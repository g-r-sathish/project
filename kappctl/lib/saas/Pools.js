//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require('assert').strict;
const tk = require('../util/tk');
const {Application} = require('./Application');
const {LogicalError} = require("../util/LogicalError");
const {InboundPool} = require("./InboundPool");

class Pools {
  static PRODUCTION = 'prod';
  static TEST_POOL = 'test';

  constructor(saasContext) {
    this.saasContext = saasContext;
    this.prod = new InboundPool(saasContext, Pools.PRODUCTION);
    this.test = new InboundPool(saasContext, Pools.TEST_POOL);
  }

  /**
   * Negotiates the subset parameter for correct application selection
   * @param subset
   * @returns {Promise<Application>}
   */
  async selectApplication(subset) {
    if (!subset) {
      const prodSubset = await this.prod.getSubsetVersion();
      if (this.saasContext.environmentFile.isTestpoolEnabled()) {
        const testSubset = await this.test.getSubsetVersion();
        const prodNumber = tk.versionToNumber(prodSubset);
        if (tk.versionToNumber(testSubset) < prodNumber) {
          throw new LogicalError(`Refusing to imply subset when in rollback hold (conclude to move forward)`);
          // subset = tk.numberToVersion(prodNumber + 1);
        } else {
          subset = testSubset;
        }
      } else {
        subset = prodSubset;
      }
    }

    let app;
    if (subset.startsWith('@')) {
      const alias = subset.substr(1);
      assert.ok(_.includes([Pools.PRODUCTION, Pools.TEST_POOL], alias), `Not a valid alias: ${subset}`);
      app = await this[alias].getApplication();
    } else if (subset === Pools.PRODUCTION || subset === Pools.TEST_POOL) {
      // Special case (for config-service) where the kubernetes resources are named
      // -test and -prod (instead of -v1, v2, etc). The image version however still derives
      // from environments.yml -> subsets -> v1, v2 (which ever is pointed to).
      assert.ok(this[subset], `Missing inbound pool for: ${subset}`);
      app = await this[subset].getApplication();
      app.setSubsetName(subset);
    } else {
      app = new Application(this.saasContext, subset);
    }
    return app;
  }

  async singleSubset() {
    const prodInboundSubset = await this.prod.getSubsetVersion();
    const testInboundSubset = await this.test.getSubsetVersion();
    return prodInboundSubset === testInboundSubset;
  }

  /**
   * @param {Application} app
   * @param poolName
   * @return {Promise<Boolean>}
   */
  async isAppServingPool(app, poolName) {
    for (const pool of [this.prod, this.test]) {
      const inbound = await pool.getInbound();
      if (app.getSubsetVersion() === inbound.getSubsetVersion()) {
        if (pool.poolName === poolName) {
          return true;
        }
      }
    }
    return false;
  }

  async isTestPool(app) {
    return this.isAppServingPool(app, Pools.TEST_POOL);
  }

  async isProdPool(app) {
    return this.isAppServingPool(app, Pools.PRODUCTION);
  }
}

module.exports.Pools = Pools;