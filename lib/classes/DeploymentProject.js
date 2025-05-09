const _ = require('underscore');

const Artifact = require('./Artifact');
const BuildError = require('./BuildError');
const BuildState = require('./BuildState');
const config = require('../common/config');
const path = require('path');
const {Project} = require('./Project');
const util = require('../common/util');

class DeploymentProject extends Project {
  static TYPE_SERVICE = 'SERVICE';
  static TYPE_JOB = 'JOB';

  constructor(bundle, definition, options, instanceName) {
    super();

    options = _.extend({shallowClone: true}, options);
    this.bundle = bundle;
    this.configVariables = undefined;
    this.markedForDeployment = false;
    this.artifactSpecs = [];
    this.pipelineDefinitions = {};
    this.pipelineValues = {};

    if (definition) {
      this.options = _.extend({
        workDir: config.workDir
      }, options);
      this.definition = _.extend({
        mainline: config.mainline_branch_name
      }, definition);
      this.instanceName = instanceName;
    }
  }

  getName() {
    return this.instanceName;
  }

  getType() {
    return this.definition.type;
  }

  getAppName() {
    return this.definition.app_name;
  }

  markForDeployment() {
    return this.markedForDeployment = true;
  }

  isMarkedForDeployment() {
    return !!this.markedForDeployment;
  }

  initAsync(scriptPath, branch) {
    let project = this;
    let args = [this.getRepoUrl(), this.getRepoPath(), branch];
    return new Promise((resolve, reject) => {
      util.execFileAsync(scriptPath, args, config.workDir)
        .then((stdout) => resolve(project, stdout), (stdout) => reject(project))
    });
  }

  setPipelineDefinitions(pipelines) {
    return this.pipelineDefinitions = pipelines;
  }

  getPipelineDefinition(pipelineType) {
    if (!this.definition.pipelines) {
      throw new BuildState.BuildNotFoundError();
    }
    let pipelineName = this.definition.pipelines[pipelineType];
    if (!pipelineName) {
      throw new BuildState.BuildNotFoundError();
    }
    let pipelineDefinition = typeof(pipelineName) === 'string'
      ? this.bundle.getPipelineDefinition(pipelineName)
      : pipelineName;
    if (!pipelineDefinition) {
      throw new BuildState.BuildDefinitionNotFoundError();
    }
    return pipelineDefinition;
  }

  getBuild(pipelineType) {
    let pipelineDefinition = this.getPipelineDefinition(pipelineType);
    let parameterValues = _.extend({}, this.definition.parameters, this.pipelineValues);
    let dockerTagSuffix = this.getDockerTagSuffix();
    if (dockerTagSuffix) {
      parameterValues['dockerTagSuffix'] = dockerTagSuffix;
    }
    return this.bundle.createBuildState(this.getName(), pipelineDefinition, parameterValues);
  }

  resolveArtifactReferences(artifactDefintions) {
    this.artifactSpecs = [];
    if (this.definition.artifacts) {
      for (var id of this.definition.artifacts) {
        let artifactDefinition = artifactDefintions[id];
        if (!artifactDefinition) {
          throw new BuildError(`Cannot resolve artifact: ${id} (deployments.${this.instanceName}.artifacts)`);
        }
        this.artifactSpecs.push(artifactDefinition);
      }
    }
  }

  getDockerRepositoryName() {
    return this.definition.docker_repository_name;
  }

  resolvePipelineVars(versions) {
    const pipelineVars = this.definition['pipeline_vars'];
    for (let key of Object.keys(pipelineVars)) {
      const versionsKey = pipelineVars[key];
      this.pipelineValues[key] = versions[versionsKey];
    }
  }

  getServiceVersion() {
    return this.pipelineValues['serviceVersion'];
  }

  getDockerTagSuffix() {
    const dockerTagSuffix = config._all['docker-tag-suffix'] || '';
    if (dockerTagSuffix) {
      return '-' + dockerTagSuffix.replace(/^[-_.:]+/, '');
    }
  }

  getDockerRepositoryTag() {
    let version = this.getServiceVersion();
    const dockerTagSuffix = this.getDockerTagSuffix();

    if (dockerTagSuffix) {
      const pipelineDefinition = this.getPipelineDefinition('image');
      if (pipelineDefinition.parameters.includes('dockerTagSuffix')) {
        version += dockerTagSuffix;
      }
    }

    return version ? version.toLowerCase() : version;
  }

  getArtifacts(versions) {
    let result = [];
    for (var spec of this.artifactSpecs) {
      let artifact = new Artifact(spec, versions);
      result.push(artifact);
    }
    return result;
  }

  alwaysDeploySnapshots() {
    return !this.definition.immutable_snapshots;
  }
}

module.exports = DeploymentProject;
