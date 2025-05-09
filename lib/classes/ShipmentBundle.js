const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;
const colors = require('colors');
const Path = require('path');

const Bundle = require('./Bundle');
const BuildError = require('./BuildError');
const {ChangesetFile} = require('./ChangesetFile');
const config = require('../common/config');
const {ForkedProjectOp} = require('./ForkedProjectOp');
const JSONFile = require('./JSONFile');
const {Projects} = require('./Constants');
const {ShipmentFile} = require('./ShipmentFile');
const {SupportProject} = require('./SupportProject');
const {Trunk} = require('./Trunk');
const util = require('../common/util');

/**
 * @class
 * @param {JSONFile} configFile
 * @param {GitRepository} versionsRepo
 */
function ShipmentBundle (configFile, versionsRepo) {
  this._constructBundle(configFile, versionsRepo, 'shipment', 'shipment-id');
  this.shipment = new ShipmentFile(this.versionsRepo);
  this.baseVersions = util.readYAML(Path.join(versionsRepo.getRepoDir(), config.versions_files.base_versions_path)) || {};
  this.changesets = {};
  this.trunkNames = [];
  _.each(this.configFile.getValue('changeset_bundle_names'), function(bundleName) {
    this.changesets[bundleName] = {
      configFile: new JSONFile(Path.join(versionsRepo.getRepoDir(), sprintf(config.versions_files.bundle_config_spec, bundleName))),
      releasedFile: ChangesetFile.create(this.versionsRepo, bundleName).loadFromAlias(ChangesetFile.Alias.RELEASED),
      hotfixFile: ChangesetFile.create(this.versionsRepo, bundleName).loadFromAliasQuietly(ChangesetFile.Alias.HOTFIX),
      productionFile: ChangesetFile.create(this.versionsRepo, bundleName).loadFromAlias(ChangesetFile.Alias.PRODUCTION),
      trunks: {}
    };
    if (!this.changesets[bundleName].hotfixFile.data) this.changesets[bundleName].hotfixFile = undefined;
    if (this.changesets[bundleName].configFile.data.trunks) {
      this.changesets[bundleName].configFile.data.trunks.forEach(
        trunkConfig => this.changesets[bundleName].trunks[trunkConfig.name] =
          new Trunk(trunkConfig, this.versionsRepo, bundleName));
    }
    let trunkNames = Object.keys(this.changesets[bundleName].trunks);
    this.trunkNames.push(...trunkNames);  
  }, this);
  this.supportProjects = [];
  this.approvedFile = new ShipmentFile(this.versionsRepo).loadFromAlias(ShipmentFile.Alias.APPROVED);
  this.productionFile = new ShipmentFile(this.versionsRepo).loadFromAlias(ShipmentFile.Alias.PRODUCTION);
}

ShipmentBundle.prototype = new Bundle();
ShipmentBundle.prototype.constructor = ShipmentBundle;

ShipmentBundle.prototype.initSupportProjects = function (options) {
  options = _.extend({
    shallow: false
  }, options);
  const projectOptionPairs = [];
  _.each(this.configFile.data.support_projects, definition => {
    const project = SupportProject.create(definition, {}, this.instanceName);
    this.supportProjects.push(project);
    projectOptionPairs.push({
      project: project,
      options: {checkout: Projects.GitTarget.NO_OP}
    });
  });
  if (!options.shallow) {
    /** Fork to {@link CheckoutFork} */
    const result = ForkedProjectOp.run('checkout.js', projectOptionPairs);
    if (!result.success) {
      throw new BuildError('Cannot continue due to one or more missing targets or errors!');
    }
  }
};

ShipmentBundle.prototype.initShipment = function (shipmentId) {
  this.shipment.loadFromShipment(shipmentId);
};

ShipmentBundle.prototype.getChangesetTypes = function () {
  return Object.keys(this.changesets);
};

ShipmentBundle.prototype.getMetadata = function () {
  return this.shipment.data.shipment;
};


ShipmentBundle.prototype.getTrunkAliases = function (bundleName) {
  if (!bundleName) {
    console.log("Bundle name is invalid.");
    return [];
  }
  if (this.changesets[bundleName] && this.changesets[bundleName].trunks) {
    return Object.keys(this.changesets[bundleName].trunks);
  } else {
    console.log("No trunks found for bundle", bundleName);
    return [];
  }
};

module.exports = ShipmentBundle;
