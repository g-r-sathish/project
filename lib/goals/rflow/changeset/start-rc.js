const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const jenkins = require('../../../common/jenkins').jenkinsService;
const {Projects, Trunks} = require('../../../classes/Constants');
const rcUtil = require('../../../common/rc-util');
const releasePipe = require('../../../common/release-pipe');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const teams = require('../../../common/teams').teamsService;
const util = require('../../../common/util');
const {VersionEx} = require('../../../classes/VersionEx');

module.exports['start-rc'] = {
  summary: 'Transition a changeset to a release candidate',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run', 'jacoco', 'sb3build', 'perf-impr'],
  requiredEnvVars: ['JENKINS_API_CREDENTIALS'],
  optionalEnvVars: [],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: [],
  notificationSettings: {
    onStart: true
  },
  callback: function (bundle, goal) {
    bundle.init();

    rflowUtil.synchronizeChangeset(bundle);

    rflowUtil.ensureStatusIs(bundle.changeset, [ChangesetFile.Status.DEV, ChangesetFile.Status.RELEASED]);
    rflowUtil.ensureCorrectSourceBundleVersion(bundle);

    if (bundle.projects.included.length + bundle.supportProjects.included.length < 1) {
      throw new BuildError('A release candidate must have at least one project');
    }

    // Check for lock
    if (bundle.changeset.doesAliasExist(bundle.getCandidateAlias())) {
      let candidate = ChangesetFile.create(bundle.versionsRepo).loadFromAlias(bundle.getCandidateAlias());
      throw new BuildError(
        sprintf('%s is already in progress for %s', bundle.getCandidateAlias(), candidate.getValue('tracking_id')));
    }

    rflowUtil.ensureCorrectPomAndDependencyVersions(bundle);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    reviewUtil.ensureProjectsAreNotRetired(bundle);

    reviewUtil.ensureProjectsAreReviewed(bundle, reviewStatus);

    if (!rflowUtil.ensureCorrectVersionsForExcludedProjects(bundle, bundle.changeset)) {
      throw new BuildError("One or project versions are misaligned; perhaps you need to pull");
    }

    // Slows things down, but ensures we have the expected head commits across the board
    const excludedProjects = bundle.getAllExcludedProjects();
    if (excludedProjects.length) {
      util.announce('Checking out excluded projects'.plain);
      bundle.checkout(excludedProjects, {
        checkout: [ Projects.GitTarget.TAG_PREFIX + bundle.changeset.getReleaseTag(), Projects.GitTarget.MAINLINE ],
      });

      // // we don't do anything with this -- should we?
      const relevantExcludedProjects = _.filter(bundle.getAllExcludedProjects(),
        project => !bundle.changeset.isHotfix() || project.existsInProduction);
    }

    rcUtil.ensureProjectsHaveLatestCommits(bundle, bundle.getChangesetBranchName(), bundle.changeset.getReleaseTag());

    // TODO: ensure projects have latest commits from merged changesets (?)

    let targetChangeset = bundle.changeset.onTrunk()
      ? bundle.trunks[bundle.changeset.getTrunk()].trunkFile || bundle.changeset
      : bundle.changeset.isHotfix()
        ? bundle.hotfixFile || bundle.productionFile
        : bundle.releasedFile;
    // reviewUtil.identifyTrunkMarkerUpdates(targetChangeset, bundle.changeset, bundle.trunks);

    // releasePipe.ensurePipeIsOpen(bundle);

    let markerOutput = '';
    const updates = reviewUtil.identifyTrunkMarkerUpdates(targetChangeset, bundle.changeset, bundle.trunks);
    Object.keys(updates).forEach(trunk => {
      const update = updates[trunk];
      if (update.from && update.to) {
        markerOutput += sprintf('From %s to %s \n', update.from.toString(), update.to.toString());
      } else if (update.from && !update.to) {
        markerOutput += sprintf('Remove %s \n', update.from.toString());
      } else if (!update.from && update.to) {
        markerOutput += sprintf('%s To %s \n', trunk.toString(), update.to.toString());
      }
    })
    releasePipe.ensurePipeIsOpen(bundle, markerOutput);



    // Let's do it
    let rcVersion = bundle.changeset.isHotfix() ?
      bundle.takeHotfixVersion() :
      bundle.changeset.onTrunk() ?
        bundle.takeTrunkVersion() :
        bundle.takeCandidateVersion();

    bundle.changeset.setStatus(ChangesetFile.Status.RC);
    bundle.changeset.save();

    // Create candidate versions file
    let candidate = ChangesetFile.create(bundle.versionsRepo);
    let trunkName = bundle.changeset.getTrunk();
    if (bundle.changeset.onTrunk()) {
      if (bundle.trunks[trunkName].trunkFile) {
        candidate.loadFromAlias(bundle.trunks[trunkName].getAlias(), bundle.projects.all);
      } else {
        candidate.loadFromChangeset(config.changesetId, bundle.projects.all);
      }
    } else {
      candidate.loadFromFirstValidAlias(bundle.getSourceAliases(false), bundle.projects.all);
    }

    util.announce(sprintf('Creating %s candidate file'.plain, rcVersion.toString()));
    candidate.setValue('bundle_version', rcVersion.toString());
    candidate.deleteValue('source_bundle_version'); // ensure there is only one version
    candidate.applyChangesetId();
    if (bundle.changeset.onTrunk()) {
      candidate.setTrunk(bundle.changeset.getTrunk());
      let bundleVersion = bundle.changeset.getBundleVersion();
      if (!bundleVersion.hasTrunk()) {
        candidate.setTrunkMarker(Trunks.MASTER, bundleVersion);
      }
    }

    Object.keys(bundle.trunks).concat([Trunks.MASTER]).forEach(trunk => {
      let sourceVersion = candidate.getTrunkMarker(trunk);
      let changesetVersion = bundle.changeset.getTrunkMarker(trunk);
      if (!changesetVersion) return;
      if (!sourceVersion || changesetVersion.compareTo(sourceVersion) >= 0) {
        candidate.setTrunkMarker(trunk, changesetVersion);
      } else {
        throw new BuildError(sprintf('Trunk marker \'%s\': changeset version %s is older than source version %s', trunk,
          changesetVersion.toString(), sourceVersion.toString()));
      }
    });

    candidate.setOrRemoveValue('merged_tracking_ids', bundle.changeset.getValue('merged_tracking_ids'));
    candidate.removeSupportProjectInclusion(bundle.supportProjects, true);
    candidate.deleteValue('hotfix');
    candidate.deleteValue('projects');
    candidate.deleteValue('releases');
    candidate.deleteValue('rollback_impact');
    candidate.deleteValue('status');
    candidate.deleteValue('summary');
    let rcBranchName = candidate.getReleaseBranchName();

    // Lock
    candidate.saveAsAlias(bundle.getCandidateAlias());
    bundle.versionsRepo.checkIn({
      message: bundle.invocation.getCommitMessage(rcVersion.toString() + ' (lock)')
    });

    try {
      let modified = false;
      if (bundle.projects.included.length > 0) {
        rflowUtil.createOfficialBranches(trunkName, bundle.projects.included, 'release',
          bundle.changeset.getReleaseTag(), bundle.getChangesetBranchName(), rcBranchName);

        // Correct project versions
        util.announce('Updating POM versions'.plain);
        let newProjectVersion = rcVersion.clone().resize(3);
        _.each(bundle.projects.included, function (project) {
          let oldProjectVersion = new VersionEx(project.pom.getVersion());
          if (oldProjectVersion.toString() !== newProjectVersion.getSnapshotString()) {
            project.pom.setVersion(newProjectVersion.getSnapshotString());
            util.startBullet(project.dirname.plain);
            util.endBullet(
              sprintf('From %s to %s'.trivial, oldProjectVersion.toString(), newProjectVersion.getSnapshotString().good));
          }
        });

        // Correct dependencies
        util.announce('Updating POM dependencies'.plain);
        let rcVersionMap = bundle.mapVersions(bundle.projects.included, VersionEx.NEXT_RELEASE);
        bundle.useCurrentVersions(bundle.projects.included, rcVersionMap);

        // Save changes
        candidate.addProjectVersions(bundle.projects.included, {versionOffset: VersionEx.NEXT_RELEASE});
        modified = true;
      }
      if (bundle.supportProjects.included.length > 0) {
        candidate.updateSupportProjectInclusion(bundle.supportProjects, {prune: true});
        modified = true;
      }
      if (modified) {
        candidate.save();
      }

      rflowUtil.updateSourceControl(bundle, {
        projects: bundle.projects.included,
        message: bundle.invocation.getCommitMessage(rcVersion.toString()),
        retryWithPull: false,
        skipVersionsRepo: true
      });

      util.startBullet(bundle.versionsRepo.dirname.plain);
      bundle.versionsRepo.checkIn({
        message: bundle.invocation.getCommitMessage(rcVersion.toString())
      });
      util.endBullet('Committed & pushed'.good);

    } catch (ex) {

      // Release lock
      candidate.removeFile(bundle.getCandidateAlias());

      // Return to IN_DEV
      bundle.changeset.setStatus(ChangesetFile.Status.DEV);
      bundle.changeset.save();

      bundle.versionsRepo.checkIn({
        message: bundle.invocation.getCommitMessage(rcVersion.toString(), 'Failure to launch, removing lock')
      });

      throw (ex);
    }

    // Trigger orchestrated build
    let orchestrationArray = jenkins.buildOrchestration(bundle.projects.included, rcBranchName, true);
    jenkins.postOrchestration(orchestrationArray);

    teams.notifyOnStartedRC(bundle);
  }
};
