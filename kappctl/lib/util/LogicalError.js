//  Copyright (C) Agilysys, Inc. All rights reserved.

class LogicalError extends Error {
  constructor(message) {
    super(message);
  }
}

module.exports.LogicalError = LogicalError;