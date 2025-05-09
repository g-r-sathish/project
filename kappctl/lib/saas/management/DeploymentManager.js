//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require('assert').strict;
const {Manager} = require("./base/Manager");
const {log} = require("../../util/ConsoleLogger");
const tk = require("../../util/tk");
const {ApiResultsAccumulator} = require("../../k8s/accessors/base/ApiResultsAccumulator");
const {YAMLFile} = require("../../repo/YAMLFile");
const util = require("util");
const {BatchOperation} = require("../../util/BatchOperation");
const {LogicalError} = require("../../util/LogicalError");

class DeploymentManager extends Manager {
  static SERVICE_COMPONENT = 'saas';
  static MESH_COMPONENT = 'mesh';

  constructor(app) {
    super();
    /** @member {Application} */
    this.app = app;
  }

  /**
   * Deploy jobs
   * @param jobName
   * @param phase
   * @param vars
   * @return {Promise<ApiResultsAccumulator>}
   */
  async deployJob(jobName, phase, vars = {}) {
    log.group(`# ${jobName}`);

    const app = this.app;
    const configFile = app.saasContext.configFile;
    const templates = configFile.get('templates.deploy.job', []);
    const jobsByPhase = configFile.get('deploy.jobs', []);
    const definedJobs = jobsByPhase[phase];
    const args = definedJobs[jobName] || [];

    assert.ok(definedJobs, `Phase does not have any jobs: ${phase}`)
    assert.ok(Object.keys(definedJobs).includes(jobName), `Unknown job: ${jobName}`);

    const context = {};
    tk.overlay(context, await app.getRolloutContext());
    tk.overlay(context, {rollout: {phase: phase, vars: vars}});
    tk.overlay(context, {deployment: {args: args}});

    const branchName = app.getConfigRepoBranch();
    const validSubsets = [app.getSubsetVersion()];
    await this._validateSubsetVersion(jobName, branchName, validSubsets, context);
    const results = await this._deploy(jobName, templates, context, branchName);

    log.groupEnd();
    return results;
  }

  /**
   * @param serviceName
   * @param component
   * @return {Promise<ApiResultsAccumulator>}
   */
  async init(serviceName, component) {
    const configFile = this.app.saasContext.configFile;
    const templates = configFile.get(`templates.init.${component}`, []);
    return this._deployService(`Initializing ${component}`, serviceName, templates);
  }

  /**
   * @param serviceName
   * @param {String?} kind Only apply CRDs of this Kind
   * @return {Promise<ApiResultsAccumulator>}
   */
  async deployService(serviceName, kind) {
    const configFile = this.app.saasContext.configFile;
    const templates = configFile.get('templates.deploy.saas', []);
    return this._deployService('Deploying', serviceName, templates, kind);
  }

  /**
   * @private
   * @param {string} action For display purposes
   * @param serviceName
   * @param templates
   * @param {String?} kind Only apply CRDs of this Kind
   * @return {Promise<ApiResultsAccumulator>}
   * @private
   */
  async _deployService(action, serviceName, templates, kind) {
    log.group(`# ${action}: ${serviceName}`);

    const app = this.app;
    const context = await app.getRolloutContext();

    let validSubsets;
    let branchName;
    const configFile = app.saasContext.configFile;
    const subsetServices = configFile.get('deploy.services.subset', []);
    const realServiceName = app.serviceNameFor(serviceName);
    if (subsetServices.includes(realServiceName)) {
      branchName = app.getConfigRepoBranchStandalone();
      validSubsets = ['prod', 'test'];
      log.user(`Using upstream config-repo branch: *${branchName}*`);
    } else {
      const subset = app.getSubsetVersion();
      const saasServices = configFile.get('deploy.services.saas', []);
      if (saasServices.includes(realServiceName)) {
        branchName = app.getConfigRepoBranch();
        validSubsets = [subset];
      } else {
        branchName = app.getConfigRepoBranchStandalone();
        validSubsets = ['prod']; // stand-alone services 'prod'
        log.user(`Using stand-alone (upstream) config-repo branch: *${branchName}*`);
      }
    }

    await this._validateSubsetVersion(serviceName, branchName, validSubsets, context);
    const results = await this._deploy(serviceName, templates, context, branchName, kind);

    log.groupEnd();
    return results;
  }

  async _validateSubsetVersion(serviceName, branchName, validSubsets, context) {
    const app = this.app;
    const config = await app.getConfig(serviceName, branchName, context);
    const deploymentSubset = _.get(config, 'deployment.version');

    if (!_.includes(validSubsets, deploymentSubset)) {
      const message = `[${serviceName}]: Deployment version (${deploymentSubset}) must be one of: ${validSubsets.join(', ')}`;
      throw new LogicalError(message);
    }

    if (deploymentSubset !== context.rollout.subset_version) {
      const message = `[${serviceName}]: Version mismatch: deployment.version=${deploymentSubset} != subset_version=${context.rollout.subset_version}`;
      throw new LogicalError(message);
    }
  }

  /**
   * Apply templates for a given application
   * @private
   * @param serviceName Service name as known to stash/docker-registry
   * @param templates Names of k8s templates in config-repo
   * @param context Rollout context
   * @param branchName
   * @param {String?} kind Only apply CRDs of this Kind
   * @return {Promise<ApiResultsAccumulator>}
   */
  async _deploy(serviceName, templates, context, branchName, kind = undefined) {
    const app = this.app;
    const config = await app.getConfig(serviceName, branchName, context);

    tk.ensureValidString(_.get(config, 'deployment.name'), `No config for ${serviceName}?`);

    const includes = _.get(config, 'deployment.k8s.manifests', templates);
    const excludes = _.get(config, 'deployment.k8s.excludes');
    const effectiveTemplates = _.difference(includes, excludes);
    const results = new ApiResultsAccumulator();

    for (let templateName of effectiveTemplates) {
      log.group(`! ${templateName}`);
      const manifest = await app.renderTemplate(templateName, serviceName, branchName, context);
      const resources = await app.makeResources(manifest, kind);
      let promiseList;

      if (app.saasContext.dryRun) {
        promiseList = await this._writeToFile(app, resources)
      } else if (app.saasContext.bulkApply) {
        log.warn('Bulk apply is not yet supported');
        promiseList = await app.applyResources(resources);
      } else {
        promiseList = await app.applyResources(resources);
      }

      results.add(promiseList);
      log.groupEnd();
    }

    return results;
  }

  async _writeToFile(app, resources) {
    const batch = new BatchOperation(resources);
    return batch.runEach(async (resource) => {
      const dir = tk.mkdirs(util.format('%s/%s', app.saasContext.manifestOutputPath, resource.getKind()))
      const path = util.format('%s/%s.yml', dir, resource.getName());
      const file = YAMLFile.newFile(path, resource.definition);
      log.user('Wrote manifest to: %s', file.path);
      return file;
    })
  }
}

module.exports.DeploymentManager = DeploymentManager;
