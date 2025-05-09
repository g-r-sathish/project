//  Copyright (C) Agilysys, Inc. All rights reserved.

const assert = require("assert").strict;
const {Manager} = require("./base/Manager");
const {log} = require("../../util/ConsoleLogger");
const {StatusManager} = require("./StatusManager");
const {BatchOperation} = require("../../util/BatchOperation");
const {Kind} = require("../../k8s/accessors/base/AccessorFactory");
const tk = require("../../util/tk");
const {InboundPool} = require("../InboundPool");
const {Pools} = require("../Pools");
const {TestPoolStateChecker} = require("./TestPoolStateChecker");
const chalk = require("chalk");
const {LogicalError} = require("../../util/LogicalError");
const {HealthcheckManager} = require("./HealthcheckManager");

class PoolManager extends Manager {
  /**
   * @param {Context} saasContext
   */
  constructor(saasContext) {
    super();
    this.saasContext = saasContext;
  }

  async alignTrackedPoolVersions() {
    const env = this.saasContext.environmentFile;
    const pools = new Pools(this.saasContext);
    const trackedVersions = env.get(`pools`);
    let madeChanges = false;
    for (const poolName of ['prod', 'test']) {
      const app = await pools[poolName].getApplication();
      const actualVersion = app.getSubsetVersion();
      const trackedVersion = trackedVersions[poolName];
      if (trackedVersion !== actualVersion) {
        log.warn(`Updating tracked pool version for *${poolName}*: ${trackedVersion} -> ${actualVersion}`)
        trackedVersions[poolName] = actualVersion;
        madeChanges = true;
      }
    }
    if (madeChanges) {
      await env.save().checkIn('Align tracked versions with reality');
    }
  }

  async _ensureConfigServiceUp(app) {
    const healthManager = new HealthcheckManager(app)
    const hc = await healthManager.pingService('config-service');
    if (hc.response.statusCode !== 200) {
      throw new LogicalError(`Cannot reach config-service at ${hc.url}`);
    }
  }

  /**
   * @param {Application} ascendingApp
   * @param {Application} descendingApp
   * @return {Promise<void>}
   */
  async swap(ascendingApp, descendingApp) {
    await this._ensureConfigServiceUp(ascendingApp);
    await this._ensureConfigServiceUp(descendingApp);

    const ascendingSubset = ascendingApp.getSubsetVersion();
    const descendingSubset = descendingApp.getSubsetVersion();
    try {
      log.group(`# [${ascendingSubset}] Setting test-pool-off`);
      await this._ensureTestPoolSwitch(ascendingApp, false);
    } catch (e) {
      log.error(e.message);
      log.user(`[${ascendingSubset}] Setting test-pool-on (error.unwind)`);
      await ascendingApp.testPoolOn();
      throw e;
    } finally {
      log.groupEnd();
    }

    try {
      log.group(`# [${ascendingSubset}] Swapping to receive inbound traffic`);
      const env = this.saasContext.environmentFile;
      env.data.pools.prod = ascendingSubset;
      env.data.pools.test = descendingSubset;
      await env.save().checkIn(`Swapping to: prod=${ascendingSubset}, test=${descendingSubset}`, true)
      await ascendingApp.applyTemplate({templateName: 'k8s-pools.yml.njk'});
    } finally {
      log.groupEnd();
    }

    try {
      log.group(`# [${descendingSubset}] Setting test-pool-on (after swap)`);
      await this._ensureTestPoolSwitch(descendingApp, true);
    } finally {
      log.groupEnd();
    }
  }

  async _ensureTestPoolSwitch(app, enabled) {
    let maxAttempts = 3;
    let attempt = 0;
    let allCorrect = false;

    try {
      log.group(`Updating testPool state`);
      while (++attempt <= maxAttempts && !allCorrect) {
        log.user(`Attempt ${attempt} of ${maxAttempts}`);
        if (enabled) {
          await app.testPoolOn();
        } else {
          await app.testPoolOff();
        }
        allCorrect = await this._waitForTestPoolRefresh(app, enabled);
      }
    } finally {
      log.groupEnd();
    }

    if (!allCorrect) {
      throw new LogicalError(`Services have not refreshed, giving up`);
    }
  }

  async _waitForTestPoolRefresh(app, expectedSetting) {
    const completionTimeoutMinutes = 3;
    const completionTimeoutMillis = completionTimeoutMinutes * tk.ONE_MINUTE_AS_MS;
    const intervalDelay = 15 * tk.ONE_SECOND_AS_MS;
    try {
      log.user(`Waiting for services to refresh testPool state (up to ${completionTimeoutMinutes} minutes)...`);
      const checker = new TestPoolStateChecker(app);
      checker.setExpectedTestPoolSetting(expectedSetting);
      await checker.addAll(app.getAllConfiguredServiceNames());
      let start = new Date();
      let haveLogged = {};

      let allCorrect = false;
      let timedOut = false;
      while (!timedOut && !allCorrect) {
        const elapsedMillis = new Date() - start;
        timedOut = elapsedMillis > completionTimeoutMillis;
        await checker.checkAll();
        let anyIncorrect = false;

        for (const service of checker.services) {
          if (service.results.length) {
            for (const result of service.results) {
              if (result.isCorrect) {
                if (!haveLogged[result.podName]) {
                  const message = chalk.green(`${result.value} (correct)`);
                  log.user(`[${service.serviceName}] ${result.podName}: ${message}`);
                  haveLogged[result.podName] = true;
                }
              } else {
                anyIncorrect = true;
                if (timedOut) {
                  const message = chalk.red(`${result.value} (INCORRECT) - Timeout exceeded: ${completionTimeoutMillis}ms`);
                  log.user(`[${service.serviceName}] ${result.podName}: ${message}`);
                }
              }
            }
          } else {
            log.error(`[${service.serviceName}]: No pods found`);
          }
          if (service.isCorrect) {
            checker.remove(service.serviceName);
          }
        }

        allCorrect = !anyIncorrect;
        if (allCorrect) {
          log.user('All services are correct');
        } else {
          await tk.sleep(intervalDelay);
        }
      }
      return allCorrect;
    } catch (e) {
      log.error(e.message);
      return false;
    }
  }
}

module.exports.PoolManager = PoolManager;