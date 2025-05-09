//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./base/Accessor");

class Job extends Accessor {
  static CRD_KIND = 'Job';

  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, options);
  }

  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.BatchV1Api);
  }

  async apiGet(name) {
    return this.api.readNamespacedJob(name, this.getNamespace());
  }

  async apiStatus(name) {
    return this.api.readNamespacedJobStatus(name, this.getNamespace());
  }

  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespacedJob(this.getNamespace(), null, null, null, fieldSelector, labelSelector);
  }

  async apiCreate(resource) {
    return this.api.createNamespacedJob(this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespacedJob(name, this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespacedJob(name, this.getNamespace(), null, this.dryRun, 0, undefined, 'Foreground');
  }
}

module.exports.Job = Job;