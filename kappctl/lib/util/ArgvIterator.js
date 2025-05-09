// Copyright (C) Agilysys, Inc. All rights reserved.

const {PeekableIterator} = require('./PeekableIterator');

class ArgvIterator extends PeekableIterator {
  constructor() {
    super(process.argv.slice(2));
  }

  // @override
  next() {
    return new ArgvElement(super.next());
  }

  // @override
  peek() {
    return new ArgvElement(super.peek());
  }
}

module.exports.ArgvIterator = ArgvIterator;

class ArgvElement {
  constructor(arg) {
    Object.assign(this, arg);
  }

  isValue() {
    return !this.done && !this.isOption();
  }

  isOption() {
    return !this.done && /^-/.test(this.value);
  }
}