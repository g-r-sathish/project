//  Copyright (C) Agilysys, Inc. All rights reserved.

const {StateManagementResource} = require("./base/StateManagementResource");

/**
 * @class {JobResource}
 * @extends {StateManagementResource}
 */
class JobResource extends StateManagementResource {
  static CRD_KIND = 'Job';

  constructor(definition) {
    super(JobResource.CRD_KIND, definition);
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
}

module.exports.JobResource = JobResource;