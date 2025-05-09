const _ = require('underscore');
const config = require('../common/config');
const util = require('../common/util');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError');
const GitRepository = require('./GitRepository');
const {Projects, Trunks} = require('./Constants');

/**
 * @abstract
 */
class Project {
  static create(project, definition, options, instanceName, trunkDefinitions) {
    if (definition) {
      project.options = _.extend({
        workDir: config.workDir
      }, options);
      project.definition = _.extend({
        mainline: config.mainline_branch_name,
        repo_host: GitRepository.Host.AGILYSYS
      }, definition);
      project.instanceName = instanceName;
      project.dirname = path.basename(project.definition.repo_path);
      project.repo = GitRepository.create(project.definition, project.options);
      project.status = project._expandProjectStatus(project.definition.status, trunkDefinitions);
    }
    return project;
  }

  static fromJsonObject(project, object) {
    _.extend(project, object);
    project.repo = GitRepository.fromJsonObject(object.repo);
    return project;
  }

  checkout(branch) {
    this.repo.checkout(branch); // will also pull
    return this;
  }

  checkoutDetached(tag) {
    this.repo.checkoutDetached(tag);
    return this;
  }

  getMainlineBranchName() {
    return this.definition.mainline;
  }

  getName() {
    return this.definition.repo_path;
  }

  getProjectDir() {
    return sprintf('%s/%s', this.getWorkDir(), this.definition.repo_path);
  }

  getRepoPath() {
    return this.definition.repo_path;
  }

  getRepoUrl() {
    let urlSpec = this.repo.repoBase;
    return sprintf(urlSpec, this.getRepoPath());
  }

  getStatus(trunkName) {
    if (!trunkName) trunkName = Trunks.MASTER;
    return this.status[trunkName];
  }

  getWorkDir() {
    return this.options.workDir;
  }

  init(options) {
    options = _.extend({
      checkout: [],
      workDir: config.workDir,
      okIfMissing: false,
      forceCheckout: false
    }, options);

    this._establishRepository(options);

    return this.point(options);
  }

  isAutoInclude() {
    return !!this.definition.auto_include;
  }

  isCalled(name) {
    return this.dirname === name || this.definition.repo_path === name;
  }

  overlayJsonObject(object) {
    this.options = object.options;
    this.definition = object.definition;
    this.instanceName = object.instanceName;
    this.dirname = object.dirname;
    this.repo = GitRepository.fromJsonObject(object.repo);
    this.status = object.status;
    this.existsInProduction = object.existsInProduction;
  }

  point(options) {
    options = _.extend({
      checkout: [],
      okIfMissing: false
    }, options);

    let label = undefined;
    _.each(util.asArray(options.checkout), target => {
      if (!label) {
        if (target === Projects.GitTarget.NO_OP) {
          this.repo.fetch();
          label = target;
        } else if (target.startsWith(Projects.GitTarget.TAG_PREFIX)) {
          let tag = target.substring(Projects.GitTarget.TAG_PREFIX.length);
          if (this.repo.doesTagExist(tag)) {
            this.checkoutDetached(tag);
            label = target;
          }
        } else if (target.startsWith(Projects.GitTarget.COMMIT_PREFIX)) {
          let commitId = target.substring(Projects.GitTarget.COMMIT_PREFIX.length);
          if (this.repo.doesCommitExist(commitId)) {
            this.checkoutDetached(commitId);
            label = target;
          }
        } else {
          if (target === Projects.GitTarget.MAINLINE) {
            target = this.getMainlineBranchName();
          }
          if (this.repo.doesBranchExist(target)) {
            this.checkout(target);
            label = target;
          }
        }
      }
    });
    if (!label && !options.okIfMissing) {
      throw BuildError(sprintf('Unable to resolve target for %s', options.checkout));
    }
    return label;
  }

  setStatus(trunk, status) {
    if (!trunk) trunk = Trunks.MASTER;
    this.status[trunk] = status;
  }

  toJsonObject() {
    const object = {};
    object.options = this.options;
    object.definition = this.definition;
    object.instanceName = this.instanceName;
    object.dirname = this.dirname;
    object.repo = this.repo;
    object.status = this.status;
    object.existsInProduction = this.existsInProduction;
    return object;
  }

  toString() {
    return sprintf('%s:%s', this.instanceName, this.definition.repo_path);
  }

  _establishRepository(options) {
    this.options = _.extend({
      workDir: config.workDir
    }, this.options, options);

    this.repo.options.workDir = options.workDir;

    if (options.workDir === config.workDir) {
      this.repo.resetRepository();
    } else {
      this.repo.ensureRepository(options);
    }

    if (this.options.productionTag) {
      this.existsInProduction = this.repo.doesTagExist(this.options.productionTag);
    }

    // better safe than sorry
    this.repo.enablePomMergeDriver();
  }

  _expandProjectStatus(masterStatus, trunkDefinitions = []) {
    let expanded = {};
    expanded[Trunks.MASTER] = masterStatus;
    trunkDefinitions.forEach(trunkDefinition => expanded[trunkDefinition.name] =
      trunkDefinition.status != null ? trunkDefinition.status[this.dirname] : undefined);

    // if nobody has it, implicit status is ACTIVE; otherwise implicit status is IGNORED
    let emptyCount = 0;
    let totalCount = 0;
    Object.keys(expanded).forEach(trunk => {
      if (!expanded[trunk]) emptyCount++;
      totalCount++;
    });
    let emptyIsActive = totalCount === emptyCount;

    Object.keys(expanded).forEach(trunk => {
      if (!expanded[trunk]) {
        expanded[trunk] = emptyIsActive ? Projects.Status.ACTIVE : Projects.Status.IGNORED;
      }
    });
    return expanded;
  }
}

module.exports.Project = Project;