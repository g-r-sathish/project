const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {BuildProject} = require('../../../classes/BuildProject');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const {ForkedProjectOp} = require('../../../classes/ForkedProjectOp');
const {Projects} = require('../../../classes/Constants');
const rcUtil = require('../../../common/rc-util');
const releasePipe = require('../../../common/release-pipe');
const rflowUtil = require('../../../common/rflow-util');
const teams = require('../../../common/teams').teamsService;
const util = require('../../../common/util');

module.exports['promote-rc'] = {
  summary: 'Promotes a release candidate to released',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: [],
  notificationSettings: {
    onStart: true
  },
  callback: function (bundle, goal) {
    function merge(projects, rcVersion, sourceBranch, targetBranch) {
      util.announce(sprintf('Merging from branch %s'.plain, sourceBranch));
      let commitMessage = bundle.invocation.getCommitMessage(rcVersion);
      _.each(projects, function (project) {
        let mainlineBranchName = targetBranch || project.getMainlineBranchName();
        util.startBullet(project.dirname.plain);
        project.checkout(mainlineBranchName); // redundant, we should already be here
        project.repo.git('fetch', 'origin', sourceBranch);
        project.repo.git('merge', '--no-ff', '--no-edit', '-m', commitMessage, '--strategy-option=theirs',
          'FETCH_HEAD');
        util.endBullet(sprintf('Merged to %s'.good, mainlineBranchName));
      });
    }

    function applyTag(repo, projectName, tag) {
      util.startBullet(projectName.plain);
      repo.tag(tag, bundle.invocation.getCommitMessage());
      util.endBullet('Tagged'.good);
    }

    function buildOfficialChangeset(alias) {
      let changeset = ChangesetFile.create(bundle.versionsRepo).loadFromAlias(bundle.getCandidateAlias());
      delete changeset.data.bundle_name;
      if (!bundle.changeset.isHotfix()) {
        changeset.removeSupportProjectInclusion(bundle.supportProjects, true);
      }
      changeset.saveAsAlias(alias);
      return changeset;
    }

    let info = rcUtil.validateInProgressReleaseCandidate(bundle);

    util.announce('Validating Maven artifacts released'.plain);
    let inputs = _.map(bundle.projects.included, project => {
      return {
        project: project,
        version: info.candidate.getVersion(project.getPrimaryVersionsKey())
      };
    });

    /** Fork to {@link ValidateMavenArtifactsFork} */
    let result = ForkedProjectOp.run('validate-maven-artifacts.js', inputs);
    if (!result.success) {
      throw new BuildError(sprintf('Unable to validate Maven artifacts for %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }
    const missingArtifacts = [];
    _.each(Object.keys(result.outputs), dirname => {
      const output = result.outputs[dirname];
      missingArtifacts.push(...output.missing);
    });
    if (missingArtifacts.length) {
      util.announce('Missing artifacts'.bad);
      _.each(missingArtifacts, missingArtifact => {
        util.startBullet(missingArtifact.artifact.bad, 'bad');
        util.endBullet(missingArtifact.version.bad);
      });
      throw new BuildError("One or more projects are missing released artifacts; check Jenkins to determine cause");
    }

    util.announce('Validating Docker images published'.plain);
    let missingImages = 0;
    let projectsWithImages = _.filter(bundle.projects.included, project => project.getDockerImage());
    inputs = _.map(projectsWithImages, project => {
      return {
        project: project,
        version: info.candidate.getVersion(project.getPrimaryVersionsKey())
      };
    });

    /** Fork to {@link ValidateDockerImageFork} */
    result = ForkedProjectOp.run('validate-docker-image.js', inputs);
    if (!result.success) {
      throw new BuildError(sprintf('Unable to validate Docker images for %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }
    _.each(Object.keys(result.outputs), dirname => {
      const output = result.outputs[dirname];
      if (output && output.missingImage) {
        missingImages++;
      }
    });
    if (missingImages > 0) {
      throw new BuildError("One or more projects are missing released artifacts; check Jenkins to determine cause");
    }

    releasePipe.ensurePipeIsOpen(bundle);

    let rcVersion = info.candidate.getBundleVersion().toString();
    if (!bundle.changeset.isHotfix() && !bundle.changeset.onTrunk()) {
      util.announce('Switching to mainline'.plain);
      bundle.checkout(_.union(bundle.projects.included, bundle.supportProjects.valid), {
        checkout: Projects.GitTarget.MAINLINE
      });

      // Write RC branches to mainline
      merge(bundle.projects.included, rcVersion, info.rcBranchName);
      merge(bundle.supportProjects.included, rcVersion, bundle.getChangesetBranchName());
    } else if (bundle.supportProjects.included.length > 0) {
      if (bundle.changeset.isHotfix()) {
        let targetBranch = info.candidate.getHotfixSupportBranch();
        rflowUtil.createOfficialBranches(bundle.changeset.getTrunk(), bundle.supportProjects.included, 'hotfix',
          bundle.changeset.getReleaseTag(), bundle.getChangesetBranchName(), targetBranch,
          bundle.invocation.getCommitMessage(targetBranch));
      } else {
        merge(bundle.supportProjects.included, rcVersion, bundle.getChangesetBranchName(),
          bundle.changeset.getTrunkMainlineBranchNameForSupportProjects());
      }
    }

    // Tag all projects(...
    let releaseTag = info.candidate.getReleaseTag();
    util.announce(sprintf('Applying tag %s'.plain, releaseTag));
    inputs = _.map(bundle.getAllIncludedProjects().concat(bundle.getAllExcludedProjects()), project => {
      const included = bundle.getAllIncludedProjects().includes(project);
      return {
        project: project,
        included: included,
        tag: releaseTag,
        priorTag: project instanceof BuildProject ? info.previousReleaseTag : undefined,
        commitMessage: bundle.invocation.getCommitMessage()
      };
    });

    /** Fork to {@link TagFork} */
    result = ForkedProjectOp.run('tag.js', inputs);
    if (!result.success) {
      throw new BuildError(sprintf('Unable to tag %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }

    let releases = bundle.changeset.getValueSafe('releases') || [];
    releases.unshift(info.candidate.getBundleVersion().toString());

    // Update changeset
    bundle.changeset.setStatus(ChangesetFile.Status.RELEASED);
    bundle.changeset.setSourceBundleVersion(bundle.changeset.getBundleVersion().toString());
    bundle.changeset.setValue('releases', releases);
    bundle.changeset.save();

    if (bundle.changeset.isHotfix()) {
      bundle.hotfixFile = buildOfficialChangeset(ChangesetFile.Alias.HOTFIX);
    } else {
      bundle.releasedFile = buildOfficialChangeset(bundle.getReleasedAlias());
    }

    // Remove candidate.yml
    info.candidate.removeFile(bundle.getCandidateAlias());

    if (!bundle.changeset.isHotfix()) {
      // Identify projects graduating from PENDING to ACTIVE
      let graduates = _.filter(bundle.getAllIncludedProjects(),
        project => bundle.getProjectStatus(project) === Projects.Status.PENDING);
      if (graduates.length > 0) {
        bundle.graduateProjects(graduates);
      }
    }

    // Tag versions-file repo, but first we have to commit what we have
    bundle.versionsRepo.addAndCommit(bundle.invocation.getCommitMessage(releaseTag));
    applyTag(bundle.versionsRepo, bundle.versionsRepo.dirname, releaseTag);

    rflowUtil.updateSourceControl(bundle, {
      projects: bundle.getAllValidProjects(),
      message: bundle.invocation.getCommitMessage(releaseTag),
      savePoms: false,
      tags: true,
      retryWithPull: false,
      successText: 'Pushed'.good,
      skipVersionsRepo: true
    })

    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.pushWithTags({retryWithPull: true});
    util.endBullet('Pushed'.good);

    teams.notifyOnReleased(bundle);
  }
};
