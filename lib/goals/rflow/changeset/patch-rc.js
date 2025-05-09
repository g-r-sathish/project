const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const jenkins = require('../../../common/jenkins').jenkinsService;
const rcUtil = require('../../../common/rc-util');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');
const {VersionEx} = require('../../../classes/VersionEx');

module.exports['patch-rc'] = {
  summary: 'Merge latest from a changeset into a release candidate',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['no-build', 'max-fork-count', 'dry-run', 'jacoco', 'sb3build', 'perf-impr'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: [],
  callback: function (bundle, goal) {
    bundle.init();

    rflowUtil.ensureStatusIs(bundle.changeset, ChangesetFile.Status.RC);

    // There must be an RC to patch
    let candidate = rflowUtil.ensureManifestMatchesChangeset(bundle.versionsRepo, bundle.getCandidateAlias(),
      config.changesetId);

    if (bundle.projects.included.length === 0) {
      throw new BuildError('Changeset only has support projects; patch-rc will do nothing');
    }

    rflowUtil.ensureCorrectPomAndDependencyVersions(bundle);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    reviewUtil.ensureProjectsAreNotRetired(bundle);

    reviewUtil.ensureProjectsAreReviewed(bundle, reviewStatus);

    let rcBranchName = candidate.getReleaseBranchName();
    let lateStarts = [];
    let changedProjects = [];
    let unchangedProjects = [];

    // TODO: FORK THIS
    // Switch to RC branch
    util.announce('Switching to release branch'.plain);
    _.each(bundle.projects.included, function (project) {
      util.startBullet(project.dirname.plain);
      if (!project.repo.doesBranchExist(rcBranchName)) {
        // Handle the case where `extend` has happened since the RC was started
        if (bundle.changeset.isHotfix() || bundle.changeset.onTrunk()) {
          project.checkout(bundle.changeset.getReleaseTag());
        } else {
          project.checkout(project.getMainlineBranchName());
        }
        project.repo.createBranch(rcBranchName);
        lateStarts.push(project);
        util.continueBullet('Created'.good);
      } else {
        project.checkout(rcBranchName, {pull: false});
      }
      util.endBullet(util.repoStatusText(rcBranchName, config.workDir, project.repo.clonePath));
    });

    let notBuiltProjects = rcUtil.syncProjectsWithBuildOutcomes(bundle, candidate);

    // TODO: FORK THIS
    // Detect changed projects which need to be patched
    util.announce('Looking for changes'.plain);
    _.each(bundle.projects.included, function (project) {
      util.startBullet(project.dirname.plain);
      let changeStatus = 'Unchanged'.trivial;
      if (_.find(lateStarts, function (item) { return item === project })) {
        changeStatus = 'Added'.good;
      } else {
        let changesetHeadCommitId = project.repo.getHeadCommitId({ branch: bundle.getChangesetBranchName() });
        if (!project.repo.doesBranchContainCommitId(rcBranchName, changesetHeadCommitId)) {
          changedProjects.push(project);
          changeStatus = 'Changed'.useful;
        } else {
          unchangedProjects.push(project);
        }
      }
      util.endBullet(changeStatus);
    });

    let unchangedNotBuiltProjects = [];
    let impactedProjects = _.union(lateStarts, changedProjects);
    if (impactedProjects.length > 0) {
      // Bring added projects into the fold as they would have during start-rc
      if (lateStarts.length) {
        // TODO: FORK THIS
        util.announce('Merging branches for added projects'.plain);
        _.each(lateStarts, function (project) {
          util.startBullet(project.dirname.plain);
          project.repo.git('merge', '--no-commit', '--no-ff', bundle.getChangesetBranchName());
          project.reload();
          util.endBullet('Merged'.good);
        });

        // TODO: FORK THIS
        util.announce('Updating added project versions'.plain);
        let newProjectVersion = candidate.getBundleVersion().clone().resize(3);
        _.each(lateStarts, function (project) {
          let oldProjectVersion = new VersionEx(project.pom.getVersion());
          if (oldProjectVersion.toString() !== newProjectVersion.getSnapshotString()) {
            project.pom.setVersion(newProjectVersion.getSnapshotString());
            util.startBullet(project.dirname.plain);
            util.endBullet(sprintf('From %s to %s'.trivial, oldProjectVersion.toString(), newProjectVersion.getSnapshotString().good));
            project.pom.saveAll(); // save now because we need to reload
          }
        });
      }

      let unchangedBuiltProjects = [];
      _.each(unchangedProjects, unchangedProject => {
        if (_.contains(notBuiltProjects, unchangedProject)) {
          unchangedNotBuiltProjects.push(unchangedProject);
        } else {
          unchangedBuiltProjects.push(unchangedProject);
        }
      });

      // Map the versions of each project according to their current RC branch state
      let rcVersionMap = _.extend(
        bundle.mapVersions(lateStarts, VersionEx.NEXT_RELEASE),
        bundle.mapVersions(changedProjects, VersionEx.NEXT_RELEASE),
        bundle.mapVersions(unchangedBuiltProjects, VersionEx.RELEASED),
        bundle.mapVersions(unchangedNotBuiltProjects, VersionEx.NEXT_RELEASE));

      let assessingImpact = true;
      while (assessingImpact) {
        let impact = bundle.useCurrentVersions(bundle.projects.included, rcVersionMap,
          {ignoreDependencyVersionedModules: true, silent: true});
        let changedDueToDependency = _.difference(impact, impactedProjects);
        if (changedDueToDependency.length) {
          impactedProjects = impactedProjects.concat(changedDueToDependency);
          rcVersionMap = _.extend(rcVersionMap,
            bundle.mapVersions(changedDueToDependency, VersionEx.NEXT_RELEASE));
        } else {
          assessingImpact = false;
        }
      }

      // Restore POMs after abusing them for assessment purposes
      _.each(bundle.projects.included, function (project) {
        project.reload();
      });

      // TODO: FORK THIS
      // Changed projects
      util.announce('Merging branches'.plain);
      _.each(changedProjects, function (project) {
        util.startBullet(project.dirname.plain);
        project.repo.git('merge', '--no-commit', '--no-ff', bundle.getChangesetBranchName());
        project.reload();
        util.endBullet('Merged'.good);
      });

      // Update dependencies between projects
      util.announce('Updating dependencies'.plain);
      bundle.useCurrentVersions(impactedProjects, rcVersionMap, {ignoreDependencyVersionedModules: true});
      candidate.updateIncludedVersionsFromVersionMap(bundle.projects.included, rcVersionMap);
    }

    let releaseVersion = rflowUtil.pullExcludedVersionsFromChangeset(bundle.projects.excluded, bundle.changeset,
      candidate, true);
    candidate.save();

    rflowUtil.updateSourceControl(bundle, {
      projects: impactedProjects,
      message: bundle.invocation.getCommitMessage(releaseVersion),
      retryWithPull: false,
      announceText: 'Saving changes',
      skipVersionsRepo: true
    })
    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.checkIn({
      message: bundle.invocation.getCommitMessage(candidate.getBundleVersion())
    });
    util.endBullet('Committed & pushed'.good);

    const buildProjects = _.union(impactedProjects, unchangedNotBuiltProjects);

    if (!config._all['no-build']) {
      let orchestrationArray = jenkins.buildOrchestration(buildProjects, rcBranchName, true);
      jenkins.postOrchestration(orchestrationArray);
    }
  }
};
