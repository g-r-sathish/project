//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const assert = require('assert').strict;
const tk = require('../util/tk');
const {YAMLFile} = require("../repo/YAMLFile");
const {ResourceFactory} = require("../k8s/resources/base/ResourceFactory");
const {BatchOperation} = require("../util/BatchOperation");
const {ResourceCache} = require('../k8s/resources/base/ResourceCache');
const {ApplicationFile} = require('../repo/ApplicationFile');
const {Kind} = require('../k8s/accessors/base/AccessorFactory');
const {EnvironmentFile} = require("../repo/EnvironmentFile");
const {LogicalError} = require("../util/LogicalError");
const {MonitorTimeoutError} = require("@agilysys-stay/config-client/lib/cloud-config-client/MonitorTimeoutError");
const {log} = require("../util/ConsoleLogger");
const Path = require("path");
const {ConfigRepoBranch} = require("./ConfigRepoBranch");
const util = require("util");

class Application {
  /**
   * @param {Context} saasContext
   * @param subset
   */
  constructor(saasContext, subset) {
    this.saasContext = saasContext;
    this.env = saasContext.environmentFile;
    this.subset = tk.ensureValidString(subset);
    this.subsetName = this.subset;
    this.vsName = saasContext.virtualServicesBaseName + '-' + this.subset;
    this.k8sClient = saasContext.k8sClient;
    this.resources = new ResourceCache(this.k8sClient);
    this.resourceFactory = new ResourceFactory();
    this.applicationFile = undefined;
    this.config = undefined;
  }

  async getVirtualService() {
    return await this.resources.fetch('vs', async (k8sClient) => {
      return await k8sClient.get(Kind.VirtualService, this.vsName);
    });
  }

  getSubsetName() {
    return this.subsetName;
  }

  setSubsetName(name) {
    return this.subsetName = name;
  }

  getSubsetVersion() {
    return this.subset;
  }

  getSubsetConfig() {
    return this.env.getSubset(this.subset) || {};
  }

  useTestpoolProfile() {
    if (this.subsetName === 'test') {
      return true;
    }
    let subset = this.env.get('pools.test');
    return this.env.isTestpoolEnabled() && subset && this.subset === subset;
  }

  getEnvironmentName() {
    return this.saasContext.environmentName;
  }

  getAllConfiguredServiceNames() {
    const configFile = this.saasContext.configFile;
    return configFile.get('deploy.services.saas', []);
  }

  async getRolloutContext() {
    const context = {};
    const subsetConfig = this.getSubsetConfig();
    const outOfBand = this.env.getImplicitSubset() !== this.subset;
    const rolloutRequestVersions = outOfBand ? {} : this.env.get('rollout.versions', {});
    context.rollout = tk.overlayMany({}, subsetConfig, rolloutRequestVersions);
    context.rollout.config_repo_branch = this.getConfigRepoBranch();
    context.rollout.subset_version = this.getSubsetName();
    context.rollout.prod_subset_version = this.env.get('pools.prod', 'v1');
    context.rollout.test_subset_version = this.env.get('pools.test', 'na');
    context.rollout.k8s_version = await this.k8sClient.getKubernetesVersion();
    return context;
  }

  /**
   * @param filter
   * @return {Promise<Resource|Resource[]|undefined>}
   */
  async listDeployments(filter = _.identity) {
    return this.list(Kind.Deployment, {filter});
  }

  /**
   * @param kind
   * @param filter
   * @return {Promise<Resource|Resource[]|undefined>}
   */
  async list(kind, {filter, requireSubsetLabels} = {filter: _.identity, requireSubsetLabels: this.saasContext.requireSubsetLabels}) {
    let resources = await this.resources.fetch(kind, async (k8sClient) => {
      const all = await k8sClient.list(kind);
      return _.filter(all, (res) => {
        if (res.getName().endsWith(`-${this.subsetName}`)) {
          const versionLabel = res.getLabel('version');
          if (versionLabel !== this.subsetName) {
            log.warn('[%s] Resources is not labeled correctly: version=%s (expected %s)',
              res.getName(), versionLabel, this.subsetName);
            if (requireSubsetLabels) {
              return false;
            }
          }
          return true;
        }
        return false;
      });
    });
    return filter(resources);
  }

  /**
   * @param filter
   * @return {Promise<Resource|Resource[]|undefined>}
   */
  async listPods(filter = _.identity) {
    const resources = await this.k8sClient.list('Pod', `version==${this.subsetName}`);
    return filter(resources);
  }

  /**
   * @param {String} label
   * @param filter
   * @return {Promise<Resource|Resource[]|undefined>}
   */
  async listPodsByAppName(label, filter = _.identity) {
    const resources = await this.k8sClient.list('Pod', `version==${this.subsetName}, app=${label}`);
    return filter(resources);
  }

  async rolloutRestart(deployments) {
    let batch = new BatchOperation(deployments);
    return batch.runEach((deployment) => this.k8sClient.getAccessorFor(deployment).restart(deployment));
  }

  async rolloutUndo(deployments) {
    let batch = new BatchOperation(deployments);
    return batch.runEach((deployment) => this.k8sClient.kubectlDeploymentUndo(deployment));
  }

  async spinDown(deployments, replicaCount = 0) {
    return this.updateEachDeployment(async (deployment) => {
      const currentReplicas = deployment.getReplicas();
      if (currentReplicas > replicaCount) {
        const savedReplicas = deployment.getAnnotation("stay.agilysys.com/replicas");
        if (savedReplicas === undefined || currentReplicas > savedReplicas) {
          // If you spin down to 1, then later spin down to 0, don't set the saved replicas to 1 (spin up should restore
          // to the original value)
          deployment.setAnnotation("stay.agilysys.com/replicas", currentReplicas);
        }
        deployment.setReplicas(replicaCount);
        return true;
      }
    }, deployments);
  }

  async spinUp(deployments, replicaCount) {
    return this.updateEachDeployment(async (deployment) => {
      let replicas;
      if (replicaCount) {
        replicas = replicaCount;
      } else {
        replicas = deployment.getAnnotation("stay.agilysys.com/replicas");
        if (!replicas) {
          replicas = 1;
          log.verbose(`[${deployment.getName()}] Missing replica-count annotation, defaulting to ${replicas}`);
        } else {
          replicas = Number.parseInt(replicas);
        }
      }
      const currentReplicas = deployment.getReplicas();
      if (currentReplicas < replicas) {
        deployment.setReplicas(replicas);
        return true;
      } else {
        log.verbose(`[${deployment.getName()}] Already has *${currentReplicas}* replicas (saved value: *${replicas}*)`)
      }
    }, deployments);
  }

  async setDeploymentReplicas(deployments, replicas) {
    assert.ok(replicas > 0); // Use retire
    assert.ok(replicas < 50);
    return this.updateEachDeployment(async (deployment) => {
      if (deployment.getReplicas() !== replicas) {
        deployment.setReplicas(replicas);
        return true;
      } else {
        log.verbose(`[${deployment.getName()}] Already has *${replicas}*`)
      }
    }, deployments);
  }

  async updateEachDeployment(makeUpdate = async () => false, deployments) {
    let batch = new BatchOperation();
    for (let deployment of deployments) {
      const isUpdated = await makeUpdate(deployment);
      if (isUpdated) {
        log.user(`[${deployment.getName()}] Updating...`);
        batch.add(deployment);
      }
    }
    this.resources.evict('deployments');
    return batch.runEach(async (deployment) => this.k8sClient.update(deployment));
  }

  usesManagedConfigRepoBranches() {
    let isManaged = this.env.get(EnvironmentFile.USE_MANAGED_CONFIG_BRANCHES);
    if (isManaged === undefined) {
      return true;
    }
    if (!isManaged && this.env.isTestpoolEnabled()) {
      throw new LogicalError('Branch management cannot be disabled when test pool is enabled');
    }
    return isManaged;
  }

  getConfigRepoBranchSource() {
    if (this.usesManagedConfigRepoBranches()) {
      let subsetConfig = this.getSubsetConfig();
      return subsetConfig[EnvironmentFile.SUBSET_CONFIG_SOURCE] || '';
    } else {
      return '';
    }
  }

  getConfigRepoBranchUpstream() {
    return this.env.get(EnvironmentFile.UPSTREAM_CONFIG_BRANCH, 'master');
  }

  getConfigRepoBranchStandalone() {
    return this.saasContext.configRepoBranch || this.getConfigRepoBranchUpstream();
  }

  isStandaloneSubset() {
    return ['prod', 'test'].includes(this.subsetName);
  }

  /**
   * Get the config-repo branch for this application set
   * @returns {String} branchName
   */
  getConfigRepoBranch() {
    let branchName;
    if (this.saasContext.configRepoBranch) {
        branchName = this.saasContext.configRepoBranch;
    } else if (!this.isStandaloneSubset()) {
      if (this.usesManagedConfigRepoBranches()) {
        branchName = this.getManagedConfigRepoBranch();
      } else {
        let subsetConfig = this.getSubsetConfig();
        branchName = subsetConfig.config_repo_branch;
      }
    }
    if (!branchName) {
      branchName = this.getConfigRepoBranchUpstream();
    }
    assert.ok(branchName);
    return branchName;
  }

  async saveConfigRepoBranch(branchName) {
    assert.ok(branchName);
    if (this.saasContext.configRepoBranch && branchName === this.saasContext.configRepoBranch) {
      return;
    }
    let subsetConfig = this.getSubsetConfig();
    subsetConfig[EnvironmentFile.SUBSET_CONFIG_BRANCH] = branchName;
    this.env.save();
    this.applicationFile = undefined;
    return this.env.checkIn(`Use config-repo@${branchName} for subset: ${this.subset}`, true);
  }

  async saveConfigRepoBranchSource(ref) {
    assert.ok(ref);
    let subsetConfig = this.getSubsetConfig();
    subsetConfig[EnvironmentFile.SUBSET_CONFIG_SOURCE] = ref;
    this.env.save();
    return this.env.checkIn(`Set config-repo@${ref} as source for subset: ${this.subset}`, true);
  }

  async reconcileNodePoolSelectors() {
    this.env.reconcileNodePoolSelectors();
    this.env.save();
    return this.env.checkIn('Reconcile node selectors', true);
  }

  getManagedConfigRepoBranch() {
    let envName = this.getEnvironmentName();
    let subsetVersion = this.getSubsetVersion();
    return `${envName}-${subsetVersion}`;
  }

  /**
   * The application.yml for the current environment.
   * @returns {Promise<ApplicationFile>}
   */
  async getApplicationFile() {
    if (!this.applicationFile) {
      await this.saasContext.configRepo.switch(this.getConfigRepoBranch());
      this.applicationFile = this.loadApplicationFile();
    }
    return this.applicationFile;
  }

  /**
   * The application.yml for the current environment.
   * @returns {ApplicationFile}
   */
  loadApplicationFile() {
    let envName = this.getEnvironmentName();
    let path = Path.join(this.saasContext.configRepoDir, `${envName}/application.yml`);
    let options = {dryRun: this.saasContext.dryRun};
    return new ApplicationFile(path, options);
  }

  async doesConfigRepoBranchExist(branchName) {
    let repo = this.saasContext.configRepo;
    return branchName === 'master' || repo.doesRemoteBranchExist(branchName);
  }

  /**
   * Make or replace the config-repo branch for this subset.
   * @param {Object} options
   * @param {Object?} sourceRef Optional, the source branch/tag/commit from where to branch.
   * @param {boolean?} rebuild When truthy, will DELETE and rebuild the subset branch
   * @returns {Promise<void>}
   */
  async initConfigRepoBranch({sourceRef, rebuild} = {}) {
    if (this.saasContext.dryRun) {
      log.warn(`Skipping config-repo branch management (--dry-run)`);
      return;
    }
    try {
      log.group(`# Initializing config-repo branch for subset: ${this.subset}`);
      const configRepoBranch = new ConfigRepoBranch(this);
      if (rebuild) {
        await configRepoBranch.rebuild();
      } else {
        await configRepoBranch.establish();
      }
      await configRepoBranch.dovetail(sourceRef);
      await configRepoBranch.writeSubsetConfig();
      await configRepoBranch.switchTo();
    } finally {
      log.groupEnd();
    }
  }

  /**
   * Pull upstream changes into runtime (managed) branches.
   * @returns {Promise<void>}
   */
  async pullConfigRepoBranch({rebuild} = {}) {
    const sourceRef = this.getConfigRepoBranchSource();
    return this.initConfigRepoBranch({sourceRef, rebuild});
  }

  async testPoolOff() {
    return this.updateTestpool(false);
  }

  async testPoolOn() {
    return this.updateTestpool(true);
  }

  async updateTestpool(enabled) {
    let applicationFile = await this.getApplicationFile();
    applicationFile.data.testPool = !!enabled;
    applicationFile.save();
    await applicationFile.checkIn(`test-pool=${enabled}`, true);
    return this.monitor(enabled, [applicationFile.repoPath]);
  }

  /**
   * Hit the /monitor endpoint of config-service.
   *  - test-pool on - monitor on prod vhost
   *  - test-pool off - monitor on test vhost
   * @param enabled test pool on or off
   * @param modified[] changed file paths
   * @returns {Promise<{timedOut: boolean, response: null}>}
   */
  async monitor(enabled, modified) {
    let applicationFile = await this.getApplicationFile();
    let publicUrl = new URL(applicationFile.get('stay_public_uri'));
    let fqdnProperty = enabled ? 'deployment.public_fqdn' : 'deployment.testpool.public_fqdn';
    let fqdn = applicationFile.get(fqdnProperty);
    let configServiceUrl = `${publicUrl.protocol}//${fqdn}/config-service`
    let cloudConfig = {endpoint: configServiceUrl};
    let configClient = this.saasContext.makeConfigClient(cloudConfig);
    let result = {
      response: null,
      timedOut: false
    };
    try {
      log.user(`Calling /monitor on: ${configServiceUrl}`);
      result.keysRefreshed = await configClient.monitor(modified);
    } catch (e) {
      if (e instanceof MonitorTimeoutError) {
        log.warn(`Tolerating lengthy response: ${e.message}`);
        result.timedOut = true;
      } else {
        throw new LogicalError(`Error invoking config monitor: ${e.message} (${configServiceUrl})`);
      }
    }
    return result;
  }

  getConfigProfiles(...profiles) {
    // let profiles = []; // ['default', this.getEnvironmentName()]
    profiles.push(this.useTestpoolProfile() ? 'testpool' : 'prodpool');
    return profiles.join(',');
  }

  async applyTemplate({templateName, applicationName, branchName, context, kind}) {
    const manifest = await this.renderTemplate(templateName, applicationName, branchName, context);
    const resources = await this.makeResources(manifest, kind);
    return this.applyResources(resources);
  }

  async makeResources(manifest, kind) {
    let definitions = YAMLFile.multiLoad(manifest);
    if (kind) {
      definitions = _.filter(definitions, (definition) => definition.kind === kind);
    }
    for (let definition of definitions) {
      tk.ensureNoEmptyValues(definition);
      tk.ensureNoValuesMatch(definition, /{{.*?}}/);
    }
    return definitions.map((definition) => this.resourceFactory.makeResource(definition));
  }

  async applyResources(resources) {
    let batch = new BatchOperation(resources);
    return batch.runEach(async (res) => {
      if (res.kind === 'Job') {
        const jobMetaName = res.getName();
        const jobAccessor = this.k8sClient.getAccessor('Job');
        let existingJob = await jobAccessor.get(jobMetaName);
        if (existingJob) {
          log.info('[%s] %s exists, deleting', res.getKind(), jobMetaName);
          await jobAccessor.delete(existingJob, true);
        }
      }
      if (this.k8sClient.dryRun) {
        const dir = tk.mkdirs(util.format('%s/%s', this.saasContext.manifestOutputPath, res.getKind()))
        const path = util.format('%s/%s.yml', dir, res.getName());
        const file = YAMLFile.newFile(path, res.definition);
        log.user('Wrote manifest to: %s', file.path);
      }
      return this.k8sClient.kubectlApply(res);
    });
  }

  async renderTemplate(templateName, name, branchName, context) {
    const cloudConfig = {
      application: this.applicationNameFor(name),
      profiles: this.getConfigProfiles('templates'),
      label: branchName || this.getConfigRepoBranch(),
      context: tk.overlayMany({}, this.env.data, {saasContext: this.saasContext.getContextVars()}, context)
    };
    await this.addApplicationProfiles(cloudConfig);
    const configClient = this.saasContext.makeConfigClient(cloudConfig);

    const manifest = await configClient.render(templateName);
    log.verbose(`Rendered template (${templateName}):`);
    log.verbose(manifest ? manifest.trimEnd() : manifest);
    return manifest;
  }

  applicationNameFor(serviceName) {
    if (!serviceName) return this.saasContext.defaultSpringApplication;
    const springAppRenameMap = this.saasContext.configFile.get('quirks.application-name-map', {});
    return springAppRenameMap[serviceName] || serviceName;
  }

  serviceNameFor(serviceAppName) {
    if (!serviceAppName) return this.saasContext.defaultSpringApplication;
    const springAppRenameMap = this.saasContext.configFile.get('quirks.application-name-map', {});
    const lookupMap = _.invert(springAppRenameMap);
    return lookupMap[serviceAppName] || serviceAppName;
  }

  async getConfig(name, branchName, context) {
    const cloudConfig = {
      application: this.applicationNameFor(name),
      profiles: this.getConfigProfiles(),
      label: branchName || this.getConfigRepoBranch(),
      context: tk.overlayMany({}, this.env.data, context)
    };
    await this.addApplicationProfiles(cloudConfig);
    const configClient = this.saasContext.makeConfigClient(cloudConfig);

    await configClient.getConfig();
    return configClient.structured;
  }

  async deleteResources(kind, filter = _.identity) {
    const allowedKinds = this.env.getAllowedResourceKindsAllowedForDelete();
    assert.ok(allowedKinds.includes(kind));

    const listOptions = {filter, requireSubsetLabels: true};
    const batch = new BatchOperation(await this.list(kind, listOptions));
    return batch.run((resource) => this.k8sClient.delete(resource));
  }

  async deleteAllResources(filter = _.identity) {
    const batch = new BatchOperation();
    const listOptions = {filter, requireSubsetLabels: true};
    const allowedKinds = this.env.getAllowedResourceKindsAllowedForDelete();
    for (const kind of allowedKinds) {
      try {
        batch.addAll(await this.list(kind, listOptions));
      } catch (e) {
        log.warn(`Error listing resources (kind=${kind}; subset=${this.subset}): ${e.message}`);
      }
    }
    try {
      return batch.run(async (resource) => this.k8sClient.delete(resource));
    } catch (e) {
      log.warn(`Error deleting resources: ${e.message}`);
    }
  }

  async addApplicationProfiles(cloudConfig) {
    const configClient = this.saasContext.makeConfigClient(cloudConfig);
    await configClient.getConfig();
    const profiles = configClient.structured.app_settings?.spring_profiles_active;
    if (profiles) {
      cloudConfig.profiles = [...profiles.split(","), cloudConfig.profiles].filter(value => value !== "secret").join(",");
    }
  }
}

module.exports.Application = Application;
