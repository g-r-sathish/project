//  Copyright (C) Agilysys, Inc. All rights reserved.

const assert = require('assert').strict;
const {StateManagementResource} = require("./base/StateManagementResource");

/**
 * @class {PodResource}
 * @extends {StateManagementResource}
 */
class PodResource extends StateManagementResource {
  static CRD_KIND = 'Pod';

  constructor(definition) {
    super(PodResource.CRD_KIND, definition);
  }

  /**
   * @override
   * @return {boolean}
   */
  get isComplete() {
    return this.conditionEquals('Complete', 'True') ||
      this.conditionEquals('Failed', 'True');
  }

  /**
   * @override
   * @return {boolean}
   */
  get isHealthy() {
    return this.conditionEquals('Complete', 'True') &&
      !this.conditionEquals('Failed', 'True');
  }

  /**
   * @override
   * @return {boolean}
   */
  get isReady() {
    return this.conditionEquals('Ready', 'True');
  }

  /**
   * The name of the pod's default container
   * @return {undefined}
   */
  get defaultContainerName() {
    let containerName = undefined;
    const plausibleFields = [
      'metadata.annotations["kubectl.kubernetes.io/default-container"]',
      'metadata.labels.app',
      'spec.template.spec.containers[0].name'
    ];
    while (!containerName && plausibleFields.length) {
      const fieldPath = plausibleFields.shift();
      containerName = this.get(fieldPath);
    }
    assert.ok(containerName);
    return containerName;
  }
}

module.exports.PodResource = PodResource;