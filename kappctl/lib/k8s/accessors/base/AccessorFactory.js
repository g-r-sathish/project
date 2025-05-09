//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Namespace} = require('../Namespace');
const {VirtualService} = require('../VirtualService');
const {Gateway} = require('../Gateway');
const {ServiceAccount} = require('../ServiceAccount');
const {Service} = require('../Service');
const {PodDisruptionBudget} = require('../PodDisruptionBudget');
const {DestinationRule} = require('../DestinationRule');
const {Deployment} = require('../Deployment');
const {Pod} = require('../Pod');
const {Job} = require('../Job');

module.exports.Kind = {
  Namespace: Namespace.CRD_KIND,
  VirtualService: VirtualService.CRD_KIND,
  Gateway: Gateway.CRD_KIND,
  ServiceAccount: ServiceAccount.CRD_KIND,
  Service: Service.CRD_KIND,
  PodDisruptionBudget: PodDisruptionBudget.CRD_KIND,
  DestinationRule: DestinationRule.CRD_KIND,
  Deployment: Deployment.CRD_KIND,
  Pod: Pod.CRD_KIND,
  Job: Job.CRD_KIND
};

class AccessorFactory {
  constructor(kubeConfig, namespace, {dryRun=false}) {
    this.accessors = {};
    this.kubeConfig = kubeConfig;
    this.namespace = namespace;
    this.options = {dryRun: dryRun};
    this.register(Namespace.CRD_KIND, Namespace);
    this.register(VirtualService.CRD_KIND, VirtualService);
    this.register(Gateway.CRD_KIND, Gateway);
    this.register(ServiceAccount.CRD_KIND, ServiceAccount);
    this.register(Service.CRD_KIND, Service);
    this.register(PodDisruptionBudget.CRD_KIND, PodDisruptionBudget);
    this.register(DestinationRule.CRD_KIND, DestinationRule);
    this.register(Deployment.CRD_KIND, Deployment);
    this.register(Pod.CRD_KIND, Pod);
    this.register(Job.CRD_KIND, Job);
  }

  register(kind, clazz) {
    this.accessors[kind] = new clazz(this.kubeConfig, this.namespace, this.options);
  }

  /**
   * Return singleton instance
   * @param kind
   * @returns {Accessor}
   */
  getAccessor(kind) {
    let instance = this.accessors[kind];
    if (!instance) {
      throw new Error(`Accessor not found: ${kind}`)
    }
    return instance;
  }
}

module.exports.AccessorFactory = AccessorFactory;