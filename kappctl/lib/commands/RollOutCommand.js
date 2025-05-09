//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require('assert').strict;
const tk = require('../util/tk');
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {EnvironmentFile} = require("../repo/EnvironmentFile");
const {Kind} = require("../k8s/accessors/base/AccessorFactory");
const {log} = require("../util/ConsoleLogger");
const {StatusManager} = require("../saas/management/StatusManager");
const {ApiResultsAccumulator} = require("../k8s/accessors/base/ApiResultsAccumulator");
const {DeploymentManager} = require("../saas/management/DeploymentManager");
const {LogicalError} = require("../util/LogicalError");

module.exports.help = {
  summary: "Deploy resources specified in the environment's rollout request",
  usages: ["[--subset {@pool|version}]"]
}

const PHASE_DEPLOY = 'deploy';
const ROLLOUT_KEY_JOBS = 'rollout.jobs';
const ROLLOUT_KEY_SERVICES = 'rollout.services';
const ROLLOUT_KEY_VERSIONS = 'rollout.versions';

class RollOutCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
  }

  async init(...args) {
    await super.init(...args);
    this.deployManager = new DeploymentManager(this.app);
    this.statusManager = new StatusManager(this.app);
  }

  async run() {
    const env = this.saasContext.environmentFile;
    const subsetConfig = env.getOrCreateSubset(tk.ensureValidString(this.subset));

    assert.ok(subsetConfig, `No subset config for: ${this.subset}`);
    assert.ok(env.get('rollout'), 'No rollout request found');

    if (this.app.usesManagedConfigRepoBranches()) {
      let branchFrom = env.get(EnvironmentFile.ROLLOUT_CONFIG_SOURCE);
      log.assert(branchFrom, 'Rollout request has no: %s', EnvironmentFile.ROLLOUT_CONFIG_SOURCE);
      await this.app.initConfigRepoBranch({sourceRef: branchFrom});
    }

    let commitMessage = 'Roll out progressing';

    try {
      const jobNames = env.get(ROLLOUT_KEY_JOBS, []);
      const jobRunner = (name) => this.deployManager.deployJob(name, PHASE_DEPLOY, this.vars);
      await this._rollout(Kind.Job, jobNames, ROLLOUT_KEY_JOBS, jobRunner);

      Object.assign(subsetConfig, env.get(ROLLOUT_KEY_VERSIONS, {}));
      const serviceNames = _.union(env.get(ROLLOUT_KEY_SERVICES, []), await this.listMissingDeployments());
      const serviceDeployer = (name) => this.deployManager.deployService(name);
      await this._rollout(Kind.Deployment, serviceNames, ROLLOUT_KEY_SERVICES, serviceDeployer);

      commitMessage = 'Roll out complete';
      env.unset('rollout');
    } finally {
      if (!this.saasContext.dryRun) {
        await env.save().checkIn(commitMessage);
      }
    }
  }

  async _rollout(kind, names, rolloutRequestKey, worker) {
    if (names.length) {
      const env = this.saasContext.environmentFile;
      const results = new ApiResultsAccumulator();
      for (const name of names) {
        results.combine(await worker(name));
      }
      results.raiseErrors();
      const resources = results.getResources((r) => r && r.getKind() === kind);
      const dequeueItem = (key, list) => {
        const index = list.indexOf(key);
        if (index > -1) {
          list.splice(index, 1);
          return true;
        }
        return false;
      };
      const onComplete = (resource, status) => {
        if (status && status.isHealthy) {
          const names = env.get(rolloutRequestKey, []);
          const name = resource.getAppName();
          let dequeued = dequeueItem(name, names);
          if (!dequeued) {
            const appName = this.app.applicationNameFor(name);
            dequeued = dequeueItem(appName, names);
          }
          if (dequeued) {
            env.set(rolloutRequestKey, names);
          } else {
            log.error(`Cannot dequeue the completed ${kind} named *${name}* as it was not found in the list: ${rolloutRequestKey}`);
          }
        }
      };
      await this.statusManager.waitUntilAllComplete(resources, {onComplete});
      const incomplete = env.get(rolloutRequestKey, []);
      if (incomplete.length) {
        throw new LogicalError(`Not all ${kind}s completed`);
      }
    } else {
      log.user(`No ${kind}s to roll out`);
    }
  }
}

module.exports.Command = RollOutCommand;
module.exports.RollOutCommand = RollOutCommand;