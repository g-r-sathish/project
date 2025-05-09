const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const rflowUtil = require('../../../common/rflow-util');
const {ShipmentFile} = require('../../../classes/ShipmentFile');
const util = require('../../../common/util');
const {VersionEx} = require('../../../classes/VersionEx');

const EXCLUDED_CHANGESET_PROPERTIES = [
  'hotfix',
  'projects',
  'releases',
  'rollback_impact',
  'source_bundle_version',
  'status',
  'summary'
];

module.exports['confirm-shipment'] = {
  summary: 'Confirms a shipment has been deployed to production',
  requiredArguments: ['shipment-id'],
  optionalArguments: ['dry-run'],
  requiredSettings: [],
  optionalSettings: [],
  callback: function (bundle, goal) {

    function writeToProduction(productionFile, key, newValue) {
      let currentValue = productionFile.data[key];
      let isObject = (typeof currentValue === 'object' && currentValue !== null) ||
        (typeof newValue === 'object' && newValue !== null);

      if (!isObject) {
        util.startBullet(key.plain);
        util.continueBullet(currentValue ? currentValue.plain : "N/A".warn);
      }
      productionFile.setOrRemoveValue(key, newValue);
      if (!isObject) {
        if (currentValue !== newValue) {
          util.endBullet(newValue.good);
        } else {
          util.endBullet('Unchanged'.trivial);
        }
      }
    }

    if (!util.fileExists(bundle.shipment.getShipmentPath(config.shipmentId))) {
      throw new BuildError(sprintf('Shipment %s does not exist', config._all['shipment-id']));
    }

    if (bundle.approvedFile.data.shipment.version !== config.shipmentId.version) {
      throw new BuildError(sprintf('Shipment %s is not approved; please make sure you know what you\'re doing!',
        config._all['shipment-id']));
    }

    bundle.initSupportProjects({shallow: true});
    let supportProjectInclusionKeys = rflowUtil.getSupportProjectInclusionKeys(bundle.supportProjects);

    bundle.initShipment(config.shipmentId);

    _.each(bundle.getChangesetTypes(), function (type) {
      let changesetId = {
        bundleName: type,
        trackingId: bundle.getMetadata().changesets[type].tracking_id
      };
      util.announce(sprintf('Updating production from %s:%s'.plain, changesetId.bundleName, changesetId.trackingId));
      let changeset = ChangesetFile.create(bundle.versionsRepo, type).loadFromChangeset(changesetId);
      let changesetBundle = bundle.changesets[type];
      changesetBundle.changeset = changeset;

      rflowUtil.ensureStatusIs(changeset, ChangesetFile.Status.RELEASED);

      _.each(ShipmentFile.Properties.CONSTITUENT, function (key) {
        writeToProduction(changesetBundle.productionFile, key, bundle.getMetadata().changesets[type][key]);
      });

      let processedKeys = [];
      _.each(Object.keys(changeset.data), function (key) {
        if (EXCLUDED_CHANGESET_PROPERTIES.includes(key) || ShipmentFile.Properties.CONSTITUENT.includes(key) ||
          supportProjectInclusionKeys.includes(key)) return;
        writeToProduction(changesetBundle.productionFile, key, bundle.shipment.data[key]);
        processedKeys.push(key);
      });

      _.each(Object.keys(changesetBundle.productionFile.data), function (key) {
        if (ShipmentFile.Properties.CONSTITUENT.includes(key) || processedKeys.includes(key)) return;
        util.startBullet(key.plain);
        util.continueBullet(changesetBundle.productionFile.data[key].plain);
        delete changesetBundle.productionFile.data[key];
        util.endBullet('Removed'.warn);
      });

      changesetBundle.productionFile.save();
    });

    util.announce('Clearing out hotfix files'.plain);
    _.each(bundle.getChangesetTypes(), function (type) {
      let changesetBundle = bundle.changesets[type];

      util.startBullet(sprintf('%s/hotfix.yml'.plain, type));
      if (changesetBundle.hotfixFile) {
        changesetBundle.hotfixFile.removeFile();
        if (changesetBundle.changeset.isHotfix()) {
          util.endBullet('Removed'.good);
        } else {
          util.continueBullet('Removed'.bad);
          util.endBullet(
            sprintf('Hotfix version %s was never deployed!'.bad, changesetBundle.hotfixFile.getBundleVersion()));
        }
      } else {
        util.endBullet('Not present'.trivial);
      }
    });

    util.announce('Setting next hotfix versions'.plain);
    _.each(bundle.getChangesetTypes(), function (type) {
      let changesetBundle = bundle.changesets[type];

      util.startBullet(type.plain);
      let currentVersion = bundle.getHotfixVersion(changesetBundle.configFile);
      util.continueBullet(currentVersion.toString().plain);
      let newVersion = bundle.seedHotfixVersion(new VersionEx(bundle.getMetadata().changesets[type].bundle_version),
        changesetBundle.configFile);
      if (newVersion.compareTo(currentVersion) === 0) {
        util.endBullet('Unchanged'.trivial);
      } else {
        util.endBullet(newVersion.toString().good);
      }
    });

    util.announce('Writing manifests'.plain);
    let productionFile = bundle.approvedFile.saveAsAlias(ShipmentFile.Alias.PRODUCTION);
    util.startBullet(productionFile.getFilename().plain);
    util.endBullet('Done'.good);
    let opsFile = bundle.approvedFile.saveForOps(ShipmentFile.OpsEnvironment.DEVNET);
    util.startBullet(opsFile.getFilename().plain);
    util.endBullet('Done'.good);

    util.announce('Updating source control'.plain);
    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.checkIn({
      message: bundle.invocation.getCommitMessage()
    });
    util.endBullet('Committed & pushed'.good);
  }
};
