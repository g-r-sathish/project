#!/usr/bin/env rbuild-node-env
require('colors');

const _ = require('underscore');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const fs = require('fs');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const binUtil = require('../lib/common/bin-util');
const BuildError = require('../lib/classes/BuildError');
const config = require('../lib/common/config');
const ConfigError = require('../lib/classes/ConfigError');
const constants = require('../lib/common/constants');
const DeployBundle = require('../lib/classes/DeployBundle');
const AKSDeployBundle = require('../lib/classes/AKSDeployBundle');
const ExecError = require('../lib/classes/ExecError');
const GitRepository = require('../lib/classes/GitRepository');
const JSONFile = require('../lib/classes/JSONFile');
const LockError = require('../lib/classes/LockError');
const LogFile = require('../lib/classes/LogFile');
const Package = require('../package.json');
const teams = require('../lib/common/teams').teamsService;
const util = require('../lib/common/util');
const {VersionEx} = require('../lib/classes/VersionEx');
const CancelledError = require('../lib/classes/CancelledError');

const GENERIC_GOAL = 'generic';

// Global logger
config.logger = new LogFile(config.logFile);

// -d       Don't use an alias of 'd' because rbuild.sh slurps a first-arg of '-d' to invoke the debugger
// -v       Reserved 'v' for version
// --args   Special case for slurping, like -- described here: <https://github.com/75lb/command-line-args/wiki/Terminate-parsing-with-a-double-hypen>

let optionList = [
  { name: 'actions',            alias: 'a', type: String,   group: ['all'], description: 'Actions to execute ({bold REQUIRED})', multiple: true, defaultOption: true },
  { name: 'env',                alias: 'e', type: String,   group: ['all'], description: 'Environment name. Use <type>:<name> for alternate configuration', required: true },
  { name: 'limit',              alias: 'l', type: String,   group: ['all'], description: 'Passed to each Ansible play (list of hosts)', multiple: true },
  { name: 'list',                           type: String,   group: ['all'], description: 'List environment names' },
  { name: 'devtest',                        type: Boolean,  group: ['all'], description: 'Use the devtest deployment scheme' },
  { name: 'dry-run',                        type: Boolean,  group: ['all'], description: 'Just show the commands which would otherwise be executed' },
  { name: 'no-checkout',                    type: Boolean,  group: ['all'], description: 'Ignore the below branches (do not try to switch branches)' },
  { name: 'use-cwd',                        type: Boolean,  group: ['all'], description: 'Use the current directory as the Agilysys root directory' },
  { name: 'use-pwd',                        type: Boolean,  group: ['all'], description: 'Arcane version of --use-cwd' },
  { name: 'core-support-branch',            type: String,   group: ['all'], description: '' },
  { name: 'stay-support-branch',            type: String,   group: ['all'], description: '' },
  { name: 'force',                          type: Boolean,  group: ['all'], description: '[Azure] Deploy even when versions are up to date' },
  { name: 'no-downgrade',                   type: Boolean,  group: ['all'], description: '[Azure] Do not deploy earlier versions' },
  { name: 'only',                           type: String,   group: ['all'], description: '[Azure] Consider only these deployments', multiple: true },
  { name: 'skip',               alias: 'x', type: String,   group: ['all'], description: '[Azure] Skip these deployments', multiple: true },
  { name: 'skip-testpool',                  type: Boolean,  group: ['all'], description: '[Azure] Deploy directly to the production subset (when testpools are enabled)' },
  { name: 'skip-snapshot-transfer',         type: Boolean,  group: ['all'], description: '[Azure] Presume the Azure snapshot artifacts are up-to-date' },
  { name: 'skip-image-pipelines',           type: Boolean,  group: ['all'], description: '[Azure] Do not trigger docker-image pipelines' },
  { name: 'run-image-pipelines',            type: Boolean,  group: ['all'], description: '[Azure] Trigger docker-image pipelines' },
  { name: 'skip-deploy-pipelines',          type: Boolean,  group: ['all'], description: '[Azure] Do not trigger deployment pipelines' },
  { name: 'config-repo-branch',             type: String,   group: ['all'], description: '[Azure] Override config_repo_branch (over any changeset value)' },
  { name: 'config-repo-branch-image',       type: String,   group: ['all'], description: '[Azure] Override config_repo_branch_image (over any changeset value)' },
  { name: 'devops-pipelines-branch',        type: String,   group: ['all'], description: '[Azure] Override devops-pipelines branch (default)' },
  { name: 'docker-tag-suffix',              type: String,   group: ['all'], description: '[Azure] append this suffix to the docker image version tag' },
  { name: 'db-script-path',                 type: String,   group: ['all'], description: '[Azure] [run-db-script] Path to script (under databasescripts)' },
  { name: 'db-script-image-tag',            type: String,   group: ['all'], description: '[Azure] [run-db-script] Docker image tag of databasescripts' },
  { name: 'skip-jobs',                      type: Boolean,  group: ['all'], description: '[Azure] Skip jobs while concluding the deployment' },
  { name: 'verbose',                        type: Boolean,  group: ['all'] },
  { name: 'help',                           type: Boolean,  group: ['all'] }
];

let requiredSettingsList = [
  { name: 'azure_devops_token', description: 'Azure DevOps PAT' }
];

let actionList = [];
let goalModules = {};
let versionsRepo;
let configPath;
let goal;
let configFile;

function loadModules(path) {
  let stat = fs.lstatSync(path);
  if (stat.isDirectory()) {
    let files = fs.readdirSync(path);
    let f, l = files.length;
    for (let i = 0; i < l; i++) {
      f = Path.join(path, files[i]);
      loadModules(f);
    }
  } else {
    moduleExports = require(path);
    for (name in moduleExports) {
      let goal = moduleExports[name];
      if (goal.disabled) {
        continue;
      }
      if (goalModules[name]) {
        throw new BuildError(`Goal ${name} would be redefined by: ${path}`);
      }
      goalModules[name] = goal;
    }
  }
}

function buildCommandHelp(actionList) {
  return [
    {
      content: sprintf('%s\nVersion: %s\nNode: %s', config.rName, Package.version, process.version),
      raw: true
    },
    {
      header: 'Synopsis',
      content: [
        '$ rdeploy {underline  action}',
        '$ rdeploy {bold --list}',
        '$ rdeploy {bold --help}'
      ]
    },
    {
      header: 'Actions',
      content: _.sortBy(actionList, 'mode')
    },
    {
      header: 'Options',
      optionList: optionList,
      group: ['all']
    },
    {
      header: 'Arbitrary arguments',
      content: '  {bold --args}         Will stop argument processing, remaining arguments are then available in their raw form.'
    },
    {
      header: 'Required Settings',
      content: _.map(requiredSettingsList, function (variable) {
        return {
          name: sprintf('{bold %s}', variable.name),
          summary: variable.description
        };
      })
    }
  ];
}

function applyParams(effectiveGoals, actionParams, optionalParams) {
  optionalParams = _.extend({
    changesets: undefined,
    shipments: undefined,
    limit: []
  }, optionalParams);

  let extraArgs;
  if (config._unknown) {
    if (!actionParams.slurpArgs) {
      throw new BuildError(`Action ${actionParams.name} does not support arbitrary arguments`);
    }
    extraArgs = config._unknown.join(' ');
  }

  for (const goalName of Object.keys(actionParams.goals)) {
    let goalParams = actionParams.goals[goalName];
    let effectiveGoalParams = effectiveGoals[goalName];
    if (!effectiveGoalParams) {
      effectiveGoalParams = effectiveGoals[goalName] = goalParams; // should clone
    } else {
      effectiveGoalParams.tags = _.union(util.asArray(effectiveGoalParams.tags), util.asArray(goalParams.tags));
      effectiveGoalParams.vars = _.extend(effectiveGoalParams.vars || {}, goalParams.vars);
    }
    effectiveGoalParams.limit = _.union(effectiveGoalParams.limit || [], util.asArray(optionalParams.limit) || []);
    if (optionalParams.changesets) {
      effectiveGoalParams.changesets = _.extend(effectiveGoalParams.changesets || {}, optionalParams.changesets);
    }
    if (optionalParams.shipments) {
      effectiveGoalParams.shipments = _.extend(effectiveGoalParams.shipments || {}, optionalParams.shipments);
    }
    if (extraArgs) {
      if (effectiveGoalParams['args'] === undefined) {
        effectiveGoalParams['args'] = extraArgs;
      } else {
        effectiveGoalParams['args'] += ` ${extraArgs}`;
      }
    }
  }
}

function sendNotificationMessage(bundle, completed, success) {
  teams.notifyOnDeploy({
    completed: completed,
    success: success,
    environment: bundle.environment,
    actions: config._all['actions'],
    options: util.extractOptions(optionList, process.argv),
    commands: _.map(bundle.ansibleCommands, function (command) { return command.getSummaryText() })
  });
}

loadModules(Path.join(__dirname, '..', 'lib', 'goals', 'rdeploy'));

try {

  // System config override
  let systemConfigPath = Path.join(config.systemConfigDir, 'config.json');
  if (util.fileExists(systemConfigPath)) {
    util.narratef('Loading system configuration: %s\n', systemConfigPath);
    config.$extend(util.readJSON(systemConfigPath));
  }

  // User config override
  let userConfigPath = Path.join(config.dotDir, 'config.json');
  if (util.fileExists(userConfigPath)) {
    util.narratef('Loading user configuration: %s\n', userConfigPath);
    config.$extend(util.readJSON(userConfigPath));
  }
  util.applyTheme();

  // Extend global config with command-line arguments
  config.$extend(commandLineArgs(optionList, {stopAtFirstUnknown: true}));

  // Verbose means verbosity=1
  config.consoleVerbosityLevel = config._all.verbose
    ? constants.VERBOSITY_VERBOSE
    : constants.VERBOSITY_NORMAL;

  // No checkout means use what's on my disk
  if (!config._all['use-cwd'] && !config._all['use-pwd'] && config._all['no-checkout']) {
    throw new BuildError('The --no-checkout option is only valid with the --use-cwd/--use-pwd option');
  }
  if (config._all['use-pwd']) config._all['use-cwd'] = true;
  config._all.commit = !config._all['dry-run'];
  config.workDir = config._all['use-cwd'] ? process.cwd() : config.workDir;

  binUtil.checkNotInDotDir();
  binUtil.checkGitVersion({ allowDevOpsVersion: true });

  binUtil.lockPidFile();

  // We need the repository which hosts our config file
  util.announce('Initializing'.plain);
  versionsRepo = GitRepository.create(config.versions_files);
  util.startBullet(versionsRepo.dirname.plain);
  if (!config._all['no-checkout'] && !config.debug.no_checkout_versions_repo) {
    versionsRepo.resetRepository();
  } else {
    versionsRepo.readBranchName()
  }
  util.endBullet(util.repoStatusText(versionsRepo.branchName, config.workDir, versionsRepo.clonePath));

  // Deployment configuration path.
  //  versions-files/rdeploy/config.json              Default
  //  versions-files/rdeploy/config-devtest.json      -e devtest:<name> OR --devtest
  //  versions-files/rdeploy/config-<type>.json       -e <type>:<name>

  // Upgrade `--devtest` to newer `-e <type>:<name>` logic
  if (config._all.devtest) {
    config._all['env'] = 'devtest:' + config._all['env'];
  }

  if (config._all.env) {
    let envParamInfo = config._all.env.split(':');
    if (envParamInfo[1]) {
      config._all.env = envParamInfo[1];
      let configType = config._all['config-type'] = envParamInfo[0];
      let relativeConfigPath = sprintf(config.versions_files['rdeploy_config_altspec'], configType)
      configPath = Path.join(versionsRepo.getRepoDir(), relativeConfigPath);
    } else {
      configPath = Path.join(versionsRepo.getRepoDir(), config.versions_files['rdeploy_config_path']);
    }
  }

  if (fs.existsSync(configPath)) {
    configFile = new JSONFile(configPath);

    _.each(configFile.data.actions, function (action) {
      if (action.bundleType) {
        actionList.push({
          name: sprintf('{bold %s:}{underline version}', action.name),
          summary: sprintf('{white . . . . . . }%s', action.description)
        });
      } else {
        actionList.push({
          name: sprintf('{bold %s}', action.name),
          summary: action.description
        });
      }
    });
  } else {
    if (!config._all.help) {
      // Bail if config file not found
      throw new BuildError(sprintf('Missing config file: %s', configPath));
    }
  }

  if (config._all.help) {
    util.println(commandLineUsage(buildCommandHelp(actionList)));
    process.exit(1);
  }

  if (config._all.list) {
    throw new BuildError('The --list option is not yet implemented');
  }

  // Every run requires an action
  if (!config._all.actions) {
    throw new BuildError('You must specify an action (or --list or --help)');
  }

  // Bail if there are unknown arguments
  if (config._unknown) {
    if (config._unknown[0] === '--args') {
      config._unknown.shift();
    } else {
      throw new BuildError(sprintf('Unknown argument(s): %s\n', config._unknown));
    }
  }

} catch (ex) {
  if (ex instanceof LockError) {
    util.println(ex.toString().bad);
    process.exit(1);
  }
  binUtil.unlockPidFile();
  if (ex instanceof BuildError) {
    let message = ex.toString() || 'Unknown build error!';
    util.println(commandLineUsage(buildCommandHelp(actionList)).plain);
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

async function goalHandler () {
  let pkgVersion = new VersionEx(Package.version);
  let minVersion = configFile.getValue('min_rflow_version')
    ? new VersionEx(configFile.getValue('min_rflow_version'))
    : false;
  let maxVersion = configFile.getValue('max_rflow_version')
    ? new VersionEx(configFile.getValue('max_rflow_version'))
    : false;
  util.narratef('Config:   %s\n', configPath);
  util.narratef('Min/Pkg/Max version: %s/%s/%s\n', minVersion, pkgVersion, maxVersion);

  if (minVersion && pkgVersion.compareTo(minVersion) < 0) {
    util.printf('Your version of this tool (%s) does not meet that required by the config (%s).\n'.bad, pkgVersion, minVersion);
    util.printf('Please upgrade:\n\n\tnpm r -g %s && npm i -g %s\n\nOr if your account lacks privileges:\n\n\t' +
      'sudo npm r -g %s && sudo npm i -g %s\n\n'.bad, Package.name, Package.name, Package.name, Package.name);
    process.exit(2);
  }

  if (maxVersion && pkgVersion.compareTo(maxVersion) > 0) {
    util.printf('The Bundle cannot be used past version %s of this tool (which is %s).\n'.bad, maxVersion, pkgVersion);
    process.exit(2);
  }

  bundle = AKSDeployBundle.useAKSDeployBundle(config._all['config-type'])
    ? new AKSDeployBundle(configFile, versionsRepo, config._all.env)
    : new DeployBundle(configFile, versionsRepo, config._all.env);

  let goalParams = {};

  // Determine goals and context from actions
  _.each(config._all.actions, function (action) {
    if (bundle.validActions.includes(action)) {
      applyParams(goalParams, bundle.actionsMap[action], {limit: config._all.limit});
    } else {
      let index = action.indexOf(':');
      if (index >= 0) {
        let prefix = action.substring(0, index);
        let version;
        let match = action.match(constants.CHANGESET_ID_SHORTCUT_REGEX);
        if (match) {
          let bundleConfigPath = Path.join(versionsRepo.getRepoDir(),
            sprintf(config.versions_files.bundle_config_spec, prefix))
          let bundleQualifiers = new JSONFile(bundleConfigPath).data.config.qualifiers;
          version = sprintf('%s-%s',
            bundleQualifiers && bundleQualifiers.default ? bundleQualifiers.default :
              config.qualifiers.default, match[2]);
        } else {
          version = action.substring(index + 1);
        }
        if (bundle.validChangesets.includes(prefix)) {
          let changesets = {};
          changesets[prefix] = version;
          applyParams(goalParams, bundle.actionsMap[prefix], {changesets: changesets, limit: config._all.limit});
        } else if (bundle.validShipments.includes(prefix)) {
          let shipments = {};
          shipments[prefix] = version;
          applyParams(goalParams, bundle.actionsMap[prefix], {shipments: shipments, limit: config._all.limit});
        } else {
          throw new BuildError(sprintf("Action %s doesn't correspond to a known changeset or shipment type", action));
        }
      } else {
        throw new BuildError(sprintf('Unknown action: %s', action));
      }
    }
  });

  _.each(util.asArray(bundle.environment.exclude_vars), function (varToExclude) {
    for (let goal in goalParams) {
      if (goalParams[goal].vars) {
        delete goalParams[goal].vars[varToExclude];
      }
    }
  });

  await bundle.initSupportProjects(goalParams);

  binUtil.ensurePersonalSettings([], versionsRepo);

  sendNotificationMessage(bundle, false, true);

  // Loop through and execute each relevant goal
  for (let goal of bundle.getOrderedGoals(goalParams)) {
    let params = goalParams[goal.name];
    let goalModule = goal.module ? goalModules[goal.module] :
          goalModules[goal.name] ? goalModules[goal.name] :
          goalModules[GENERIC_GOAL];

    if (!goalModule) {
      throw new Error('No such goal module');
    }

    util.narratef('Starting goal: %s', goal.name);
    util.narratef('Config: %s', JSON.stringify(params, null, 2));
    util.announce(sprintf('Executing %s'.plain, goal.name));

    bundle.currentGoal = goal.name;
    if (goalModule.requiredSettings) {
      binUtil.ensurePersonalSettings(goalModule.requiredSettings, versionsRepo);
    }

    if (!config._all['no-checkout']) {
      await goalModule.checkout(bundle, goal, params);
    }
    bundle.verifyEnvironment();
    await goalModule.callback.call(this, bundle, goal.name, params);
  }

  sendNotificationMessage(bundle, true, true);

  displayAguiNotification();
}

function errorHandler (ex) {
  binUtil.unlockPidFile();
  if (ex instanceof CancelledError) {
    util.announce('Exit'.plain);
    util.subAnnounce('Cancelled by operator'.plain);
  } else {
    util.println();
    util.announce('Fatal error'.bad);
    if (ex instanceof ExecError) {
      if (ex.stderr && ex.stderr.length > 0) {
        util.println(ex.stderr.bad);
      }
    }
    if (ex instanceof BuildError) {
      let message = ex.toString() || 'Unknown build error!';
      util.println(message.bad);
      if (typeof bundle !== 'undefined' && bundle.ansibleCommands.length > 0) {
        sendNotificationMessage(bundle, true, false);
      }
      process.exitCode = 1;
    } else if (ex instanceof ConfigError) {
      util.println(ex.toString().bad);
    } else {
      console.error(ex);
    }
  }
}

goalHandler().catch(errorHandler);

// Define a function to display actions
function displayAguiNotification() {
  util.subAnnounce('Notification'.plain);
  util.startBullet('For AGUI deployment please use this pipeline'.plain);
  util.continueBullet('https://dev.azure.com/agilysys/Stay/_build?definitionId=4532&_a=summary'.useful);
  util.subAnnounce(''.plain);
}
