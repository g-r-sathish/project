//  Copyright (C) Agilysys, Inc. All rights reserved.

const {HttpError} = require("@kubernetes/client-node");
const {StatusResource} = require("../../resources/StatusResource");

class ApiError extends Error {
  constructor(e, resource, operation) {
    let message = e.message;
    if (e instanceof HttpError) {
      let statusResource = new StatusResource(e.body);
      message = statusResource.getStatus();
    }
    super(message);
    this.apiOperation = operation;
    this.resource = resource;
    this.cause = e;
  }
}

module.exports.ApiError = ApiError;