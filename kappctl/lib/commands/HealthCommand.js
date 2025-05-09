//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const {log} = require("../util/ConsoleLogger");
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {HealthcheckManager} = require("../saas/management/HealthcheckManager");
const {StatusManager} = require("../saas/management/StatusManager");
const {BatchOperation} = require("../util/BatchOperation");
const {LogicalError} = require("../util/LogicalError");
const {subset} = require("semver");

module.exports.help = {
  summary: "Application health",
  usages: [
    "[--subset {subset}] --healthcheck {--all | names...}",
    "[--subset {subset}] --health-details {--all | names...}",
    "[--subset {subset}] --versions {--all | names...}",
    "[--subset {subset}] --test-pool {--all | names...}",
    "[--subset {subset}] --deployments [--wait] {--all | names...}"
  ]
}

const OPT_ALL = '--all';
const OPT_HEALTHCHECK = '--healthcheck';
const OPT_VERSIONS = '--versions';
const OPT_DEPLOYMENTS = '--deployments';
const OPT_TEST_POOL = '--test-pool';
const OPT_HEALTH_DETAILS = '--health-details';
const OPT_WAIT = '--wait';

class HealthCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_ALL] = true;
    this.spec.flags[OPT_HEALTHCHECK] = true;
    this.spec.flags[OPT_VERSIONS] = true;
    this.spec.flags[OPT_DEPLOYMENTS] = true;
    this.spec.flags[OPT_TEST_POOL] = true;
    this.spec.flags[OPT_HEALTH_DETAILS] = true;
    this.spec.flags[OPT_WAIT] = true;
  }

  async init(...args) {
    await super.init(...args)
  }

  async run() {
    const configFile = this.saasContext.configFile;
    const names = this.isOptionPresent(OPT_ALL) ? configFile.get('deploy.services.saas', []) : this.args;
    let hasRun = false;

    if (this.isOptionPresent(OPT_HEALTHCHECK)) {
      hasRun = true;
      const hcManager = new HealthcheckManager(this.app);
      await hcManager.checkServices(names);
    }

    if (this.isOptionPresent(OPT_VERSIONS)) {
      hasRun = true;
      const deployments = await this.listDeployments();
      if (deployments.length) {
        log.group(`# Service versions (subset=${this.app.subsetName})`);
        for (const deployment of deployments) {
          try {
            const container = deployment.definition.spec.template.spec.containers[0];
            if (container && container.env) {
              const versionEntry = _.find(container.env, (entry) => entry.name === "serviceInfo_version");
              log.user('[%s]: %s', deployment.getName(), versionEntry.value);
            }
          } catch (e) {
            log.warn('[%s] %s', deployment.getName(), e.message)
          }
        }
        log.groupEnd();
      }
    }

    if (this.isOptionPresent(OPT_TEST_POOL)) {
      hasRun = true;
      const hcManager = new HealthcheckManager(this.app);
      await hcManager.reportTestPoolState(names);
    }

    if (this.isOptionPresent(OPT_HEALTH_DETAILS)) {
      hasRun = true;
      const hcManager = new HealthcheckManager(this.app);
      await hcManager.reportHealthDetails(names);
    }

    if (this.isOptionPresent(OPT_DEPLOYMENTS)) {
      hasRun = true;
      const statusManager = new StatusManager(this.app);
      const deployments = await this.listDeployments();
      if (this.isOptionPresent(OPT_WAIT)) {
        const promiseList = await statusManager.waitUntilAllComplete(deployments);
        promiseList.raiseErrors();
      } else {
        const batch = new BatchOperation(deployments);
        const batchResults = await batch.runChunked(6, async (deployment) => {
          return statusManager.getResourceStatus(deployment).then((status) => status.logStatus());
        })
        batchResults.raiseErrors();
      }
    }

    if (!hasRun) {
      throw new LogicalError('No check specified (see --help)');
    }
  }

}

module.exports.Command = HealthCommand;
module.exports.HealthCommand = HealthCommand;