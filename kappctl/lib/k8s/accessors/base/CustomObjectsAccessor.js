//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./Accessor");

class CustomObjectsAccessor extends Accessor {
  /**
   * Constructor
   * @param {k8s.KubeConfig} kubeConfig
   * @param {string} namespace
   * @param {string} API_GROUP
   * @param {string} API_VERSION
   * @param {string} API_PLURAL
   * @param {object} options
   */
  constructor(kubeConfig, namespace, API_GROUP, API_VERSION, API_PLURAL, options) {
    super(kubeConfig, namespace, options);
    this.API_GROUP = API_GROUP;
    this.API_VERSION = API_VERSION;
    this.API_PLURAL = API_PLURAL;
  }

  /**
   * @param kubeConfig
   * @returns {k8s.CustomObjectsApi}
   */
  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.CustomObjectsApi);
  }

  /**
   * Common arguments to namespace APIs
   * @param {Resource} [resource]
   * @returns {string[]}
   */
  nsargs(resource) {
    const args = [];
    if (resource) {
      args.push(resource.getApiVersionGroup() || this.API_GROUP);
      args.push(resource.getApiVersionLevel() || this.API_VERSION);
    } else {
      args.push(this.API_GROUP);
      args.push(this.API_VERSION);
    }
    args.push(this.getNamespace());
    args.push(this.API_PLURAL);
    return args;
  }

  async apiGet(name) {
    return this.api.getNamespacedCustomObject(...this.nsargs(), name);
  }

  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespacedCustomObject(...this.nsargs(), '', '', '', fieldSelector, labelSelector);
  }

  async apiCreate(resource) {
    return this.api.createNamespacedCustomObject(...this.nsargs(resource), resource.getDefinition(), '', this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespacedCustomObject(...this.nsargs(resource), name, resource.getDefinition(), this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespacedCustomObject(...this.nsargs(), name, undefined, undefined, undefined, this.dryRun);
  }
}

module.exports.CustomObjectsAccessor = CustomObjectsAccessor;