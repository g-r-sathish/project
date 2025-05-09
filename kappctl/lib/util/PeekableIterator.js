// Copyright (C) Agilysys, Inc. All rights reserved.

const _iterator = Symbol('iterator');
const _peeked = Symbol('peeked');

class PeekableIterator {
  constructor(array) {
    let iterator = array[Symbol.iterator]();
    this[_iterator] = iterator;
    this[_peeked] = iterator.next();
  }

  peek() {
    return this[_peeked];
  }

  next() {
    const returnValue = this[_peeked];
    this[_peeked] = this[_iterator].next();
    return returnValue;
  }

  hasNext() {
    return !this[_peeked].done;
  }
}

module.exports.PeekableIterator = PeekableIterator;