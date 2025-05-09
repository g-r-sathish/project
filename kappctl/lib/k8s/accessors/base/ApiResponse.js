//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const tk = require("../../../util/tk");
const {log} = require("../../../util/ConsoleLogger");
const chalk = require("chalk");

class ApiResponse {
  /**
   * API operation response
   * @param {Resource} resource Resource acted upon
   * @param {Resource|string} result Resource from the API response
   * @param {Object} response Raw k8s response
   * @param {string} status Short hint of what happened
   */
  constructor(resource, result, response, status) {
    this._resource = resource;
    this._result = result;
    this._response = response;
    this._status = status;
  }

  get result() {
    return this._result;
  }

  get resource() {
    return this._resource;
  }

  get response() {
    return this._response;
  }

  get status() {
    return tk.isValidString(this._status) ? this._status : _.get(this, 'response.response.statusMessage');
  }

  logSummary() {
    let resource = this.resource;
    let statusText = this.status === 'unchanged'
      ? chalk.italic(this.status)
      : chalk.bold(this.status);
    log.info(`[${chalk.magenta(resource.kind)}] ${resource.getName()}: ${statusText}`);
  }
}
module.exports.ApiResponse = ApiResponse;