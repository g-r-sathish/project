const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const artifactory = require('./artifactory');
const BuildError = require('../classes/BuildError');
const {BuildProject} = require('../classes/BuildProject');
const {ChangesetFile} = require('../classes/ChangesetFile');
const config = require('./config');
const docker = require('./docker').dockerService;
const {ForkedProjectOp} = require('../classes/ForkedProjectOp');
const {Projects} = require('../classes/Constants');
const rflowUtil = require('./rflow-util');
const {SupportProject} = require('../classes/SupportProject');
const util = require('./util');
const {VersionEx} = require('../classes/VersionEx');

/**
 * @param {ForkInboundMessage} message
 */
function ensureProjectHasLatestCommitsForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const projectStatus = input.projectStatus;
      let onTrunk = input.changeset.onTrunk;
      const missing = {};
      if (project instanceof BuildProject && projectStatus === Projects.Status.PENDING && !onTrunk) {
        ForkedProjectOp.sendFinal(project.dirname, 'Not previously released'.trivial, true, missing);
        return;
      }
      let isIncluded = input.isIncluded;
      let atLeastOneCheck = false;

      // Look for missing release or hotfix commits as appropriate for included projects
      if (isIncluded) {
        let commitId = undefined;
        let commitType = undefined;
        if (input.hotfix) {
          if (input.hotfix.hasFile) {
            if (project instanceof BuildProject && input.hotfix.version === undefined) {
              ForkedProjectOp.sendFinal(project.dirname, 'Not yet in production'.trivial, true, missing);
              return;
            }
            commitId = project.repo.getHeadCommitId({tag: input.hotfix.releaseTag});
            commitType = 'hotfix';
          }
        } else if (onTrunk) {
          if (input.trunk) {
            if (project instanceof BuildProject && !input.trunk.version) {
              util.endBullet('Not yet in trunk'.trivial);
              return;
            }
            if (!(project instanceof SupportProject) || input.trunk.inclusion) {
              commitId = project.repo.getHeadCommitId({tag: input.trunk.releaseTag});
              commitType = 'trunk';
            }
          }
        } else if (project instanceof BuildProject || projectStatus !== Projects.Status.PENDING) {
          let releasedHead = project instanceof SupportProject ? {branch: project.getMainlineBranchName()} :
            {tag: input.released.releaseTag};
          commitId = project.repo.getHeadCommitId(releasedHead);
          commitType = 'released';
        }
        if (commitId) {
          atLeastOneCheck = true;
          if (project.repo.doesBranchContainCommitId(input.includedBranch, commitId)) {
            ForkedProjectOp.sendInterim(project.dirname, sprintf('Has latest %s commit'.trivial, commitType));
          } else {
            ForkedProjectOp.sendInterim(project.dirname, sprintf('Missing %s commit'.bad, commitType));
            if (!input.hotfix && project instanceof SupportProject) {
              missing.supportReleasedCommits = true;
            } else {
              missing.commitType = commitType;
            }
          }
        }
      }

      // Look for missing production commits (on master) or support project trunk commits
      let update;
      if (!onTrunk) {
        if ((project instanceof BuildProject && input.production.version === undefined) ||
          (project instanceof SupportProject && input.projectStatus === Projects.Status.PENDING)) {
          ForkedProjectOp.sendFinal(project.dirname, 'Not yet in production'.trivial, true, missing);
          return;
        }
        let commitId = project.repo.getHeadCommitId({tag: input.production.releaseTag});
        if (!commitId) {
          update = 'Not yet in production'.trivial;
        } else {
          let isCurrent = isIncluded
            ? project.repo.doesBranchContainCommitId(input.includedBranch, commitId)
            : project.repo.doesTagContainCommitId(input.excludedTag, commitId);
          if (isCurrent) {
            update = 'Has latest production commit'.trivial;
          } else {
            update = 'Missing production commit'.bad;
            missing.prodCommits = true;
          }
        }
      } else if (onTrunk && project instanceof SupportProject) {
        let commitId = project.repo.getHeadCommitId({branch: input.changeset.mainlineBranchForSupportProjects});
        let isCurrent = isIncluded
          ? project.repo.doesBranchContainCommitId(input.includedBranch, commitId)
          : project.repo.doesTagContainCommitId(input.excludedTag, commitId);
        if (isCurrent) {
          update = sprintf('Has latest \'%s\' commit'.trivial, input.changeset.mainlineBranchForSupportProjects);
        } else {
          update = sprintf('Missing latest \'%s\' commit'.bad, input.changeset.mainlineBranchForSupportProjects);
          missing.supportTrunkCommits = true;
        }
      } else if (!atLeastOneCheck) {
          update = 'Not applicable'.trivial.italic;
      }
      ForkedProjectOp.sendFinal(project.dirname, update, true, missing);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function ensureProjectsHaveLatestCommits(bundle, includedProjectBranch, excludedProjectTag) {
  let options = {
    projects: {
      includedBranch: includedProjectBranch,
      excludedTag: excludedProjectTag
    },
    supportProjects: {
      includedBranch: includedProjectBranch,
      excludedTag: excludedProjectTag
    }
  };
  _ensureAllProjectsHaveLatestCommitsAlaCarte(bundle, options);
}

function syncProjectsWithBuildOutcomes(bundle, candidate) {
  let artifacts = {};

  // TODO: FORK THIS
  util.announce('Checking for Maven artifacts released'.plain);
  _.each(bundle.projects.included, project => {
    artifacts[project.dirname] = { project: project, expected: 0, existing: 0};
    _.each(project.getArtifacts(), artifact => {
      util.startBullet(project.dirname.plain);
      util.continueBullet(artifact.plain);
      let version = candidate.getVersion(project.getPrimaryVersionsKey());
      util.continueBullet(version.toString().plain);
      artifacts[project.dirname].expected++;
      if (artifactory.isGithubPackageReleased(artifact, version)) {
        util.endBullet('Released'.useful);
        artifacts[project.dirname].existing++;
      } else {
        util.endBullet('Missing'.bad);
      }
    });
  });

  // TODO: FORK THIS
  util.announce('Checking for Docker images published'.plain);
  _.each(bundle.projects.included, project => {
    let image = project.getDockerImage();
    if (image) {
      util.startBullet(project.dirname.plain);
      util.continueBullet(image.plain);
      let version = candidate.getVersion(project.getPrimaryVersionsKey());
      util.continueBullet(version.toString().plain);
      artifacts[project.dirname].expected++;
      if (docker.isImageReleased(image, version)) {
        util.endBullet('Released'.useful);
        artifacts[project.dirname].existing++;
      } else {
        util.endBullet('Missing'.bad);
      }
    }
  });

  // TODO: FORK THIS?
  let projectsToBuild = [];
  let updatePomDependencies = false;
  util.announce('Determining corrective action required'.plain);
  _.each(Object.keys(artifacts), projectName => {
    util.startBullet(projectName.plain);
    let expectedCount = artifacts[projectName].expected;
    let existingCount = artifacts[projectName].existing;
    if (existingCount === expectedCount) {
      util.continueBullet('Already built'.useful);
      util.endBullet('No action'.trivial);
    } else {
      let project = artifacts[projectName].project;
      let version = new VersionEx(project.pom.getOwnVersion());
      if (!version.isSnapshot()) {
        util.continueBullet(sprintf('POM has version %s'.bad, version.toString()));
        let newVersion = version.getNextBuildVersion().addSnapshot();
        util.endBullet(sprintf('Roll forward to %s and update dependencies'.useful, newVersion.toString()));
        project.pom.mvn('versions:set', '-DgenerateBackupPoms=false', '-DoldVersion=' + version.toString(),
          '-DnewVersion=' + newVersion.toString());
        project.reload();
        candidate.setValue(project.getPrimaryVersionsKey(), newVersion.removeSnapshot().toString());
        candidate.save();
        updatePomDependencies = true;
        projectsToBuild.push(project);
      } else if (version.compareTo(candidate.getVersion(project.getPrimaryVersionsKey()).addSnapshot()) !== 0) {
        util.continueBullet(sprintf('POM has version %s'.bad, version.toString()));
        util.endBullet('Update dependencies'.useful);
        candidate.setValue(project.getPrimaryVersionsKey(), version.removeSnapshot().toString());
        candidate.save();
        updatePomDependencies = true;
        projectsToBuild.push(project);
      } else {
        util.continueBullet('Not yet built'.useful);
        util.endBullet('No action'.trivial);
        projectsToBuild.push(project);
      }
    }
  });

  if (updatePomDependencies) {
    util.announce('Updating POM dependencies'.plain);
    let rcVersionMap = bundle.mapVersions(projectsToBuild, VersionEx.NEXT_RELEASE);
    bundle.useCurrentVersions(bundle.projects.included, rcVersionMap, {});
    rflowUtil.updateSourceControl(bundle);
  }

  return projectsToBuild;
}

function validateInProgressReleaseCandidate(bundle) {
  bundle.init({noCheckout: true});

  rflowUtil.ensureStatusIs(bundle.changeset, ChangesetFile.Status.RC);
  let candidate = rflowUtil.ensureManifestMatchesChangeset(bundle.versionsRepo, bundle.getCandidateAlias(),
    config.changesetId);
  rflowUtil.ensureCorrectSourceBundleVersion(bundle);

  if (!rflowUtil.ensureCorrectVersionsForExcludedProjects(bundle, candidate)) {
    throw new BuildError("One or project versions are misaligned; perhaps you need to patch-rc");
  }

  let rcBranchName = candidate.getReleaseBranchName();

  util.announce('Checking out release branches'.plain);
  bundle.checkout(bundle.projects.included, {
    checkout: rcBranchName,
    okIfMissing: true
  }, 'One or more release branches are missing; did you forget to patch-rc?');

  // TODO: FORK THIS?
  util.announce('Looking for unmerged changeset commits'.plain);
  let missingCommit = false;
  _.each(bundle.projects.included, function (project) {
    util.startBullet(project.dirname.plain);
    let changesetHeadCommitId = project.repo.getHeadCommitId({branch: bundle.getChangesetBranchName()});
    if (project.repo.doesBranchContainCommitId(rcBranchName, changesetHeadCommitId)) {
      util.endBullet('Up-to-date'.good);
    } else {
      util.endBullet('Missing commit'.bad);
      missingCommit = true;
    }
  });
  if (missingCommit) {
    throw new BuildError('One or more projects have unmerged changeset commits; did you forget to patch-rc?');
  }

  // Checkout changeset branch of support projects
  if (bundle.supportProjects.included.length > 0) {
    util.announce('Checking out support projects'.plain);
    bundle.checkout(bundle.supportProjects.included, {checkout: bundle.getChangesetBranchName()});
  }

  let previousReleaseTag = bundle.changeset.getReleaseTag();

  // Checkout released tag of excluded projects
  const excludedProjects = bundle.getAllExcludedProjects();
  if (excludedProjects.length) {
    util.announce('Checking out excluded projects'.plain);
    bundle.checkout(excludedProjects, {
      checkout: [Projects.GitTarget.TAG_PREFIX + previousReleaseTag, Projects.GitTarget.MAINLINE]
    });

    // we don't do anything with this -- should we?
    const relevantExcludedProjects  = _.filter(excludedProjects,
      project => !bundle.changeset.isHotfix() || project.existsInProduction);
  }

  // If hotfix or included support projects, make sure production hasn't changed since we went into RC
  let latestCommitOptions = {};
  if (bundle.projects.included.length > 0 && bundle.changeset.isHotfix()) {
    latestCommitOptions.projects = {
      includedBranch: candidate.getReleaseBranchName(),
      excludedTag: bundle.changeset.getReleaseTag()
    };
  }
  if (bundle.supportProjects.included.length > 0 && !bundle.changeset.onTrunk()) {
    latestCommitOptions.supportProjects = {
      includedBranch: bundle.getChangesetBranchName(),
      excludedTag: bundle.changeset.getReleaseTag()
    };
  }
  _ensureAllProjectsHaveLatestCommitsAlaCarte(bundle, latestCommitOptions);

  return {
    candidate: candidate,
    rcBranchName: rcBranchName,
    previousReleaseTag: previousReleaseTag
  };
}

function _ensureAllProjectsHaveLatestCommitsAlaCarte(bundle, options) {
  // Only proceed if there is something to do
  if (!options.projects && !options.supportProjects) {
    return;
  }
  let missing = {
    commitType: undefined,
    prodCommits: false,
    supportReleasedCommits: false,
    supportTrunkCommits: false
  };
  util.announce('Ensuring projects have latest commits'.plain);
  const inputs = _.chain(bundle.getAllValidProjects()).filter(
    project => (project instanceof BuildProject && options.projects) ||
      (project instanceof SupportProject && options.supportProjects))
    .map(project => {
      const input = {
        project: project,
        isIncluded: bundle.getAllIncludedProjects().includes(project),
        projectStatus: bundle.getProjectStatus(project),
        includedBranch: project instanceof BuildProject
          ? options.projects.includedBranch
          : options.supportProjects.includedBranch,
        excludedTag: project instanceof BuildProject
          ? options.projects.excludedTag
          : options.supportProjects.excludedTag,
        changeset: {
          onTrunk: bundle.changeset.onTrunk(),
          trunk: bundle.changeset.getTrunk(),
          mainlineBranchForSupportProjects: bundle.changeset.onTrunk() ?
            bundle.changeset.getTrunkMainlineBranchNameForSupportProjects() : undefined
        },
        released: {
          releaseTag: bundle.releasedFile.getReleaseTag()
        },
        production: {
          version: project instanceof BuildProject ? bundle.productionFile.getVersion(project.getPrimaryVersionsKey()) :
            undefined,
          releaseTag: bundle.productionFile.getReleaseTag()
        }
      };
      if (bundle.changeset.isHotfix()) {
        input.hotfix = {
          hasFile: !!bundle.hotfixFile,
          version: project instanceof BuildProject && bundle.hotfixFile ?
            bundle.hotfixFile.getVersion(project.getPrimaryVersionsKey()) : undefined,
          releaseTag: bundle.hotfixFile ? bundle.hotfixFile.getReleaseTag() : undefined
        };
      }
      const trunkFile = bundle.changeset.onTrunk() ? bundle.trunks[bundle.changeset.getTrunk()].trunkFile : undefined;
      if (trunkFile) {
        input.trunk = {
          version: project instanceof BuildProject ? trunkFile.getVersion(project.getPrimaryVersionsKey()) : undefined,
          inclusion: project instanceof SupportProject ? trunkFile.getValue(project.getInclusionKey()) : undefined,
          releaseTag: trunkFile.getReleaseTag()
        };
      }
      return input;
    }).value();

  /** Fork to {@link ensureProjectHasLatestCommitsForked} */
  const result = ForkedProjectOp.run('ensure-project-has-latest-commits.js', inputs);
  if (!result.success) {
    throw new BuildError(sprintf('Unable to ensure %d project%s have latest commits', result.failureCount,
      util.plural(result.failureCount)));
  }
  _.each(Object.keys(result.outputs), dirname => {
    const output = result.outputs[dirname];
    if (output) {
      if (output.commitType) missing.commitType = output.commitType;
      if (output.prodCommits) missing.prodCommits = output.prodCommits;
      if (output.supportReleasedCommits) missing.supportReleasedCommits = output.supportReleasedCommits;
      if (output.supportTrunkCommits) missing.supportTrunkCommits = output.supportTrunkCommits;
    }
  });
  if (missing.commitType) {
    throw new BuildError(
      sprintf('Houston we have a problem; %s commits are missing from one or more branches!', missing.commitType));
  }
  if (missing.prodCommits) {
    let advice = bundle.changeset.isHotfix()
      ? 'this can be rectified with a pull'
      : 'this is likely due to the release of a hotfix and can be rectified with a pull using the --production option';
    throw new BuildError(sprintf('Production commits are missing from one or more branches; %s', advice));
  }
  if (missing.supportReleasedCommits) {
    throw new BuildError(
      'Released commits for support projects are missing from one or more branches; this can be rectified with a pull');
  }
  if (missing.supportTrunkCommits) {
    throw new BuildError(
      'Trunk commits for support projects are missing from one or more branches; this can be rectified with a pull');
  }
}

module.exports = {
  ensureProjectHasLatestCommitsForked: ensureProjectHasLatestCommitsForked,
  ensureProjectsHaveLatestCommits: ensureProjectsHaveLatestCommits,
  syncProjectsWithBuildOutcomes: syncProjectsWithBuildOutcomes,
  validateInProgressReleaseCandidate: validateInProgressReleaseCandidate
};
