//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./base/Accessor");

class PodDisruptionBudget extends Accessor {
  static CRD_KIND = 'PodDisruptionBudget';

  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, options);
  }

  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.PolicyV1beta1Api);
  }

  async apiGet(name) {
    return this.api.readNamespacedPodDisruptionBudget(name, this.getNamespace());
  }

  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespacedPodDisruptionBudget(this.getNamespace(), null, null, null, fieldSelector, labelSelector);
  }

  async apiCreate(resource) {
    return this.api.createNamespacedPodDisruptionBudget(this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespacedPodDisruptionBudget(name, this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespacedPodDisruptionBudget(name, this.getNamespace(), undefined, this.dryRun);
  }
}

module.exports.PodDisruptionBudget = PodDisruptionBudget;
