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
const ChangesetBundle = require('../lib/classes/ChangesetBundle');
const constants = require('../lib/common/constants');
const ExecError = require('../lib/classes/ExecError');
const GitRepository = require('../lib/classes/GitRepository');
const JSONFile = require('../lib/classes/JSONFile');
const LockError = require('../lib/classes/LockError');
const Package = require('../package.json');
const util = require('../lib/common/util');

require('../lib/common/release-pipe'); // populate constants

// Don't use an alias of 'd' because wrapper slurps a first-arg of '-d' to invoke the debugger
let optionList = [
  { name: 'goal',       alias: 'g', type: String,   group: ['global'],  description: 'Goal to execute ({bold REQUIRED})', defaultOption: true },
  { name: 'include',    alias: 'i', type: String,   group: ['goal'],    description: 'Pipeline to include: svc|ui|naag', multiple: true },
  { name: 'constraint', alias: 'c', type: String,   group: ['goal'],    description: 'Constraint: ' + constants.ENUM_RELEASE_CONSTRAINTS.join('|') },
  { name: 'dry-run',                type: Boolean,  group: ['goal'],    description: 'Do not push changes to Git' },
  { name: 'help',                   type: Boolean,  group: ['global'] }
];

let requiredSettingsList = [
  { name: 'ad_username',     description: 'Username for AD' }
];

let goalList = [];
let goalModules = {};
let versionsRepo;
let goal;
let goalName;

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
      goalList.push({
        name: sprintf('{bold %s}', name),
        summary: goal.summary
      });
    }
  }
}

function buildCommandHelp(goalList) {
  return [
    {
      content: sprintf('%s\nVersion: %s\nNode: %s', config.rName, Package.version, process.version),
      raw: true
    },
    {
      header: 'Synopsis',
      content: [
        '$ rboss -g {underline goal}',
        '$ rboss {bold --help}'
      ]
    },
    {
      header: 'Goals',
      content: _.sortBy(goalList, 'mode')
    },
    {
      header: 'Options',
      optionList: optionList,
      group: ['goal']
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

loadModules(Path.join(__dirname, '..', 'lib', 'goals', 'rboss'));

try {

  // User config override
  let userConfigPath = Path.join(config.dotDir, 'config.json');
  if (util.fileExists(userConfigPath)) {
    util.narratef('Loading user configuration: %s\n', userConfigPath);
    config.$extend(util.readJSON(userConfigPath));
  }
  util.applyTheme();

  // Extend global config with command-line arguments
  config.$extend(commandLineArgs(optionList, {partial: true}));

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
    throw new BuildError(sprintf('No goal available: %s\n', goalName));
  }

  // apply defaults
  goal.notificationSettings = _.extend({
    skip: false,
    onStart: false
  }, goal.notificationSettings);

  optionList = _.filter(optionList, function (option) {
    return option.group.indexOf('global') > -1
      || goal.requiredArguments.indexOf(option.name) > -1
      || goal.optionalArguments.indexOf(option.name) > -1;
  });

  requiredSettingsList = _.filter(requiredSettingsList, function (variable) {
    return goal.requiredSettings.indexOf(variable.name) > -1;
  });

  if (config._all.help) {
    util.println(commandLineUsage(buildCommandHelp(goalName)));
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

  // Bail if there are unknown arguments
  if (config._unknown) {
    throw new BuildError(sprintf('Unknown argument(s): %s\n', config._unknown));
  }

  // Changes are not pushed under --dry-run
  config._all.commit = !config._all['dry-run'];

  binUtil.checkNotInDotDir();
  binUtil.checkGitVersion({ allowDevOpsVersion: true });

  binUtil.lockPidFile();

} catch (ex) {
  if (ex instanceof LockError) {
    util.println(ex.toString().bad);
    process.exit(1);
  }
  binUtil.unlockPidFile();
  if (ex instanceof BuildError) {
    let message = ex.toString() || 'Unknown build error!';
    util.println(commandLineUsage(buildCommandHelp(goalList)).plain);
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

try {
  // We need the repository which hosts our config files
  util.announce('Initializing'.plain);
  versionsRepo = GitRepository.create(config.versions_files);
  util.startBullet(versionsRepo.dirname.plain);
  if (!config._all['no-checkout']) {
    versionsRepo.resetRepository();
  }
  util.endBullet(util.repoStatusText(versionsRepo.branchName, config.workDir, versionsRepo.clonePath));

  binUtil.ensurePersonalSettings(goal.requiredSettings.concat(goal.optionalSettings), versionsRepo);

  util.announce(goal.heading.plain || goalName.plain);
  let bundleNames = config._all['include'] || config.debug.all_bundle_names || config.rboss.all_bundle_names;
  _.each(bundleNames, (bundleName) => {
    config.bundleName = bundleName; // global state (used by ChangesetBundle)
    let bundleConfigPath = Path.join(versionsRepo.getRepoDir(),
      sprintf(config.versions_files.bundle_config_spec, bundleName));

    // Bail if build file not found
    if (!fs.existsSync(bundleConfigPath)) {
      throw new BuildError(sprintf('No bundle config found. Ensure your bundle name is accurate: %s\n', bundleName || ''));
    }
    let bundleFile = new JSONFile(bundleConfigPath);
    let bundle = new ChangesetBundle(bundleFile, versionsRepo);
    goal.callback.call(this, bundle, goal);
  });

  process.exit(0);
} catch (ex) {
  binUtil.unlockPidFile();
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
    process.exit(1);
  } else if (ex instanceof ConfigError) {
    util.println(ex.toString().bad);
  } else {
    throw ex;
  }
}
