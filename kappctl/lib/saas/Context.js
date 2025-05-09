//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const {log} = require('../util/ConsoleLogger');
const assert = require('assert').strict;
const tk = require("../util/tk");
const chalk = require('chalk');

const {YAMLFile} = require("../repo/YAMLFile");
const {ConfigClient, Inputs} = require('@agilysys-stay/config-client');
const {EnvironmentFile} = require('../repo/EnvironmentFile');
const {KubernetesClient} = require('../k8s/KubernetesClient');
const {GitRepo, findGitRepoDirOf} = require("../repo/GitRepo");
const Path = require("path");
const fs = require("fs");
const {ourPackage} = require("../util/NodePackageHelper");
const {EnsuringError} = require("../util/tk");
const {LogicalError} = require("../util/LogicalError");

function randomString(length = 8) {
  if (length < 1 || length > 1024) {
    throw new Error('Invalid length');
  }
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = length; i > 0; --i) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

class Context {
  minRuntimeVersion;
  envRepoDir = '../environments';
  configRepoDir = '../config-repo';
  namespace = 'agys-stay';
  virtualServicesBaseName = 'agys-stay-services';
  defaultSpringApplication = 'aks-cluster-setup';
  configSearchPaths = 'default,shared/{profile},${env},default/{profile},${env}/{profile}';
  configRepoBranch = undefined;
  dryRun = false;
  requireSubsetLabels = false;
  rejectUnauthorized = true;
  environmentName = undefined;
  allowDirtyRepositories = false;
  autoStash = false;
  bulkApply = false;
  configurableKeys = Object.keys(this);

  configurableEnvVars = [
    'spring_cloud_config_password',
    'spring_cloud_config_username',
    'spring_application_name',
    'spring_profiles_active',
    'spring_cloud_config_uri',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'KUBECONFIG',
  ];

  defaultBuildVars = {
    BUILD_DEFINITIONNAME: ourPackage.shortName,
    BUILD_BUILDNUMBER: `${Date.now()}.${process.pid}`,
    RUN_ID: `${randomString(8)}`
  }

  constructor(options = {}) {
    this._initFromContextFile(options);
    this._initFromData(options);
  }

  async postConstruct() {
    assert.ok(this.environmentName);
    if (/-prod-/.test(this.environmentName)) {
      log.user(chalk.bgRed.whiteBright('# PRODUCTION ENVIRONMENT'));
      if (process.stdout.isTTY && !this.dryRun) {
        await tk.confirm('This is not a dry run, are you sure you want to continue?');
      }
    }
    await this._loadEnvironment(this.environmentName);

    const optConfigPath = this.environmentFile.get(EnvironmentFile.KAPPTCTL_CONFIG);
    if (!optConfigPath) {
      throw new LogicalError(`Missing required configuration: ${EnvironmentFile.KAPPTCTL_CONFIG}`)
    }
    const configPath = Path.join(this.envRepoDir, optConfigPath);
    this.configFile = new YAMLFile(configPath, {required: true});
    const contextFromConfig = this.configFile.get('context');
    if (contextFromConfig) {
      this._initFromData(contextFromConfig);
    }
    this.ensureVersion();

    this.configRepo = new GitRepo({baseDir: this.configRepoDir});
    await this._levelSetRepo(this.configRepo);

    let context = tk.ensureValidString(this.environmentFile.get('k8s.context'), 'environmentFile.k8s.context');
    assert.ok(context.toLowerCase().startsWith(this.environmentName), 'k8s.context does align with environment filename');
    this.k8sClient = new KubernetesClient(this.namespace, {dryRun: this.dryRun, context});

    for (const envVarName of Object.keys(this.defaultBuildVars)) {
      if (!process.env[envVarName]) {
        const envVarValue = this.defaultBuildVars[envVarName];
        log.verbose(`Setting environment variable: ${envVarName}=${envVarValue}`);
        process.env[envVarName] = envVarValue;
      }
    }

    return this;
  }

  ensureVersion() {
    return !this.minRuntimeVersion || ourPackage.ensureVersion(this.minRuntimeVersion);
  }

  async _levelSetRepo(repo) {
    if (!this.allowDirtyRepositories) {
      const repoDir = repo.baseDir;
      log.user(`~ [GitRepo] Refreshing: ${repoDir}`);
      if (!(await repo.isClean())) {
        if (this.autoStash) {
          log.user(`~ [GitRepo] Auto stash: ${repoDir}`);
          await repo.stash(['save', '--include-untracked', 'cleaning up dirty repo (--auto-stash)']);
        } else {
          throw new EnsuringError(`${repoDir} has local changes (use --allow-dirty if this is intentional, or --auto-stash to discard)`);
        }
      }
      await repo.fetch(['--all']);
      await repo.switch('master');
    }
    return true;
  }

  async _loadEnvironment(environmentSpecifier) {
    assert.ok(environmentSpecifier, 'No environment specified');
    let environmentFilePath;
    if (environmentSpecifier.endsWith('.yml')) {
      environmentFilePath = environmentSpecifier;
      this.environmentName = Path.basename(environmentFilePath).slice(0, -4);
      this.envRepoDir = findGitRepoDirOf(environmentFilePath);
    } else {
      environmentFilePath = Path.join(this.envRepoDir, `${environmentSpecifier}.yml`);
    }
    this.envRepo = new GitRepo({baseDir: this.envRepoDir});
    await this._levelSetRepo(this.envRepo);
    this.environmentFile = new EnvironmentFile(environmentFilePath, {dryRun: this.dryRun});
  }

  getContextVars() {
    return _.pick(this, this.configurableKeys);
  }

  _initFromData(data) {
    if (data === null || data === undefined) {
      return;
    }
    for (const key of this.configurableKeys) {
      if (data.hasOwnProperty(key)) {
        this[key] = data[key];
      }
    }
    const env = data.env;
    if (_.isObject(env)) {
      for (const key of this.configurableEnvVars) {
        if (env.hasOwnProperty(key)) {
          process.env[key] = env[key];
        }
      }
    }
  }

  /**
   * Loading order, overwriting:
   *  - ~/kappctl/context.yml
   *  - ~/kappctl/aks-stay-dev.yml      If `-e` aks-env-dev was provided on the cli
   *  - ./.kappctl.yml
   *  - ${KAPPCONTEXT}
   * @param environmentName? {String}
   * @private
   */
  _initFromContextFile({environmentName}) {
    const configPaths = [Path.join(ourPackage.dotDir, 'context.yml')];
    if (environmentName) {
      configPaths.push(Path.join(ourPackage.dotDir, `${environmentName}.yml`));
    }
    configPaths.push(`${ourPackage.dotName}.yml`, process.env['KAPPCONTEXT']);
    for (const path of configPaths) {
      if (path && fs.existsSync(path)) {
        log.verbose(`[Loading]: ${path}`);
        const file = new YAMLFile(path);
        this._initFromData(file.data);
      } else if (path) {
        log.verbose(`[Not found]: ${path}`);
      }
    }
  }

  get manifestOutputPath() {
    const path = Path.join(ourPackage.dotDir, 'manifests', this.environmentName);
    return fs.existsSync(path) ? path : tk.mkdirs(path);
  }

  makeConfigClient(cloudConfig) {
    const inputs = new Inputs();
    const searchPaths = this.configSearchPaths.replace(/\${env}/g, this.environmentName);

    inputs.gitRepoConfig.enabled = true;
    inputs.gitRepoConfig.baseDir = this.configRepo.baseDir;
    inputs.gitRepoConfig.searchPaths = searchPaths;
    log.debug('[config-client] local-repo', inputs.gitRepoConfig);

    inputs.cloudConfig.rejectUnauthorized = this.rejectUnauthorized;
    Object.assign(inputs.cloudConfig, cloudConfig);
    log.debug('[config-client] cloudConfig', inputs.cloudConfig);
    if (!inputs.cloudConfig.rejectUnauthorized) {
      log.warn('[config-client] Insecure SSL certificates allowed');
    }

    return new ConfigClient(inputs);
  }
}

module.exports.Context = Context;
