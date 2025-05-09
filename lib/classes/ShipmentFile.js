const _ = require('underscore');
const fs = require('fs');
const sprintf = require('sprintf-js').sprintf;
const path = require('path');
const yaml = require('js-yaml');

const BuildError = require('./BuildError');
const {ChangesetFile} = require('./ChangesetFile');
const config = require('../common/config');
const util = require('../common/util');

class ShipmentFile {
  static Alias = {
    APPROVED: 'approved',
    PRODUCTION: 'production'
  };

  // order matters here for priority when determining support project branches
  static AllowedChangesetAliases = [
    ChangesetFile.Alias.PRODUCTION,
    ChangesetFile.Alias.RELEASED,
    ChangesetFile.Alias.HOTFIX
  ];

  static OpsEnvironment = {
    PROD: 'stay-versions-prod',
    DEVNET: 'stay-versions-devnet'
  };

  static Properties = {
    METADATA: ['shipment'],
    CONSTITUENT: ['bundle_version', 'tracking_id', 'trunk_markers'],
    EXCLUDED: [ 'merged_tracking_ids', 'bundle_name' ]
  };

  /**
   * @param {GitRepository} versionsRepo
   * @param {string} bundleName
   * @param {string} version
   */
  constructor(versionsRepo, bundleName, version) {
    this.repo = versionsRepo;
    this.projectDir = bundleName || config.bundleName;
    this.filePath = undefined;
    this.data = {
      shipment: {
        version: version || config.shipmentId.version,
        changesets: {},
        commits: {}
      }
    };
  }

  getFilename() {
    return this.filePath ? path.basename(this.filePath) : this.filePath;
  }

  getReleaseTag() {
    return sprintf(config.releaseTagSpec, this.projectDir, this.data.shipment.version);
  }

  getShipmentPath(shipmentId) {
    return this.repo.getAbsolutePath(this.getRelativeShipmentPath(shipmentId));
  }

  getRelativeShipmentPath(shipmentId) {
    return sprintf(config.versions_files.shipment_spec, shipmentId.bundleName, shipmentId.version);
  }

  getAliasPath(alias) {
    return this.repo.getAbsolutePath(sprintf(config.versions_files.alias_spec, this.projectDir, alias));
  }

  doesAliasExist(alias) {
    return util.fileExists(this.getAliasPath(alias));
  }

  doesShipmentExist(shipmentId) {
    return util.fileExists(this.getShipmentPath(shipmentId));
  }

  loadFromShipment(shipmentId) {
    this.readFile(this.getShipmentPath(shipmentId));
    return this;
  }

  loadFromAlias(alias) {
    try {
      this.readFile(this.getAliasPath(alias));
    } catch (ex) {
      throw new BuildError(sprintf('Cannot load manifest: %s\n%s', alias.bold, ex));
    }
    return this;
  }

  load() {
    let version = this.data.shipment.version;
    if (_.find(Object.values(ShipmentFile.Alias), alias => version === alias)) {
      return this.loadFromAlias(version);
    }
    let shipmentId = {
      bundleName: this.projectDir,
      version: version
    };
    if (!this.doesShipmentExist(shipmentId)) {
      throw new BuildError(sprintf('Shipment %s:%s does not exist', shipmentId.bundleName, shipmentId.version));
    }
    return this.loadFromShipment(shipmentId);
  }

  readFile(filePath) {
    this.data = undefined;
    try {
      this.data = util.readYAML(filePath);
      this.filePath = filePath;
    } catch (ex) {
      throw new BuildError(sprintf('Could not load `%s`: %s', filePath, ex.toString()));
    }
  }

  getVersionProperties() {
    let versions = {};
    for (let key of Object.keys(this.data)) {
      if (key.endsWith('_version')) {
        versions[key] = this.data[key];
      }
    }
    return versions;
  }

  setValue(key, value) {
    if (!util.isPresent(key)) throw new Error('Missing assignment key');
    if (!util.isPresent(value)) throw new Error(sprintf('Missing value for assignment to: %s', key));
    return this.data[key] = value;
  }

  saveAsShipment(shipmentId) {
    return this.saveAs(this.getShipmentPath(shipmentId));
  }

  saveAsAlias(alias) {
    return this.saveAs(this.getAliasPath(alias));
  }

  saveForOps(environment) {
    return this.saveAs(this.repo.getAbsolutePath(sprintf(config.versions_files.ops_shipment_spec, environment)),
      {includeMetadata: false});
  }

  save() {
    return this.saveAs(this.filePath);
  }

  saveAs(filePath, params) {
    params = _.extend({
      includeMetadata: true
    }, params);
    util.mkfiledir(filePath);
    let aggregate = {};
    _.each(Object.keys(this.data), function (key) {
      if (key !== 'shipment' || params.includeMetadata) {
        aggregate[key] = this.data[key];
      }
    }, this);
    fs.writeFileSync(filePath, yaml.dump(aggregate), 'utf8');
    this.filePath = filePath;
    return this;
  }
}

module.exports.ShipmentFile = ShipmentFile;
