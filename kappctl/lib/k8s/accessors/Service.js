//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./base/Accessor");

class Service extends Accessor {
  static CRD_KIND = 'Service';

  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, options);
  }

  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.CoreV1Api);
  }

  async apiGet(name) {
    return this.apiList(`metadata.name==${name}`);
  }

  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespacedService(this.getNamespace(), null, null, null, fieldSelector, labelSelector);
  }

  async apiCreate(resource) {
    return this.api.createNamespacedService(this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespacedService(name, this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespacedService(name, this.getNamespace(), null, this.dryRun);
  }
}

module.exports.Service = Service;