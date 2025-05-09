require('colors');

const _ = require('underscore');
const mustache = require('mustache');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;

const azureDevOps = require('./azure-devops').azureDevOpsService;
const BuildError = require('../classes/BuildError');
const ChangesetBundle = require('../classes/ChangesetBundle');
const ChangesetId = require('../classes/ChangesetId');
const CommitNotFoundError = require('../classes/Errors').CommitNotFoundError;
const {BuildProject} = require('../classes/BuildProject');
const CancelledError = require('../classes/CancelledError');
const {ChangesetFile} = require('../classes/ChangesetFile');
const config = require('./config');
const {ForkedProjectOp} = require('../classes/ForkedProjectOp');
const jenkins = require('./jenkins').jenkinsService;
const {Projects, Trunks} = require('../classes/Constants');
const {SupportProject} = require('../classes/SupportProject');
const util = require('./util');
const {VersionEx} = require('../classes/VersionEx');

function auditShipment(bundle) {
  return compareAliases(bundle.supportProjects, bundle.getMetadata().changesets, undefined, ChangesetFile.Alias.PRODUCTION,
    bundle.changesets, bundle.versionsRepo);
}

function compareAliases(supportProjects, changesetsMetadata, fromTrunk, toAlias, changesetBundles, versionsRepo,
                        simpleOutput) {
  function nextCommit(history, bundleName, alias) {
    let head = history.shift();
    head.released = ChangesetFile.create(versionsRepo, bundleName).loadFromAliasByCommitOrTag(alias, head.id);
    return head;
  }

  function process(bundleName, alias, aliasChangeset, fromVersion, toVersion, changesetMap) {
    let history = aliasChangeset.getCommitHistory(alias);
    if (!history.length) return;

    let head = nextCommit(history, bundleName, alias);
    while ((!toVersion || head.released.getBundleVersion().compareTo(toVersion) > 0) && history.length > 0) {
      if (!fromVersion || head.released.getBundleVersion().compareTo(fromVersion) <= 0) {
        let trackingId = head.released.data.tracking_id;
        let version = head.released.getBundleVersion();
        let changeset = changesetMap[trackingId];
        if (!changeset) {
          changeset = {
            id: new ChangesetId(sprintf('%s:%s', bundleName, head.released.data.tracking_id)),
            merged: _.map(head.released.data.merged_tracking_ids, mergedId => {
              return {
                id: new ChangesetId(sprintf('%s:%s', bundleName, mergedId)),
                azureDevOps: undefined,
                other: undefined
              }
            }),
            version: version.toString(),
            otherTrunk: version.getTrunkName() !== fromTrunk,
            name: head.name,
            date: head.date.toLocaleString().replace(',', ''),
            sortableDate: head.date.toISOString(),
            projects: []
          };
          changesetMap[trackingId] = changeset;
        }

        let versions = head.released.getVersions();
        _.each(Object.keys(versions), function (key) {
          if (key === 'bundle_version') return;
          if (key === 'trunk') return;
          if (key === 'trunk_markers') return;
          if (_.find(changeset.projects, c => c.name === key)) return;
          if (_.contains(supportProjectInclusionKeys, key)) {
            changeset.projects.push({
              name: key
            });
          } else if ((!version.hasTrunk() && version.compareSegment(versions[key], 2) === 0) ||
            (version.hasTrunk() && versions[key].getTrunkVersion() === version.getTrunkVersion())) {
            changeset.projects.push({
              name: key,
              version: versions[key].toString()
            });
          }
        });
      }

      try {
        head = nextCommit(history, bundleName, alias);
      } catch (ex) {
        if (ex instanceof CommitNotFoundError) {
          break;
        } else {
          throw(ex);
        }
      }
    }
  }

  let supportProjectInclusionKeys = getSupportProjectInclusionKeys(supportProjects);

  util.announce(sprintf('Identifying changesets that are not in %s'.plain, toAlias));
  let changesetMap = {};
  let isProcessingTrunkOnly = true;
  _.each(Object.keys(changesetsMetadata), function (bundleName) {
    let changesetInfo = changesetsMetadata[bundleName];
    if (!['released', 'hotfix', 'production'].includes(changesetInfo.alias) && (!config._all['shipment-changeset'])) {
      util.println(sprintf('Skipping changeset identification for trunk shipments for %s bundle'.warn, bundleName));
    } else {  
      isProcessingTrunkOnly = false; 
      if (changesetInfo.alias === toAlias) return;

      let aliasChangeset = ChangesetFile.create(versionsRepo, bundleName).loadFromAlias(changesetInfo.alias);
      let toAliasChangeset = ChangesetFile.create(versionsRepo, bundleName).loadFromAlias(toAlias);

      let aliasTrunk = aliasChangeset.getTrunk() || Trunks.MASTER;
      let toAliasTrunk = toAliasChangeset.getTrunk() || Trunks.MASTER;
      let sameTrunk = aliasTrunk === toAliasTrunk;
      if (sameTrunk) {
        process(bundleName, changesetInfo.alias, aliasChangeset, undefined, toAliasChangeset.getBundleVersion(),
        changesetMap);
      }

      Object.keys(changesetBundles[bundleName].trunks).concat([Trunks.MASTER]).forEach(trunk => {
        let isMaster = trunk === Trunks.MASTER;
        if (sameTrunk && ((isMaster && !aliasTrunk) || trunk === aliasTrunk)) return;

        let trunkFile = isMaster ? changesetBundles[bundleName].releasedFile :
          changesetBundles[bundleName].trunks[trunk].trunkFile;
        if (!trunkFile) return;
        let trunkAlias = isMaster ? ChangesetFile.Alias.RELEASED : changesetBundles[bundleName].trunks[trunk].getAlias();

        let aliasVersion = aliasChangeset.getTrunkMarker(trunk);
        if (!aliasVersion && aliasTrunk === trunk) {
          aliasVersion = aliasChangeset.getBundleVersion();
        }
        if (!aliasVersion) return;
        let toAliasVersion = toAliasChangeset.getTrunkMarker(trunk);
        if (!toAliasVersion && toAliasTrunk === trunk) {
          toAliasVersion = toAliasChangeset.getBundleVersion();
        }
        if (!toAliasVersion || aliasVersion.compareTo(toAliasVersion) > 0) {
          process(bundleName, trunkAlias, trunkFile, aliasVersion, toAliasVersion, changesetMap);
        }
      });
    }
  });


  let changesets = Object.values(changesetMap);
  if (!changesets.length && !isProcessingTrunkOnly) {
    util.println('No changesets found'.warn);
  } else {
    changesets = _.sortBy(changesets, iteratee => iteratee.sortableDate).reverse();

    let changesetIds = [];
    _.each(changesets, changeset => {
      changeset.projects = _.reject(changeset.projects, c => _.contains(supportProjectInclusionKeys, c.name))
        .concat(_.filter(changeset.projects, c => _.contains(supportProjectInclusionKeys, c.name)));

      changesetIds.push(changeset.id);
      if (changeset.merged) _.each(changeset.merged, merged => changesetIds.push(merged.id));
    });

    let azureDevOpsIds = [];
    let otherIds = [];
    _.each(changesetIds, id => {
      if (_.contains(config.qualifiers.azure_devops, id.qualifier)) {
        azureDevOpsIds.push(id);
      } else {
        otherIds.push(id);
      }
    });

    let metadata = {};
    if (azureDevOpsIds.length) {
      let ids = _.map(azureDevOpsIds, id => id.ticketId);
      let workItems = azureDevOps.getWorkItemsForShipment(ids);
      _.each(azureDevOpsIds, id => {
        const workItem = workItems[id.ticketId];
        if (!workItem) {
          metadata[id.changesetId] = {
            azureDevOps: {
              id: id.ticketId,
              type: 'UNKNOWN',
              summary: 'Missing from Azure DevOps',
              url: sprintf(config.azureDevOpsBrowseUrlSpec, id.ticketId),
              status: {
                text: 'UNKNOWN',
                color: 'Red'
              }
            },
            summary: sprintf('Missing from Azure DevOps [UNKNOWN]')
          }
        } else {
          const status = workItem.fields['System.State'];
          const statusIsClosed = status === 'Closed';
          metadata[id.changesetId] = {
            azureDevOps: {
              id: workItem.id,
              type: workItem.fields['System.WorkItemType'].toUpperCase(),
              summary: workItem.fields['System.Title'],
              url: sprintf(config.azureDevOpsBrowseUrlSpec, workItem.id),
              status: {
                text: status,
                color: statusIsClosed ? 'Green' : 'Blue'
              }
            },
            summary: sprintf('%s [%s]', workItem.fields['System.Title'], status)
          };
        }
      });
    }
    _.each(otherIds, id => {
      let changeset = ChangesetFile.create(versionsRepo, id.bundleName).load(id.trackingId);
      metadata[id.changesetId] = {
        other: {
          id: id.trackingId,
          summary: changeset.data.summary
        },
        summary: changeset.data.summary
      };
    });

    changesets = _.map(changesets, changeset => {
      changeset = _.extend(changeset, metadata[changeset.id.changesetId]);
      if (changeset.merged)
        changeset.merged = _.map(changeset.merged, merged => _.extend(merged, metadata[merged.id.changesetId]));
      return changeset;
    })

    _.each(changesets, changeset => {
      util.startBullet(changeset.id.changesetId.useful);
      util.continueBullet(changeset.summary ? changeset.summary.trim().useful : undefined);
      util.continueBullet(changeset.version.plain);
      util.continueBullet(changeset.name.plain);
      util.endBullet(changeset.date.plain);
      if (changeset.merged && changeset.merged.length) {
        let indent = 1;
        if (!simpleOutput) {
          util.startSubBullet('Merged:'.plain);
          util.endBullet();
          indent++;
        }
        _.each(changeset.merged, merged => {
          util.startSubBullet(merged.id.changesetId.useful, indent);
          util.endBullet(merged.summary ? merged.summary.trim().useful : undefined);
        });
      }
      if (!simpleOutput) {
        util.startSubBullet('Included:'.trivial);
        util.endBullet();
        _.each(changeset.projects, function (project) {
          util.startSubBullet(project.name.trivial, 2);
          util.endBullet(project.version ? project.version.trivial : undefined);
        });
      }
    });
  }

  util.narrateln(JSON.stringify(changesets));
  return changesets;
}

function confirmIntent() {
  util.announce('Confirming intent'.plain);
  util.println('Please review the above details carefully before proceeding.'.useful);
  util.println('This operation will perform irreversible Changeset deletions!'.italic.useful);
  let carryOn = util.prompt('Type "yes" if you wish to proceed: '.plain);
  if (carryOn === null || !carryOn || carryOn.toLowerCase() !== 'yes') {
    throw new CancelledError();
  }
}

/**
 * @param {ForkInboundMessage} message
 */
function createChangesetBranchForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      let source = Projects.Status.PENDING;
      let created;
      if (project.getStatus(input.trunkName) !== Projects.Status.PENDING) {
        source = input.releaseTag;
        if (!project.repo.doesTagExist(source)) {
          // if releaseTag not found, assume this project was added later so use releasedTag
          source = input.releasedTag;
          if (!project.repo.doesTagExist(source)) {
            throw new BuildError(sprintf('Released tag %s is missing for %s', source, project.dirname));
          }
        }
        project.checkoutDetached(source);
        created = project.repo.createBranch(input.changesetBranch, true);

        // handle situation where branch already exists (e.g. shrink/extend or shared between bundle types)
        if (!created) {
          source = project.repo.getLatestCommitId('HEAD');
        }
      } else {
        created = project.repo.createBranch(input.changesetBranch, true);
        handleIfPending(project.repo, source);
      }

      let update = created ? 'Created'.good : input.isNew ? 'Preexisting'.warn : 'Existing'.trivial;
      ForkedProjectOp.sendInterim(project.dirname, update);

      let output = {
        project: project.toJsonObject(),
        source: source
      };

      update = util.repoStatusText(input.changesetBranch, project.repo.options.workDir, project.repo.clonePath);
      ForkedProjectOp.sendFinal(project.dirname, update, true, output);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function createChangesetBranches(bundle, projects, supportProjects, isNew) {
  util.announce(sprintf('Creating changeset branches from tag %s'.plain, bundle.changeset.getReleaseTag()));
  const inputs = _.map(projects.concat(supportProjects), project => {
    return {
      project: project,
      trunkName: bundle.changeset.getTrunk(),
      releaseTag: bundle.changeset.getReleaseTag(),
      releasedTag: bundle.getReleasedFile().getReleaseTag(),
      changesetBranch: bundle.getChangesetBranchName(),
      isNew: !!isNew
    };
  });

  /** Fork to {@link createChangesetBranchForked} */
  const result = ForkedProjectOp.run('create-changeset-branch.js', inputs);
  if (!result.success) {
    throw new BuildError(sprintf('Unable to create changeset branch for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }
  _.each(Object.keys(result.outputs), dirname => {
    const metadata = bundle.changeset.getProjectMetadata(dirname);
    if (!metadata) {
      bundle.changeset.setProjectMetadata(dirname, {source: result.outputs[dirname].source});
    }
  });
}

/**
 * @param {ForkInboundMessage} message
 */
function createOfficialBranchForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
        if (input.status === Projects.Status.PENDING) {
          project.checkout(project.getMainlineBranchName());
        } else {
          project.checkoutDetached(input.sourceTag);
        }
        project.repo.createBranch(input.targetBranch);
        ForkedProjectOp.sendInterim(project.dirname, 'Created'.good);

        project.checkout(input.targetBranch, {pull: false});
        project.repo.git('merge', '--no-commit', '--no-ff', input.sourceBranch);
        if (project.reload) {
          project.reload();
        }
        ForkedProjectOp.sendInterim(project.dirname, 'Merged'.good);

      if (input.commitMessage) {
          project.repo.addAndCommit(input.commitMessage);
          ForkedProjectOp.sendInterim(project.dirname, 'Committed'.good);
      }

      const update = util.repoStatusText(input.targetBranch, config.workDir, project.repo.clonePath);
      ForkedProjectOp.sendFinal(project.dirname, update, true, {
        project: project.toJsonObject()
      });
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function createOfficialBranches(trunkName, projects, descriptor, sourceTag, sourceBranch, targetBranch, commitMessage) {
  util.announce(sprintf('Creating %s branches from tag %s'.plain, descriptor, sourceTag));
  const inputs = _.map(projects, project => {
    return {
      project: project,
      status: project.getStatus(trunkName),
      sourceTag: sourceTag,
      targetBranch: targetBranch,
      sourceBranch: sourceBranch,
      commitMessage: commitMessage
    };
  })

  /** Fork to {@link createOfficialBranchForked} */
  const result = ForkedProjectOp.run('create-official-branch.js', inputs);
  if (!result.success) {
    throw new BuildError(sprintf('Unable to create official branch for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }
}

function documentChangesets(changesets) {
  if (!changesets || !changesets.length) return;

  // prepare for pretty output
  _.each(changesets, function (changeset) {
    changeset.projectVersions = [];
    changeset.supportProjects = [];
    _.each(changeset.projects, function (project) {
      if (project.version) {
        changeset.projectVersions.push({
          name: project.name.replace('_version', '').replace(/_/g, ' '),
          version: project.version
        });
      } else {
        changeset.supportProjects.push({
          name: project.name.replace('includes_', '').replace(/_/g, ' ')
        });
      }
    });
    delete changeset.projects;
  });

  let template = util.readFile(path.join(process.env.NODE_BASE_DIRECTORY, 'res', 'shipment-template.txt'));
  let model = {
    shipmentId: config._all['shipment-id'],
    changesets: changesets
  };
  let text = mustache.render(template, model).replace(/^\s+|\s+$/gm, '').replace(/[\r\n]+/g, '');

  util.announce('Generating Confluence markup'.plain);
  util.println('Copy/paste the following block into a Source Editor for Confluence:');
  util.println(text.trivial.italic);
  util.println();
}

function ensureCorrectPomAndDependencyVersions(bundle) {
  let versionMap = bundle.mapVersions(bundle.projects.included, VersionEx.LITERAL);
  let discrepancies = [];

  _.each(bundle.projects.included, function (project) {
    let actualPomVersion = project.pom.getVersion();
    let expected = versionMap[project.pom.getCanonicalArtifactId()];
    if (actualPomVersion !== expected) {
      discrepancies.push(
        sprintf('%s %s %s expected %s, not %s', config.display.bulletChar, project.dirname, config.display.arrowChar,
          expected, actualPomVersion));
    }
    util.narratef("Check version: %s", project.pom.getCanonicalArtifactId());
    _.each(project.pom.dependencies, function (dependency) {
      let dependencyId = dependency.getCanonicalArtifactId();
      let expected = versionMap[dependencyId];
      if (expected) {
        let actual = dependency.getResolvedVersion();
        util.narratef("  Check dependency version: %s", dependencyId);
        if (actual && actual !== expected) {
          discrepancies.push(
            sprintf('%s %s %s %s %s expected %s, not %s', config.display.bulletChar, project.dirname,
              config.display.arrowChar, dependencyId, config.display.arrowChar, expected, actual));
        }
      } else {
        if (config.trackedArtifactsGroupRegex.test(dependency.getGroupId())) {
          let actual = dependency.getResolvedVersion();
          if (actual) {
            if (dependency.isProjectVersionReference()) {
              util.narratef("  Check dependency version: %s (Skipping: '%s')\n", dependencyId, dependency.getVersion());
            } else {
              util.narratef("  Check dependency version: %s\n", dependencyId);
              let version = new VersionEx(actual);
              if (version.hasTrackingId()) {
                discrepancies.push(
                  sprintf('%s %s %s %s %s illegal external changeset %s', config.display.bulletChar, project.dirname,
                    config.display.arrowChar, dependencyId, config.display.arrowChar, actual));
              }
            }
          }
        }
      }
    });
  });

  if (discrepancies.length) {
    throw new BuildError(
      sprintf('One or more incorrect POM or dependency versions identified; please correct\n\nDiscrepant:\n%s',
        discrepancies.join('\n')));
  }
}

function ensureCorrectSourceBundleVersion(bundle) {
  // Check that we have the right source_bundle_version
  let sourceVersion = bundle.changeset.getBundleVersion();

  let expectedFile = bundle.changeset.isHotfix() ?
    bundle.hotfixFile || bundle.productionFile :
    bundle.changeset.onTrunk() ?
      bundle.trunks[bundle.changeset.getTrunk()].trunkFile :
      bundle.releasedFile;
  if (!expectedFile) {
    return;
  }
  let expectedVersion = expectedFile.getBundleVersion();
  if (!sourceVersion.equals(expectedVersion)) {
    if (bundle.changeset.isHotfix()) {
      throw new BuildError(
        sprintf('Hotfix was started from %s and production is now at %s; you need to pull', sourceVersion,
          expectedVersion));
    } else if (bundle.changeset.onTrunk()) {
      throw new BuildError(
        sprintf('Changeset is up-to-date with %s but trunk is now %s; you need to pull', sourceVersion,
          expectedVersion));
    } else {
      throw new BuildError(
        sprintf('Changeset is up-to-date with %s but released is now %s; you need to pull', sourceVersion,
          expectedVersion));
    }
  }
}

function ensureCorrectVersionsForExcludedProjects(bundle, changeset) {
  let allVersionsAreCorrect = true;
  util.announce('Confirming versions for excluded projects'.plain);
  let compareToChangeset =
    bundle.changeset.isHotfix() ?
      bundle.hotfixFile || bundle.productionFile :
      bundle.changeset.onTrunk() ?
        bundle.trunks[bundle.changeset.getTrunk()].trunkFile || bundle.changeset :
        bundle.releasedFile;
  let toRemove = [];
  _.each(bundle.projects.excluded, function (project) {
    _.each(util.asArray(project.getVersionsKey()), function (versionKey) {
      let expectedVersion = compareToChangeset.getVersion(versionKey);
      if (expectedVersion !== undefined) {
        util.startBullet(project.dirname.plain);
        util.continueBullet(versionKey.plain);
        let actualVersion = changeset.getVersion(versionKey);
        if (actualVersion.compareTo(expectedVersion) === 0) {
          util.endBullet(sprintf('Matches version %s'.trivial, actualVersion.toString().good));
        } else {
          allVersionsAreCorrect = false;
          util.endBullet(sprintf('Expected version %s; actual version is %s'.bad, expectedVersion.toString(),
            actualVersion.toString()));
        }
      } else {
        // remove from excluded versions -- this may occur when new projects added but we're working on a hotfix from
        // before it was added
        toRemove.push(project.dirname);
      }
    });
  });
  if (allVersionsAreCorrect && toRemove.length > 0) {
    bundle.projects.all =
      _.filter(bundle.projects.all, function (project) {
        return toRemove.indexOf(project.dirname) < 0
      });
    bundle.projects.valid =
      _.filter(bundle.projects.valid, function (project) {
        return toRemove.indexOf(project.dirname) < 0
      });
    bundle.projects.excluded =
      _.filter(bundle.projects.excluded, function (project) {
        return toRemove.indexOf(project.dirname) < 0
      });
  }
  return allVersionsAreCorrect;
}

function ensureManifestMatchesChangeset(versionsRepo, alias, changesetId) {
  let manifest = ChangesetFile.create(versionsRepo, changesetId.bundleName);
  if (!manifest.doesAliasExist(alias)) {
    throw new BuildError(sprintf('There is no %s in progress', alias));
  }
  manifest.loadFromAlias(alias);
  if (manifest.getValue('tracking_id') !== changesetId.trackingId) {
    throw new BuildError(sprintf('The %s was started from a different changeset', alias));
  }
  return manifest;
}

function ensureStatusIs(changeset, statuses) {
  if (!changeset.inStatus(util.asArray(statuses))) {
    throw new BuildError(sprintf('Status mismatch: %s is not in [%s]', changeset.getStatus(), statuses));
  }
  return true;
}

function getSupportProjectInclusionKeys(supportProjects) {
  let supportProjectInclusionKeys = [];
  _.each(supportProjects, function (project) {
    supportProjectInclusionKeys.push(project.definition.inclusion_key);
  });
  return supportProjectInclusionKeys;
}

function handleIfPending(repo, target) {
  if (target === Projects.Status.PENDING && !repo.doesBranchExist(target)) {
    repo.createPendingMarkerCommit(target);
    return true;
  }
  return false;
}

function postPRLinks(changesetId, links) {
  azureDevOps.postPRLinks(changesetId, links);
}

function prepareChangeset(bundle, options) {
  options = _.extend({
    isNew: false,
    explicitProjectsToAdd: undefined
  }, options);

  let projects = bundle.projects.included;
  let supportProjects = bundle.supportProjects.included;
  if (options.explicitProjectsToAdd) {
    projects = _.filter(projects, project => _.contains(options.explicitProjectsToAdd, project.dirname));
    supportProjects = _.filter(supportProjects, project => _.contains(options.explicitProjectsToAdd, project.dirname));
  }

  createChangesetBranches(bundle, projects, supportProjects, options.isNew);
  if (projects.length > 0) {
    updateProjectPomVersions(projects);
    updateProjectPomDependencies(bundle);
  }

  // Update changeset
  let changeset = bundle.changeset;
  changeset.setValue('tracking_id', config.changesetId.trackingId);
  if (config._all.trunk) {
    changeset.setTrunk(config._all.trunk);
  }
  changeset.setValue('hotfix', !!config._all.hotfix || changeset.isHotfix());
  changeset.addProjectVersions(projects);
  changeset.removeSupportProjectInclusion(bundle.supportProjects, true);
  changeset.updateSupportProjectInclusion(bundle.supportProjects);

  if (_.isFunction(options.callback)) {
    options.callback.call(this, {changeset: changeset});
  }

  synchronizeChangeset(bundle, {update: false, invalidOk: !options.isNew});

  changeset.saveAsChangeset(config.changesetId);

  updateSourceControl(bundle);
}

function pullExcludedVersionsFromChangeset(projects, sourceChangeset, targetChangeset, updateSourceBundleVersion) {
  let sourceVersion = sourceChangeset.getBundleVersion();
  if (projects && projects.length) {
    util.announce(sprintf('Updating project versions from bundle %s'.plain, sourceVersion));
    _.each(projects, function (project) {
      util.startBullet(project.dirname.plain);
      let update = targetChangeset.updateFrom(sourceChangeset, util.asArray(project.definition.versions_key));
      if (update) {
        for (let i = 0; i < update.length; i++) {
          if (i > 0) util.startBullet(project.dirname.plain);
          util.continueBullet('Updated'.good);
          util.continueBullet(update[i].key.useful);
          if (update[i].from !== undefined) {
            util.endBullet(sprintf('From %s to %s'.trivial, update[i].from, update[i].to.good));
          } else {
            util.endBullet(sprintf('To %s'.trivial, update[i].to.good));
          }
        }
      } else {
        util.endBullet('No change'.trivial);
      }
    });
  }
  if (updateSourceBundleVersion && sourceVersion.compareTo(targetChangeset.getBundleVersion()) > 0) {
    targetChangeset.setSourceBundleVersion(sourceVersion.toString());
  }
  return sourceVersion;
}

/**
 * @param {ForkInboundMessage} message
 */
function removeAllBranchesForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      project.repo.deleteLocalAndRemoteBranch(input.changesetBranch, input.options);
      if (project.repo.doesBranchExist(input.reviewSourceBranch)) {
        project.repo.deleteLocalAndRemoteBranch(input.reviewSourceBranch, input.options);
      }
      if (project.repo.doesBranchExist(input.reviewTargetBranch)) {
        project.repo.deleteLocalAndRemoteBranch(input.reviewTargetBranch, input.options);
      }

      ForkedProjectOp.sendFinal(project.dirname, 'Deleted & pushed'.good, true, undefined);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function removeChangesetAndReviewBranches(bundle, projects, options) {
  options = _.extend({
    quiet: false,
    localOnly: false
  }, options);
  let reviewSourceBranch = bundle.getReviewSourceBranchName();
  let reviewTargetBranch = bundle.getReviewTargetBranchName();

  !options.quiet && util.announce('Removing changeset and review branches'.plain);

  const inputs = _.map(projects, project => {
    return {
      project: project,
      changesetBranch: bundle.getChangesetBranchName(),
      reviewSourceBranch: reviewSourceBranch,
      reviewTargetBranch: reviewTargetBranch,
      options: options
    }
  });

  /** Fork to {@link removeAllBranchesForked} */
  const result = ForkedProjectOp.run('remove-all-branches.js', inputs, {silent: options.quiet});
  if (!result.success) {
    throw new BuildError(sprintf('Unable to remove all branches for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }
}

function removeProjectsFromChangeset(bundle, projectsToRemove, isRetired) {
  if (!projectsToRemove || !projectsToRemove.length) return;

  let removedProjects = _.filter(projectsToRemove, project => project instanceof BuildProject);
  let removedSupportProjects = _.filter(projectsToRemove, project => project instanceof SupportProject);

  let includedProjects = _.difference(bundle.projects.included, removedProjects);
  let includedSupportProjects = _.difference(bundle.supportProjects.included, removedSupportProjects);

  let originalVersionsMap = bundle.mapVersions(removedProjects,
    isRetired ? VersionEx.RETIRED : VersionEx.RELEASED);
  let versionMap = bundle.mapVersions(bundle.projects.included, VersionEx.LITERAL);
  Object.assign(versionMap, originalVersionsMap);

  util.announce('Identifying changeset YAML updates'.plain);
  _.each(bundle.changeset.updateIncludedVersionsFromVersionMap(removedProjects, versionMap), update => {
    util.startBullet(update.key.plain);
    if (update.after !== VersionEx.RETIRED) {
      util.endBullet(sprintf('From %s to %s'.trivial, update.before, update.after.good));
    } else {
      util.endBullet('Removed'.good);
    }
  });
  _.each(bundle.changeset.removeSupportProjectInclusion({
    all: bundle.supportProjects.all,
    included: removedSupportProjects
  }), key => {
    util.startBullet(key.plain);
    util.endBullet('Removed'.good);
  });
  bundle.changeset.save();

  util.announce('Identifying POM dependency updates'.plain);
  bundle.useCurrentVersions(includedProjects, versionMap);

  if (!isRetired) {
    // give the user a chance to bail out
    confirmIntent();
  }

  let localBundle;
  let removedNames = _.pluck(projectsToRemove, 'dirname');
  if (!isRetired) {
    util.announce('Initializing secondary'.plain);
    localBundle = new ChangesetBundle(bundle.configFile, bundle.versionsRepo, 'local');
    localBundle.init({
      workDir: util.cwd(),
      checkout: [Projects.GitTarget.TAG_PREFIX + bundle.changeset.getReleaseTag(), Projects.GitTarget.MAINLINE],
      includeList: removedNames,
      trackingIdMatch: false
    });
  }

  _.each(projectsToRemove, project => {
    bundle.changeset.setProjectMetadata(project.dirname, undefined);
  });
  bundle.changeset.save();

  bundle.projects.included = includedProjects;
  bundle.supportProjects.included = includedSupportProjects;

  if (!isRetired) {
    updateSourceControl(bundle);
  } else {
    bundle.projects.included.forEach(project => {
      project.pom.saveAll();
      project.repo.addAndCommit(bundle.invocation.getCommitMessage('retired ' + removedNames.join(', ')))
    });
  }

  removeChangesetAndReviewBranches(bundle, projectsToRemove);
  if (localBundle) {
    removeChangesetAndReviewBranches(localBundle, localBundle.getAllIncludedProjects(),
      {quiet: true, localOnly: true});
  }
  if (isRetired) {
    _removeTrunkMainlineBranches(bundle, projectsToRemove);
  }
}

/**
 * Synchronizes the changeset with external ticketing system, e.g. Azure DevOps.
 * @param {ChangesetBundle} bundle
 * @param [options]
 * @param {boolean} [options.force=false]
 * @param {boolean} [options.invalidOk=false]
 * @param {boolean} [options.update]
 * @returns {boolean} True, if an update occurred; otherwise, false.
 */
function synchronizeChangeset(bundle, options) {
  options = _.extend({
    force: false,
    invalidOk: true,
    update: true
  }, options);
  if (bundle.changeset.getValue('summary') && !options.force) {
    return;
  }

  let updated = undefined;
  if (_.contains(config.qualifiers.azure_devops, config.changesetId.qualifier)) {
    options.skip = !!config.debug.skip_azure_devops_interaction;
    updated = _synchronizeChangeset(bundle.changeset, 'Azure DevOps', azureDevOps.getWorkItemSummary, options);
  } else {
    util.announce('Retrieving data from non-automated source'.plain);
    let summary = util.prompt('Enter changeset summmary: '.plain);
    if (summary) {
      bundle.changeset.setValue('summary', summary);
      updated = true;
    } else
      updated = false;
  }
  if (updated && options.update) {
    bundle.changeset.save();
    updateSourceControl(bundle,
      {silent: true, skipProjects: true, message: bundle.invocation.getCommitMessage()});
  }
  return updated;
}

function triggerBuild(bundle, explicitProjects, reviewStatus, options) {
  options = _.extend({
    announceIt: false,
    addDependencies: true,
    addDownstream: false
  }, options);

  function announceIt(text) {
    if (options.announceIt) {
      if (projectsToBuild.length > explicitProjects.length) {
        util.announce(text.plain);
        _.each(projectsToBuild, function (project) {
          if (!explicitProjects.includes(project)) {
            util.startBullet(project.dirname.plain);
            util.endBullet('Added'.good);
          }
        });
      }
    }
  }

  if (options.announceIt) {
    util.announce('Including identified projects for build'.plain);
    _.each(explicitProjects, function (project) {
      util.startBullet(project.dirname.plain);
      util.endBullet('Added'.good);
    });
  }

  let projectsToBuild;
  if (options.addDependencies) {
    projectsToBuild = bundle.addDependentProjects(bundle.projects.included, explicitProjects);
    announceIt('Including dependent projects for build');
  } else {
    projectsToBuild = explicitProjects;
  }

  explicitProjects = projectsToBuild.slice();
  if (options.addDownstream) {
    projectsToBuild = bundle.addDownstreamProjects(bundle.projects.included, projectsToBuild);
    announceIt('Including downstream projects for build');
  }

  let reviewSourceBranch = bundle.getReviewSourceBranchName();
  _.each(projectsToBuild, function (project) {
    let status = reviewStatus[project.dirname];
    if ((status && status.hasBranches) || project.hasNewReviewBranches) {
      project.branchToBuild = reviewSourceBranch;
    }
  });

  let orchestrationArray = jenkins.buildOrchestration(projectsToBuild, bundle.getChangesetBranchName(), false);
  jenkins.postOrchestration(orchestrationArray);
}

function triggerBuildFromIncludes(bundle, reviewStatus, options) {
  options = _.extend({
    announceIt: !!config._all['include'],
    addDependencies: true,
    addDownstream: false
  }, options);
  let explicitProjects = config._all['include'] ? bundle.getIncludedProjectsByName(config._all['include']) :
    bundle.projects.included;
  triggerBuild(bundle, explicitProjects, reviewStatus, options);
}

/**
 * @param {ChangesetBundle} bundle
 */
function updateProjectPomDependencies(bundle) {
  // Update dependencies between projects
  util.announce('Updating POM dependencies'.plain);
  let versionMap = bundle.mapVersions(bundle.projects.included, VersionEx.LITERAL);
  bundle.useCurrentVersions(bundle.getIncludedProjectsWithPassiveDependencies(), versionMap);

  bundle.addVersionsForArtifacts(bundle.changeset, versionMap);
  bundle.useCurrentVersions(bundle.getIncludedProjectsWithActiveDependencies(), versionMap);
}

function updateProjectPomVersions(projects) {
  util.announce('Updating POM versions'.plain);
  _.each(projects, function (project) {
    let projectVersion = new VersionEx(project.pom.getVersion());
    if (projectVersion.hasTrackingId()) {
      if (projectVersion.getTrackingId() !== config.changesetId.trackingId) {
        throw new BuildError(
          sprintf('POM has unexpected version %s; look for incorrect merges', projectVersion.toString()));
      }
    } else {
      let changesetVersion = projectVersion.clone();
      let qualifiers = [];
      if (changesetVersion.hasTrunk()) {
        qualifiers.push(changesetVersion.getTrunk());
      }
      qualifiers.push(config.changesetId.qualifier, config.changesetId.qualifierId, 'SNAPSHOT')
      changesetVersion.setQualifiers(qualifiers);
      changesetVersion.resize(changesetVersion.segments - 1);
      project.pom.setVersion(changesetVersion.getSnapshotString());
      if (projectVersion.toString() !== changesetVersion.getSnapshotString()) {
        util.startBullet(project.dirname.plain);
        util.endBullet(
          sprintf('From %s to %s'.trivial, projectVersion.toString(), changesetVersion.getSnapshotString().good));
      }
    }
  });
}

function updateProjectPomVersionsFromMap(projects, versionMap, options) {
  options = _.extend({
    silent: false
  }, options);
  options.silent || util.announce(sprintf('Updating POM versions'.plain, this.instanceName));
  _.each(projects, function (project) {
    if (project instanceof BuildProject) {
      let currentVersion = project.pom.getVersion();
      let expectedVersion = versionMap[project.pom.getCanonicalArtifactId()];
      if (expectedVersion && currentVersion !== expectedVersion) {
        if (!options.silent) {
          util.startBullet(project.dirname.plain);
          util.util.endBullet(sprintf('From %s to %s'.trivial, currentVersion, expectedVersion.good));
        }
        project.pom.setVersion(expectedVersion);
        project.pom.saveAll();
      }
    }
  });
}

function updateSourceControl(bundle, options) {
  options = _.extend({
    silent: false,
    skipProjects: false,
    skipVersionsRepo: false,
    message: bundle.invocation.getCommitMessage(),
    projects: bundle.getAllIncludedProjects(),
    savePoms: true,
    retryWithPull: true,
    tags: false,
    announceText: 'Updating source control',
    successText: 'Committed & pushed'.good,
    noOpText: 'No changes'.trivial
  }, options);
  options.silent || util.announce(options.announceText.plain);
  if (!options.skipProjects) {
    const inputs = _.map(options.projects, project => {
      return {
        project: project,
        message: options.message,
        savePoms: options.savePoms,
        retryWithPull: options.retryWithPull,
        tags: options.tags,
        successText: options.successText,
        noOpText: options.noOpText
      }
    });

    /** Fork to {@link updateSourceControlForked} */
    const result = ForkedProjectOp.run('update-source-control.js', inputs, {silent: options.silent});
    if (!result.success) {
      throw new BuildError(sprintf('Unable to update source control for %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }
  }

  if (!options.skipVersionsRepo) {
    options.silent || util.startBullet(bundle.versionsRepo.dirname.plain);
    if (bundle.versionsRepo.checkIn({
      message: options.message
    })) {
      options.silent || util.endBullet(options.successText);
    } else {
      options.silent || util.endBullet(options.noOpText);
    }
  }
}

/**
 * @param {ForkInboundMessage} message
 */
function updateSourceControlForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      if (input.savePoms && project.pom) {
        project.pom.saveAll();
      }
      let update;
      if (project.repo.checkIn({
        message: input.message,
        retryWithPull: input.retryWithPull,
        tags: input.tags
      })) {
        update = input.successText;
      } else {
        update = input.noOpText;
      }
      ForkedProjectOp.sendFinal(project.dirname, update, true, undefined);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function _removeTrunkMainlineBranches(bundle, projects) {
  if (!bundle.changeset.onTrunk()) return;
  let supportProjects = _.filter(projects, project => project instanceof SupportProject);
  if (!supportProjects.length) return;
  util.announce('Removing trunk mainline branches'.plain);
  _.each(supportProjects, project => {
    util.startBullet(project.dirname.plain);
    project.repo.deleteLocalAndRemoteBranch(bundle.changeset.getTrunkMainlineBranchNameForSupportProjects());
    util.endBullet('Deleted & pushed'.good);
  });
}

function _synchronizeChangeset(changeset, sourceName, summaryFunction, options) {
  options = _.extend({
    invalidOk: true,
    skip: false
  }, options);
  let previousSummary = changeset.getValue('summary');
  let updatedSummary = undefined;

  util.announce(sprintf('Retrieving data from %s'.plain, sourceName));
  if (options.skip) {
    util.println('Skipping interaction'.italic);
    updatedSummary = previousSummary || 'Mock summary from ' + sourceName;
  } else {
    updatedSummary = summaryFunction.call(azureDevOps, config.changesetId, options);
  }

  if (updatedSummary === previousSummary) {
    return false;
  }

  changeset.setValue('summary', updatedSummary.trim());
  util.startBullet('summary'.plain);
  util.endBullet(updatedSummary.plain.italic);
  return true;
}

module.exports = {
  auditShipment: auditShipment,
  compareAliases: compareAliases,
  confirmIntent: confirmIntent,
  createChangesetBranchForked: createChangesetBranchForked,
  createChangesetBranches: createChangesetBranches,
  createOfficialBranchForked: createOfficialBranchForked,
  createOfficialBranches: createOfficialBranches,
  documentChangesets: documentChangesets,
  ensureCorrectPomAndDependencyVersions: ensureCorrectPomAndDependencyVersions,
  ensureCorrectSourceBundleVersion: ensureCorrectSourceBundleVersion,
  ensureCorrectVersionsForExcludedProjects: ensureCorrectVersionsForExcludedProjects,
  ensureManifestMatchesChangeset: ensureManifestMatchesChangeset,
  ensureStatusIs: ensureStatusIs,
  handleIfPending: handleIfPending,
  getSupportProjectInclusionKeys: getSupportProjectInclusionKeys,
  prepareChangeset: prepareChangeset,
  postPRLinks: postPRLinks,
  pullExcludedVersionsFromChangeset: pullExcludedVersionsFromChangeset,
  removeAllBranchesForked: removeAllBranchesForked,
  removeChangesetAndReviewBranches: removeChangesetAndReviewBranches,
  removeProjectsFromChangeset: removeProjectsFromChangeset,
  synchronizeChangeset: synchronizeChangeset,
  triggerBuild: triggerBuild,
  triggerBuildFromIncludes: triggerBuildFromIncludes,
  updateProjectPomDependencies: updateProjectPomDependencies,
  updateProjectPomVersions: updateProjectPomVersions,
  updateProjectPomVersionsFromMap: updateProjectPomVersionsFromMap,
  updateSourceControl: updateSourceControl,
  updateSourceControlForked: updateSourceControlForked
}
