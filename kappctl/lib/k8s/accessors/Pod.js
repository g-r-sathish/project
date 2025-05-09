//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {Accessor} = require("./base/Accessor");
const {PassThrough} = require('stream');
const {Buffer} = require('buffer');
const {Exec} = require("@kubernetes/client-node");
const {log} = require("../../util/ConsoleLogger");

class Pod extends Accessor {
  static CRD_KIND = 'Pod';

  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, options);
  }

  makeApiClient(kubeConfig) {
    return kubeConfig.makeApiClient(k8s.CoreV1Api);
  }

  async apiGet(name) {
    return this.api.readNamespacedPod(name, this.getNamespace());
  }

  async apiList(fieldSelector, labelSelector) {
    return this.api.listNamespacedPod(this.getNamespace(), null, null, null, fieldSelector, labelSelector);
  }

  async apiCreate(resource) {
    return this.api.createNamespacedPod(this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiReplace(name, resource) {
    return this.api.replaceNamespacedPod(name, this.getNamespace(), resource.getDefinition(), null, this.dryRun);
  }

  async apiDelete(name) {
    return this.api.deleteNamespacedPod(name, this.getNamespace(), null, this.dryRun);
  }

  /**
   * Execute a command within a pod.
   * @param {PodResource} pod
   * @param {String|[]} command
   * @return {Promise<Buffer>}
   */
  async apiExec(pod, command) {
    const exec = new Exec(this.kubeConfig);
    const container = pod.defaultContainerName;
    const stream = new PassThrough();
    const wsPromise = exec.exec(pod.getNamespace(), pod.getName(), container, command, stream, null, null, false);
    return new Promise((resolve, reject) => {
      const _buf = [];
      const timeout = setTimeout(() => {
        log.error("[apiExec] Timeout (leaky)");
        reject(new Error("Timeout (leaky)"))
      }, 60 * 1000);
      stream.on("data", (chunk) => _buf.push(chunk));
      stream.on("end", () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(_buf))
      });
      stream.on("error", (err) => {
        clearTimeout(timeout);
        reject(err)
      });
    });
  }
}

module.exports.Pod = Pod;
