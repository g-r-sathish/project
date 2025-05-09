//  Copyright (C) Agilysys, Inc. All rights reserved.

const {PromiseList} = require("./PromiseList");
const assert = require('assert').strict;

class BatchOperation {
  constructor(items) {
    this.items = items || [];
  }

  /**
   * Add a single work item
   * @param {any} item
   */
  add(item) {
    this.items.push(item);
  }

  /**
   * Add all work items from the given list
   * @param {array} listOfItems
   */
  addAll(listOfItems) {
    this.items.push(...listOfItems);
  }

  /**
   * Execute a worker for each item asynchronously and wait for all to be settled.
   * @param worker
   * @returns {Promise<PromiseList>}
   */
  async run(worker) {
    return this._invoke(worker).settle();
  }

  /**
   * Execute a worker for each item asynchronously, in groups (of `chunkSize`) and wait for all to be settled.
   * @param worker
   * @param chunkSize
   * @return {Promise<PromiseList>}
   */
  async runChunked(chunkSize, worker) {
    assert.ok(chunkSize > 0);
    const plist = new PromiseList();
    let bucket;
    for (let idx = 0, startIdx = 0; idx < this.items.length; idx++) {
      if (idx > 0 && idx % chunkSize === 0) {
        bucket = this.items.slice(startIdx, idx);
        startIdx = idx;
      } else if (idx + 1 === this.items.length) {
        bucket = this.items.slice(startIdx);
      }
      if (bucket) {
        plist.addAll(bucket.map(item => worker(item)));
        await plist.settle();
        bucket = undefined;
      }
    }
    return plist;
  }

  /**
   * Execute a worker for each work item, in order, and return once complete.
   * @param worker
   * @returns {Promise<PromiseList>}
   */
  async runEach(worker) {
    return this._invoke(worker).settleEach();
  }

  /**
   * Execute worker for each of our items
   * @param worker
   * @returns {PromiseList}
   * @private
   */
  _invoke(worker) {
    let plist = new PromiseList();
    plist.addAll(this.items.map(item => worker(item)));
    return plist;
  }
}

module.exports.BatchOperation = BatchOperation;