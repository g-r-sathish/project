const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError');
const config = require('../common/config');
const Errors = require('./Errors');
const Invocation = require('./Invocation');
const util = require('../common/util');
const {VersionEx} = require('./VersionEx');

/**
 * @class
 */
function Bundle() {}

Bundle.prototype._constructBundle = function (configFile, versionsRepo, instanceName, targetParamName) {
  this.instanceName = instanceName;
  this.currentGoal = config.goal || 'no-known-goal';
  this.configFile = undefined;
  this.versionsRepo = versionsRepo;
  this.setBuildFile(configFile);
  this.invocation =
    targetParamName ? new Invocation(targetParamName, config.personal_settings.ad_username) : undefined;
};

Bundle.prototype.lock = function () {
  if (!config.targetLocking) {
    return;
  }
  if (!this.invocation) {
    throw new BuildError('Unable to lock; no invocation defined');
  }
  let lockFilename = this.invocation.getLockFilename();
  let lockContent = this.versionsRepo.getFileIfExists(lockFilename);
  if (lockContent !== undefined) {
    throw new Errors.LockedError(sprintf('%s is locked by %s, try again later?', this.invocation.target, lockContent));
  }
  this.invocation.markLockedByUs();
  lockContent = this.invocation.getLockContent();
  this.versionsRepo.writeFile(lockFilename, lockContent);
  try {
    this.versionsRepo.addCommitPush(lockFilename, this.invocation.getCommitMessage('(lock)'));
  } catch (ex) {
    throw new Errors.LockedError(sprintf('Failed to lock %s', this.invocation.target));
  }
};

Bundle.prototype.getHotfixVersion = function (configFile) {
  let theConfigFile = configFile || this.configFile;
  let rawValue = theConfigFile.getValue('bundle_next_hotfix_version');
  if (rawValue === undefined) {
    throw new BuildError('Config file is missing value for \'bundle_next_hotfix_version\'');
  }
  return new VersionEx(rawValue);
};

Bundle.prototype.isLockedByUs = function () {
  return this.invocation && this.invocation.lockedByUs;
};

Bundle.prototype.seedHotfixVersion = function (productionVersion, configFile) {
  let theConfigFile = configFile || this.configFile;
  return this._incrementHotfixVersion(productionVersion, theConfigFile);
};

Bundle.prototype.setBuildFile = function (configFile) {
  this.configFile = configFile;

  // Allow build file to override default configuration
  config.$extend(this.configFile.data.config);
  util.narrateln('Configuration');
  util.narrateln(JSON.stringify(config, null, 2));
};

Bundle.prototype.unlock = function () {
  if (!config.targetLocking) {
    return;
  }
  if (!this.invocation) {
    throw new BuildError('Unable to lock; no invocation defined');
  }

  let lockFilename = this.invocation.getLockFilename();
  try {
    this.versionsRepo.git('pull');
    let lockContent = this.versionsRepo.getFileIfExists(lockFilename);
    if (lockContent !== undefined) {
      this.versionsRepo.deleteCommitPush(lockFilename, this.invocation.getCommitMessage('(unlock)'));
    }
  } catch (ex) {
    throw new Errors.LockedError(sprintf('Failed to unlock %s; %s will need to be manually removed',
      this.invocation.target, lockFilename));
  }
};

Bundle.prototype._incrementHotfixVersion = function (oldVersion, configFile) {
  let version = oldVersion.clone();
  version.setHotfix(version.hasHotfix() ? version.getHotfix() + 1 : 1);
  configFile.setValue('bundle_next_hotfix_version', version.toString());
  configFile.save();
  return version;
};

module.exports = Bundle;
