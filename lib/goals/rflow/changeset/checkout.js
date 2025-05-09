const BuildError = require('../../../classes/BuildError');
const config = require('../../../common/config');
const util = require('../../../common/util');

module.exports['checkout'] = {
  summary: 'Checkout development branches',
  requiredArguments: [],
  optionalArguments: ['changeset-id', 'alias-id', 'force', 'max-fork-count'],
  requiredSettings: [],
  optionalSettings: ['rflow_workdir'],
  notificationSettings: {
    skip: true
  },
  callback: function (bundle, goal) {
    if (config._all['changeset-id'] && config._all['alias-id']) {
      throw new BuildError('The --changeset-id and --alias-id parameters are mutually exclusive');
    }
    if (!config._all['changeset-id'] && !config._all['alias-id']) {
      throw new BuildError('The --changeset-id or --alias-id parameter must be specified');
    }

    let options = {
      workDir: util.cwd(),
      forceCheckout: !!config._all['force']
    };
    if (config._all['alias-id']) {
      options.alias = config.aliasId.alias;
    }
    bundle.init(options);
  }
};

module.exports['checkout-all'] = {
  summary: 'Checkout development branches (and release branches of not-included projects)',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['use-cwd', 'force', 'max-fork-count'],
  requiredSettings: [],
  optionalSettings: ['rflow_workdir'],
  notificationSettings: {
    skip: true
  },
  callback: function (bundle, goal) {
    bundle.init({
      workDir: util.cwd(),
      checkoutExcluded: true,
      forceCheckout: !!config._all['force']
    });
  }
};
