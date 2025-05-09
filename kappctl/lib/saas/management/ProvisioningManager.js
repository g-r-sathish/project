//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require("assert").strict;
const tk = require("../../util/tk");
const chalk = require("chalk");
const {log} = require("../../util/ConsoleLogger");
const {Manager} = require("./base/Manager");
const {InboundPool} = require("../InboundPool");
const {DeploymentManager} = require("./DeploymentManager");
const {ApiResultsAccumulator} = require("../../k8s/accessors/base/ApiResultsAccumulator");
const {LogicalError} = require("../../util/LogicalError");
const {Pools} = require("../Pools");
const {EnvironmentFile} = require("../../repo/EnvironmentFile");

class ProvisioningManager extends Manager {
  constructor(saasContext) {
    super();
    this.saasContext = saasContext;
    this.pools = new Pools(saasContext);
  }

  async promotePools() {
    const env = this.saasContext.environmentFile;

    if (!env.isTestpoolEnabled()) {
      throw new LogicalError('Testpool not enabled');
    }

    const prodSubset = await this.pools.prod.getSubsetVersion();
    const prodVersion = tk.versionToNumber(prodSubset);
    const nextSubset = env.getImplicitSubset();
    const nextVersion = tk.versionToNumber(nextSubset);
    assert.ok(nextVersion > prodVersion, `Next is not ahead of production`);
    env.set('pools.prod', prodSubset);
    env.set('pools.test', nextSubset);
    await env.save().checkIn('Promote pools');

    await this.initEnvironmentSubset(nextSubset, prodSubset);
    await this.initConfigRepo(nextSubset);

    try {
      log.group(`# Initializing routes for ${nextSubset}`);
      await this.subsetInit(nextSubset);
      // Part of Istio sidecar routing
      // await this.subsetInitAppMesh(nextSubset);
      await this.applyTemplates('templates.promote.pools', nextSubset);
    } finally {
      log.groupEnd();
    }
  }

  async initEnvironmentSubset(subset, prodSubset) {
    const env = this.saasContext.environmentFile;
    const prodConfig = env.get(['subsets', prodSubset], {});
    const config = Object.assign({}, prodConfig);
    delete config[EnvironmentFile.SUBSET_CONFIG_BRANCH];
    env.set(['subsets', subset], config);
    env.reconcileNodePoolSelectors();
    await env.save().checkIn('Prepare next subset version');
  }

  async initPools() {
    const env = this.saasContext.environmentFile;
    let subset = env.get('pools.prod', 'v1');
    return this.applyTemplates('templates.init.pools', subset);
  }

  async clusterInit() {
    const env = this.saasContext.environmentFile;
    let subset = env.get('pools.prod', 'v1');
    await this.initConfigRepo(subset);
    return this.applyTemplates('templates.init.cluster', subset);
  }

  async initConfigRepo(subset) {
    const app = await this.pools.selectApplication(subset);
    return app.initConfigRepoBranch();
  }

  async subsetInit(subset) {
    assert.ok(!_.includes(['prod', 'test'], subset),
      `The reserved subset '${subset}' is not something that can be initialized.`);
    return this.applyTemplates('templates.init.subset', subset);
  }

  async subsetInitAppMesh(subset) {
    assert.ok(!_.includes(['prod', 'test'], subset),
      `The reserved subset '${subset}' is not something that can be initialized.`);
    const app = await this.pools.selectApplication(subset);
    return this.meshInit(app);
  }

  async meshInit(app) {
    return this._servicesInit(app, DeploymentManager.MESH_COMPONENT);
  }

  async servicesInit() {
    const app = await this.pools.selectApplication();
    return this._servicesInit(app, DeploymentManager.SERVICE_COMPONENT);
  }

  async _servicesInit(app, component) {
    const configFile = this.saasContext.configFile;
    const serviceNameList = configFile.get('deploy.services.saas', []);
    const deploymentManager = new DeploymentManager(app);
    const results = new ApiResultsAccumulator();
    for (let serviceName of serviceNameList) {
      results.combine(await deploymentManager.init(serviceName, component));
    }
    results.raiseErrors();
    return results;
  }

  async applyTemplates(configKey, subset) {
    const config = this.saasContext.configFile;
    const app = await this.pools.selectApplication(subset);
    assert.ok(app, `No inbound pool for: ${subset}`);

    let templates = config.get(tk.ensureValidString(configKey));
    let branchName = app.getConfigRepoBranch();
    let context = await app.getRolloutContext();
    log.user(`Using config-repo branch: *${branchName}*`);

    for (let templateName of templates) {
      log.user(chalk.bold(templateName));
      const params = {templateName, branchName, context};
      const promiseList = await app.applyTemplate(params);
      promiseList.raiseErrors();
    }
  }
}

module.exports.ProvisioningManager = ProvisioningManager;