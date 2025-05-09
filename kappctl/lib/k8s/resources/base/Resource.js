//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const METADATA_ANNOTATIONS = 'metadata.annotations';

class Resource {
  constructor(kind, definition) {
    this.kind = kind;
    this.definition = definition;
    this.apiResponse = undefined;
  }

  getKind() {
    return this.definition.kind || this.kind;
  }

  ensureKind() {
    if (this.definition.kind !== this.kind) {
      throw new Error(`Unexpected resource: expected='${this.kind}', actual='${this.definition.kind}'`)
    }
  }

  getApiVersionGroup() {
    try {
      let apiInfo = this.definition.apiVersion.split('/');
      return apiInfo.length > 1 ? apiInfo.shift() : '';
    } catch (e) {
      return '';
    }
  }

  getApiVersionLevel() {
    try {
      let apiInfo = this.definition.apiVersion.split('/');
      if(apiInfo.length > 1) {
        apiInfo.shift();
        return apiInfo.join('/');
      } else {
        return apiInfo.shift();
      }
    } catch (e) {
      return '';
    }
  }

  getResourceVersion() {
    try {
      return this.definition.metadata.resourceVersion;
    } catch (e) {
      return undefined;
    }
  }

  setResourceVersion(resourceVersion) {
    return this.definition.metadata.resourceVersion = resourceVersion;
  }

  setAnnotation(key, value) {
    const annotations = _.get(this.definition, METADATA_ANNOTATIONS, {});
    annotations[key] = `${value}`; // as string
    _.set(this.definition, METADATA_ANNOTATIONS, annotations);
  }

  getAnnotations() {
    const annotations = _.get(this.definition, METADATA_ANNOTATIONS);
    return annotations || {};
  }

  getAnnotation(key) {
    return this.getAnnotations()[key];
  }

  getDefinition() {
    return this.definition;
  }

  getTypeName() {
    return `${this.kind.toLowerCase()}/${this.getName()}`;
  }

  getName() {
    return this.definition.metadata.name;
  }

  getAppName() {
    let name = this.getLabel('app'); // convention is to set the label
    if (!name) {
      name = this.getName();
      if (name) {
        name = name.replace(/-v\d+$/, ''); // remove version suffix
      }
    }
    return name;
  }

  getLabel(label) {
    const labels = this.definition.metadata.labels || {};
    return labels[label];
  }

  getNamespace() {
    return this.definition.metadata.namespace;
  }

  /**
   * Get data value
   * @param {string|Array} path
   * @param {*} defaultValue
   * @returns {*}
   */
  get(path, defaultValue=undefined) {
    return _.get(this.definition, path, defaultValue);
  }

  /**
   * Remove data at given path
   * @param {string} path
   * @returns {*}
   */
  unset(path) {
    return _.unset(this.definition, path);
  }

  /**
   * Set data value
   * @param {string|Array} path
   * @param {*} value
   * @returns {*}
   */
  set(path, value) {
    return _.set(this.definition, path, value);
  }
}

module.exports.Resource = Resource;