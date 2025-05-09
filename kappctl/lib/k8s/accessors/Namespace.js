//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./base/Accessor");

class Namespace extends Accessor {
  static CRD_KIND = 'Namespace';

  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, options);
  }

  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.CoreV1Api);
  }

  async apiGet(name) {
    return this.api.readNamespace(name);
  }

  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespace(null, null, null, fieldSelector, labelSelector);
  }

  async apiCreate(resource) {
    return this.api.createNamespace(resource, null, this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespace(name, resource, null, this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespace(name, null, this.dryRun);
  }
}

module.exports.Namespace = Namespace;