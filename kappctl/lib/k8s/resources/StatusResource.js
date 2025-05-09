//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Resource} = require("./base/Resource");

class StatusResource extends Resource {
  static CRD_KIND = "Status";
  static SUCCESS = "Success";

  constructor(definition) {
    super(StatusResource.CRD_KIND, definition);
  }

  getStatus() {
    try {
      return this.definition.message || this.definition.status;
    } catch (e) {
      return undefined;
    }
  }

  isSuccess() {
    return this.getStatus() === StatusResource.SUCCESS;
  }
}

module.exports.StatusResource = StatusResource;