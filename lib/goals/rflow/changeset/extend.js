const _ = require('underscore');

const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');

module.exports['extend'] = {
  summary: 'Include additional projects in an existing set of changeset branches',
  requiredArguments: ['changeset-id', 'include'],
  optionalArguments: ['max-fork-count', 'dry-run', 'skip-test', 'jacoco', 'perf-impr'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: [],
  callback: function (bundle, goal) {
    bundle.init({
      addAutoInclude: true,
      allowMissingBranches: true,
      includeList: config._all.include
    });
    rflowUtil.ensureStatusIs(bundle.changeset,
      [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);

    const reviewStatus = reviewUtil.synchronizeReviewStatus(bundle, bundle.changeset.getReleaseTag(),
      config._all.include);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    rflowUtil.prepareChangeset(bundle, { explicitProjectsToAdd: config._all.include });
    rflowUtil.triggerBuildFromIncludes(bundle, reviewStatus);
  }
};
