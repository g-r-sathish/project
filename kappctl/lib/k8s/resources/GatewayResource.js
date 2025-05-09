//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Resource} = require('./base/Resource');

/**
 * @class GatewayResource
 * @extends Resource
 */
class GatewayResource extends Resource {
  static CRD_KIND = 'Gateway';

  constructor(definition) {
    super(GatewayResource.CRD_KIND, definition);
  }
}
module.exports.GatewayResource = GatewayResource;