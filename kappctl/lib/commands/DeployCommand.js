//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require('assert').strict;
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {LogicalError} = require("../util/LogicalError");
const {log} = require("../util/ConsoleLogger");
const {DeploymentManager} = require("../saas/management/DeploymentManager");
const {ApiResultsAccumulator} = require("../k8s/accessors/base/ApiResultsAccumulator");
const {Kind} = require("../k8s/accessors/base/AccessorFactory");
const {StatusManager} = require("../saas/management/StatusManager");
const {TestPoolStateChecker} = require("../saas/management/TestPoolStateChecker");
const {ConfigRepoBranch} = require("../saas/ConfigRepoBranch");

module.exports.help = {
  summary: "Deploy application services",
  usages: ["[--subset {@pool|version}] {--missing | --all | names...} [--image-tag] [--kind {kind}] [--wait]"]
}

const OPT_ALL = '--all';
const OPT_KIND = '--kind';
const OPT_MISSING = '--missing';
const OPT_WAIT = '--wait';
const OPT_INIT = '--init';
const OPT_IMAGE_TAG = '--image-tag';

class DeployCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
    this.spec.options[OPT_KIND] = true;
    this.spec.options[OPT_IMAGE_TAG] = true;
    this.spec.flags[OPT_ALL] = true;
    this.spec.flags[OPT_MISSING] = true;
    this.spec.flags[OPT_WAIT] = true;
    this.spec.flags[OPT_INIT] = true;
  }

  async run() {
    const branchName = this.app.getConfigRepoBranch();
    if (!await this.app.doesConfigRepoBranchExist(branchName)) {
      throw new LogicalError(`Config repo branch does not exist: ${branchName}`);
    }
    const configFile = this.saasContext.configFile;
    const kind = this.getOption(OPT_KIND);
    let serviceNameList;

    assert.equal(encodeURIComponent(branchName), branchName, `Branch name is not a valid URI component: ${branchName}`)

    if (this.isOptionPresent(OPT_ALL)) {
      assert.equal(this.args.length, 0);
      serviceNameList = configFile.get('deploy.services.saas', []);
    } else if (this.isOptionPresent(OPT_MISSING)) {
      assert.equal(this.args.length, 0);
      serviceNameList = await this.listMissingDeployments();
    } else {
      serviceNameList = this.args;
    }

    const imageTag = this.getOption(OPT_IMAGE_TAG);
    if (imageTag) {
      for (let serviceName of serviceNameList) {
        this.serviceImageTags[serviceName] ??= imageTag; // Don't override specific tags
      }
    }

    const hasSpecifiedTags = Object.keys(this.serviceImageTags).length > 0;

    if (this.app.isStandaloneSubset()) {
      log.user('# Standalone deployment');
      if (hasSpecifiedTags) {
        const branchName = this.app.getConfigRepoBranch();
        log.user(`Updating services with the specified tags (on branch: ${branchName})`);
        const configRepoBranch = new ConfigRepoBranch(this.app);
        await configRepoBranch.writeImageTags(this.serviceImageTags);
      }
    } else {
      if (hasSpecifiedTags) {
        throw new LogicalError('Service tags are only supported for standalone deployments');
      }
      try {
        log.group('# Validating pool configuration');

        log.user('Checking test pool setting');
        const testPoolStateChecker = new TestPoolStateChecker(this.app);
        await testPoolStateChecker.ensureTestPoolSetting();

        log.user('Checking settings in config-repo branch');
        const configRepoBranch = new ConfigRepoBranch(this.app);
        await configRepoBranch.writeSubsetConfig();

        log.user('Checking node selectors');
        await this.app.reconcileNodePoolSelectors();
      } finally {
        log.groupEnd();
      }
    }

    const deploymentManager = new DeploymentManager(this.app);
    const initComponents = [DeploymentManager.SERVICE_COMPONENT];

    // Used with Istio subset selectors
    if (false) {
      initComponents.push(DeploymentManager.MESH_COMPONENT);
    }

    if (this.isOptionPresent(OPT_INIT)) {
      for (let serviceName of serviceNameList) {
        for (const component of initComponents) {
          const initResults = await deploymentManager.init(serviceName, component);
          initResults.raiseErrors();
        }
      }
    }

    const results = new ApiResultsAccumulator();

    for (let serviceName of serviceNameList) {
      results.combine(await deploymentManager.deployService(serviceName, kind));
    }
    results.raiseErrors();

    if (this.isOptionPresent(OPT_WAIT)) {
      const statusManager = new StatusManager(this.app);
      const resources = results.getResources((r) => Kind.Deployment === r.getKind());
      await statusManager.waitUntilAllComplete(resources);
    }
  }
}

module.exports.Command = DeployCommand;
module.exports.DeployCommand = DeployCommand;
