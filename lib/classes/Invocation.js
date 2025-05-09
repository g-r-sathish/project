const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const config = require('../common/config');
const util = require('../common/util');

/**
 * @class
 * @param {string} targetParamName
 * @param {string} actor
 */
function Invocation(targetParamName, actor) {
  let params = config._all;

  this.actor = actor;
  this.app = config.whatami;
  this.target = params[targetParamName];
  this.goal = params['goal'];
  this.options = '';

  _.each(Object.keys(params), key => {
    if (_.contains([targetParamName, 'goal', 'commit'], key)) {
      return;
    }
    this.options += ' --' + key;
    let value = params[key];
    if (value === true) {
      return;
    }
    value = util.asArray(value);
    this.options += ' ' + value.join(' ');
  });
  this.options = this.options.trimLeft();

  this.command = this.goal + (this.options ? ' ' + this.options : '');
  this.lockedByUs = false;
}

Invocation.prototype.getLockContent = function () {
  return sprintf('%s [%s]', this.actor, this.command);
};

Invocation.prototype.getLockFilename = function () {
  return sprintf(config.versions_files.lock_spec, this.target);
};

Invocation.prototype.getCommitMessage = function (additionalText) {
  return this._getCommitMessage(this.getCommitPrefix(), additionalText);
};

Invocation.prototype.getCommitPrefix = function () {
  return sprintf('[%s]', this.app);
};

Invocation.prototype.getIgnoredCommitMessage = function (additionalText) {
  return this._getCommitMessage(this.getIgnoredCommitPrefix(), additionalText);
};

Invocation.prototype.getIgnoredCommitPrefix = function () {
  return sprintf('%s[ignore]', this.getCommitPrefix());
};

Invocation.prototype.markLockedByUs = function () {
  this.lockedByUs = true;
};

Invocation.prototype._getCommitMessage = function (prefix, additionalText) {
  let message = sprintf('%s[%s][%s]', prefix, this.target, this.command);
  if (additionalText) {
    message += ' ' + additionalText;
  }
  return message;
};

module.exports = Invocation;
