const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const {ChangesetFile} = require('./ChangesetFile');
const config = require('../common/config');

class Trunk {
  static NAME_REGEX = /^[a-zA-Z]{1}[\w.-]{2,}$/;

  /**
   * @param {{}} definition
   * @param {GitRepository} versionsRepo
   * @param {string} [bundleName]
   * @constructor
   */
  constructor(definition, versionsRepo, bundleName) {
    this.definition = _.extend({
      active: true
    }, definition);

    this.trunkFile = ChangesetFile.create(versionsRepo, bundleName).loadFromTrunkQuietly(this);
    if (!this.trunkFile.data) this.trunkFile = undefined;
  }

  isActive() {
    return !!this.definition.active;
  }

  getAlias() {
    return sprintf(config.trunk_alias_spec, this.definition.name);
  }

  getCandidateAlias() {
    return sprintf(config.trunk_candidate_alias_spec, this.definition.name);
  }

  getName() {
    return this.definition.name;
  }

  getVersion() {
    return this.trunkFile ? this.trunkFile.getBundleVersion() : undefined;
  }
}

module.exports.Trunk = Trunk;
