//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const k8s = require('@kubernetes/client-node');
const tk = require('../../../util/tk');
const {ApiError} = require("./ApiError");
const {ResourceFactory} = require("../../resources/base/ResourceFactory");
const {ApiResponse} = require("./ApiResponse");
const {HttpError} = require("@kubernetes/client-node");

const NA = undefined;

/**
 * Kubernetes resource access object
 */
class Accessor {
  static STATUS_CREATED = 'created';
  static STATUS_UPDATED = 'updated';
  static STATUS_APPLIED = 'applied';
  static STATUS_DELETED = 'deleted';
  static STATUS_FAILED = 'failed';
  static STATUS_UNCHANGED = 'unchanged';

  static extractSingleResult(response) {
    if (response && response.body) {
      if (response.body.items) {
        if (response.body.items.length === 1) {
          return response.body.items[0];
        } else {
          throw new UnexpectedCountError(response.body.items.length, 1);
        }
      } else {
        return response.body;
      }
    }
  }

  /**
   * Constructor
   * @param {k8s.KubeConfig} kubeConfig
   * @param {string} namespace
   * @param options
   *
   * options.dryRun: (true|false) indicates that modifications should not be persisted
   */
  constructor(kubeConfig, namespace, {dryRun=false}) {
    this.kubeConfig = kubeConfig;
    this.api = this.makeApiClient(kubeConfig);
    this.namespace = tk.ensureValidString(namespace);
    this.dryRun = dryRun ? 'All' : NA;
    this.resourceFactory = new ResourceFactory();
  }

  /**
   * Create appropriate API client
   * @abstract
   * @param {k8s.KubeConfig} kubeConfig
   */
  makeApiClient(kubeConfig) {
  }

  /**
   * Cast definition to appropriate Resource
   * @param {object} definition
   * @returns {Resource}
   */
  makeResource(definition) {
    return this.resourceFactory.makeResource(definition);
  }

  /**
   * Make the k8s api call to fetch a single resource by name. May return a get/read method call, or a list with the
   * expectation that only one item will be in the response.
   *
   * @abstract
   * @param name
   * @returns {Promise<void>}
   */
  async apiGet(name) {
  }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  async apiList(fieldSelector, labelSelector) {
  }

  /**
   * @abstract
   * @param {Resource} resource
   * @returns {Promise<void>}
   */
  async apiCreate(resource) {
  }

  /**
   * @abstract
   * @param name
   * @param {Resource} resource
   * @returns {Promise<void>}
   */
  async apiReplace(name, resource) {
  }

  /**
   * @abstract
   * @param name
   * @returns {Promise<void>}
   */
  async apiDelete(name) {
  }

  /**
   * Get configured namespace
   * @returns {string} namespace
   */
  getNamespace() {
    return this.namespace;
  }

  /**
   * Transform the response body into its resource and attach the response object.
   * @param resource
   * @param response k8s API response
   * @param status
   * @returns {ApiResponse}
   */
  makeApiResponse(resource, response, status) {
    let result;
    if (response) {
      let definition = Accessor.extractSingleResult(response);
      result = this.makeResource(definition);
    } else {
      result = resource;
    }
    if (this.dryRun) {
      status = `${status} (dry-run)`;
    }
    return new ApiResponse(resource, result, response, status);
  }

  /**
   * Get resource by name
   * @param name
   * @returns {Promise<Resource>}
   */
  async get(name) {
    try {
      let response = await this.apiGet(name);
      return this.makeResource(Accessor.extractSingleResult(response));
    } catch (e) {
      if (e instanceof k8s.HttpError || e instanceof HttpError) {
        const statusCode = _.get(e, 'response.statusCode');
        if (statusCode === 404) {
          return undefined;
        }
      }
      throw(e);
    }
  }

  /**
   * Get resource status by name
   * @param name
   * @returns {Promise<Resource>}
   */
  async status(name) {
    try {
      let response = await this.apiStatus(name);
      return this.makeResource(Accessor.extractSingleResult(response));
    } catch (e) {
      if (e instanceof k8s.HttpError || e instanceof HttpError) {
        if (404 === _.get(e, 'response.statusCode')) {
          return undefined;
        }
      }
      throw(e);
    }
  }

  /**
   * List resources
   * @param {string} labelSelector
   * @param {string} fieldSelector
   * @returns {Promise<Resource[]>}
   * @see https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   * @see https://kubernetes.io/docs/concepts/overview/working-with-objects/field-selectors/
   */
  async list(labelSelector = '', fieldSelector = '') {
    const results = [];
    let response = await this.apiList(fieldSelector, labelSelector);
    let kind = response.body.kind.replace(/List$/, '');
    let apiVersion = response.body.apiVersion;
    for (let definition of response.body.items) {
      definition.kind = kind;
      definition.apiVersion = apiVersion;
      results.push(this.makeResource(definition));
    }
    return results;
  }

  /**
   * Create resource
   * @param {Resource} resource
   * @returns {Promise<ApiResponse>}
   */
  async create(resource) {
    tk.ensureEqualValidStrings(resource.getNamespace(), this.getNamespace());
    let response = await this.apiCreate(resource);
    return this.makeApiResponse(resource, response, Accessor.STATUS_CREATED);
  }

  /**
   * Replace resource
   * @param {Resource} resource
   * @returns {Promise<ApiResponse>}
   */
  async replace(resource) {
    tk.ensureEqualValidStrings(resource.getNamespace(), this.getNamespace());
    let name = tk.ensureValidString(resource.getName());
    let response = await this.apiReplace(name, resource);
    return this.makeApiResponse(resource, response, Accessor.STATUS_UPDATED);
  }

  /**
   * Delete resource
   * @param {Resource} resource
   * @param wait Wait for resource to be deleted before returning
   * @returns {Promise<ApiResponse>}
   */
  async delete(resource, wait=false) {
    let result;
    let name = tk.ensureValidString(resource.getName());
    try {
      let response = await this.apiDelete(name);
      result = this.makeApiResponse(resource, response, Accessor.STATUS_DELETED);
    } catch (e) {
      let resource = this.makeResource(e.body);
      throw new ApiError(e, resource, 'delete');
    }
    if (wait && resource) {
      const timeout = 30 * 1000;
      const startTime = Date.now();
      let existing = await this.get(name);
      while (existing) {
        if ((Date.now() - startTime) > timeout) {
          throw new Error(`Timed-out waiting for Job to delete: ${name}`);
        }
        await tk.sleep(250);
        existing = await this.get(name);
      }
    }
    return result;
  }

  /**
   * Update or make resource
   * @param {Resource} resource
   * @returns {Promise<ApiResponse>}
   */
  async updateOrCreate(resource) {
    tk.ensureEqualValidStrings(resource.getNamespace(), this.getNamespace());
    let name = tk.ensureValidString(resource.getName());
    let existingResource = await this.get(name);
    if (existingResource) {
      let updates = tk.update(existingResource.getDefinition(), resource.getDefinition());
      if (updates > 0) {
        return this.replace(existingResource);
      } else {
        return this.makeApiResponse(existingResource, undefined, Accessor.STATUS_UNCHANGED)
      }
    } else {
      return this.create(resource);
    }
  }
}
module.exports.Accessor = Accessor;

class UnexpectedCountError extends Error {
  constructor(actual, expected) {
    const message = `Unexpected result count: expected=${expected}, actual=${actual}`;
    super(message);
  }
}
module.exports.UnexpectedCountError = UnexpectedCountError;