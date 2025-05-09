//  Copyright (C) Agilysys, Inc. All rights reserved.

const {StateManagementResource} = require("./base/StateManagementResource");
const {log} = require("../../util/ConsoleLogger");

const STATUS_REPLICAS = 'status.replicas';
const STATUS_READY_REPLICAS = 'status.readyReplicas';
const STATUS_UNAVAILABLE_REPLICAS = 'status.unavailableReplicas';

/**
 * @class {DeploymentResource}
 * @extends {StateManagementResource}
 */
class DeploymentResource extends StateManagementResource {
  static CRD_KIND = 'Deployment';

  constructor(definition) {
    super(DeploymentResource.CRD_KIND, definition);
  }

  hasReplicas() {
    return this.getReplicas() > 0;
  }

  setReplicas(count) {
    return this.definition.spec.replicas = count;
  }

  getReplicas() {
    return this.definition.spec.replicas;
  }

  /**
   * @override
   * @return {boolean}
   */
  get isComplete() {
    const replicas = this.get(STATUS_REPLICAS);
    const readyReplicas = this.get(STATUS_READY_REPLICAS);
    return this.conditionEquals('Progressing', 'True')
      && this.conditionEquals('Available', 'True')
      && (!replicas || replicas === readyReplicas);
  }

  /**
   * @override
   * @return {boolean}
   */
  get isHealthy() {
    return this.get(STATUS_REPLICAS) && this.isComplete;
  }

  /**
   * @override
   */
  logStatus() {
    super.logStatus();
    log.group('[%s] Replicas', this.getName());
    log.info('[%s]: %s', STATUS_REPLICAS, this.get(STATUS_REPLICAS, 0));
    log.info('[%s]: %s', STATUS_READY_REPLICAS, this.get(STATUS_READY_REPLICAS, 0));
    log.info('[%s]: %s', STATUS_UNAVAILABLE_REPLICAS, this.get(STATUS_UNAVAILABLE_REPLICAS, 0));
    log.groupEnd();
  }
}

module.exports.DeploymentResource = DeploymentResource;