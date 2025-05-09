const _ = require('underscore');

const BuildError = require('../../../classes/BuildError');
const config = require('../../../common/config');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');

module.exports['build'] = {
  summary: 'Build identified and downstream projects',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['include', 'resume', 'local', 'use-cwd', 'max-fork-count', 'dry-run', 'skip-test', 'jacoco', 'perf-impr', 'sb3build'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: ['rflow_workdir'],
  callback: function (bundle, goal) {
    if (config._all.local) {
      throw new BuildError('The --local option is not yet implemented');
    }
    if (config._all.resume && !config._all.include) {
      throw new BuildError('The --resume option only works in conjunction with --include (-i)');
    }

    bundle.init(config._all.local ? { workDir: util.cwd()} : { workDir: config.workDir });

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    let options = {
      addDependencies: !config._all.resume,
      addDownstream: !!config._all.resume
    };

    rflowUtil.triggerBuildFromIncludes(bundle, reviewStatus, options);
  }
};
