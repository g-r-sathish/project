//  Copyright (C) Agilysys, Inc. All rights reserved.

const  _ = require("lodash");
const {Resource} = require("./Resource");
const {log} = require("../../../util/ConsoleLogger");
const chalk = require("chalk");
const tk = require("../../../util/tk");

/**
 * @class {StateManagementResource} Manages other resources to satisfy the desired state
 * @extends {Resource}
 */
class StateManagementResource extends Resource {
  constructor(kind, definition) {
    super(kind, definition);
  }

  /**
   * The desired state is the current state
   * @abstract
   * @return {boolean}
   */
  get isHealthy() {}

  /**
   * @abstract
   * @return {boolean}
   */
  get isComplete() {}

  getCondition(name) {
    const conditions = this.get('status.conditions', []);
    return _.find(conditions, (condition) => condition.type === name);
  }

  conditionEquals(name, status) {
    tk.ensureValidString(name);
    tk.ensureValidString(status);
    const condition = this.getCondition(name);
    return condition && status === condition.status;
  }

  logStatus() {
    this.logConditions();
  }

  logConditions() {
    const conditions = this.get('status.conditions', []);
    log.group('[%s] Conditions', this.getName());
    for (const condition of conditions) {
      const color = condition.status === 'True' ? chalk.green : chalk.red;
      log.info('[%s] %s (%s)', chalk.bold(condition.type), color(condition.status), condition.message);
    }
    log.groupEnd();
  }
}

module.exports.StateManagementResource = StateManagementResource;