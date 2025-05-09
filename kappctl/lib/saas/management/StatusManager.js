//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const chalk = require('chalk');
const tk = require("../../util/tk");
const {log, LOG_LEVEL} = require("../../util/ConsoleLogger");
const {Manager} = require("./base/Manager");
const {StateManagementResource} = require('../../k8s/resources/base/StateManagementResource');
const {BatchOperation} = require("../../util/BatchOperation");
const {Kind} = require("../../k8s/accessors/base/AccessorFactory");
const {LoopTimeoutError} = require("../../util/tk");

const DEFAULT_WAIT = {
  timeoutMs: 20 * tk.ONE_MINUTE_AS_MS,
  restMs: 5 * tk.ONE_SECOND_AS_MS
}

class StatusManager extends Manager {
  constructor(app) {
    super();
    this.app = app;
  }

  /**
   * @return {Promise<DeploymentResource[]>}
   */
  async getUnhealthyDeployments() {
    const app = this.app;
    const statuses = await this.getResourceStatusAll(await app.listDeployments());
    const unhealthy = _.filter(statuses.results, (status) => !status.isHealthy);
    if (unhealthy.length > 0) {
      log.group(`Unhealthy services`);
      for (const status of unhealthy) {
        status.logStatus();
      }
      log.groupEnd();
    } else {
      log.info(`All ${statuses.results.length} services are healthy`);
    }
    return unhealthy;
  }

  /**
   * @return {Promise<string[]>}
   */
  async getMissingDeployments() {
    const app = this.app;
    const missing = [];
    const serviceNameList = this.app.getAllConfiguredServiceNames();
    const batch = new BatchOperation(serviceNameList);
    const promiseList = await batch.run(async (serviceName) => {
      const accessor = this.app.saasContext.k8sClient.getAccessor(Kind.Deployment);
      const deploymentName = `${serviceName}-${app.subset}`;
      if (!await accessor.get(deploymentName)) {
        missing.push(serviceName);
        log.info('[%s] Missing', deploymentName);
      }
    });
    promiseList.raiseErrors();
    if (!missing.length) {
      log.info(`All ${serviceNameList.length} deployments exist`);
    }
    return missing;
  }

  async waitUntilAllComplete(resources, {wait, onComplete}={wait:DEFAULT_WAIT, onComplete:_.noop}) {
    const waitList = new BatchOperation(resources);
    log.group('# Waiting for completions');
    await tk.sleep(5 * tk.ONE_SECOND_AS_MS); // Initial pause to allow k8s time to begin (hack for occasional completed result before it starts)
    const promiseList = await waitList.run(async (resource) => {
      const status = await this.waitUntilComplete(resource, wait);
      await onComplete(resource, status);
    });
    promiseList.raiseErrors();
    log.groupEnd();
    return promiseList;
  }

  /**
   * @param resource
   * @param wait
   * @return {Promise<StateManagementResource|void>}
   */
  async waitUntilComplete(resource, wait=DEFAULT_WAIT) {
    const startTime = new Date();
    const name = resource.getName();
    const kind = resource.getKind();
    const format = `[${kind}] ${name} %s`;
    try {
      log.user(format, 'Status polling started');
      const status = await tk.doUntil(async () => {
        log.verbose(format, `Getting status (+${tk.elapsedTime(startTime)})`);
        const status = await this.getResourceStatus(resource);
        if (log.enabled(LOG_LEVEL.DEBUG)) {
          status.logStatus();
        }
        return status.isComplete ? status : false;
      }, wait.timeoutMs, wait.restMs);
      if (status.isComplete) {
        let outcome = chalk.green('Okay');
        if (!status.isHealthy) {
          outcome = chalk.red('Unhealthy');
          status.logStatus();
        }
        log.user(format, `${chalk.bold('Completed')} - ${outcome}`);
        return status;
      }
      return undefined;
    } catch (e) {
      if (e instanceof LoopTimeoutError) {
        log.user(format, chalk.red(e.message));
      } else {
        throw e;
      }
    }
  }

  async getResourceStatusAll(resources) {
    const batch = new BatchOperation(resources);
    const batchResults = await batch.run(async (deployment) => {
      return this.getResourceStatus(deployment);
    })
    batchResults.raiseErrors();
    return batchResults;
  }

  /**
   * @param resource
   * @return {Promise<StateManagementResource>}
   */
  async getResourceStatus(resource) {
    const accessor = this.app.k8sClient.getAccessorFor(resource);
    return accessor.status(resource.getName());
  }
}

module.exports.StatusManager = StatusManager;