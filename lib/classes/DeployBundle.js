const _ = require('underscore');
const colors = require('colors');
const sprintf = require('sprintf-js').sprintf;
const Path = require('path');

const BuildError = require('./BuildError')
const Bundle = require('./Bundle');
const {ChangesetFile} = require('./ChangesetFile');
const config = require('../common/config');
const {Projects} = require('./Constants');
const {ShipmentFile} = require('./ShipmentFile');
const {SupportProject} = require('./SupportProject');
const util = require('../common/util');

function DeployBundle (configFile, versionsRepo, environmentName) {
  this._constructBundle(configFile, versionsRepo, 'deploy');
  this.supportProjects = [];
  this.actionsMap = {};
  _.each(configFile.data.actions, function (action) {
    this.actionsMap[action.name] = action;
  }, this);
  this.goalsMap = {};
  _.each(configFile.data.goals, function (goal) {
    this.goalsMap[goal.name] = goal;
  }, this);
  this.validActions = _.chain(configFile.data.actions).filter(function (action) { return !action.bundleType }).pluck('name').value();
  this.validChangesets = _.chain(configFile.data.actions).filter(function (action) { return action.bundleType === 'changeset' }).pluck('name').value();
  this.validShipments = _.chain(configFile.data.actions).filter(function (action) { return action.bundleType === 'shipment' }).pluck('name').value();
  this.initScript = undefined;
  this.ansibleCommands = [];
  this.setEnvironment(environmentName);
}

DeployBundle.prototype = new Bundle();
DeployBundle.prototype.constructor = DeployBundle;

DeployBundle.prototype.setEnvironment = function (name) {
  let definition = undefined;
  _.each(this.configFile.data.environments, function (environment) {
    if (definition) return;
    if (environment.regex) {
      let regex = new RegExp(environment.regex);
      if (!name.match(regex)) return;
      definition = environment;
    } else if (environment.name) {
      if (name === environment.name) {
        definition = environment;
      }
    } else {
      definition = environment;
    }
  }, this);
  if (!definition) {
    throw new BuildError(`Could not find environment definition for: ${name}`);
  }
  this.environment = _.extend({}, config.environments[definition.type], definition);
  this.environment.name = name;
  if (this.environment.hosts_file) {
    this.environment.hosts_file = this.environment.hosts_file.replace(/\$\{name}/g, name);
  }
};

DeployBundle.prototype.getEnvironmentRepoPath = function () {
  return this.environment ? util.asArray(this.environment.repo)[0] : undefined;
};

DeployBundle.prototype.verifyEnvironment = function () {
  let found = false;
  _.each(util.asArray(this.environment.home_dir), function (path) {
    let hostsPath = Path.join(config.workDir, this.getEnvironmentRepoPath(), path, this.environment.hosts_file);
    if (!found && util.fileExists(hostsPath)) {
      this.environment.home_dir = path;
      found = true;
    }
  }, this);
  if (!found) {
    throw new BuildError(sprintf('Could not find hosts file for %s', this.environment.name));
  }
  util.narratef('Environment: %s', JSON.stringify(this.environment, null, 2));
};

DeployBundle.prototype.verifyShipmentYaml = function (type, idOrAlias) {
  return this._verifyYaml(Object.values(ShipmentFile.Alias).includes(idOrAlias)
    ? sprintf(config.versions_files.alias_spec, type, idOrAlias)
    : sprintf(config.versions_files.shipment_spec, type, idOrAlias));
};

DeployBundle.prototype.verifyChangesetYaml = function (type, idOrAlias) {
  let changesetFile = ChangesetFile.create(this.versionsRepo, type);
  return this._verifyYaml(changesetFile.doesAliasExist(idOrAlias)
    ? sprintf(config.versions_files.alias_spec, type, idOrAlias)
    : sprintf(config.versions_files.changeset_spec, type, idOrAlias));
};

DeployBundle.prototype.verifyBaseYaml = function () {
  return this._verifyYaml(config.versions_files.base_versions_path);
};

DeployBundle.prototype._verifyYaml = function (internalPath) {
  let fullPath = Path.join(this.versionsRepo.getRepoDir(), internalPath);
  if (!util.fileExists(fullPath)) {
    throw new BuildError(sprintf('Could not find yaml file %s', fullPath));
  }
  return internalPath;
};

DeployBundle.prototype.initSupportProjects = function (goalParams) {
  let repos = Array.from(util.asArray(this.environment.repo));
  _.each(this.getOrderedGoals(goalParams), function (goal) {
    if (goalParams[goal.name]) {
      repos.push(goal.repo);
      if (goal.support_repo) {
        repos = repos.concat(util.asArray(goal.support_repo));
      }
    }
  });
  _.each(this.configFile.data.support_projects, function (definition) {
    if (repos.includes(definition.repo_path)) {
      let project = SupportProject.create(definition, {}, this.instanceName);
      this.supportProjects.push(project);
      util.startBullet(project.dirname.plain);
      let label = project.init({
        checkout: config._all['use-cwd'] ? Projects.GitTarget.NO_OP : Projects.GitTarget.MAINLINE,
        workDir: config._all['use-cwd'] ? util.cwd() : config.workDir
      });
      util.endBullet(util.repoStatusText(label, config.workDir, project.repo.clonePath));
    }
  }, this);
};

DeployBundle.prototype.pointSupportProjects = function (checkoutMap) {
  _.each(this.supportProjects, function (project) {
    if (checkoutMap[project.dirname]) {
      util.startBullet(project.dirname.plain);
      let label = project.point({
        checkout: checkoutMap[project.dirname]
      });
      util.endBullet(util.repoStatusText(label, config.workDir, project.repo.clonePath));
    }
  }, this);
};

/*
  actions rdeploy config have a goals{} object which referes to a named goals in the
  goals[] section. if it isn't found, or the goals[] section isn't used, the goal
  name is still passed on.
 */
DeployBundle.prototype.getOrderedGoals = function (goalParams) {
  let namedGoalNames = Object.keys(goalParams);
  let orderedGoalNames = [];

  if (this.configFile.data.goals) {
    let configuredGoals = _.pluck(this.configFile.data.goals, 'name');
    let adhocGoals = _.difference(namedGoalNames, configuredGoals);
    let orderedGoals = _.intersection(configuredGoals, namedGoalNames);
    orderedGoalNames = orderedGoals.concat(adhocGoals);
  } else {
    orderedGoalNames = namedGoalNames;
  }

  let goals = [];
  for (let goalName of orderedGoalNames) {
    goals.push(_.find(this.configFile.data.goals, candidate => candidate.name === goalName) || {name: goalName});
  }
  return goals;
};

DeployBundle.prototype.getInitScript = function () {
  if (!this.initScript) {
    this.initScript = util.generateScript('init-repo.sh', this);
  }
  return this.initScript;
}

module.exports = DeployBundle;
