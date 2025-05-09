//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const {Manager} = require("./base/Manager");
const {log} = require("../../util/ConsoleLogger");
const tk = require("../../util/tk");
const needle = require("needle");
const {BatchOperation} = require("../../util/BatchOperation");
const chalk = require("chalk");
const {Pools} = require("../Pools");
const {TestPoolStateChecker} = require("./TestPoolStateChecker");
const {HealthDetailChecker} = require("./HealthDetailChecker");
const {LogicalError} = require("../../util/LogicalError");

class HealthcheckManager extends Manager {
  constructor(app) {
    super();
    /** @member {Application} */
    this.app = app;
    this.pools = new Pools(app.saasContext);
  }

  async getBaseUri(usingTestPool = false) {
    const config = await this.app.getConfig();
    const publicUrl = new URL(_.get(config, 'stay_public_uri'));
    const fqdnProperty = usingTestPool ? 'deployment.testpool.public_fqdn' : 'deployment.public_fqdn';
    const fqdn = _.get(config, fqdnProperty);
    const baseUri = `${publicUrl.protocol}//${fqdn}`;
    log.verbose(`Base URI: ${baseUri}`);
    return baseUri;
  }

  async pingService(serviceName) {
    const isTestPool = await this.pools.isTestPool(this.app);
    const baseUri = await this.getBaseUri(isTestPool);
    const config = await this.app.getConfig(serviceName);
    const hcPath = _.get(config, 'deployment.probes.liveness');
    if (!hcPath) {
      throw new LogicalError(`No liveness probe for: ${serviceName}`);
    }
    const hc = {
      name: serviceName,
      url: `${baseUri}${hcPath}`,
      config: config
    };
    log.verbose('[%s] GET (%s)', hc.name, hc.url);
    hc.response = await needle('GET', hc.url);
    return hc;
  }

  async checkServices(names) {
    const isTestPool = await this.pools.isTestPool(this.app);
    const baseUri = await this.getBaseUri(isTestPool);
    const batch = new BatchOperation();

    for (let serviceName of names) {
      const config = await this.app.getConfig(serviceName);
      const hcPath = _.get(config, 'deployment.probes.liveness');
      const hc = {name: serviceName, config: config};
      if (hcPath) {
        hc.url = `${baseUri}${hcPath}`;
        batch.add(hc);
      } else {
        log.user('[%s]: %s (%s)', chalk.red('ERR'), serviceName, 'Missing liveness probe');
      }
    }

    let plist = await batch.run(async (hc) => {
      log.verbose('[%s] GET (%s)', hc.name, hc.url);
      hc.response = await needle('GET', hc.url);
      return hc;
    });

    for (let hc of plist.results) {
      log.user('[%s]: %s (%s)', colorizeStatusCode(hc.response.statusCode), hc.name, hc.url);
    }
  }

  async reportTestPoolState(names) {
    const isProdPool = await this.pools.isProdPool(this.app);
    const checker = new TestPoolStateChecker(this.app);
    const expectedValue = await checker.getCorrectTestpoolSetting();

    log.group('# serviceInfo.testPool setting');
    log.info(`Subset        : *${this.app.subset}*`);
    log.info(`Production    : *${isProdPool}*`);
    log.info(`Expected value: *${expectedValue}*`);

    for (const name of names) {
      if (!await checker.add(name)) {
        log.warn(`Endpoint not available for: ${name}`);
      }
    }

    const plist = await checker.checkAll();

    for (const service of checker.services) {
      if (service.results.length) {
        for (const result of service.results) {
          const message = result.isCorrect ? chalk.green(`${result.value} (correct)`) : chalk.red(`${result.value} (INCORRECT)`);
          log.user(`[${service.serviceName}]: ${result.podName}: ${message}`);
        }
      } else {
        log.info(`[${service.serviceName}]: No pods found`);
      }
    }
    plist.raiseErrors();
    log.groupEnd();
  }

  async checkTestPoolState(names) {
    const checker = new TestPoolStateChecker(this.app);
    await checker.addAll(names);
    await checker.checkAll();
    return checker.results;
  }

  async reportHealthDetails(names) {
    log.group('# Health details');
    log.info(`Subset        : *${this.app.subset}*`);

    const checker = new HealthDetailChecker(this.app);
    await checker.addAll(names);
    await checker.checkAll();

    for (const service of checker.services) {
      if (service.results.length) {
        for (const result of service.results) {
          for (const hcName in result.value) {
            const hcDetails = result.value[hcName];
            const message = hcDetails.healthy ? chalk.green(`${hcName} (healthy)`) : chalk.red(`${hcName} (UNHEALTHY)`);
            log.user(`[${service.serviceName}]: ${result.podName}: ${message}`);
          }
        }
      } else {
        log.info(`[${service.serviceName}]: No pods found`);
      }
    }
    log.groupEnd();
  }
}

function colorizeStatusCode(code) {
  if (code >= 200 && code < 300) {
    return chalk.green(code);
  } else if (code >= 400) {
    return chalk.red(code);
  }
  return code;
}

module.exports.HealthcheckManager = HealthcheckManager;