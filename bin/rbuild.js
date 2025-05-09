#!/usr/bin/env rbuild-node-env
const _ = require('underscore');
const colors = require('colors');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const fs = require('fs');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../lib/classes/BuildError');
const Bundle = require('../lib/classes/Bundle');
const config = require('../lib/common/config');
const util = require('../lib/common/util');

// Don't use an alias of 'd' because rbuild.sh slurps a first-arg of '-d' to invoke the debugger
const optionList = [
  { name: 'goal',       alias: 'g', type: String,   description: 'Goals to execute ({bold REQUIRED})', multiple: true, defaultOption: true },
  { name: 'file',       alias: 'f', type: String,   description: 'Build definition file ({bold REQUIRED})' },
  { name: 'commit',                 type: Boolean,  description: 'Carry out the Git/Artifactory operations' },
  { name: 'release',    alias: 'r', type: Boolean,  description: 'Publish release artifacts and commit versions' },
  { name: 'include',    alias: 'i', type: String,   description: 'Consider only these projects', multiple: true },
  { name: 'exclude',    alias: 'e', type: String,   description: 'Do not consider these projects', multiple: true },
  { name: 'branch-type',alias: 'b', type: String,   description: 'Checkout projects using the branch defined by this key' },
  // Goal specific
  { name: 'alias',      alias: 'a', type: String,   description: 'Use with `bom` goal, symlink to bom (dev|rc|mr|hf)' },
  { name: 'feature',                type: String,   description: 'Name of the feature to start/extend/end. (e.g., VCTRS-9999-lorem-ipsum)' },
  // Rarely used options
  { name: 'no-cache',               type: Boolean,  description: 'Disable use of cached POM files downloaded from artifactory' },
  { name: 'no-color',               type: Boolean,  description: 'Disable color console output' },
  { name: 'quickstart', alias: 'q', type: Boolean,  description: 'Don\'t clone or pull repositories on startup ' + '(dangerous)'.bold },
  // General purpose
  { name: 'help',       alias: 'h', type: Boolean },
  { name: 'verbose',    alias: 'v', type: Boolean }
];

var commandList = [];
var goalModules = {};
function LoadModules(path) {
  var stat = fs.lstatSync(path);
  if (stat.isDirectory()) {
    var files = fs.readdirSync(path);
    var f, l = files.length;
    for (var i = 0; i < l; i++) {
      f = Path.join(path, files[i]);
      LoadModules(f);
    }
  } else {
    moduleExports = require(path);
    for (name in moduleExports) {
      var properties = moduleExports[name];
      if (properties.disabled) {
        continue;
      }
      if (goalModules[name]) {
        throw new BuildError('Goal ' + name + ' would be redefined by: ' + path);
      }
      goalModules[name] = properties;
      commandList.push({name: name, summary: properties.summary});
    }
  }
}
LoadModules(Path.join(__dirname, '..', 'lib', 'goals', 'rbuild'));

_.extend(config, commandLineArgs(optionList));

var buildFilePath = config['file'];
var goals = config['goal'];
var projects = [];

// Bail if requirements are not met
if (!goals || !buildFilePath) {
  config.help = true;
}

// Bail if we wont be able to execute one of the requested goals
_.each(goals, function (goal) {
  if (!goalModules[goal]) {
    util.printf("No goal available: %s\n".bad, goal);
    config.help = true;
  }
});

if (config.feature) {
  if (!/^VCTRS-\d+(-\w+)*$/.test(config.feature)) {
    util.printf("Feature is not well formed: %s\n".bad, config.feature);
    config.help = true;
  }
}

if (config.help) {
  util.println(commandLineUsage([
    {
      header: 'rGuest Build Tool',
      content: 'Perform repository changes and builds across multiple projects'
    },
    {
      header: 'Synopsis',
      content: [
        '$ rbuild {underline goal} {bold -f} {underline file}',
        '$ rbuild {bold --help}'
      ]
    },
    {
      header: 'Goals',
      content: _.sortBy(commandList, 'mode')
    },
    {
      header: 'Options',
      optionList: optionList
    }
/*
    ,{
      header: 'Recipes',
      content: [
        '{bold Release or maintenance-release build}',
        '-f rguest-stay-sprint60.json build bom --release --verbose'
      ]
    }
*/
  ]));
  return;
}

try {
  let bundle = new Bundle(util.readJSON(buildFilePath));
  _.each(goals, function (goal) {
    var properties = goalModules[goal];
    _.each(properties.requiredArguments, function (parameter) {
      if (!util.isPresent(config[parameter])) {
        throw new BuildError(sprintf("Missing parameter: %s", parameter));
      }
    });
    bundle.currentGoal = goal;
    bundle.checkout(config['branch-type'] || properties.branchType);
    util.printf(sprintf('Executing goal: %s\n'.underline, goal));
    properties.callback.call(this, bundle);
  });
  process.exit(0);
} catch (ex) {
  if (ex instanceof BuildError) {
    let message = ex.toString() || 'Unknown build error!';
    util.println(message.bad);
    process.exit(1);
  } else {
    throw ex;
  }
}
