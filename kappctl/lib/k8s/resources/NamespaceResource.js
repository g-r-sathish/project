//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Resource} = require("./base/Resource");

/**
 * @class {NamespaceResource}
 * @extends {Resource}
 */
class NamespaceResource extends Resource {
  static CRD_KIND = 'Namespace';

  constructor(definition) {
    super(NamespaceResource.CRD_KIND, definition);
  }

  /**
   * @override
   * @returns {*}
   */
  getNamespace() {
    return this.definition.metadata.name;
  }
}
module.exports.NamespaceResource = NamespaceResource;