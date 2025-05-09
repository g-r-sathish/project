const _ = require('underscore');
const config = require('../common/config');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const ExecError = require('./ExecError' );
const util = require('../common/util');

const ANSIBLE_EXECUTABLE = 'ansible-playbook';


function AnsibleCommand(bundle, goalName, goalParams) {
  let goalConfig = bundle.goalsMap[goalName];
  this.goalName = goalName;
  this.playbook = Path.join(goalConfig.repo, goalConfig.playbook);
  this.inventory = Path.join(bundle.getEnvironmentRepoPath(), bundle.environment.home_dir, bundle.environment.hosts_file);
  let pairs = [];
  if (goalParams.vars) {
    _.each(Object.keys(goalParams.vars), function (key) {
      pairs.push(sprintf('%s=%s', key, goalParams.vars[key]));
    });
  }
  this.vars = pairs.join(' ');
  this.tags = util.asArray(goalParams.tags).join(',');
  this.extraArguments = (goalConfig.extra_playbook_args || []).join(' ');
  this.limit = util.asArray(goalParams.limit).join(',');
  this.workDir = config.workDir;
}

AnsibleCommand.prototype.getCommandText = function () {
  return sprintf('%s %s', ANSIBLE_EXECUTABLE, this.getArgs().join(' '));
};

AnsibleCommand.prototype.getSummaryText = function () {
  return sprintf('%s %s', this.goalName, this.tags);
};

AnsibleCommand.prototype.getArgs = function () {
  let args = [this.playbook, '-i', this.inventory];
  if (this.vars) {
    args.push('-e', this.vars);
  }
  args.push('-t', this.tags);
  if (this.extraArguments) {
    args = args.concat(this.extraArguments);
  }
  if (this.limit) {
    args.push('-l', this.limit);
  }
  return args;
};

AnsibleCommand.prototype.execute = function () {
  if (config._all.commit) {
    // TODO: figure out async with event listeners for better experience and logging
    util.exec(ANSIBLE_EXECUTABLE, this.getArgs(), this.workDir, { stdio: 'inherit' });
  }
};

module.exports = AnsibleCommand;
