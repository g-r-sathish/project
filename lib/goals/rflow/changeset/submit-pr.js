const _ = require('underscore');

const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const {UpdateTypes} = require('../../../classes/Constants');
const util = require('../../../common/util');
const teams = require('../../../common/teams').teamsService;

module.exports['submit-pr'] = {
  summary: 'Create pull requests (PRs) from changeset',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['force-new', 'reviewers', 'max-fork-count', 'dry-run', 'build', 'skip-test', 'jacoco', 'perf-impr'],
  requiredSettings: [],
  optionalSettings: ['reviewers'],
  callback: function (bundle, goal) {
    bundle.init();

    rflowUtil.ensureStatusIs(bundle.changeset,
      [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);
    rflowUtil.ensureCorrectPomAndDependencyVersions(bundle);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);
    rflowUtil.updateSourceControl(bundle, {skipProjects: true});

    let projectsToPR = reviewUtil.createReviewBranchesAsNeeded(bundle, reviewStatus, config._all['force-new']);

    if (projectsToPR.length === 0) {
      util.announce('Noteworthy'.warn);
      util.println('Your changeset has no commits to review, PRs are not needed'.warn);
    } else {
      let pullRequests = [];
      let projectsToBuild = [];
      _.each(projectsToPR, function (project) {
        pullRequests.push({
          project: project,
          versionsRepo: bundle.versionsRepo,
          source: bundle.getReviewSourceBranchName(),
          destination: bundle.getReviewTargetBranchName()
        });
        if (project.hasNewReviewBranches) {
          projectsToBuild.push(project);
        }
      });

      if (projectsToBuild.length && config._all['build']) {
        rflowUtil.triggerBuild(bundle, projectsToBuild, reviewStatus, {announceIt: true, addDependencies: false});
      }

      reviewUtil.createPullRequests(pullRequests, config.changesetId.trackingId);

      util.announce('Noteworthy'.warn);
      util.println('Please use the links above to review your PRs for expected changes and reviewers'.warn);
      let updates = [];
      _.each(pullRequests, function(pullRequest) {
        updates.push({
          type: UpdateTypes.PULL_REQUEST,
          status: pullRequest.status,
          project: pullRequest.project.dirname,
          url: pullRequest.url
        });
      });
      teams.notifyOnSubmitPr(bundle, updates);
      return updates;
    }
  }
};
