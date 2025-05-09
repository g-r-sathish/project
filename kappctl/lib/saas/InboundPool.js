//  Copyright (C) Agilysys, Inc. All rights reserved.

const {ResourceCache} = require('../k8s/resources/base/ResourceCache');
const {Application} = require('./Application');
const {Kind} = require('../k8s/accessors/base/AccessorFactory');

function ensureValidPoolName(name) {
  if (name && name === InboundPool.PRODUCTION || name === InboundPool.TEST_POOL) {
    return true;
  } else {
    throw new Error(`Invalid pool name: ${name}`);
  }
}

class InboundPool {
  static PRODUCTION = 'prod';
  static TEST_POOL = 'test';

  constructor(saasContext, poolName) {
    ensureValidPoolName(poolName);
    this.saasContext = saasContext;
    this.poolName = poolName;
    this.vsName = saasContext.virtualServicesBaseName + '-' + this.poolName;
    this.k8sClient = saasContext.k8sClient;
    this.resources = new ResourceCache(this.k8sClient);
    this.app = undefined;
  }

  /**
   * @return {Promise<VirtualServiceResource>}
   */
  async getInbound() {
    return this.resources.fetch('delegate', async (k8sClient) => {
      return k8sClient.get(Kind.VirtualService, this.vsName);
    });
  }

  async getSubsetVersion() {
    let inbound = await this.getInbound();
    return inbound.getSubsetVersion();
  }

  /**
   * @return {Promise<Application>}
   */
  async getApplication() {
    if (!this.app) {
      let inbound = await this.getInbound();
      if (inbound) {
        this.app = new Application(this.saasContext, inbound.getSubsetVersion());
      }
    }
    return this.app;
  }
}

module.exports.InboundPool = InboundPool;