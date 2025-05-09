//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require("assert").strict;
const {log} = require("../../util/ConsoleLogger");
const {Pools} = require("../Pools");
const {BatchOperation} = require("../../util/BatchOperation");
const {EnsuringError} = require("../../util/tk");
const tk = require("../../util/tk");

/**
 * @typedef {Object} TestPoolPodState
 * @property {String} podName
 * @property {Boolean} value
 * @property {Boolean} isCorrect
 */

/**
 * @typedef {Object} TestPoolServiceState
 * @property {String} serviceName
 * @property {String} url
 * @property {TestPoolPodState[]} results
 * @property {Boolean} isCorrect
 */

class TestPoolStateChecker {
  _app;
  _pools;
  /** @member {Map<String, TestPoolServiceState>} */
  _services = new Map();
  _correctTestPoolSetting;
  _unreadyPods = {};

  /**
   * @param {Application} app
   */
  constructor(app) {
    this._app = app;
    this._pools = new Pools(app.saasContext);
  }

  async getCorrectTestpoolSetting() {
    if (!_.isBoolean(this._correctTestPoolSetting)) {
      if (this._app.saasContext.environmentFile.isTestpoolEnabled()) {
        const isProdPool = await this._pools.isProdPool(this._app);
        const isTestPool = await this._pools.isTestPool(this._app);
        if (isProdPool && isTestPool) {
          log.warn('Test-pool mode expected for all services (special case)');
          this._correctTestPoolSetting = true;
        } else {
          this._correctTestPoolSetting = !isProdPool;
        }
      } else {
        this._correctTestPoolSetting = false;
      }
    }
    return this._correctTestPoolSetting;
  }

  setExpectedTestPoolSetting(value) {
    this._correctTestPoolSetting = value;
  }

  async isCorrectSetting(value) {
    await this.getCorrectTestpoolSetting();
    try {
      return value !== null && value !== undefined && tk.parseBoolean(value) === this._correctTestPoolSetting;
    } catch (e) {
      log.warn(e.message);
    }
    return false;
  }

  async ensureTestPoolSetting() {
    const config = await this._app.getConfig();
    const isCorrect = await this.isCorrectSetting(config.testPool);
    if (!isCorrect) {
      const branchName = this._app.getConfigRepoBranch();
      throw new EnsuringError(`Incorrect testPool value: *${config.testPool}* (on branch *${branchName}*)`);
    }
  }

  async addAll(names) {
    let addedCount = 0;
    for (const serviceName of names) {
      if (await this.add(serviceName)) {
        addedCount++;
      }
    }
    return addedCount;
  }

  async add(serviceName) {
    const config = await this._app.getConfig(serviceName);
    const supported = _.get(config, 'serviceInfo.endpointAvailable', false);
    const rootContext = _.get(config, 'deployment.contextPath', `/${serviceName}`)
    if (supported) {
      const url = `http://localhost${rootContext}/internal/serviceInfo`;
      this._services.set(serviceName, {serviceName, url, results: [], isCorrect: false});
      return true;
    } else {
      log.verbose(`Endpoint not available for: ${serviceName}`);
      return false;
    }
  }

  remove(serviceName) {
    this._services.delete(serviceName);
  }

  /**
   * Perform checks one all pods for all services
   * @returns {Promise<PromiseList>}
   */
  async checkAll() {
    const batch = new BatchOperation();
    batch.addAll(this.services);
    return batch.run(async (service) => this._check(service));
  }

  /**
   * @return {TestPoolPodState[]}
   */
  get results() {
    let results = [];
    for (const service of this._services.values()) {
      results = results.concat(service.results);
    }
    return results;
  }

  /**
   * @return {TestPoolServiceState[]}
   */
  get services() {
    return Array.from(this._services.values());
  }

  async _check({serviceName, url}) {
    const service = this._services.get(serviceName);
    const results = service.results = [];
    const pods = await this._app.listPodsByAppName(serviceName, (pods) => {
      const readyPods = [];
      for (const pod of pods) {
        if (pod.isReady) {
          readyPods.push(pod);
        } else {
          const podName = pod.getName();
          if (!this._unreadyPods[podName]) {
            log.warn('[%s]: Pod not ready, skipping test-pool check', podName);
            this._unreadyPods[podName] = pod;
          }
        }
      }
      return readyPods;
    });
    let correctPodCount = 0;
    for (const pod of pods) {
      const podName = pod.getName();
      let value;
      try {
        log.verbose('[%s] EXEC (%s)', podName, url);
        const response = await this._app.k8sClient.exec(pod, ['curl', '-s', url])
        log.verbose(`[%s] EXEC completed`, podName);
        const data = JSON.parse(response.toString());
        value = _.get(data, 'serviceInfo.testPool');
      } catch (e) {
        log.verbose(`[%s] %s`, podName, e.message);
        value = null;
      } finally {
        const isCorrect = await this.isCorrectSetting(value);
        if (isCorrect) {
          correctPodCount++;
        }
        results.push({podName, value, isCorrect});
      }
    }
    service.isCorrect = pods.length && correctPodCount === pods.length;
    return results;
  }
}

module.exports.TestPoolStateChecker = TestPoolStateChecker;