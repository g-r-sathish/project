//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./base/Accessor");

class Deployment extends Accessor {
  static CRD_KIND = 'Deployment';

  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, options);
  }

  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.AppsV1Api);
  }

  async apiGet(name) {
    return this.api.readNamespacedDeployment(name, this.getNamespace());
  }

  async apiStatus(name) {
    return this.api.readNamespacedDeploymentStatus(name, this.getNamespace());
  }

  async apiCreate(resource) {
    return this.api.createNamespacedDeployment(this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespacedDeployment(name, this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespacedDeployment(name, this.getNamespace(), null, this.dryRun);
  }

  /**
   * Rolling restart for the given deployment
   * @param {DeploymentResource} deployment
   * @returns {Promise<DeploymentResource>}
   * @see https://github.com/kubernetes-client/javascript/blob/master/examples/patch-example.js#L10
   */
  async restart(deployment) {
    const annotations = deployment.get('spec.template.metadata.annotations', {});
    annotations["stay.agilysys.com/restartedAt"] = Date.now().toString();
    const patch = [
      {
        "op": "replace",
        "path": "/spec/template/metadata/annotations",
        "value": annotations
      }
    ];
    const options = {"headers": {"Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH}};
    let response = await this.api.patchNamespacedDeployment(
      deployment.getName(), this.getNamespace(), patch, null, this.dryRun, null, undefined, options);
    // noinspection JSValidateTypes
    return this.makeApiResponse(deployment, response, Deployment.STATUS_UPDATED);
  }

  /**
   * List deployments
   * @param {string} fieldSelector
   * @param {string} labelSelector
   * @returns {Promise<DeploymentResource[]>}
   */
  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespacedDeployment(this.getNamespace(), null, null, null, fieldSelector, labelSelector);
  }
}
module.exports.Deployment = Deployment;