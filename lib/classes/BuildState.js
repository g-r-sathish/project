const azureDevOps = require('../common/azure-devops').azureDevOpsService;
const config = require('../common/config');
const errorMaker = require('custom-error');
const util = require('../common/util');

class BuildState {

  static BUILD_RESULT_FAILED_TO_START = "failedToStart";
  static BUILD_RESULT_NOT_FOUND = "failedNotFound"
  static BUILD_RESULT_FAILED = "failed";
  static BUILD_STATUS_COMPLETED = "completed";
  static BUILD_RESULT_SUCCEEDED = "succeeded";

  static BuildNotFoundError = errorMaker('BuildNotFoundError');
  static BuildDefinitionNotFoundError = errorMaker('BuildDefinitionNotFoundError');
  static MissingParameterError = errorMaker('MissingParameterError');

  constructor(json) {
    this.buildId = undefined;
    this.name = undefined;
    this.parameters = undefined;
    this.pipelineId = undefined;
    this.projectName = undefined;
    this.result = undefined;
    this.status = undefined;
    this.webUrl = undefined;
    if (json) {
      for (let key in this) {
        if (this.hasOwnProperty(key)) {
          this[key] = json[key];
        }
      }
    }
  }

  create(projectName, pipeline, parameters) {
    this.projectName = projectName
    this.pipelineId = pipeline.id;
    this.parameters = parameters;
    return this;
  }

  async run() {
    if (!config._all.commit) return this;
    const response = await azureDevOps.runPipeline(this.pipelineId, this.parameters, config._all['devops-pipelines-branch']);
    return this.init(response);
  }

  // @param response https://docs.microsoft.com/en-us/rest/api/azure/devops/pipelines/runs/run%20pipeline?view=azure-devops-rest-6.0#run
  init(response) {
    this.buildId = response.id;
    this.name = response.name;
    this.status = response.state;
    this.result = response.result;
    this.webUrl = response._links.web.href;
    return this;
  }

  // @param response https://docs.microsoft.com/en-us/rest/api/azure/devops/build/builds/get?view=azure-devops-rest-6.0#build
  update(response) {
    if (response.id !== this.buildId) {
      throw new Error('Build ids do not match');
    }
    this.status = response.status;
    this.result = response.result;
    return this;
  }

  async refresh() {
    if (!config._all.commit) return;
    try {
      let response = await azureDevOps.getBuild(this.buildId);
      if (response) {
        this.update(response);
      } else {
        this.status = BuildState.BUILD_STATUS_COMPLETED;
        this.result = BuildState.BUILD_RESULT_NOT_FOUND;
      }
    } catch (ex) {
      util.narrateln('Ignoring possible 503 exception');
      util.narrateln(ex);
    }
  };

  hasCompleted() {
    return this.status && this.status === BuildState.BUILD_STATUS_COMPLETED;
  }

  hasSucceeded() {
    return this.result && this.result === BuildState.BUILD_RESULT_SUCCEEDED;
  }

  hasFailed() {
    return this.result && this.result.match(BuildState.BUILD_RESULT_FAILED);
  }

}

module.exports = BuildState;
