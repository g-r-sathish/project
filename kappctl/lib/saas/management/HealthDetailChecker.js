//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const urlJoin = require('url-join');
const assert = require("assert").strict;
const {log} = require("../../util/ConsoleLogger");
const {Pools} = require("../Pools");
const {BatchOperation} = require("../../util/BatchOperation");
const {EnsuringError} = require("../../util/tk");

/**
 * @typedef {Object} PodHealthDetails
 * @property {String} podName
 * @property {Object[]} value
 * @property {Boolean} isHealthy
 */

/**
 * @typedef {Object} ServiceHealthDetails
 * @property {String} serviceName
 * @property {String} url
 * @property {PodHealthDetails[]} results
 * @property {Boolean} isHealthy
 */

class HealthDetailChecker {
  _app;
  _pools;
  /** @member {Map<String, ServiceHealthDetails>} */
  _services = new Map();

  /**
   * @param {Application} app
   */
  constructor(app) {
    this._app = app;
    this._pools = new Pools(app.saasContext);
  }

  async isHealthy(details) {
    if (details === null) {
      return false;
    }
    const anyUnhealthy = _.find(details, (healthCheck) => healthCheck.healthy === false);
    return !anyUnhealthy;
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
    const healthProbe = _.get(config, 'deployment.probes.liveness'); // TODO - Update when refactor of probes happens
    const rootContext = _.get(config, 'deployment.contextPath', `/${serviceName}`)
    if (healthProbe) {
      const detailsProbe = /\/details$/.test(healthProbe) ? healthProbe : `${healthProbe}/details`;
      const url = urlJoin(`http://localhost`, detailsProbe);
      this._services.set(serviceName, {serviceName, url, results: [], isHealthy: false});
      return true;
    } else {
      log.verbose(`Health probe not available for: ${serviceName}`);
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
   * @return {PodHealthDetails[]}
   */
  get results() {
    let results = [];
    for (const service of this._services.values()) {
      results = results.concat(service.results);
    }
    return results;
  }

  /**
   * @return {ServiceHealthDetails[]}
   */
  get services() {
    return Array.from(this._services.values());
  }

  /**
   *
   * @param serviceName
   * @param url
   * @returns {PodHealthDetails}
   * @private
   */
  async _check({serviceName, url}) {
    const service = this._services.get(serviceName);
    const results = service.results = [];
    const pods = await this._app.listPodsByAppName(serviceName);
    let healthyPodCount = 0;
    for (const pod of pods) {
      const podName = pod.getName();
      let value;
      try {
        log.verbose('[%s] EXEC (%s)', podName, url);
        const response = await this._app.k8sClient.exec(pod, ['curl', '-s', url])
        value = JSON.parse(response.toString());
      } catch (e) {
        log.verbose(`[%s] %s`, podName, e.message);
        value = null;
      } finally {
        const isHealthy = await this.isHealthy(value);
        if (isHealthy) {
          healthyPodCount++;
        }
        results.push({podName, value, isHealthy});
      }
    }
    service.isHealthy = pods.length && healthyPodCount === pods.length;
    return results;
  }
}

module.exports.HealthDetailChecker = HealthDetailChecker;