const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const config = require('../common/config');
const ConfigError = require('../classes/ConfigError');
const GitRepository = require('./GitRepository');
const util = require('../common/util');

class Users {
  /**
   * @param {GitRepository} versionsRepo
   */
  constructor(versionsRepo) {
    this.repo = versionsRepo;
  }

  /**
   * @param {UserData} user
   */
  addUser(user) {
    this._save(user);
    this.repo.checkIn({message: sprintf('[%s] users', config.whatami)})
  }

  /**
   * @param {string[]} adUsernames
   * @return {UserData[]}
   */
  resolveUsers(adUsernames) {
    return _.map(adUsernames, adUsername => {
      const user = this._getUser(adUsername);
      return user || {adUsername: adUsername};
    });
  }

  /**
   * @param adUsername
   * @return {UserData|undefined}
   * @private
   */
  _getUser(adUsername) {
    const filePath = this._getUserPath(adUsername.toLowerCase());
    if (util.fileExists(filePath)) {
      const user = util.readYAML(filePath);
      user.adUsername = adUsername;
      return user;
    }
    return undefined;
  }

  /**
   * @param {string} adUsername
   * @returns {string}
   * @private
   */
  _getUserPath(adUsername) {
    return this.repo.getAbsolutePath(sprintf(config.versions_files.user_spec, adUsername));
  }

  /**
   * @param {UserData} user
   * @private
   */
  _save(user) {
    if (!user.adUsername) return;
    const filePath = this._getUserPath(user.adUsername);
    const data = _.clone(user);
    delete data.adUsername;
    if (Object.keys(data).length === 2) {
      util.writeYAML(filePath, data);
    }
  }
}

module.exports.Users = Users;