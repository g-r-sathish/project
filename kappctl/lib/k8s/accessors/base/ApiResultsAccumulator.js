//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const {SettlementError} = require("../../../util/tk");

class ApiResultsAccumulator {
  constructor() {
    this._promiseLists = [];
    this._results = [];
    this._errors = [];
  }

  get promiseLists() {
    return this._promiseLists;
  }

  /**
   * Add results from a PromiseList (BatchOperation results)
   * @param {PromiseList} plist
   */
  add(plist) {
    this._promiseLists.push(plist);
    this._results.push(...plist.results);
    this._errors.push(...plist.errors);
  }

  /**
   * Add results from another ApiResultsAccumulator
   * @param {ApiResultsAccumulator} that
   */
  combine(that) {
    for (const plist of that.promiseLists) {
      this.add(plist);
    }
  }

  /**
   * List result resources
   * @param {function?} filter
   * @return {unknown[]}
   */
  getResources(filter=_.identity) {
    const resources = _.map(this._results, (apiResponse) => apiResponse.resource);
    return _.filter(resources, filter);
  }

  raiseErrors() {
    if (this._errors.length > 0) {
      throw new SettlementError(this._results, this._errors);
    }
  }
}

module.exports.ApiResultsAccumulator = ApiResultsAccumulator;