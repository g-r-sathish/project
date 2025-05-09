const _ = require('underscore');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../classes/BuildError');
const {BuildProject} = require('../classes/BuildProject');
const CancelledError = require('../classes/CancelledError');
const {ChangesetFile} = require('../classes/ChangesetFile');
const config = require('./config');
const Errors = require('../classes/Errors');
const {ForkedProjectOp} = require('../classes/ForkedProjectOp');
const Invocation = require('../classes/Invocation');
const {POM} = require('../classes/POM');
const {Projects, Trunks} = require('../classes/Constants');
const reviewUtil = require('./review-util');
const rflowUtil = require('./rflow-util');
const {SupportProject} = require('../classes/SupportProject');
const util = require('./util');
const {VersionEx} = require('../classes/VersionEx');

/**
 * @param {ForkInboundMessage} message
 */
function checkoutOtherForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const priorTag = input.priorTag;
      const releaseTag = input.releaseTag;

      project.repo.options.workDir = util.cwd();
      if (!priorTag || !releaseTag) {
        ForkedProjectOp.sendFinal(project.dirname, 'Missing context'.bad, true, undefined);
        return;
      }
      if (project.repo.hasCloned()) {
        let branch = project.repo.getCurrentBranch();
        let tags = project.repo.getTagsForHead();
        if (!branch && _.contains(tags, priorTag)) {
          if (!_.contains(tags, releaseTag)) {
            project.repo.fetch();
            project.checkoutDetached(releaseTag);
            ForkedProjectOp.sendInterim(project.dirname, 'Updated'.good);
            const update = util.repoStatusText(Projects.GitTarget.TAG_PREFIX + releaseTag, project.repo.options.workDir,
              project.repo.clonePath);
            ForkedProjectOp.sendFinal(project.dirname, update, true, undefined);
          } else {
            ForkedProjectOp.sendInterim(project.dirname, 'Current'.trivial);
            const update = util.repoStatusText(project.repo.getHeadLabel(), project.repo.options.workDir,
              project.repo.clonePath);
            ForkedProjectOp.sendFinal(project.dirname, update, true, undefined);
          }
        } else {
          ForkedProjectOp.sendInterim(project.dirname, 'Ignored'.trivial);
          ForkedProjectOp.sendFinal(project.dirname, 'Other origin'.trivial, true, undefined);
        }
      } else {
        ForkedProjectOp.sendInterim(project.dirname, 'Ignored'.trivial);
        ForkedProjectOp.sendFinal(project.dirname, 'Not cloned'.trivial, true, undefined);
      }
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

/**
 * @param {ForkInboundMessage} message
 */
function determineActionForExcludedProjectForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const ourChangeset = ChangesetFile.fromJsonObject(input.ourChangeset);
      const ourTrunk = input.ourTrunk;
      const theirChangeset = ChangesetFile.fromJsonObject(input.theirChangeset);
      const theirTrunk = input.theirTrunk;
      const sameTrunk = input.sameTrunk;
      const latestReleaseTag = input.latestReleaseTag;
      const instanceName = input.instanceName;

      const projectsToRemove = [];
      const projectsToAdd = [];
      const mergeMap = {};
      const versionsToUpdate = {};

      let sendFinal = () => {
        ForkedProjectOp.sendFinal(project.dirname, undefined, true, {
          removeProject: !!projectsToRemove.length,
          addProject: !!projectsToAdd.length,
          mergeMap: mergeMap,
          versionsToUpdate: versionsToUpdate
        });
      };

      if (_processProjectByStatus(project, ourChangeset, theirTrunk, projectsToRemove)) {
        sendFinal();
        return;
      }

      let headCommits = _compareHeadCommits(project, ourChangeset, theirChangeset, latestReleaseTag);
      if (project instanceof BuildProject) {
        if (headCommits.oursHasTheirs && !headCommits.same) {
          _markVersionToKeep(project, ourChangeset, headCommits);
          sendFinal();
          return;
        }

        let ourVersion = ourChangeset.getVersion(project.getPrimaryVersionsKey());
        let theirVersion = theirChangeset.getVersion(project.getPrimaryVersionsKey());
        if (!ourVersion || theirVersion.hasTrackingId()) {
          _markProjectToAdd(project, projectsToAdd, theirChangeset, mergeMap, instanceName, headCommits, sameTrunk);
          sendFinal();
          return;
        }

        let ourVersionTrunk = ourVersion.getTrunkName();
        let theirVersionTrunk = theirVersion.getTrunkName();
        let sameVersionTrunk = ourVersionTrunk === theirVersionTrunk && ourVersion.getHotfix() ===
          theirVersion.getHotfix();

        // this is a little bit paranoid, but better safe than sorry
        let ourVersionDominates = (sameVersionTrunk && ourVersion.compareTo(theirVersion) >= 0)
          || (ourTrunk && !theirVersionTrunk && ourVersionTrunk === ourTrunk);
        if (headCommits.oursHasTheirs && (!sameTrunk || ourVersionDominates)) {
          _markVersionToKeep(project, ourChangeset, headCommits);
          sendFinal();
          return;
        }

        let theirVersionDominates = (sameVersionTrunk && theirVersion.compareTo(ourVersion) > 0)
          || (ourTrunk && !ourVersionTrunk && theirVersionTrunk === ourVersion);
        if (headCommits.theirsHasOurs && sameTrunk && theirVersionDominates) {
          _markVersionToUpdate(project, theirChangeset, versionsToUpdate, headCommits);
          sendFinal();
          return;
        }

        _markProjectToAdd(project, projectsToAdd, theirChangeset, mergeMap, instanceName, headCommits);
      } else if (project instanceof SupportProject) {
        if (headCommits.same || headCommits.oursHasTheirs) {
          _markVersionToKeep(project, ourChangeset, headCommits);
        } else {
          _markProjectToAdd(project, projectsToAdd, theirChangeset, mergeMap, instanceName, headCommits, sameTrunk);
        }
      } else {
        throw new BuildError('Unexpected project type');
      }

      sendFinal();
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

/**
 * @param {ForkInboundMessage} message
 */
function determineActionForIncludedProjectForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const ourChangeset = ChangesetFile.fromJsonObject(input.ourChangeset);
      const theirChangeset = ChangesetFile.fromJsonObject(input.theirChangeset);
      const theirTrunk = input.theirTrunk;
      const sameTrunk = input.sameTrunk;
      const instanceName = input.instanceName;

      const projectsToRemove = [];
      const mergeMap = {};
      const versionsToUpdate = {};

      let sendFinal = () => {
        ForkedProjectOp.sendFinal(project.dirname, undefined, true, {
          removeProject: !!projectsToRemove.length,
          mergeMap: mergeMap,
          versionsToUpdate: versionsToUpdate
        });
      };

      // TODO: what to do about PENDING support project when trunk/xxxx branch already exists (and may have newer commit)

      if (!_processProjectByStatus(project, ourChangeset, theirTrunk, projectsToRemove)) {
        _markProjectToMerge(project, theirChangeset, mergeMap, instanceName, sameTrunk);
      }
      sendFinal();
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

// Ensure local repos are in a good state to receive a merge
function ensureGoodStateForMerge(bundle) {
  util.announce('Verifying status'.plain);
  let projectsOk = _verifyStatus(bundle.projects.included);
  let supportProjectsOk = _verifyStatus(bundle.supportProjects.included);
  if (!projectsOk || !supportProjectsOk) {
    throw new BuildError('Pull cannot proceed; local repositories need attention before you can proceed');
  }
}

function merge(bundle, theirChangeset, reviewStatus, isPull) {
  const ourChangeset = bundle.changeset;
  const ourTrunk = ourChangeset.getTrunk();
  const theirTrunk = theirChangeset.getTrunk();
  const sameTrunk = ourTrunk === theirTrunk;

  const instanceName = bundle.instanceName;

  const trunkMarkerUpdates = reviewUtil.identifyTrunkMarkerUpdates(ourChangeset, theirChangeset, bundle.trunks);

  const graduates = _graduateProjects(bundle, ourChangeset, theirChangeset, {ours:true, theirs:true});
  const graduatesEligibleToAdd = isPull ? graduates.active : graduates.pendingOrActive;

  const mergeMap = {};
  _addInstanceToMergeMap(mergeMap, bundle.instanceName);

  const projectsToAdd = [];
  const projectsToRemove = [];
  const versionsToUpdate = {};

  const includedProjects = bundle.getAllIncludedProjects();
  if (includedProjects.length) {
    util.announce('Determining actions for included projects'.plain);
    const inputs = _.map(includedProjects, project => {
      return {
        project: project,
        ourChangeset: ourChangeset,
        theirChangeset: theirChangeset,
        theirTrunk: theirTrunk,
        sameTrunk: sameTrunk,
        instanceName: instanceName
      }
    });

    /** Fork to {@link determineActionForIncludedProjectForked } */
    const result = ForkedProjectOp.run('determine-action-included-project.js', inputs);
    _processDeterminedActionsResult(bundle, result, projectsToRemove, projectsToAdd, versionsToUpdate, mergeMap,
      instanceName);
  }

  const excludedProjects = bundle.getAllExcludedProjects().concat(graduatesEligibleToAdd);

  if (excludedProjects.length) {
    util.announce('Checking out excluded projects'.plain);

    bundle.checkout(excludedProjects, {
      checkout: Projects.GitTarget.TAG_PREFIX + ourChangeset.getReleaseTag(),
      workDir: config.workDir,
      okIfMissing: true
    });

    // have to checkout before we can exclude so that project.existsInProduction is populated
    const relevantExcludedProjects = _.filter(excludedProjects,
      project => !theirChangeset.isProductionFile() || project.existsInProduction);

    const latestReleaseTag = bundle.getReleasedFile().getReleaseTag();

    util.announce('Determining actions for excluded projects'.plain);
    const inputs = _.map(relevantExcludedProjects, project => {
        return {
          project: project,
          ourChangeset: ourChangeset,
          ourTrunk: ourTrunk,
          theirChangeset: theirChangeset,
          theirTrunk: theirTrunk,
          sameTrunk: sameTrunk,
          latestReleaseTag: latestReleaseTag,
          instanceName: instanceName
        }
      });

    /** Fork to {@link determineActionForExcludedProjectForked} */
    const result = ForkedProjectOp.run('determine-action-excluded-project.js', inputs);
    _processDeterminedActionsResult(bundle, result, projectsToRemove, projectsToAdd, versionsToUpdate, mergeMap,
      instanceName);
  }

  const approvedMergeParents = reviewUtil.getApprovedMergeParentsAndConfirmUnapprovedIsOk(bundle, theirChangeset,
    projectsToAdd, isPull);

  const commitAddendum = isPull ? sprintf('from %s', theirChangeset.getReleaseTag()) : '';
  const commitMessage = bundle.invocation.getCommitMessage(commitAddendum);
  _addProjectsToChangeset(bundle, projectsToAdd, graduatesEligibleToAdd, {
    workDir: util.cwd(),
    guarantee: true,
    commitMessage: commitMessage
  });

  if (projectsToRemove.length) {
    rflowUtil.removeProjectsFromChangeset(bundle, projectsToRemove, true);
  }

  const reviewBundle = reviewUtil.initializeReviewBundle(bundle, reviewStatus, approvedMergeParents);
  const reviewProjectTargets = {};
  _.each(Object.keys(mergeMap[bundle.instanceName]), key => {
    _.each(mergeMap[bundle.instanceName][key], dirname => {
      reviewProjectTargets[dirname] = key;
    });
  });
  _.each(reviewBundle.projects.included, project => {
    let target = reviewProjectTargets[project.dirname];
    if (target) {
      _doAddToMergeMap(mergeMap, reviewBundle.instanceName, target, project);
    }
  });

  const bundleMap = {};
  bundleMap[bundle.instanceName] = bundle;
  bundleMap[reviewBundle.instanceName] = reviewBundle;
  const processedMap = _mergeSourceCode(bundleMap, mergeMap, approvedMergeParents, 'review', commitMessage);
  _finalizeMerge(bundle, theirChangeset, approvedMergeParents, processedMap, versionsToUpdate, trunkMarkerUpdates,
    isPull, commitMessage);
}

/**
 * @param {ForkInboundMessage} message
 */
function mergeSourceCodeForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    const processed = input.processed;

    try {
      const ourTrunkName = input.ourTrunkName;
      const isPassive = input.isPassive;

      const invocation = new Invocation('changeset-id', config.personal_settings.ad_username);
      let conflictedPoms = [];
      let hasConflictedPom = false;
      let hasCorruptedPom = false;
      const priorPom = project.pom;

      if (!input.retry) {
        try {
          project.repo.git.apply(project.repo, ['fetch', 'origin'].concat(input.heads));
          if (input.approvedMergeParents) {
            processed.approvedMergeParent = project.repo.gitCapture('log', '--max-count=1', '--pretty=format:%h',
              '--abbrev=' + config.gitCommitHashSize, 'FETCH_HEAD');
          }

          if (isPassive) {
            if (processed.approvedMergeParent) {
              let ourPom = input.pomPathname ? POM.create(input.pomPathname, {detached: true}) : undefined;
              if (ourPom) {
                ourPom.readDependencies();
              }
              reviewUtil.mergeToReviewTarget(project, processed.approvedMergeParent, ourPom, ourTrunkName, invocation);
              project.repo.push();
            }
          } else {
            if (ourTrunkName) {
              process.env.MERGE_POM_OUR_TRUNK_NAME = ourTrunkName;
            } else {
              delete process.env.MERGE_POM_OUR_TRUNK_NAME;
            }
            let params = ['merge', '--no-commit', '-m', input.commitMessage];
            if (input.changesetStatus === ChangesetFile.Status.RELEASED) {
              params.push('--no-ff');
            }
            params.push('FETCH_HEAD');
            let output = project.repo.gitCapture.apply(project.repo, params);

            processed.autoMergedFiles = _extractAutoMergedFiles(output);
          }

          processed.gitMerged = true;
          processed.conflicts = false;

          if (isPassive) {
            ForkedProjectOp.sendInterim(project.dirname, 'Merged'.good);
          } else {
            ForkedProjectOp.sendInterim(project.dirname, 'No conflicts'.good)
          }
        } catch (ex) {
          if (!ex.status || ex.status > 1 || ex instanceof Errors.TargetMergeError) {
            if (ex instanceof Errors.TargetMergeError) {
              throw new BuildError(ex.message);
            }
            throw ex;
          }
          processed.gitMerged = true;
          if (!isPassive && project.pom) {
            conflictedPoms = project.repo.getConflictedFiles('(^|/)pom.xml$');
            if (conflictedPoms.length) {
              ForkedProjectOp.sendInterim(project.dirname, 'Conflicts in POM'.bad);
              hasConflictedPom = true;
            } else {
              ForkedProjectOp.sendInterim(project.dirname, 'Conflicts'.good);
            }
          } else {
            ForkedProjectOp.sendInterim(project.dirname, 'Conflicts'.good);
          }

          if (!isPassive) {
            processed.handMergedFiles = _extractHandMergedFiles(ex.stdout);
            processed.autoMergedFiles =
              _.difference(_extractAutoMergedFiles(ex.stdout), processed.handMergedFiles);
          }

          processed.conflicts = true;
          processed.mergeError = ex;
        }
      }

      if (!isPassive && project.pom && !hasConflictedPom) {
        try {
          project.reload();
          // this is an overzealous safeguard in the event that merge pom driver is not invoked
          project.pom.setVersion(priorPom.getOwnVersion());
          if (input.retry) {
            ForkedProjectOp.sendInterim(project.dirname, 'Resolved'.good);
          }
        } catch (ex) {
          if (input.retry) {
            ForkedProjectOp.sendInterim(project.dirname, 'Failed'.bad);
            hasCorruptedPom = true;
          } else {
            throw ex;
          }
        }
      }

      ForkedProjectOp.sendFinal(project.dirname, undefined, true, {
        project: project,
        processed: processed,
        hasConflictedPom: hasConflictedPom,
        hasCorruptedPom: hasCorruptedPom,
        conflictedPoms: conflictedPoms
      });
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, {
        project: project,
        processed: processed
      });
    }
  });
}

/**
 * @param {ForkInboundMessage} message
 */
function updateSourceControlForMergeForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      let actionRequired = false;
      let update;
      if (project.pom) {
        project.pom.saveAll();
      }
      if (!input.processed || !input.processed.conflicts) {
        if (project.repo.hasTrackedChanges() || project.repo.isMergeInProgress()) {
          if (project.pom) {
            project.repo.add(project.pom.getFilePaths());
          }
          project.repo.git('commit', '--message', input.message);
          if (!!input.push) {
            project.repo.push();
            update = 'Committed & pushed'.good;
          } else {
            update = 'Committed'.good;
          }
        } else {
          update = 'No changes'.trivial;
        }
      } else {
        update = 'Uncommitted'.warn;
        actionRequired = true;
      }
      ForkedProjectOp.sendFinal(project.dirname, update, true, {
        actionRequired: actionRequired
      });
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false);
    }
  });
}

function _addInstanceToMergeMap(mergeMap, instanceName) {
  if (!mergeMap[instanceName]) {
    mergeMap[instanceName] = {};
  }
}

function _addProjectsToChangeset(bundle, projectsToAdd, graduates, options) {
  options = _.extend({
    commitMessage: bundle.invocation.getCommitMessage(),
    guarantee: false
  }, options);
  if (projectsToAdd.length) {
    if (!config._all.commit) {
      throw new BuildError('This operation cannot proceed with the --dry-run option')
    }

    if (options.guarantee) {
      _initAdditionalProjects(bundle, projectsToAdd);
    }

    if (bundle.changeset.onTrunk()) {
      let supportGraduates = _.filter(graduates, project => project instanceof SupportProject);
      if (supportGraduates.length) {
        bundle.ensureTrunkSupportProjectsMainline(supportGraduates, options);
      }
    }

    let projects = _.filter(projectsToAdd, project => project instanceof BuildProject);
    let supportProjects = _.filter(projectsToAdd, project => project instanceof SupportProject);

    _moveProjects(projects, bundle.projects);
    _moveProjects(supportProjects, bundle.supportProjects);

    rflowUtil.createChangesetBranches(bundle, projects, supportProjects);
    rflowUtil.updateProjectPomVersions(projects);
    rflowUtil.updateProjectPomDependencies(bundle);
    bundle.changeset.addProjectVersions(projects);
    bundle.changeset.addSupportProjectInclusions(supportProjects);
    bundle.changeset.save();

    rflowUtil.updateSourceControl(bundle, {
      message: options.commitMessage,
      projects: projectsToAdd
    });
  }
}

/**
 * @param {BuildProject|SupportProject} project
 * @param {ChangesetFile} theirChangeset
 * @param {{}} mergeMap
 * @param {string} instanceName
 * @param {boolean} sameTrunk
 * @private
 */
function _addToMergeMap(project, theirChangeset, mergeMap, instanceName, sameTrunk) {
  let heads = [];
  if (project instanceof BuildProject) {
    let theirVersion = theirChangeset.getVersion(project.getPrimaryVersionsKey());
    heads.push(theirVersion.hasTrackingId()
      ? theirChangeset.getChangesetBranchName()
      : Projects.GitTarget.TAG_PREFIX + theirChangeset.getReleaseTagForVersion(theirVersion));
  } else if (project instanceof SupportProject) {
    heads.push(theirChangeset.getValue(project.getInclusionKey()) && theirChangeset.isChangesetFile()
      ? theirChangeset.getChangesetBranchName()
      : sameTrunk && !theirChangeset.isProductionFile() && !theirChangeset.isHotfixFile()
        ? theirChangeset.onTrunk()
          ? theirChangeset.getTrunkMainlineBranchNameForSupportProjects()
          : project.getMainlineBranchName()
        : Projects.GitTarget.TAG_PREFIX + theirChangeset.getReleaseTag());
    let opsMainline = project.definition.ops_mainline;
    if (theirChangeset.isReleasedFile() && sameTrunk && opsMainline && !heads.includes(opsMainline)) {
      heads.push(opsMainline);
    }
  } else {
    throw new BuildError('Unexpected project type');
  }

  _doAddToMergeMap(mergeMap, instanceName, heads, project)
  let displayValue = '';
  _.each(heads, head => {
    let prefixIndex = head.indexOf(Projects.GitTarget.TAG_PREFIX);
    displayValue += (displayValue.length > 0 ? ', ' : '') + (prefixIndex < 0 ? head : head.substring(prefixIndex + 1));
  });

  ForkedProjectOp.sendInterim(project.dirname, sprintf('Merge from %s'.useful, displayValue));
}

function _checkLocalStatus(projects) {
  let unpushedCommits = false;
  _.each(projects, function (project) {
    util.startBullet(project.dirname.plain);
    if (project.repo.isMergeInProgress()) {
      util.endBullet('Merge conflicts'.bad);
    } else if (project.repo.hasLocalCommits()) {
      util.endBullet('Unpushed commits'.warn);
      unpushedCommits = true;
    } else {
      util.endBullet('Up-to-date'.trivial);
    }
  });
  return unpushedCommits;
}

function _checkoutOther(projects, priorTags, releaseTags) {
  util.announce('Checkout other projects if relevant'.plain);
  const inputs = _.map(projects, project => {
    return {
      project: project,
      priorTag: priorTags[project.dirname],
      releaseTag: releaseTags[project.dirname]
    }
  });

  /** Fork to {@link checkoutOtherForked} */
  const result = ForkedProjectOp.run('checkout-other.js', inputs);
  if (!result.success) {
    throw new BuildError(
      sprintf('Unable to process %d project%s', result.failureCount, util.plural(result.failureCount)));
  }
}

/**
 * @param {BuildProject|SupportProject} project
 * @param {ChangesetFile} ourChangeset
 * @param {ChangesetFile} theirChangeset
 * @param {string} latestReleaseTag
 * @returns {{theirs: string, ours: string, oursHasTheirs: boolean, theirsHasOurs: boolean, same: boolean}}
 * @private
 */
function _compareHeadCommits(project, ourChangeset, theirChangeset, latestReleaseTag)  {
  let sameTrunk = ourChangeset.onTrunk() === theirChangeset.onTrunk();
  let ourTarget = _determineTargetForHeadCommit(project, ourChangeset, sameTrunk, latestReleaseTag, true);
  let theirTarget = _determineTargetForHeadCommit(project, theirChangeset, sameTrunk, latestReleaseTag, false);
  let sameTarget = ourTarget && ourTarget === theirTarget;
  let ourHeadCommit = ourTarget
    ? project.repo.getHeadCommitId(ourTarget)
    : undefined;
  let theirHeadCommit = sameTarget
    ? ourHeadCommit
    : theirTarget
      ? project.repo.getHeadCommitId(theirTarget)
      : undefined;

  let result = {
    ours: ourHeadCommit,
    theirs: theirHeadCommit
  };

  if (sameTarget) {
    result.oursHasTheirs = true;
    result.theirsHasOurs = true;
  } else {
    if (ourTarget && theirHeadCommit) {
      if (ourTarget.branch) {
        result.oursHasTheirs = project.repo.doesRemoteBranchContainCommitId(ourTarget.branch, theirHeadCommit);
      } else if (ourTarget.tag) {
        result.oursHasTheirs = project.repo.doesTagContainCommitId(ourTarget.tag, theirHeadCommit);
      }
    }
    if (theirTarget && ourHeadCommit) {
      if (theirTarget.branch) {
        result.theirsHasOurs = project.repo.doesRemoteBranchContainCommitId(theirTarget.branch, ourHeadCommit);
      } else if (theirTarget.tag) {
        result.theirsHasOurs = project.repo.doesTagContainCommitId(theirTarget.tag, ourHeadCommit);
      }
    }
  }

  result.same = ourHeadCommit === theirHeadCommit;
  return result;
}

/**
 * @param {BuildProject|SupportProject} project
 * @param {ChangesetFile} changeset
 * @param {boolean} sameTrunk
 * @param {string} latestReleaseTag
 * @param {boolean} ours
 * @returns {{branch: string}|{tag: string}}
 * @private
 */
function _determineTargetForHeadCommit(project, changeset, sameTrunk, latestReleaseTag, ours) {
  if (project instanceof BuildProject) {
    let version = changeset.getVersion(project.getPrimaryVersionsKey());
    if (!version) return undefined;
    return version.hasTrackingId()
      ? {branch: changeset.getChangesetBranchName()}
      : {tag: changeset.getReleaseTagForVersion(version)};
  } else if (project instanceof SupportProject) {
    return changeset.isChangesetFile() && changeset.getValue(project.getInclusionKey())
      ? {branch: changeset.getChangesetBranchName()}
      : sameTrunk
        ? ours
          ? {tag: latestReleaseTag}
          : changeset.onTrunk()
            ? {branch: changeset.getTrunkMainlineBranchNameForSupportProjects()}
            : {branch: project.getMainlineBranchName()}
        : {tag: changeset.getReleaseTag()};
  } else {
    throw new BuildError('Unexpected project type');
  }
}

function _displayHeadCommits(project, headCommits) {
  if (!headCommits) return;
  if (headCommits.ours && headCommits.ours === headCommits.theirs) {
    const displayValue = headCommits.ours.substring(0, config.gitCommitHashSize).useful;
    ForkedProjectOp.sendInterim(project.dirname, sprintf('Both %s'.trivial, displayValue));
    return;
  }
  if (headCommits.ours) {
    let displayValue = headCommits.ours.substring(0, config.gitCommitHashSize);
    displayValue = headCommits.oursHasTheirs ? displayValue.useful : displayValue.warn;
    ForkedProjectOp.sendInterim(project.dirname, sprintf('Ours %s'.trivial, displayValue));
  }
  if (headCommits.theirs) {
    let displayValue = headCommits.theirs.substring(0, config.gitCommitHashSize);
    displayValue = headCommits.theirsHasOurs ? displayValue.useful : displayValue.warn;
    ForkedProjectOp.sendInterim(project.dirname, sprintf('Theirs %s'.trivial, displayValue));
  }
}

function _doAddToMergeMap(mergeMap, instanceName, key, project) {
  _addInstanceToMergeMap(mergeMap, instanceName);
  if (!mergeMap[instanceName][key]) {
    mergeMap[instanceName][key] = [];
  }
  mergeMap[instanceName][key].push(project.dirname);
}

function _extractAutoMergedFiles(output) {
  return _extractMergedFiles('^Auto-merging (.+?)$', 1, output);
}

function _extractHandMergedFiles(output) {
  return _extractMergedFiles('^CONFLICT \(.+?\): Merge conflict in (.+?)$', 2, output).concat(_extractMergedFiles(
    "^CONFLICT \(.+?\): (.+?) deleted in .+?$", 2, output));
}

function _extractMergedFiles(regex, groupIndex, output) {
  let mergedFiles = [];
  let lines = util.textToLines(output);
  _.each(lines, line => {
    let match = line.match(regex);
    if (match && match.length > groupIndex) {
      mergedFiles.push(match[groupIndex]);
    }
  });
  return mergedFiles.reverse();
}

function _finalizeMerge(bundle, sourceChangeset, approvedMergeParents, processedMap, versionsToUpdate,
                        trunkMarkerUpdates, isPull, commitMessage) {
  let modified = false;
  _.each(bundle.getAllIncludedProjects(), project => {
    let ourMetadata = bundle.changeset.getProjectMetadata(project.dirname);
    let theirMetadata = sourceChangeset.getProjectMetadata(project.dirname);
    let addMergedFiles = theirMetadata && !isPull;

    const processed = processedMap[project.dirname];
    let approvedMergeParent = processed ? processed.approvedMergeParent : undefined;
    if (approvedMergeParent) {
      ourMetadata.approvedMergeParents = _.union(ourMetadata.approvedMergeParents || [], [approvedMergeParent]);
      bundle.changeset.setProjectMetadata(project.dirname, ourMetadata);
      modified = true;
    }

    modified =
      _joinMergedFileMetadata(bundle, project.dirname, processed, ourMetadata, theirMetadata, addMergedFiles,
        'handMergedFiles') || modified;

    modified =
      _joinMergedFileMetadata(bundle, project.dirname, processed, ourMetadata, theirMetadata, addMergedFiles,
        'autoMergedFiles') || modified;
  });
  if (modified) {
    bundle.changeset.save();
  }

  let changesetVersionMap = bundle.mapVersions(bundle.projects.included, VersionEx.LITERAL);
  util.narratef('Changeset Version Map (Passive): %s\n', JSON.stringify(changesetVersionMap));

  // align versions
  let updatedExcludedProjects = _.filter(bundle.getAllExcludedProjects(), project => versionsToUpdate[project.dirname]);
  if (bundle.projects.included.length > 0) {
    rflowUtil.updateProjectPomVersionsFromMap(bundle.projects.included, changesetVersionMap);
    util.announce('Updating POM dependencies'.plain);
    bundle.useCurrentVersions(bundle.getIncludedProjectsWithPassiveDependencies(), changesetVersionMap, {});

    if (updatedExcludedProjects.length) {
      bundle.addVersionsForArtifacts(sourceChangeset, changesetVersionMap, updatedExcludedProjects);
      util.narratef('Changeset Version Map (Active): %s\n', JSON.stringify(changesetVersionMap));
    }
    bundle.useCurrentVersions(bundle.getIncludedProjectsWithActiveDependencies(), changesetVersionMap, {});
  }

  // Merge versions (mainline projects)
  let priorTags = bundle.getTagsForExcludedProjects();
  rflowUtil.pullExcludedVersionsFromChangeset(updatedExcludedProjects, sourceChangeset, bundle.changeset, false);

  let ourTrunkKey = bundle.changeset.getTrunk() || Trunks.MASTER;
  Object.keys(trunkMarkerUpdates).forEach(trunk => {
    let update = trunkMarkerUpdates[trunk];
    if (ourTrunkKey === trunk) {
      if (update.to) {
        bundle.changeset.setSourceBundleVersion(update.to.toString());
      }
      bundle.changeset.setTrunkMarker(trunk, undefined);
    } else {
      bundle.changeset.setTrunkMarker(trunk, update.to);
    }
  });

  // save POMs and commit if there are no merge conflicts
  util.announce('Updating source control for changeset branches'.plain);
  let actionRequired = _updateSourceControl(bundle.projects.included, processedMap, commitMessage);
  actionRequired = _updateSourceControl(bundle.supportProjects.included, processedMap, commitMessage) || actionRequired;
  util.announce('Updating source control'.plain);
  util.startBullet(bundle.versionsRepo.dirname.plain);

  bundle.changeset.save();
  if (bundle.versionsRepo.checkIn({message: commitMessage})) {
    util.endBullet('Committed & pushed'.good);
  } else {
    util.endBullet('No changes'.trivial);
  }

  // Pull source for mainline projects
  let releaseTags = bundle.getTagsForExcludedProjects();
  _checkoutOther(bundle.getAllExcludedProjects(), priorTags, releaseTags);

  // A final review of local repo status so the user is clear
  util.announce('Checking local status'.plain);
  let unpushedCommits = _checkLocalStatus(bundle.projects.included);
  unpushedCommits = _checkLocalStatus(bundle.supportProjects.included) || unpushedCommits;

  if (actionRequired) {
    util.announce('Resolution required'.bad);
    _outputConflicts(bundle.projects.included, processedMap);
    _outputConflicts(bundle.supportProjects.included, processedMap);
  }
  if (unpushedCommits) {
    util.announce('Noteworthy'.warn);
    util.println(
      sprintf('A %s is not a push; you now have local commits that have not been pushed'.warn, bundle.currentGoal));
  }
}

function _graduateProjects(bundle, ourChangeset, theirChangeset, requiredInclusion) {
  requiredInclusion = _.extend({
    ours: false,
    theirs: false
  }, requiredInclusion);

  let graduates = {
    pending: [],
    active: [],
    retired: [],
    pendingOrActive: []
  }
  let ourTrunk = ourChangeset.getTrunk();
  let theirTrunk = theirChangeset.getTrunk();
  if (ourTrunk === theirTrunk) return graduates;
  bundle.getAllProjects().forEach(project => {
    let ourStatus = project.getStatus(ourTrunk);
    let theirStatus = project.getStatus(theirTrunk);
    if (ourStatus === theirStatus) return;
    if (!!requiredInclusion.theirs && theirStatus !== Projects.Status.RETIRED) {
      if (project instanceof BuildProject) {
        let theirVersion = theirChangeset.getVersion(project.getPrimaryVersionsKey());
        if (!theirVersion || !theirVersion.hasTrackingId()) return;
      } else if (project instanceof SupportProject) {
        if (theirChangeset.isChangesetFile() && !theirChangeset.getValue(project.getInclusionKey())) return;
      }
    }
    let included = bundle.getAllIncludedProjects().indexOf(project) >= 0;
    if (theirStatus === Projects.Status.PENDING && !included && ourStatus ===
      Projects.Status.IGNORED) {
      graduates.pending.push(project);
      graduates.pendingOrActive.push(project);
    } else if (theirStatus === Projects.Status.ACTIVE && !included &&
      [Projects.Status.IGNORED, Projects.Status.PENDING].indexOf(ourStatus) >= 0) {
      graduates.active.push(project);
      graduates.pendingOrActive.push(project);
    } else if (theirStatus === Projects.Status.RETIRED && (included || !requiredInclusion.ours)) {
      graduates.retired.push(project);
    }
  });

  bundle.graduateProjects(graduates.pending, Projects.Status.PENDING);
  bundle.graduateProjects(graduates.active, Projects.Status.PENDING); // yes, intentional
  bundle.graduateProjects(graduates.retired, Projects.Status.RETIRED);
  return graduates;
}

function _initAdditionalProjects(bundle, projectsToAdd) {
  util.announce('Initializing additional projects'.plain);
  bundle.checkout(projectsToAdd, {
    checkout: [Projects.GitTarget.TAG_PREFIX + bundle.changeset.getReleaseTag(), Projects.GitTarget.MAINLINE],
    workDir: util.cwd()
  });
}

function _joinMergedFileMetadata(bundle, projectName, processed, ourMetadata, theirMetadata, addMergedFiles, field) {
  let mergedFiles = processed ? processed[field] : undefined;
  if (mergedFiles || addMergedFiles) {
    if (mergedFiles) {
      ourMetadata[field] = _.union(ourMetadata[field] || [], mergedFiles);
    }
    if (addMergedFiles) {
      ourMetadata[field] = _.union(ourMetadata[field], theirMetadata[field] || []);
    }
    bundle.changeset.setProjectMetadata(projectName, ourMetadata);
    return true;
  }
  return false;
}

function _markProjectToAdd(project, projectsToAdd, theirChangeset, mergeMap, instanceName, headCommits, sameTrunk) {
  _displayHeadCommits(project, headCommits);
  projectsToAdd.push(project);
  ForkedProjectOp.sendInterim(project.dirname, 'Add project'.useful);
  _addToMergeMap(project, theirChangeset, mergeMap, instanceName, sameTrunk);
}

function _markProjectToMerge(project, theirChangeset, mergeMap, instanceName, sameTrunk) {
  _addToMergeMap(project, theirChangeset, mergeMap, instanceName, sameTrunk);
}

function _markProjectToRemove(project, projectsToRemove, forked) {
  projectsToRemove.push(project);
  const update = 'Remove'.useful;
  if (forked) {
    ForkedProjectOp.sendInterim(project.dirname, update);
  } else {
    util.endBullet(update);
  }
}

function _markVersionToKeep(project, ourChangeset, headCommits) {
  _displayHeadCommits(project, headCommits);
  if (project instanceof BuildProject) {
    const ourVersion = ourChangeset.getVersion(project.getPrimaryVersionsKey());
    ForkedProjectOp.sendInterim(project.dirname, sprintf('Stay at %s'.trivial, ourVersion));
  } else if (project instanceof SupportProject) {
    const branch = ourChangeset.getValue(project.getInclusionKey())
      ? ourChangeset.getChangesetBranchName()
      : ourChangeset.onTrunk()
        ? ourChangeset.getTrunkMainlineBranchNameForSupportProjects()
        : project.getMainlineBranchName();
    ForkedProjectOp.sendInterim(project.dirname, sprintf('Stay at %s'.trivial, branch));
  } else {
    throw new BuildError('Unexpected project type');
  }
}

/**
 * @param {BuildProject} project
 * @param {ChangesetFile} theirChangeset
 * @param {{}} versionsToUpdate
 * @param {{}} headCommits
 * @private
 */
function _markVersionToUpdate(project, theirChangeset, versionsToUpdate, headCommits) {
  _displayHeadCommits(project, headCommits);
  if (!(project instanceof BuildProject)) {
    throw new BuildError('Unexpected project type');
  }
  let versionsKey = project.getPrimaryVersionsKey();
  let theirVersion = theirChangeset.getValue(versionsKey);
  versionsToUpdate[project.dirname] = {};
  versionsToUpdate[project.dirname][versionsKey] = theirVersion;
  ForkedProjectOp.sendInterim(project.dirname, sprintf('Update to %s'.useful, theirVersion))
}

/**
 * @param {{}} bundleMap
 * @param {{}} mergeMap
 * @param {{}} approvedMergeParents
 * @param {string[]} passives
 * @param {string} commitMessage
 * @returns {{}}
 * @private
 */
function _mergeSourceCode(bundleMap, mergeMap, approvedMergeParents, passives, commitMessage) {
  passives = util.asArray(passives);

  util.narratef('Approved Merge Parents: %s\n', JSON.stringify(approvedMergeParents, null, 2));
  _narrateMergeMap(mergeMap);

  let processedMap = {};
  _.each(Object.keys(mergeMap), instanceName => {
    const bundle = bundleMap[instanceName];
    const isPassive = passives.indexOf(instanceName) >= 0;
    _.each(Object.keys(mergeMap[instanceName]), key => {
      let heads = key.split(',');
      const names = _.map(heads, head => util.gitTargetFriendlyName(head));
      heads = _.map(heads, head => head.replace(/^\^/, ''));
      util.announce(sprintf('Merging to %s branch from %s'.plain, instanceName, names.join(', ')));
      let projects = _.map(mergeMap[instanceName][key], dirname => bundle.getProjectByDirname(dirname));
      let retry;
      do {
        const inputs = _.map(projects, project => {
          return {
            project: project,
            processed: processedMap[project.dirname] || {},
            approvedMergeParents: approvedMergeParents ? approvedMergeParents[project.dirname] : undefined,
            heads: heads,
            ourTrunkName: bundle.changeset.getTrunk(),
            isPassive: isPassive,
            commitMessage: commitMessage,
            changesetStatus: bundle.changeset.getStatus(),
            pomPathname: project.pom ? project.pom.pathname : undefined,
            retry: retry
          }
        });

        /** Fork to {@link mergeSourceCodeForked} */
        const result = ForkedProjectOp.run('merge-source-code.js', inputs);

        let projectsToRetry = [];
        let hasConflictedPom = false;
        let hasCorruptedPom = false;
        let conflictedPoms = [];
        let corruptedPoms = [];
        _.each(Object.keys(result.outputs), dirname => {
          const output = result.outputs[dirname];
          if (!isPassive) {
            processedMap[dirname] = output.processed;
          }
          if (output.hasConflictedPom) {
            hasConflictedPom = true;
            _.each(output.conflictedPoms,
              pom => conflictedPoms.push(path.join(output.project.repo.getRepoDir(), pom)));
            projectsToRetry.push(output.project);
          } else if (output.hasCorruptedPom) {
            hasCorruptedPom = true;
            corruptedPoms.push(dirname);
            projectsToRetry.push(output.project);
          }
        });
        if (!result.success) {
          _undoMerges(bundle, mergeMap, processedMap);
          throw new BuildError(sprintf('Unable to merge source code for %d project%s', result.failureCount,
            util.plural(result.failureCount)));
        }
        if (hasConflictedPom || hasCorruptedPom) {
          retry = true;
          projects = projectsToRetry;
        } else {
          retry = false;
        }

        if (hasConflictedPom) {
          util.println('You must locally resolve POM merge conflicts before continuing!'.useful.bold);
          util.println('Resolve conflicts for the following files:'.useful);
          _.each(conflictedPoms.sort(), conflict => util.printf('%s %s\n'.useful, config.display.bulletChar, conflict));
          util.println('Save changes, but do not commit or push at this time!'.useful);
          let carryOn = _yesOrNoPrompt('Type "yes" if you wish to proceed or "no" to cancel: '.useful, 'yes', 'no');
          if (!carryOn) {
            _undoMerges(bundle, mergeMap, processedMap);
            throw new CancelledError();
          }
          util.announce('Reloading POM files'.plain);
        } else if (hasCorruptedPom) {
          util.printf(
            'Unable to process POM files for %d project%s above, are you sure you resolved the POM conflicts?\n'.bad,
            corruptedPoms.length, util.plural(corruptedPoms.length));
          util.println('This only happens when the POM files cannot be parsed properly!'.bad.italic);
          util.println('Save changes, but do not commit or push at this time!'.bad);
          const carryOn = _yesOrNoPrompt('Type "yes" if you wish to proceed or "no" to cancel: '.bad, 'yes', 'no');
          if (!carryOn) {
            _undoMerges(bundle, mergeMap, processedMap);
            throw new BuildError(sprintf('Unable to read POM files for %d project%s', corruptedPoms.length,
              util.plural(corruptedPoms.length)));
          }
          util.announce('Reloading POM files'.plain);
        }
      } while (retry);
    });
  });
  return processedMap;
}

function _moveProjects(projects, parent) {
  _.each(projects, function (project) {
    parent.valid = _.union(parent.valid, [project]);
    parent.included = _.union(parent.included, [project]);
    parent.excluded = _.without(parent.excluded, project);
  });
}

function _narrateMergeMap(mergeMap) {
  util.narratef('Merge Map: %s\n', JSON.stringify(mergeMap, null, 2));
}

/**
 * @param bundle
 * @param result
 * @param {[]} projectsToRemove
 * @param {[]} projectsToAdd
 * @param versionsToUpdate
 * @param {{}} mergeMap
 * @param {string} instanceName
 * @private
 */
function _processDeterminedActionsResult(bundle, result, projectsToRemove, projectsToAdd, versionsToUpdate, mergeMap,
                                         instanceName) {
  if (!result.success) {
    throw new BuildError(sprintf('Unable to determine actions for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }
  _.each(Object.keys(result.outputs), dirname => {
    const output = result.outputs[dirname];
    if (output) {
      if (output.removeProject) {
        projectsToRemove.push(bundle.getProjectByDirname(dirname));
      }
      if (output.addProject) {
        projectsToAdd.push(bundle.getProjectByDirname(dirname));
      }
      _.each(Object.keys(output.mergeMap[instanceName] || {}), key => {
        mergeMap[instanceName][key] =
          _.union(mergeMap[instanceName][key] || [], output.mergeMap[instanceName][key]);
      });
      _.extend(versionsToUpdate, output.versionsToUpdate);
    }
  });
}

function _processProjectByStatus(project, ourChangeset, theirTrunk, projectsToRemove) {
  let ourStatus = project.getStatus(ourChangeset.getTrunk());
  let theirStatus = project.getStatus(theirTrunk);
  if (ourStatus === Projects.Status.PENDING && theirStatus !== Projects.Status.ACTIVE) {
    _markVersionToKeep(project, ourChangeset);
    return true;
  }
  if (ourStatus === Projects.Status.RETIRED) {
    _markProjectToRemove(project, projectsToRemove);
    return true;
  }
  return false;
}

function _outputConflicts(projects, processedMap) {
  _.each(projects, project => {
    const processed = processedMap[project.dirname];
    if (processed && processed.mergeError) {
      if (processed.handMergedFiles && processed.handMergedFiles.length) {
        util.startBullet(project.dirname.bad, 'bad');
        util.continueBullet('Resolve merge conflicts:'.bad);
        util.endBullet();
        _.each(processed.handMergedFiles, file => {
          util.startSubBullet(file.italic.bad);
          util.endBullet();
        });
      } else if (processed.mergeError.stdout) {
        util.startBullet(project.dirname.bad);
        util.endBullet(processed.mergeError.stdout.italic.bad);
      } else {
        // don't expect to end up here, but just in case
        util.startBullet(project.dirname.bad);
        util.endBullet(processed.mergeError.toString().bad);
      }
    }
  });
}

function _undoMerges(bundle, mergeMap, processedMap) {
  _.each(Object.keys(mergeMap), instanceName => {
    let projects = [];
    _.each(Object.keys(mergeMap[instanceName]), key => {
      projects = _.union(projects, _.map(mergeMap[instanceName][key], dirname => bundle.getProjectByDirname(dirname)));
    });
    if (projects.length) {
      util.announce(sprintf('Aborting in-progress %s merges'.plain, instanceName));
      _.each(projects, project => {
        const processed = processedMap[project.dirname];
        if (processed && processed.gitMerged) {
          util.startBullet(project.dirname.plain);
          try {
            if (project.repo.abortMergeInProgress()) {
              util.endBullet('OK'.good);
            } else {
              util.endBullet('No-op'.good);
            }
          } catch (ex) {
            util.println(ex.toString().bad);
          }
        }
      });
    }
  });
}

function _updateSourceControl(projects, processedMap, message, push) {
  const inputs = _.map(projects, project => {
    return {
      project: project,
      processed: processedMap[project.dirname],
      message: message,
      push: push
    }
  });

  /** Fork to {@link updateSourceControlForMergeForked} */
  const result = ForkedProjectOp.run('update-source-control-for-merge.js', inputs);
  if (!result.success) {
    throw new BuildError(sprintf('Unable to update source control for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }
  return _.some(result.outputs, output => output.actionRequired);
}

function _verifyStatus(projects) {
  let proceed = true;
  _.each(projects, function (project) {
    util.startBullet(project.dirname.plain);
    if (project.repo.isMergeInProgress()) {
      util.endBullet('Merge in progress'.bad);
      proceed = false;
    } else if (project.repo.hasLocalChanges()) {
      util.endBullet('Local changes'.bad);
      proceed = false;
    } else {
      util.endBullet('OK to proceed'.good);
    }
  });
  return proceed;
}

function _yesOrNoPrompt(promptText, continueText, abortText) {
  let carryOn;
  while (carryOn === undefined) {
    carryOn = util.prompt(promptText);
    if (carryOn) {
      carryOn = carryOn.toLowerCase();
    }
    if (carryOn === abortText) {
      carryOn = null;
    }
    if (carryOn !== null && carryOn !== continueText) {
      carryOn = undefined;
    }
  }
  return carryOn;
}

module.exports = {
  checkoutOtherForked: checkoutOtherForked,
  determineActionForExcludedProjectForked: determineActionForExcludedProjectForked,
  determineActionForIncludedProjectForked: determineActionForIncludedProjectForked,
  ensureGoodStateForMerge: ensureGoodStateForMerge,
  merge: merge,
  mergeSourceCodeForked: mergeSourceCodeForked,
  updateSourceControlForMergeForked: updateSourceControlForMergeForked
};
