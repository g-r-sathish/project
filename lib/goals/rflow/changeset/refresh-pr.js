const _ = require('underscore');

const config = require('../../../common/config');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');

module.exports['refresh-pr'] = {
  summary: 'Refresh pull requests (PRs)',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['include', 'build', 'max-fork-count', 'dry-run', 'skip-test', 'jacoco', 'perf-impr'],
  requiredSettings: [],
  optionalSettings: [],
  callback: function (bundle, goal) {
    bundle.initSomeOrAll();

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    if (config._all['build']) {
      let projectsToBuild = [];
      _.each(bundle.getAllIncludedProjects(), project => {
        let status = reviewStatus[project.dirname];
        if (status && status.needsBuild) {
          projectsToBuild.push(project);
        }
      });
      if (projectsToBuild.length) {
        let options = {
          announceIt: true,
          addDependencies: !config._all.include
        };
        rflowUtil.triggerBuild(bundle, projectsToBuild, reviewStatus, options);
      }
    }
  }
};
