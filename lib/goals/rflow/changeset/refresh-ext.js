const rflowUtil = require('../../../common/rflow-util');

module.exports['refresh-ext'] = {
  summary: 'Refresh externally-sourced details',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: [],
  callback: function (bundle, goal) {
    bundle.init({noCheckout: true});

    rflowUtil.synchronizeChangeset(bundle, {force: true});
  }
};
