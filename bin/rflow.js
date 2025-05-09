#!/usr/bin/env rbuild-node-env
require('colors');

const _ = require('underscore');
const cliCursor = require('cli-cursor');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const fs = require('fs');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const binUtil = require('../lib/common/bin-util');
const BuildError = require('../lib/classes/BuildError');
const CancelledError = require('../lib/classes/CancelledError');
const ChangesetBundle = require('../lib/classes/ChangesetBundle');
const config = require('../lib/common/config');
const ConfigError = require('../lib/classes/ConfigError');
const constants = require('../lib/common/constants');
const Errors = require('../lib/classes/Errors');
const events = require('../lib/classes/Events');
const ExecError = require('../lib/classes/ExecError');
const GitRepository = require('../lib/classes/GitRepository');
const JSONFile = require('../lib/classes/JSONFile');
const LockError = require('../lib/classes/LockError');
const LogFile = require('../lib/classes/LogFile');
const Package = require('../package.json');
const ShipmentBundle = require('../lib/classes/ShipmentBundle');
const teams = require('../lib/common/teams').teamsService;
const util = require('../lib/common/util');
const {VersionEx} = require('../lib/classes/VersionEx');

const SHIPMENT_ID_REGEX = /^([a-z]+):([\w\-_]{6,})$/;
const ALIAS_ID_REGEX = /^([a-z]+):([\w\-_]{3,})$/;

let stdin = process.stdin;
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');
stdin.on('data', key => {
  if (key === '\u0003') {
    util.narrateln('Ctrl-C in rFlow');
    process.emit('SIGINT');
  }
});
cliCursor.hide();

if (process.platform === "win32") {
  let reader = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  reader.on('SIGINT', function () {
    process.emit('SIGINT');
  });
}

process.on('SIGINT', () => {
  util.narrateln('SIGINT event in rFlow');
  if (bundle && bundle.isLockedByUs()) {
    bundle.unlock();
  }
  cliCursor.show();
  stdin.setRawMode(false);
  stdin.resume();

  events.emit('SIGINT');
  console.log('[Interrupted by Ctrl-C]'.bad);
  process.exit(130);
});

// Global logger
config.logger = new LogFile(config.logFile);

// Don't use an alias of 'd' because rbuild.sh slurps a first-arg of '-d' to invoke the debugger
// Reserve 'v' for version
let optionList = [{
  name: 'goal',
  alias: 'g',
  type: String,
  group: ['global'],
  description: 'Goal to execute ({bold DEFAULT})',
  defaultOption: true
}, {
  name: 'changeset-id',
  alias: 'c',
  type: String,
  group: ['goal'],
  description: 'Changeset ID, for example `ui:VCTRS-12345`'
}, {
  name: 'from-changeset-id',
  alias: 'f',
  type: String,
  group: ['goal'],
  description: 'From changeset ID, for example `ui:VCTRS-12346`'
}, {
  name: 'shipment-id',
  alias: 's',
  type: String,
  group: ['goal'],
  description: 'Shipment ID, for example `uat:20170508`'
}, {
  name: 'alias-id',
  alias: 'a',
  type: String,
  group: ['goal'],
  description: 'Alias ID, for example `svc:released`'
}, {
  name: 'to-alias-id',
  alias: 'b',
  type: String,
  group: ['goal'],
  description: 'From changeset ID, for example `ui:VCTRS-12346`'
}, {
  name: 'include',
  alias: 'i',
  type: String,
  group: ['goal'],
  description: 'Consider only these projects',
  multiple: true
}, {
  name: 'reviewers',
  alias: 'r',
  type: String,
  group: ['goal'],
  description: 'Stash names (e.g. SpragueC) of reviewers',
  multiple: true
}, {
  name: 'message',
  alias: 'm',
  type: String,
  group: ['goal'],
  description: 'Commit message ({bold push} only)'
}, {
  name: 'hotfix',
  type: Boolean,
  group: ['goal'],
  description: 'Indicates a hotfix scope'
}, {
  name: 'from-prod',
  type: Boolean,
  group: ['goal'],
  description: 'Use {bold production} instead of {bold released} as a base-line (deprecated, same as {bold production})'
}, {
  name: 'use-cwd',
  type: Boolean,
  group: ['goal'],
  description: 'Use current working directory and ignore {italic rflow_workdir} setting'
}, {
  name: 'local',
  type: Boolean,
  group: ['goal'],
  description: 'Perform build locally using Maven'
}, {
  name: 'force-new',
  type: Boolean,
  group: ['goal'],
  description: 'Force creation of new PRs'
}, {
  name: 'formal',
  type: Boolean,
  group: ['goal'],
  description: 'Indicates a formal merge for bookkeeping purposes'
}, {
  name: 'commits',
  type: Boolean,
  group: ['goal'],
  description: 'Only show commits'
}, {
  name: 'unapproved',
  type: Boolean,
  group: ['goal'],
  description: 'Only show unapproved commits'
}, {
  name: 'files',
  type: Boolean,
  group: ['goal'],
  description: 'Only show merged files'
}, {
  name: 'resume',
  type: Boolean,
  group: ['goal'],
  description: 'Resume prior operation'
}, {
  name: 'no-build',
  type: Boolean,
  group: ['goal'],
  description: 'Skip initiating a Jenkins build'
}, {
  name: 'build',
  type: Boolean,
  group: ['goal'],
  description: 'Trigger a Jenkins build'
}, {
  name: 'jacoco',
  type: Boolean,
  group: ['goal'],
  description: 'Generate jacoco code coverage report in Jenkins build'
}, {
  name: 'dry-run',
  type: Boolean,
  group: ['goal'],
  description: 'Do not push changes to Git'
}, {
  name: 'document',
  type: Boolean,
  group: ['goal'],
  description: 'Produce documentation output'
}, {
  name: 'simple',
  type: Boolean,
  group: ['goal'],
  description: 'Produce simple, pared-down output'
}, {
  name: 'help',
  type: Boolean,
  group: ['global']
}, {
  name: 'trunk',
  alias: 't',
  type: String,
  group: ['goal'],
  description: 'The trunk relevant to this operation'
}, {
  name: 'production',
  type: Boolean,
  group: ['goal'],
  description: 'Use {bold production} instead of {bold released} as a base-line (formerly {bold from-prod})'
}, {
  name: 'released',
  type: Boolean,
  group: ['goal'],
  description: 'Use {bold released} as a base-line (for trunks)'
}, {
  name: 'force',
  type: Boolean,
  group: ['goal'],
  description: 'Force the operation to continue where it would otherwise normally bail out'
}, {
  name: 'max-fork-count',
  alias: 'x',
  type: Number,
  group: ['goal'],
  description: 'Limit the concurrency of forked operations'
},
{
  name: 'skip-test',
  type: Boolean,
  group: ['goal'],
  description: 'Skip test in a Jenkins build'
},
{
  name: 'shipment-changeset',
  type: Boolean,
  group: ['goal'],
  description: 'Identifying changesets that are not in production'
},
{
  name: 'sb3build',
  type: Boolean,
  group: ['goal'],
  description: 'testing for maven version upgrade'
},
{
  name: 'perf-impr',
  alias: 'p',
  type: Boolean,
  group: ['goal'],
  description: 'Run performance improved pipelines'
}
];

let requiredSettingsList = [
  {name: 'github_token', description: 'Github token'},
  {name: 'github_username', description: 'Github Username'},
  {name: 'ad_username', description: 'Username for AD'},
  {name: 'azure_devops_token', description: 'Azure personal access token with full access scope'},
  {name: 'azure_identity_id', description: 'Azure identity GUID'},
  {name: 'stash_username', description: 'Username for Stash'},
  {name: 'jenkins_api_token', description: 'Jenkins API token'}
];

let optionalSettingsList = [
  {name: 'rflow_workdir', description: 'Workdir to use instead of CWD when performing local operations'},
  {name: 'reviewers', description: 'Comma-delimited list of AD usernames (e.g. spraguec) of reviewers'},
];

let commandList = [];
let goalModules = {};

function loadModules (path) {
  let stat = fs.lstatSync(path);
  if (stat.isDirectory()) {
    let files = fs.readdirSync(path);
    let f, l = files.length;
    for (let i = 0; i < l; i++) {
      f = Path.join(path, files[i]);
      loadModules(f);
    }
  } else {
    moduleExports = require (path);
    for (name in moduleExports) {
      let goal = moduleExports[name];
      if (goal.disabled) {
        continue;
      }
      if (goalModules[name]) {
        throw new BuildError(`Goal ${name} would be redefined by: ${path}`);
      }
      goalModules[name] = goal;
      commandList.push({ name: sprintf('{bold %s}', name), summary: goal.summary });
    }
  }
}

/**
 * @param arg
 * @returns {ChangesetId}
 */
function parseChangesetId (arg) {
  let match = arg.match(constants.CHANGESET_ID_SHORTCUT_REGEX);
  if (match) {
    return {
      bundleName: match[1],
      qualifierId: match[2],
      ticketId: match[3]
    };
  }
  match = arg.match(constants.CHANGESET_ID_REGEX);
  if (!match) {
    throw new BuildError(sprintf('Your changeset-id %s does not conform to %s', arg, constants.CHANGESET_ID_REGEX));
  }

  return {
    bundleName: match[1],
    trackingId: match[2],
    qualifier: match[3],
    qualifierId: match[4],
    ticketId: match[5]
   };
}

/**
 * @param arg
 * @returns {ShipmentId}
 */
function parseShipmentId (arg) {
  let match = arg.match(SHIPMENT_ID_REGEX);
  if (!match) {
    throw new BuildError(sprintf('Your shipment-id %s does not conform to %s', arg, SHIPMENT_ID_REGEX));
  }
  return {
    bundleName: match[1],
    version: match[2]
  };
}

/**
 * @param arg
 * @returns {AliasId}
 */
function parseAliasId (arg) {
  let match = arg.match(ALIAS_ID_REGEX);
  if (!match) {
    throw new BuildError(sprintf('Your alias-id %s does not conform to %s', arg, ALIAS_ID_REGEX));
  }
  return {
    bundleName: match[1],
    alias: match[2]
  }
}

function buildCommandHelp(goalName) {
  let options = _.filter(optionList, function (option) {
    return option.name !== 'goal';
  });
  let commandHelp = [{
      content: sprintf('%s\nVersion: %s\nNode: %s', config.rName, Package.version, process.version),
      raw: true
    }];
  if (goalName) {
    commandHelp.push({
        header: 'Synopsis',
        content: [
          '$ rflow {bold ' + goalName + '} {underline options}',
          '$ rflow {bold ' + goalName + '} {bold --help}'
        ]
      },
      {
        header: 'Options',
        optionList: options
      });
    if (requiredSettingsList.length) {
      let content = [];
      _.each(requiredSettingsList, function (setting) {
          content.push({ name: sprintf('{bold %s}', setting.name), summary: setting.description });
      });
      commandHelp.push(
        {
          header: 'Required Settings',
          content: content
        });
    }
    if (optionalSettingsList.length) {
      let content = [];
      _.each(optionalSettingsList, function (setting) {
        content.push({ name: sprintf('{bold %s}', setting.name), summary: setting.description });
      });
      commandHelp.push(
        {
          header: 'Optional Settings',
          content: content
        });
    }
  } else {
    commandHelp.push({
        header: 'Synopsis',
        content: [
          '$ rflow {underline goal} {underline options}',
          '$ rflow {underline goal} {bold --help}',
          '$ rflow {bold --help}'
        ]
      },
      {
        header: 'Goals',
        content: _.sortBy(commandList, 'mode')
      });
  }
  return commandHelp;
}

function sendNotificationMessage(bundle, goal, params) {
  params = _.extend({
    onStart: false,
    errorMessage: undefined,
    updates: undefined,
    silent: false
  }, params);
  if (!!goal.notificationSettings.skip || (params.onStart && !goal.notificationSettings.onStart)) return;
  let messageType = constants.TEAMS_1_OF_1_MESSAGE;
  if (params.onStart) {
    messageType = constants.TEAMS_1_OF_2_MESSAGE;
  } else if (goal.notificationSettings.onStart) {
    messageType = constants.TEAMS_2_OF_2_MESSAGE;
  }
  if (bundle instanceof ChangesetBundle) {
    teams.notifyOnChangeset(bundle, {
      type: messageType,
      changesetId: config.changesetId,
      options: util.extractOptions(optionList, process.argv, ['changeset-id']),
      errorMessage: params.errorMessage,
      updates: params.updates,
      silent: params.silent
    });
  } else if (bundle instanceof ShipmentBundle) {
    teams.notifyOnShipment(bundle, {
      type: messageType,
      shipmentId: config.shipmentId,
      options: util.extractOptions(optionList, process.argv, ['shipment-id']),
      errorMessage: params.errorMessage,
      silent: params.silent
    });
  }
}

function reportErrorNotification(bundle, goal, message) {
  if (typeof bundle !== 'undefined') {
    sendNotificationMessage(bundle, goal, {
      errorMessage: message,
      silent: true
    });
  }
}

function applyShortcutIfRelevant(param, changesetId) {
  if (param && !changesetId.qualifier) {
    if (!config.qualifiers.default) {
      util.println('No default qualifier is configured for the bundle.');
      process.exit(2);
    }
    changesetId.qualifier = config.qualifiers.default;
    // not great because assumes '-' between qualifier and qualifierId
    changesetId.trackingId = sprintf('%s-%s', changesetId.qualifier, changesetId.qualifierId);
  }
}

loadModules(Path.join(__dirname, '..', 'lib', 'goals', 'rflow', 'changeset'));
loadModules(Path.join(__dirname, '..', 'lib', 'goals', 'rflow', 'shipment'));

let versionsRepo;
let bundleConfigPath;
let goalName;
let goal;

try {
  // User config override
  let userConfigPath = Path.join(config.dotDir, 'config.json');
  if (util.fileExists(userConfigPath)) {
    util.narratef('Loading user configuration: %s\n', userConfigPath);
    config.$extend(util.readJSON(userConfigPath));
  }
  util.applyTheme();

  // Extend global config with command-line arguments
  config.$extend(commandLineArgs(optionList, {partial:true}));

  // Verbose means verbosity=1
  config.consoleVerbosityLevel = config._all.verbose
    ? constants.VERBOSITY_VERBOSE
    : constants.VERBOSITY_NORMAL;

  goalName = config._all.goal;
  if (config._all.help && !goalName) {
    util.println(commandLineUsage(buildCommandHelp()).plain);
    process.exit(1);
  }

  // Every run requires a goal
  if (!goalName) {
    throw new BuildError('You must specify a goal (or --help)');
  }

  goal = goalModules[goalName];

  // Bail if we wont be able to execute the requested goal
  if (!goal) {
    let incorrectGoalName = goalName;
    goalName = undefined; // So help doesn't try to show goal-specific help
    throw new BuildError(sprintf('No goal available: %s\n', incorrectGoalName));
  }

  // apply defaults
  goal.notificationSettings = _.extend({
    skip: false,
    onStart: false
  }, goal.notificationSettings);
  goal.requiredSettings.push('ad_username', 'azure_devops_token', 'stash_username', 'github_username', 'github_token');

  optionList = _.filter(optionList, function (option) {
    return option.group.indexOf('global') > -1
      || goal.requiredArguments.indexOf(option.name) > -1
      || goal.optionalArguments.indexOf(option.name) > -1;
  });

  requiredSettingsList = _.filter(requiredSettingsList, function (variable) {
    return goal.requiredSettings.indexOf(variable.name) > -1;
  });

  optionalSettingsList = _.filter(optionalSettingsList, function (variable) {
    return goal.optionalSettings.indexOf(variable.name) > -1;
  });

  if (config._all.help) {
    util.println(commandLineUsage(buildCommandHelp(goalName)).plain);
    process.exit(1);
  }

  // now we can re-extend config with updated groups
  config.$extend(commandLineArgs(optionList, { partial: true }));

  // Bail if user is using an argument not allowed for goal
  if (config._unknown) {
    throw new BuildError(sprintf('Argument(s) not supported for %s goal: %s', goalName.underline, config._unknown.join(', ')));
  }

  // Required ARGV
  _.each(goal.requiredArguments, (parameter) => {
    if (!util.isPresent(config._all[parameter]) || !config._all[parameter].length) {
      throw new BuildError(sprintf("Missing parameter: %s", parameter));
    }
  });

  binUtil.checkNotInDotDir();
  binUtil.checkGitVersion();

  // first check to ensure pom merge driver is installed
  let mergeDriver = util.exec('git', ['config', '--global', '--get', 'merge.rbuildmergepom.driver'], config.homeDir, { okToFail: true }).stdout.toString().trim();
  if (!mergeDriver) {
    throw new BuildError('POM merge driver is not installed; please run git-merge-pom-setup');
  }

  binUtil.lockPidFile();

  // We need the repository which hosts our config files
  util.announce('Initializing'.plain);
  binUtil.ensurePersonalSettings(goal.requiredSettings.concat(goal.optionalSettings));
  goal.requiredSettings.push('azure_identity_id');
  versionsRepo = GitRepository.create(config.versions_files);
  util.startBullet(versionsRepo.dirname.plain);
  versionsRepo.resetRepository();
  util.endBullet(util.repoStatusText(versionsRepo.branchName, config.workDir, versionsRepo.clonePath));

  if (config._all['changeset-id']) {
    config.changesetId = parseChangesetId(config._all['changeset-id']);
    config.bundleName = config.changesetId.bundleName;
  }

  if (config._all['from-changeset-id']) {
    config.fromChangesetId = parseChangesetId(config._all['from-changeset-id']);
  }

  if (config._all['shipment-id']) {
    config.shipmentId = parseShipmentId(config._all['shipment-id']);
    config.bundleName = config.shipmentId.bundleName;
  }

  if (config._all['alias-id']) {
    config.aliasId = parseAliasId(config._all['alias-id']);
    config.bundleName = config.aliasId.bundleName;
  }

  if (config._all['to-alias-id']) {
    config.toAliasId = parseAliasId(config._all['to-alias-id']);
  }

  // backward compatibility
  if (config._all['from-prod']) {
    delete config._all['from-prod'];
    config._all['production'] = true;
  }

  if (config._all['max-fork-count']) {
    config.maxForkCount = config._all['max-fork-count'];
  }

  config._all.commit = !config._all['dry-run'];

  bundleConfigPath = Path.join(versionsRepo.getRepoDir(),
    sprintf(config.versions_files.bundle_config_spec, config.bundleName));

  // Bail if build file not found
  if (!fs.existsSync(bundleConfigPath)) {
    throw new BuildError(sprintf('No bundle config found. Ensure your bundle name is accurate: %s\n', config.bundleName || ''));
  }
} catch (ex) {
  if (ex instanceof LockError) {
    util.println(ex.toString().bad);
    process.exit(1);
  }
  binUtil.unlockPidFile();
  if (ex instanceof BuildError) {
    let message = ex.toString() || 'Unknown build error!';
    util.println(commandLineUsage(buildCommandHelp(goalName)).plain);
    util.println(message.bad);
    util.println();
    process.exit(1);
  } else if (ex instanceof ConfigError) {
      let message = ex.toString() || 'Unknown config error!';
      util.println(message.bad);
      util.println();
      process.exit(1);
  } else {
    throw ex;
  }
}

let bundle = undefined;
try {
  let bundleFile = new JSONFile(bundleConfigPath);
  config.$extend(bundleFile.data.config);
  config.$extend({bundleConfigPath});
  let pkgVersion = new VersionEx(Package.version);
  let minVersion = bundleFile.getValue('min_rflow_version')
    ? new VersionEx(bundleFile.getValue('min_rflow_version'))
    : false;
  let maxVersion = bundleFile.getValue('max_rflow_version')
    ? new VersionEx(bundleFile.getValue('max_rflow_version'))
    : false;
  util.narratef('Bundle config:   %s\n', bundleConfigPath);
  util.narratef('Min/Pkg/Max version: %s/%s/%s\n', minVersion, pkgVersion, maxVersion);

  if (minVersion && pkgVersion.compareTo(minVersion) < 0) {
    util.printf('Your version of this tool (%s) does not meet that required by the Bundle (%s).\n'.bad, pkgVersion, minVersion);
    util.printf('Please upgrade:\n\n\tnpm r -g %s && npm i -g %s\n\n'.bad, Package.name, Package.name);
    process.exit(2);
  }

  if (maxVersion && pkgVersion.compareTo(maxVersion) > 0) {
    util.printf('The Bundle cannot be used past version %s of this tool (which is %s).\n'.bad, maxVersion, pkgVersion);
    process.exit(2);
  }

  binUtil.ensurePersonalSettings(goal.requiredSettings.concat(goal.optionalSettings), versionsRepo);

  applyShortcutIfRelevant(config._all['changeset-id'], config.changesetId);
  applyShortcutIfRelevant(config._all['from-changeset-id'], config.fromChangesetId);

  if (config._all['changeset-id']) {
    bundle = new ChangesetBundle(bundleFile, versionsRepo);
  } else if (config._all['alias-id']) {
    bundle = new ChangesetBundle(bundleFile, versionsRepo);
  } else if (config._all['shipment-id']) {
    bundle = new ShipmentBundle(bundleFile, versionsRepo);
  }
  bundle.currentGoal = goalName;

  bundle.lock();

  sendNotificationMessage(bundle, goal, {
    onStart: true,
    silent: true
  });
  let updates = goal.callback.call(this, bundle, goal);
  sendNotificationMessage(bundle, goal, {
    updates: updates,
    silent: true
  });
  bundle.unlock();

  process.exit(0);
} catch (ex) {
  if (!(ex instanceof Errors.LockedError) && bundle) {
    bundle.unlock();
  }
  binUtil.unlockPidFile();
  util.println();
  if (ex instanceof ExecError) {
    util.announce('Fatal error'.bad);
    let message = ex.toString() || 'Unknown exec error!';
    if (ex.stderr && ex.stderr.length > 0) {
      message += '\n' + ex.stderr;
    }
    util.println(message.bad);
    reportErrorNotification(bundle, goal, message);
    process.exit(1);
  } else if (ex instanceof BuildError) {
    util.announce('Fatal error'.bad);
    let message = ex.toString() || 'Unknown build error!';
    util.println(message.bad);
    reportErrorNotification(bundle, goal, message);
    process.exit(1);
  } else if (ex instanceof ConfigError || ex instanceof Errors.LockedError || ex instanceof Errors.CommitGraphError) {
    util.announce('Fatal error'.bad);
    util.println(ex.toString().bad);
    process.exit(1);
  } else if (ex instanceof CancelledError) {
    util.announce('Cancelled'.bad);
    process.exit(1);
  } else {
    util.announce('Fatal error'.bad);
    util.narrateln(ex.stack);
    throw ex;
  }
}
