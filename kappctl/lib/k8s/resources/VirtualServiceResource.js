//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Resource} = require('./base/Resource');

/**
 * @class VirtualServiceResource
 * @extends Resource
 */
class VirtualServiceResource extends Resource {
  static CRD_KIND = 'VirtualService';

  constructor(definition) {
    super(VirtualServiceResource.CRD_KIND, definition);
  }

  getSubsetVersion() {
    return this.definition.metadata.labels.subset;
  }

  getSubsetVersionNumber() {
    return tk.versionToNumber(this.getSubsetVersion());
  }

  getDelegateName() {
    try {
      return this.definition.spec.http[0].delegate.name;
    } catch (ex) {
      return '';
    }
  }
}
module.exports.VirtualServiceResource = VirtualServiceResource;