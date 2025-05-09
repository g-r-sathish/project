const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const config = require('../../../common/config');
const rflowUtil = require('../../../common/rflow-util');
const {ShipmentFile} = require('../../../classes/ShipmentFile');
const util = require('../../../common/util');

module.exports['audit-shipment'] = {
  summary: 'Audits a shipment, provides a list of changesets not in production',
  requiredArguments: ['shipment-id'],
  optionalArguments: ['document'],
  requiredSettings: [],
  optionalSettings: [],
  notificationSettings: {
    skip: true
  },
  callback: function (bundle, goal) {
    if (!util.fileExists(bundle.shipment.getShipmentPath(config.shipmentId))) {
      throw new BuildError(sprintf('Shipment %s does not exist', config._all['shipment-id']));
    }

    util.announce(sprintf('Loading keys from %s'.plain, config._all['shipment-id']));
    bundle.initShipment(config.shipmentId);
    _.each(Object.keys(bundle.shipment.data), function (key) {
      if (ShipmentFile.Properties.METADATA.includes(key)) {
        util.startBullet(key.useful);
        util.endBullet(JSON.stringify(bundle.shipment.data[key], null, 2).useful);
      } else {
        util.startBullet(key.plain);
        util.endBullet(bundle.shipment.data[key].plain);
      }
    });
    bundle.initSupportProjects({ shallow: true });

    let changesets = rflowUtil.auditShipment(bundle);

    if (config._all['document']) {
      rflowUtil.documentChangesets(changesets);
    }
  }
};
