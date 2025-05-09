//  Copyright (C) Agilysys, Inc. All rights reserved.

const assert = require("assert").strict;
const tk = require("../util/tk");
const {Command} = require("./base/Command");
const {InboundPool} = require("../saas/InboundPool");
const {ProvisioningManager} = require("../saas/management/ProvisioningManager");
const {ApiResultsAccumulator} = require("../k8s/accessors/base/ApiResultsAccumulator");
const {DeploymentManager} = require("../saas/management/DeploymentManager");
const {StatusManager} = require("../saas/management/StatusManager");
const {Kind} = require("../k8s/accessors/base/AccessorFactory");
const {PoolManager} = require("../saas/management/PoolManager");
const {log} = require("../util/ConsoleLogger");
const {Application} = require("../saas/Application");
const {Pools} = require("../saas/Pools");

module.exports.help = {
  summary: "Conclude the roll forward workflow",
  usages: ["[--skip-jobs]"]
}

const OPT_SKIP_JOBS = '--skip-jobs';

class ConcludeCommand extends Command {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_SKIP_JOBS] = true;
    this.pools = undefined;
  }

  async run() {
    const poolManager = new PoolManager(this.saasContext);
    const pools = new Pools(this.saasContext)
    const prod = await pools.prod.getApplication();
    const test = await pools.test.getApplication();

    // Ensure we're in the rolled-forward state
    await poolManager.alignTrackedPoolVersions();
    const prodVersion = tk.versionToNumber(prod.getSubsetVersion());
    const testVersion = tk.versionToNumber(test.getSubsetVersion());
    assert.ok(prodVersion > testVersion, `Production is not ahead of test pool`);

    // Run post-deployment jobs
    if (!this.isOptionPresent(OPT_SKIP_JOBS)) {
      const configFile = this.saasContext.configFile;
      const definedJobs = configFile.get('deploy.jobs.conclude', []);
      const results = new ApiResultsAccumulator();
      const deployManager = new DeploymentManager(prod);
      for (let jobName of Object.keys(definedJobs)) {
        results.combine(await deployManager.deployJob(jobName, 'conclude'));
      }
      results.raiseErrors();

      // Wait for jobs to complete successfully
      const statusManager = new StatusManager(prod);
      const jobs = results.getResources((r) => Kind.Job === r.getKind());
      await statusManager.waitUntilAllComplete(jobs);
    }

    // Retire test pool
    let deployments = await test.listDeployments();
    if (deployments.length) {
      const promiseList = await test.spinDown(deployments);
      const statusText = 'Retired';
      for (let apiResponse of promiseList.results) {
        let resource = apiResponse.resource;
        log.user('[%s] %s - *%s*', resource.kind, resource.getName(), statusText);
      }
      promiseList.raiseErrors();
    }

    // Prepare next subset
    const provisioner = new ProvisioningManager(this.saasContext);
    await provisioner.promotePools();
  }
}

module.exports.Command = ConcludeCommand;
module.exports.ConcludeCommand = ConcludeCommand;