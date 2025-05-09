const _ = require('underscore');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const azureDevOps = require('../common/azure-devops').azureDevOpsService;
const BuildError = require('../classes/BuildError');
const CancelledError = require('../classes/CancelledError');
const config = require('./config');
const ConfigError = require('../classes/ConfigError');
const constants = require('./constants');
const GitRepository = require('../classes/GitRepository');
const LockError = require('../classes/LockError');
const stash = require('../common/stash').stashService;
const util = require('./util');
const {Users} = require('../classes/Users');
const {VersionEx} = require('../classes/VersionEx');

const VERSION_3_5_0 = new VersionEx('3.5.0');

constants.define('CHANGESET_ID_SHORTCUT_REGEX', /^([a-z]+):(([0-9]{2,6})[a-z]?)$/);
constants.define('CHANGESET_ID_REGEX', /^([a-z]+):(([A-Z]+)-(([0-9]{2,6})[a-z]?))$/);

/**
 * @typedef PersonalSettingsContext
 * @property {boolean} anyOutput
 */

function lockPidFile() {
  if (util.fileExists(config.pidFile)) {
    let pid = util.readFile(config.pidFile);
    let result = util.exec('ps', ['-p', pid], config.homeDir, {okToFail: true});
    if (!result.status) {
      throw new LockError(
        sprintf('%s is already running (process ID %s); concurrent operations are not supported!', config.whatami,
          pid));
    }
  }
  util.writeFile(config.pidFile, '' + process.pid);
}

function unlockPidFile() {
  util.removeFile(config.pidFile);
}

function checkGitVersion(options) {
  options = _.extend({
    allowDevOpsVersion: false
  }, options);

  let proc = util.exec('git', ['--version'], process.cwd());
  let currentVersion = proc.stdout.toString().match(/(\d+?)\.(\d+?)\.(\d+?)/);

  if (options.allowDevOpsVersion && currentVersion[0] === config.gitOpsVersion) {
    config.gitForDevOps = true;
    return;
  }

  let minVersion = config.gitMinVersion.match(/(\d+?)\.(\d+?)\.(\d+?)/);
  let current = _.map(currentVersion.slice(1), function (value) { return parseInt(value) });
  let min = _.map(minVersion.slice(1), function (value) { return parseInt(value) });

  let outdated = current[0] < min[0];
  if (!outdated && current[0] > min[0]) return;
  outdated = outdated || current[1] < min[1];
  if (!outdated && current[1] > min[1]) return;
  outdated = outdated || current[2] < min[2];
  if (!outdated && current[2] >= min[2]) return;

  throw new BuildError(sprintf('Git version is %s; requires at least %s', currentVersion[0], minVersion[0]));
}

function checkNotInDotDir() {
  if (process.cwd().startsWith(config.dotDir)) {
    throw new BuildError(sprintf('%s cannot be executed from within %s', config.whatami, config.dotDir))
  }
}

/**
 * @param {string[]} relevant
 * @param {GitRepository} [versionsRepo]
 */
function ensurePersonalSettings(relevant, versionsRepo) {
  const personalSettings = config.personal_settings ? _.clone(config.personal_settings) : {};
  let environmentValue = undefined;

  const context = { anyOutput: false };
  _.each(util.asArray(relevant || []), function (setting) {
    switch (setting) {
      case 'ad_username':
        personalSettings.ad_username = _ensureADUsername(context, personalSettings.ad_username);
        break;
      case 'github_token':
        personalSettings.github_token = _ensureGithubToken(context, personalSettings.github_token);
        break;
      case 'github_username':
        personalSettings.github_username = _ensureGithubUsername(context, personalSettings.github_username);
        break;
      case 'jenkins_api_token':
        personalSettings.jenkins_api_token = _ensureJenkinsApiToken(context, personalSettings.jenkins_api_token);
        break;
      case 'rflow_workdir':
        personalSettings.rflow_workdir = _firstOne(personalSettings.rflow_workdir);
        break;
      case 'azure_devops_token':
      case 'azdo_git_username':
      case 'azdo_git_password':
        personalSettings[setting] = _ensureAzureDevOpsSetting(context, setting, personalSettings[setting]);
        break;
      case 'azure_identity_id':
        personalSettings.azure_identity_id =
          _ensureAzureIdentityId(context, personalSettings.azure_identity_id, personalSettings.ad_username,
            personalSettings.azure_devops_token, versionsRepo);
        break;
      // case 'stash_username':
      //   personalSettings.stash_username =
      //     _ensureStashUsername(context, personalSettings.stash_username, personalSettings.ad_username);
      //   break;
      case 'reviewers':
        personalSettings.reviewers = _firstOne(personalSettings.reviewers, personalSettings.stash_reviewers);
        delete personalSettings.stash_reviewers;
        break;
    }
  });

  _removeIfPresent(context, personalSettings, 'jenkins_user_id', 'slack_member_id', 'teams_member_id');

  if (!_.isEqual(personalSettings, config.personal_settings)) {
    util.narrateln('Updated personal settings');
    util.narrateln(JSON.stringify(personalSettings, null, 2));

    if(versionsRepo) {
    const users = new Users(versionsRepo);
      users.addUser({
        adUsername: personalSettings.ad_username,
        stashUsername: personalSettings.stash_username,
        azureIdentityId: personalSettings.azure_identity_id
    });
    }

    config.personal_settings = personalSettings;
    let userConfigPath = Path.join(config.dotDir, 'config.json');
    let localConfig = util.fileExists(userConfigPath) ? util.readJSON(userConfigPath) : {};
    localConfig.personal_settings = personalSettings;
    util.writeJSON(userConfigPath, localConfig);

    if (personalSettings.azdo_git_username) {
      _announce(context);
      util.startBullet('Git Credentials'.italic.trivial);
      let gitCredentials = util.renderTemplate('git-credentials');
      util.writeFile(config.gitCredentialsPath, gitCredentials);
      util.endBullet(`Saved to ${config.gitCredentialsPath}`.trivial);
      util.exec('git', ['config', '--global', 'credential.helper', `store --file ${config.gitCredentialsPath}`]);
    }
  }

  if (context.anyOutput) {
    util.announce('Initializing (continued)'.plain);
  }
}

function mvnVersionLessThanThreeFive () {
  let proc = util.exec('mvn', ['--version']);
  let versionRegex = /Apache Maven ([\d\.]+)/;
  let matchResult = versionRegex.exec(proc.stdout);
  let versionEx = new VersionEx(matchResult[1]);
  return versionEx.isLessThan(VERSION_3_5_0);
}

function typeYesToContinue() {
  let carryOn = util.prompt('Type "yes" if you wish to proceed: '.plain);
  if (carryOn === null || !carryOn || carryOn.toLowerCase() !== 'yes') {
    throw new CancelledError();
  }
}

/**
 * @param {PersonalSettingsContext} context
 * @private
 */
function _announce(context) {
  if (context.anyOutput) return;
  util.announce('Updating personal settings'.plain);
  context.anyOutput = true;
}

/**
 * @param {PersonalSettingsContext} context
 * @param {string} sources
 * @return {string}
 * @private
 */
function _ensureADUsername(context, ...sources) {
  let value = _firstOne(...sources);
  if (!value) {
    _announce(context);
    util.startBullet('ad_username'.trivial.italic);
    util.endBullet('Missing'.bad);
    let username = util.prompt('Enter AD username: '.plain);
    if (username === null || !username) {
      throw new ConfigError('AD username is required');
    }
    value = username.toLowerCase();
  }
  if (value !== value.toLowerCase()) {
    _announce(context);
    util.startBullet('ad_username'.trivial.italic);
    util.endBullet(sprintf('Adjusted from %s to %s'.trivial, value.italic, value.toLowerCase().italic));
    value = value.toLowerCase();
  }
  return value;
}

/**
 * @param {PersonalSettingsContext} context
 * @param {string} key
 * @param {string} value
 * @return {string}
 * @private
 */
function _ensureAzureDevOpsSetting(context, key, value) {
  const settingsText = {
    azure_devops_token: {
      name: 'Azure DevOps Token',
      hint: sprintf('Create your token with %s here: %s', 'full access'.bold, 'https://dev.azure.com/agilysys/_usersSettings/tokens'.useful)
    },
    azdo_git_username: {
      name: 'Azure Repos Git Username',
      hint: 'Go to Azure Repos > Clone > Generate Git Credentials'
    },
    azdo_git_password: {
      name: 'Azure Repos Git Password',
      hint: 'Go to Azure Repos > Clone > Generate Git Credentials'
    }
  };

  if (value) return value;
  _announce(context);
  util.startBullet(key.trivial.italic);
  util.endBullet('Missing'.bad);

  const settingText = settingsText[key];
  util.println(settingText.hint.italic);
  let input = util.prompt(sprintf('Enter %s: '.plain, settingText.name));
  if (!input) {
    throw new ConfigError(sprintf('%s is required', settingText.name));
  }
  return input;
}

/**
 * @param {PersonalSettingsContext} context
 * @param {string} identityId
 * @param {string} adUsername
 * @param {string} token
 * @param {GitRepository} versionsRepo
 * @private
 */
function _ensureAzureIdentityId(context, identityId, adUsername, token, versionsRepo) {
  if (identityId) return identityId;

  _announce(context);
  util.startBullet('azure_identity_id'.trivial.italic);
  let emailAddress = versionsRepo.getEmailAddress();
  if (!emailAddress) {
    throw new ConfigError('Git global configuration is missing \'user.email\'');
  }
  util.continueBullet(emailAddress.trivial);
  identityId = azureDevOps.getIdentityId(token, emailAddress);
  util.endBullet(sprintf('Updated to %s'.trivial, identityId.italic));
  return identityId;
}

function _ensureJenkinsApiToken(context, ...sources) {
  let value = _firstOne(...sources);
  if (value) return value;

  _announce(context);
  util.startBullet('jenkins_api_token'.trivial.italic);
  util.endBullet('Missing'.bad);
  value = util.prompt('Enter Jenkins API key: '.plain);
  if (!value) {
    throw new ConfigError('Jenkins API key is required');
  }
  return value;
}

/**
 * @param {PersonalSettingsContext} context
 * @param {string} github_token
 * @private
 */
function _ensureGithubToken(context, ...sources) {
  let value = _firstOne(...sources);
  if (value) return value;

  _announce(context);
  util.startBullet('github_token'.trivial.italic);
  util.endBullet('Missing'.bad);
  value = util.prompt('Enter Github Token: '.plain);
  if (!value) {
    throw new ConfigError('Github Token is required');
  }
  return value;
}

/**
 * @param {PersonalSettingsContext} context
 * @param {string} github_username
 * @private
 */
function _ensureGithubUsername(context, ...sources) {
  let value = _firstOne(...sources);
  if (value) return value;

  _announce(context);
  util.startBullet('github_username'.trivial.italic);
  util.endBullet('Missing'.bad);
  value = util.prompt('Enter Github Username: '.plain);
  if (!value) {
    throw new ConfigError('Github Username is required');
  }
  return value;
}

/**
 * @param {PersonalSettingsContext} context
 * @param {string} stashUsername
 * @param {string} adUsername
 * @return {string}
 * @private
 */
function _ensureStashUsername(context, stashUsername, adUsername) {
  if (stashUsername) return stashUsername;

  _announce(context);
  const credentials = stash.obtainCredentials(adUsername);
  util.startBullet('stash_username'.trivial.italic);
  stashUsername = stash.getUsername(adUsername, credentials.password);
  util.endBullet(sprintf('Updated to %s'.trivial, stashUsername.italic));
  return stashUsername;
}

/**
 * @param {string} sources
 * @return {string|undefined}
 * @private
 */
function _firstOne(...sources) {
  return _.chain(sources).filter(source => source).first().value();
}

/**
 * @param {PersonalSettingsContext} context
 * @param {{}} personalSettings
 * @param {string} keys
 * @private
 */
function _removeIfPresent(context, personalSettings, ...keys) {
  keys.forEach(key => {
    if (personalSettings[key]) {
      _announce(context);
      util.startBullet(key.trivial.italic);
      delete personalSettings[key];
      util.endBullet('Removed'.trivial);
    }
  });
}

module.exports = {
  lockPidFile: lockPidFile,
  unlockPidFile: unlockPidFile,
  checkGitVersion: checkGitVersion,
  checkNotInDotDir: checkNotInDotDir,
  ensurePersonalSettings: ensurePersonalSettings,
  mvnVersionLessThanThreeFive: mvnVersionLessThanThreeFive,
  typeYesToContinue: typeYesToContinue
};
