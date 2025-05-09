const _ = require('underscore');
const Path = require('path');
const request = require('sync-request');
const assert = require('assert').strict;

const config = require('../common/config');
const util = require('../common/util');
const BuildError = require('./BuildError')
const BuildState = require('./BuildState');
const DeployBundle = require('./DeployBundle');
const DeploymentProject = require('./DeploymentProject');
const {EnvironmentFile} = require('./models/EnvironmentFile');
const ApplicationConfigFile = require('./models/ApplicationConfigFile');
const GitBackedYAMLFile = require('./GitBackedYAMLFile');
const GitRepository = require('./GitRepository');
const {RolloutRequest} = require("./RolloutRequest");

class AKSDeployBundle extends DeployBundle {
  static useAKSDeployBundle(type) {
    return /^(aks|wip|lab|k3d|k8s)$/.test(type);
  }

  constructor(definition, options, environmentName) {
    super(definition, options, environmentName);

    this.defaultCommitMessage = `[${config.rName}]`;
    this.artifactDefinitions = undefined;
    this.buildStates = {};
    this.registryIndex = undefined;
    this.registryIndexIsDirty = false;
    this.promoteRegistryIndex = undefined;
    this.promoteRegistryIndexIsDirty = false;
    this.environmentFile = undefined;
    this.deploymentProjects = [];
    this.configRepoBranch = undefined;
  }

  init(includeList, excludeList, subsetSelector) {
    this.loadEnvironment(subsetSelector);
    this.loadBuildStates();
    this.loadRegistryIndex();
    this.loadPromoteRegistryIndex();
    this.constructDeploymentProjects(includeList, excludeList);
  }
  

  // @override
  verifyEnvironment () {
    util.narratef('AKS Environment: %s', JSON.stringify(this.environment, null, 2));
  }

  getEnvironmentName () {
    let name = this.environment.name;
    let type = this.environment.type;
    return `${type}-${name}`;
  }

  loadEnvironment(subsetSelector) {
    let envRepo = this.initRepo(this.environment.env_repo);
    let envName = this.getEnvironmentName();
    this.environmentFile = new EnvironmentFile(envRepo, `${envName}.yml`, subsetSelector, true);
    return this.environmentFile;
  }

  initRepo(definition, repoBranch) {
    let repoOptions = _.extend({workDir: config.workDir}, definition.options);
    let repoDefinition = _.extend({mainline: config.mainline_branch_name}, definition);
    if (repoBranch) {
      Object.assign(repoDefinition, {mainline: repoBranch});
    }
    let repo = GitRepository.create(repoDefinition, repoOptions);
    util.startBullet(repo.dirname.plain);
    if (repoOptions.workDir === config.workDir) {
      repo.resetRepository();
    } else {
      repo.ensureRepository();
    }
    util.endBullet(util.repoStatusText(repoDefinition.mainline, config.workDir, repo.clonePath));
    return repo;
  }

  getEnv () {
    return this.environmentFile;
  }

  getConfigRepoBranch() {
    if (!this.configRepoBranch) {
      let subset = this.getEnv().getSubset();
      this.configRepoBranch = subset.config_repo_branch;
    }
    return this.configRepoBranch;
  }

  setConfigRepoBranch(branch) {
    return this.configRepoBranch = branch;
  }

  get rolloutRequest() {
    if (!this._rolloutRequest) {
      this._rolloutRequest = new RolloutRequest(this);
    }
    return this._rolloutRequest;
  }

  get isManualRollout() {
    return !!this.environmentFile.get(EnvironmentFile.MANUAL_ROLLOUT);
  }

  saveRolloutRequest() {
    util.startBullet('Saving rollout request'.plain);
    this.setConfigRepoBranch(this.rolloutRequest.getConfigSource());
    this.environmentFile.data.rollout = this.rolloutRequest.composeRequest();
    this.environmentFile.save();
    const actions = config._all['actions'] || [];
    const requested = actions.join(' ');
    const pushed = this.environmentFile.checkIn(`Rollout request for: ${this.getEnvironmentName()} (${requested})`);
    util.endBullet(pushed ? 'Pushed'.good : 'No changes'.warn);
  }

  getEnvironmentVersions() {
    return this.environmentFile.getSubset();
  }

  getArtifactDefinitions () {
    if (!this.artifactDefinitions) {
      let path = Path.join(this.versionsRepo.getRepoDir(), config.versions_files.rdeploy_config_artifacts_path);
      this.artifactDefinitions = util.readYAML(path);
    }
    return this.artifactDefinitions;
  }

  constructDeploymentProjects(includeList, excludeList) {
    const deployments = this.configFile.data.deployments;
    const pipelines = this.configFile.data.pipelines;
    const artifactDefinitions = this.getArtifactDefinitions();
    const subset = this.environmentFile.getSubset();

    if (!includeList || !includeList.length) {
      includeList = this.configFile.data.all_deployments_in_order;
    }

    for (var key of includeList) {
      if (excludeList && _.contains(excludeList, key)) {
        continue;
      }
      let definition = deployments[key];
      if (!definition) {
        let validOptions = Object.keys(deployments).join("\n");
        throw new BuildError(`Cannot find requested deployment '${key}', valid options are:\n${validOptions}`);
      }
      let deploymentProject = new DeploymentProject(this, definition, {}, key);
      deploymentProject.setPipelineDefinitions(pipelines.definitions);
      deploymentProject.resolveArtifactReferences(artifactDefinitions);
      deploymentProject.resolvePipelineVars(subset);
      this.deploymentProjects.push(deploymentProject);
    }
  }

  getPipelineDefinition(name) {
    try {
      return this.configFile.data.pipelines.definitions[name];
    } catch (ex) {
      throw new BuildState.BuildDefinitionNotFoundError(ex);
    }
  }

  async runPipeline(piplineName, buildName, parameterValues = {}) {
    let pipelineDefinition = this.getPipelineDefinition(piplineName);
    let buildState = this.createBuildState(buildName, pipelineDefinition, parameterValues);
    return buildState.run();
  }

  createBuildState(buildName, pipelineDefinition, parameterValues = {}) {
    let pipelineParameters = {};
    let valueMap = _.extend(
      {
        "env": this.getEnvironmentName(),
        "subsetVersion": this.getEnv().getSubsetVersion(),
        "approval": this.getEnv().getApprovalRequest(),
        "configBranch": this.getConfigRepoBranch() || 'master', // TODO: This should not default
      },
      this.environment,
      parameterValues
    );
    const imageBranch = config._all['config-repo-branch-image'];
    if (imageBranch) {
      valueMap.configBranch = imageBranch;
    }
    if (pipelineDefinition.parameters) {
      for (var key of pipelineDefinition.parameters) {
        if (key in valueMap) {
          pipelineParameters[key] = valueMap[key];
        } else {
          throw new BuildState.MissingParameterError();
        }
      }
    }
    if (pipelineDefinition.optionalParameters) {
      for (var key of pipelineDefinition.optionalParameters) {
        if (key in valueMap) {
          pipelineParameters[key] = valueMap[key];
        }
      }
    }
    return new BuildState().create(buildName, pipelineDefinition, pipelineParameters);
  }

  getDeploymentProjects () {
    return this.deploymentProjects;
  }

  getDeploymentProjectByName(name) {
    return _.find(this.deploymentProjects, (project) => {
      return project.getName() === name;
    })
  }

  getDeploymentProjectByAppName(name) {
    return _.find(this.deploymentProjects, (project) => {
      return project.getAppName() === name;
    })
  }

  getDeploymentProjectsByType(type, {markedForDeployment=false}) {
    const projects = _.filter(this.deploymentProjects, (project) => {
      return project.getType() === type;
    })
    return markedForDeployment
      ? _.filter(projects, (project) => project.isMarkedForDeployment())
      : projects;
  }

  getServiceProjects ({markedForDeployment=false}) {
    let projects = this.getDeploymentProjectsByType(DeploymentProject.TYPE_SERVICE, {markedForDeployment});
  }

  getJobProjects ({markedForDeployment=false}) {
    return this.getDeploymentProjectsByType(DeploymentProject.TYPE_JOB, {markedForDeployment});
  }

  // Keep track of build states in a manner that resumes if the client (rdeploy)
  // gets cut off or interrupted after the jobs have been submitted.
  getBuildStateFilename() {
    return Path.join(config.dotDir, this.getEnvironmentName() + '.yml');
  }

  loadBuildStates() {
    this.buildStates = {};
    let path = this.getBuildStateFilename();
    if (util.fileExists(path)) {
      this.buildStates = util.readYAML(path);
      for (let key in this.buildStates) {
        let project = this.buildStates[key];
        for (let type in project) {
          project[type] = new BuildState(project[type]);
        }
      }
    }
  }

  saveBuildStates() {
    util.writeYAML(this.getBuildStateFilename(), this.buildStates);
  }

  getRemainingBuildStates(pipelineType) {
    return this.getBuildStates(pipelineType, true);
  }

  getBuildStates(pipelineType, filterCompleted = false) {
    const result = [];
    for (let key in this.buildStates) {
      let project = this.buildStates[key];
      for (let type in project) {
        if (project.hasOwnProperty(type) && (!pipelineType || type === pipelineType)) {
          let buildState = project[type];
          if (!filterCompleted || !buildState.hasCompleted()) {
            result.push(buildState);
          }
        }
      }
    }
    return result;
  }

  getBuildState(projectName, pipelineType) {
    return this.buildStates[projectName] ? this.buildStates[projectName][pipelineType] : undefined;
  }

  setBuildState(projectName, pipelineType, buildState) {
    this.buildStates[projectName] = this.buildStates[projectName] || {};
    this.buildStates[projectName][pipelineType] = buildState;
    return this.buildStates[projectName][pipelineType];
  }

  // Keep track of docker images which have been published.
  //
  // The better approach of hitting the Azure API directly imposes credential flow
  // and an async/wait refactor that I don't want to take on at the moment.
  //
  // State is maintained in versions-files/stay/rdeploy/agysacrdev.json (for example)

  getRegistryIndexFilename() {
    return Path.join(
      this.versionsRepo.getRepoDir(),
      config.versions_files.rdeploy_config_root,
      this.environment.containerRegistry + '.json'
    );
  }

  loadRegistryIndex() {
    let path = this.getRegistryIndexFilename();
    this.registryIndexIsDirty = false;
    if (!util.fileExists(path)) {
      throw new BuildError(`Docker registry index does not exist: ${path}`);
    }
    this.registryIndex = util.readJSON(path);
    assert.ok(this.registryIndex);
  }

  saveRegistryIndex() {
    if (this.registryIndexIsDirty) {
      util.writeJSON(this.getRegistryIndexFilename(), this.registryIndex);
      this.registryIndexIsDirty = false;
      return true;
    }
    return false;
  }

  isDockerImagePublished(project) {
    let name = project.getDockerRepositoryName();
    let tag = project.getDockerRepositoryTag();
    assert.ok(name);
    assert.ok(tag);
    try {
      let tags = this.registryIndex.repositories[name];
      return _.contains(tags, tag);
    } catch (ex) {
      return false;
    }
  }

  markDockerImageAsPublished(project) {
    let name = project.getDockerRepositoryName();
    let tag = project.getDockerRepositoryTag();
    if (!this.registryIndex) {
      this.registryIndex = {};
    }
    if (!this.registryIndex.repositories) {
      this.registryIndex.repositories = {};
    }
    if (!this.registryIndex.repositories[name]) {
      this.registryIndex.repositories[name] = [];
    }
    let tags = this.registryIndex.repositories[name];
    if (!_.contains(tags, tag)) {
      tags.push(tag)
      this.registryIndexIsDirty = true;
    }
  }

  // Tracking images that are promoted to Prod registry
  getPromoteRegistryIndexFilename() {
      const fullPath = Path.join(
      this.versionsRepo.getRepoDir(),
      config.versions_files.rdeploy_config_root,
      this.environment.promoteRegistry + '.json'
    );
    return fullPath;
  }

  loadPromoteRegistryIndex() {
    let path = this.getPromoteRegistryIndexFilename();
    this.promoteRegistryIndexIsDirty = false;
    if (!util.fileExists(path)) {
      throw new BuildError(`Promote registry index does not exist: ${path}`);
    }
    this.promoteRegistryIndex = util.readJSON(path);
    assert.ok(this.promoteRegistryIndex);
  }

  savePromoteRegistryIndex() {
    if (this.promoteRegistryIndexIsDirty) {
      util.writeJSON(this.getPromoteRegistryIndexFilename(), this.promoteRegistryIndex);
      this.promoteRegistryIndexIsDirty = false;
      return true;
    }
    return false;
  }
  

  isImagePromoted(project) {
    let name = project.getDockerRepositoryName();
    let tag = project.getDockerRepositoryTag();
    assert.ok(name);
    assert.ok(tag);

    try {
        let promoteRegistryIndex = this.promoteRegistryIndex.repositories[name];
        let isPublished = _.contains(promoteRegistryIndex, tag);
        return isPublished;
    } catch (ex) {
        return false;
    }
}

markImageAsPromoted(project) {
  let name = project.getDockerRepositoryName();
  let tag = project.getDockerRepositoryTag();
  
  if (!this.promoteRegistryIndex) {
    this.promoteRegistryIndex = {};
  }
  if (!this.promoteRegistryIndex.repositories) {
    this.promoteRegistryIndex.repositories = {};
  }
  if (!this.promoteRegistryIndex.repositories[name]) {
    this.promoteRegistryIndex.repositories[name] = [];
  }
  let tags = this.promoteRegistryIndex.repositories[name];
  if (!_.contains(tags, tag)) {
    tags.push(tag);
    this.promoteRegistryIndexIsDirty = true;
  }
}  
}

module.exports = AKSDeployBundle;
