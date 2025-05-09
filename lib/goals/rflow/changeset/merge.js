const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const mergeUtil = require('../../../common/merge-util');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');

module.exports['merge'] = {
  summary: 'Merge an existing changeset into the current changeset',
  requiredArguments: ['changeset-id', 'from-changeset-id'],
  optionalArguments: ['formal', 'max-fork-count', 'dry-run'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: [],
  callback: function (bundle, goal) {
    if (config.changesetId.bundleName !== config.fromChangesetId.bundleName) {
      throw new BuildError('Merge is only allowed within the same bundle');
    }

    if (config.changesetId.trackingId === config.fromChangesetId.trackingId) {
      throw new BuildError('Self merging is not allowed');
    }

    bundle.init({workDir: util.cwd()});

    let ourChangeset = bundle.changeset;
    let theirChangeset = ChangesetFile.create(bundle.versionsRepo, bundle.bundleName).loadFromChangeset(
      config.fromChangesetId);
    let ourTrunk = ourChangeset.getTrunk();
    let theirTrunk = theirChangeset.getTrunk();
    let ourBundleVersion = ourChangeset.getBundleVersion();
    let theirBundleVersion = theirChangeset.getBundleVersion();
    let ourBundleVersionTrunk = ourBundleVersion.getTrunkName();
    let theirBundleVersionTrunk = theirBundleVersion.getTrunkName();

    let theirBundleIsNewer = ourTrunk === theirTrunk &&
      ((ourBundleVersionTrunk === theirBundleVersionTrunk && ourBundleVersion.compareTo(theirBundleVersion) < 0) ||
        (!ourBundleVersionTrunk && theirBundleVersionTrunk === ourTrunk));

    if (bundle.changeset.isHotfix() && theirBundleIsNewer) {
      throw new BuildError(sprintf('Cannot merge changeset with source bundle version %s into hotfix with source' +
        ' bundle version %s', theirChangeset.getBundleVersion(), ourChangeset.getBundleVersion()));
    }

    if (config._all.formal) {
      let mergedTrackingIds = ourChangeset.data.merged_tracking_ids || [];
      if (!_.contains(mergedTrackingIds, theirChangeset.data.tracking_id)) {
        mergedTrackingIds.push(theirChangeset.data.tracking_id);
      }

      if (theirChangeset.data.merged_tracking_ids) {
        _.each(theirChangeset.data.merged_tracking_ids, mergedTrackingId => {
          if (!_.contains(mergedTrackingIds, mergedTrackingId)) {
            mergedTrackingIds.push(mergedTrackingId);
          }
        });
      }

      ourChangeset.data.merged_tracking_ids = mergedTrackingIds;
      ourChangeset.save();
    }

    rflowUtil.ensureStatusIs(ourChangeset,
      [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);
    if (theirChangeset.isHotfix()) {
      rflowUtil.ensureStatusIs(theirChangeset,
        [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);
    } else {
      rflowUtil.ensureStatusIs(theirChangeset, [ChangesetFile.Status.DEV, ChangesetFile.Status.RELEASED]);
    }

    mergeUtil.ensureGoodStateForMerge(bundle);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    mergeUtil.merge(bundle, theirChangeset, reviewStatus, false);
  }
};
