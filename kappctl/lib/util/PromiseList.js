//  Copyright (C) Agilysys, Inc. All rights reserved.

const tk = require("./tk");
const {SettlementError} = require("./tk");

class PromiseList {
  static FULFILLED = 'fulfilled';
  static REJECTED = 'rejected';

  constructor(promises) {
    this.promises = promises || [];
    this.results = [];
    this.errors = [];
  }

  /**
   * @param {Promise} promise
   * @returns {number}
   */
  add(promise) {
    return this.promises.push(promise);
  }

  /**
   * @param {Promise[]} promises
   * @returns {number}
   */
  addAll(promises) {
    return this.promises.push(...promises);
  }

  /**
   * Uses promise.allSettled to wait for completion. (Parallel execution)
   * @returns {Promise<PromiseList>}
   */
  async settle() {
    if (this.promises.length) {
      const settled = await Promise.allSettled(this.promises);
      this.promises.length = 0;
      for (let settlement of settled) {
        if (tk.areEqualValidStrings(settlement.status, PromiseList.FULFILLED)) {
          this.results.push(settlement.value);
        } else {
          this.errors.push(settlement.reason);
        }
      }
    }
    return this;
  }

  /**
   * Awaits each promise in order. (Serial execution)
   * @returns {Promise<PromiseList>}
   */
  async settleEach() {
    while (this.promises.length) {
      const promise = this.promises.shift();
      try {
        let result = await promise;
        this.results.push(result);
      } catch (e) {
        this.errors.push(e);
      }
    }
    return this;
  }

  /**
   * Throws an error if any were thrown during processing.
   * @throws {SettlementError}
   */
  raiseErrors() {
    if (this.errors.length > 0) {
      throw new SettlementError(this.results, this.errors);
    }
  }
}

module.exports.PromiseList = PromiseList;