const _ = require('underscore');
const config = require('../../common/config');
const util = require('../../common/util');

module.exports['status'] = {
  heading: "Release pipe constraints",
  summary: 'Show the current status of the release pipes',
  requiredArguments: [],
  optionalArguments: ['include'],
  requiredSettings: [],

  callback: function (bundle, params) {
    util.startBullet(config.bundleName.plain);
    util.endBullet(bundle.getReleaseConstraint().plain);
  }
};
