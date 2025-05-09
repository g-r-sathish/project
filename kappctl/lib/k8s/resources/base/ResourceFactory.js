//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const {log} = require("../../../util/ConsoleLogger");
const {Resource} = require("./Resource");
const {NamespaceResource} = require('../NamespaceResource');
const {VirtualServiceResource} = require('../VirtualServiceResource');
const {GatewayResource} = require('../GatewayResource');
const {DeploymentResource} = require('../DeploymentResource');
const {StatusResource} = require('../StatusResource');
const {JobResource} = require("../JobResource");
const {PodResource} = require("../PodResource");

class ResourceFactory {
  constructor() {
    this.resources = {};
    this.register(NamespaceResource.CRD_KIND, NamespaceResource);
    this.register(VirtualServiceResource.CRD_KIND, VirtualServiceResource);
    this.register(GatewayResource.CRD_KIND, GatewayResource);
    this.register(DeploymentResource.CRD_KIND, DeploymentResource);
    this.register(JobResource.CRD_KIND, JobResource);
    this.register(StatusResource.CRD_KIND, StatusResource);
    this.register(PodResource.CRD_KIND, PodResource);
  }

  register(kind, clazz) {
    this.resources[kind] = clazz;
  }

  getResourceClass(kind) {
    return this.resources[kind];
  }

  /**
   * Cast the raw definition object to its Resource class
   * @param definition
   * @returns {*|Resource}
   */
  makeResource(definition) {
    if (!definition) {
      return;
    }
    let kind = definition.kind;
    if (!kind) {
      let className = _.get(definition, 'constructor.name');
      if (className) {
        kind = className.replace(/^V\d/, '');
        log.verbose(`Inferring kind (${kind}) from API class name: ${className}`);
      }
      definition.constructor.name
    }
    let clazz = this.getResourceClass(kind);
    return clazz ? new clazz(definition) : new Resource(kind, definition);
  }

  createObject(kind) {
    return this.makeResource({kind: kind});
  }
}

module.exports.ResourceFactory = ResourceFactory;