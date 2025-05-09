// Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const tk = require('../util/tk');
const k8s = require('@kubernetes/client-node');
const spawnSync = require('child_process').spawnSync;
const {AccessorFactory} = require("./accessors/base/AccessorFactory");
const {ErrorWithContext} = require('../util/ErrorWithContext');
const {YAMLFile} = require('../repo/YAMLFile');
const {ResourceFactory} = require("./resources/base/ResourceFactory");
const {ApiResponse} = require("./accessors/base/ApiResponse");
const {log} = require("../util/ConsoleLogger");
const {LogicalError} = require("../util/LogicalError");

const KUBECTL_BIN = 'kubectl';

class KubernetesClient {
  constructor(namespace, {dryRun=false, context}) {
    this.namespace = tk.ensureValidString(namespace);
    this.kubeConfig = new k8s.KubeConfig();
    this.kubeConfig.loadFromDefault();
    const defaultContext = this.kubeConfig.getCurrentContext();
    if (context) {
      const contextLowerCase = context.toLowerCase();
      const possibleContexts = this.kubeConfig.getContexts().map(c => c.name);
      const allowedContexts = [context, `${context}-admin`, contextLowerCase, `${contextLowerCase}-admin`];
      const matchingContext = possibleContexts.find(c => allowedContexts.includes(c));
      if (!matchingContext) {
        throw new LogicalError(`No matching Kubernetes available: ${allowedContexts.join(', ')}`);
      }
      if (matchingContext !== defaultContext) {
        this.kubeConfig.setCurrentContext(context);
      }
    }
    this.dryRun = dryRun;
    this.accessorFactory = new AccessorFactory(this.kubeConfig, this.namespace, {dryRun: this.dryRun});
    this.resourceFactory = new ResourceFactory();
  }

  /**
   * Get access object for resource
   * @param kind
   * @returns {Accessor}
   */
  getAccessor(kind) {
    return this.accessorFactory.getAccessor(kind);
  }

  /**
   * Get access object for resource
   * @param {Resource|Object} resource
   * @returns {Accessor}
   */
  getAccessorFor(resource) {
    return this.getAccessor(tk.ensureValidString(resource.kind));
  }

  /**
   * Analog to `kubectl apply`
   * @param manifest
   * @returns {Promise<*[Resource]>}
   */
  async applyManifest(manifest) {
    let results = [];
    for (let definition of YAMLFile.multiLoad(manifest)) {
      let dao = this.getAccessorFor(definition);
      let res = dao.makeResource(definition)
      let status;
      try {
        let resp = await dao.updateOrCreate(res);
        status = resp.status;
        results.push(resp.resource);
      } catch (e) {
        if (e instanceof k8s.HttpError) {
          status = _.get(e, 'response.resp.body.message', e.name);
          e = new ErrorWithContext(e);
          e.context.resource = res;
        }
        throw(e);
      } finally {
        log.user(` - [${res.kind}] ${res.getName()}: ${status}`);
      }
    }
    return results;
  }

  // rollout undo deployment.v1.apps/abc-service-v1
  async kubectlDeploymentUndo(deployment) {
    return this.kubectlCommand(['rollout', 'undo', deployment.getTypeName()]);
  }

  async kubectlApply(resource) {
    const manifest = YAMLFile.mktemp(resource.definition);
    return this.kubectlCommand(['apply', '-f', manifest.path], {json: true});
  }

  async kubectlCommand(command, {json=false}={}) {
    const context = this.kubeConfig.getCurrentContext();
    let status = command[0];

    const args = ['--namespace', this.namespace, '--context', context, ...command];

    if (json) {
      args.push('-o', 'json');
    }
    if (this.dryRun) {
      args.push('--dry-run=client');
      status = `${status} (dry-run)`;
    }

    return new Promise((resolve, reject) => {
      try {
        const proc = spawnSync(KUBECTL_BIN, args, {stdio: ['ignore', 'pipe', 'pipe']});
        const stdout = proc.stdout ? tk.trimLastEOL(proc.stdout.toString()) : '';
        const stderr = proc.stderr ? tk.trimLastEOL(proc.stderr.toString()) : '';
        if (stderr) {
          log.warn(stderr);
        }
        if (stdout) {
          if (json) {
            const data = JSON.parse(stdout);
            const res = this.resourceFactory.makeResource(data);
            const response = new ApiResponse(res, stdout, data, status);
            response.logSummary();
            resolve(response);
          } else {
            resolve(stdout);
          }
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Get a resource
   * @param kind
   * @param name
   * @returns {Promise<Resource>}
   */
  async get(kind, name) {
    return this.getAccessor(kind).get(name);
  }

  /**
   * List matching resources
   * @param kind
   * @param labelSelector
   * @param fieldSelector
   * @returns {Promise<Resource[]>}
   */
  async list(kind, labelSelector, fieldSelector) {
    return this.getAccessor(kind).list(labelSelector, fieldSelector);
  }

  /**
   * Create a resource
   * @param kind
   * @param name
   * @returns {Promise<ApiResponse>}
   */
  async create(kind, name) {
    return this.getAccessor(kind).create(name);
  }

  /**
   * Update a resource
   * @param resource
   * @returns {Promise<ApiResponse>}
   */
  async update(resource) {
    return this.getAccessorFor(resource).replace(resource);
  }

  /**
   * Update a resource
   * @param resource
   * @returns {Promise<ApiResponse>}
   */
  async updateOrCreate(resource) {
    return this.getAccessorFor(resource).updateOrCreate(resource);
  }

  /**
   * Delete a resource
   * @param resource
   * @returns {Promise<ApiResponse>}
   */
  async delete(resource) {
    return this.getAccessorFor(resource).delete(resource);
  }

  /**
   * Execute a command inside a pod
   * @param {PodResource} pod
   * @param {String|[]} command
   * @return {Promise<void>}
   */
  async exec(pod, command) {
    return this.getAccessorFor(pod).apiExec(pod, command);
  }

  async getKubernetesVersion() {
    const versionApi = this.kubeConfig.makeApiClient(k8s.VersionApi);
    const code = await versionApi.getCode();
    return code.body;
  }
}
module.exports.KubernetesClient = KubernetesClient;
