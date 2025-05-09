//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const chalk = require('chalk');
const assert = require('assert').strict;
const tk = require('../../util/tk');
const packageJson = require('../../../package.json');
const {LogicalError} = require("../../util/LogicalError");
const {log} = require("../../util/ConsoleLogger");

class Command {
  constructor(args=[], options={}) {
    this.options = options;
    this.args = args;
    this.vars = {};
    /** @member {Context} */
    this.saasContext = undefined;
    this.spec = {
      options: ['--var'],
      flags: []
    }
  }

  addOption(name) {
    let initialValue = undefined;
    if (this.spec.flags[name]) {
      initialValue = true;
    } else if (!this.spec.options[name]) {
      throw new LogicalError(`Unsupported option: ${name} (see --help)`);
    }
    if (this.options.hasOwnProperty(name)) {
      throw new Error(`Illegal option name: ${name}`);
    }
    this.options[name] = initialValue;
    return !!initialValue;
  }

  addOptionValue(name, value) {
    if (name === '--var') {
      let parts = value.split('=');
      assert.ok(parts.length > 1, `Not in key=value format: ${value}`)
      let varName = parts.shift();
      this.vars[varName] = parts.join('=');
    } else {
      if (this.options.hasOwnProperty(name) && this.options[name] !== undefined) {
        if (!_.isArray(this.options[name])) {
          this.options[name] = [this.options[name]];
        }
        this.options[name].push(value);
      } else {
        this.options[name] = value;
      }
    }
  }

  isOptionPresent(name) {
    return this.options.hasOwnProperty(name);
  }

  getOption(name) {
    return this.options[name];
  }

  getRequiredOption(name) {
    let hint = `Required option: ${name}`;
    return tk.ensureValidString(this.getOption(name), hint);
  }

  takeArgument() {
    return this.args.shift();
  }

  takeRequiredArgument() {
    let hint = `Required argument`;
    return tk.ensureValidString(this.takeArgument(), hint);
  }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  async run() {}

  /**
   * @param saasContext
   * @returns {Promise<void>}
   */
  async init(saasContext) {
    this.saasContext = saasContext;
  }

  /**
   * @param promiseList
   */
  logResponses(promiseList) {
    if (promiseList.results.length === 0) {
      log.user(chalk.bold('No results'));
    } else {
      for (let apiResponse of promiseList.results) {
        this.logApiResponse(apiResponse);
      }
    }
    promiseList.raiseErrors();
    return promiseList;
  }

  /**
   * @param {ApiResponse} apiResponse
   */
  logApiResponse(apiResponse) {
    let resource = apiResponse.resource;
    if (resource) {
      let statusText = apiResponse.status === 'unchanged'
        ? chalk.italic(apiResponse.status)
        : chalk.bold(apiResponse.status);
      log.user(`[${chalk.magenta(resource.kind)}] ${resource.getName()}: ${statusText}`);
      // this.results.push(resource);
    }
  }

  async logContext() {
    async function repoStatus(repo) {
      const repoDir = repo.baseDir;
      if (await repo.isClean()) {
        return repoDir;
      } else {
        return chalk.bgRedBright.whiteBright.bold(`${repoDir} DIRTY!`);
      }
    }
    let kubeConfig = this.saasContext.k8sClient.kubeConfig;
    log.info('~ kubernetesContext: ' + kubeConfig.getCurrentContext());
    log.info('~ namespace: ' + this.saasContext.namespace);
    log.info('~ environmentFile: ' + this.saasContext.environmentFile.path);
    log.info('~ envRepoDir: ' + await repoStatus(this.saasContext.envRepo));
    log.info('~ configRepoDir: ' + await repoStatus(this.saasContext.configRepo));
    log.info(`~ version: ${packageJson.name}@${packageJson.version}`);
    log.info(`~ dryRun: ${this.saasContext.dryRun}`);
  }
}

module.exports.Command = Command;
