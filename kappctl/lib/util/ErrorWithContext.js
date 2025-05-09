//  Copyright (C) Agilysys, Inc. All rights reserved.

class ErrorWithContext extends Error {
  constructor(e) {
    super(e.message);
    this.cause = e;
    this.context = {};
  }
}

module.exports.ErrorWithContext = ErrorWithContext;