const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const mergeUtil = require('../../../common/merge-util');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');

module.exports['pull'] = {
  summary: 'Merge latest from mainline into a changeset',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['hotfix', 'production', 'released', 'trunk', 'use-cwd', 'max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: ['rflow_workdir'],
  callback: function (bundle, goal) {
    let fromHotfix = config._all.hotfix;
    let fromProd = config._all.production;
    let fromReleased = config._all.released;
    let fromTrunk = config._all.trunk;

    bundle.init({workDir: util.cwd()});

    rflowUtil.ensureStatusIs(bundle.changeset,
      [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);

    if (fromProd && bundle.changeset.isHotfix()) {
      throw new BuildError('The --production option is not allowed for a hotfix changeset');
    }

    if (fromTrunk && !bundle.trunks[fromTrunk]) {
      throw new BuildError(sprintf('Invalid trunk: %s', fromTrunk));
    }

    if (fromTrunk && bundle.changeset.onTrunk() && bundle.changeset.getTrunk() === fromTrunk) {
      throw new BuildError('The --trunk option is only allowed for other trunks');
    }

    if (fromReleased && !bundle.changeset.onTrunk()) {
      throw new BuildError('The --released option is only allowed for a trunk changeset');
    }

    if (fromHotfix && bundle.changeset.isHotfix()) {
      throw new BuildError('The --hotfix option is not allowed for hotfixes');
    }

    if (fromHotfix && !bundle.hotfixFile) {
      throw new BuildError('No hotfix currently exists');
    }

    if ((fromProd ? 1 : 0) + (fromTrunk ? 1 : 0) + (fromReleased ? 1 : 0) + (fromHotfix ? 1 : 0) > 1) {
      throw new BuildError('The --production, --hotfix, --trunk, and --released options are mutually exclusive');
    }

    mergeUtil.ensureGoodStateForMerge(bundle);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    let sourceChangeset =
      fromProd ?
        bundle.productionFile :
        fromTrunk ?
          bundle.trunks[fromTrunk].trunkFile || bundle.releasedFile :
          fromReleased ?
            bundle.releasedFile :
            fromHotfix ?
              bundle.hotfixFile :
              bundle.changeset.isHotfix() ?
                bundle.hotfixFile || bundle.productionFile :
                bundle.changeset.onTrunk() ?
                  bundle.trunks[bundle.changeset.getTrunk()].trunkFile :
                  bundle.releasedFile;
    if (sourceChangeset == null && bundle.changeset.onTrunk()) {
      // compare against self to allow for external support branch updates
      sourceChangeset = bundle.changeset;
    }
    if (sourceChangeset == null) {
      throw new BuildError('Unable to locate source changeset');
    }

    mergeUtil.merge(bundle, sourceChangeset, reviewStatus, true);
  }
};
