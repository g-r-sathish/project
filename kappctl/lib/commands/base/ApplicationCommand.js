//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const {InboundPool} = require('../../saas/InboundPool');
const {Command} = require('./Command');
const {log} = require("../../util/ConsoleLogger");
const {LogicalError} = require("../../util/LogicalError");
const {Pools} = require("../../saas/Pools");

const OPT_SUBSET = '--subset';
const OPT_ALL = '--all';

class ApplicationCommand extends Command {
  constructor(args, options) {
    super(args, options);
    this.spec.options[OPT_SUBSET] = true;
    this.spec.flags[OPT_ALL] = true;
    this.subset = undefined;
    this.app = undefined;
    this.serviceNameArgs = [];
    this.serviceImageTags = {};
  }

  async init(saasContext) {
    await super.init(saasContext);
    this.processArgs();

    // As stand-alone deployments (backplane, etc.) are more predominant, this convenience lifts the repetitive need
    // to supply `--subset prod` all the time.
    let subsetOption = this.getOption(OPT_SUBSET);
    if (!subsetOption) {
      if (this.allServicesAreStandalone()) {
        subsetOption = 'prod';
      }
    }
    const pools = new Pools(saasContext);
    this.app = await pools.selectApplication(subsetOption);
    this.subset = this.app.getSubsetVersion();

    this.buildResourceNames(this.serviceNameArgs, this.app.getSubsetName());
  }

  // Extract `:version` tags from service names. This is used during deploy, for stand-alone services.
  // Needs to happen before building resource names.
  processArgs() {
    for (let i = 0; i < this.args.length; i++) {
      let serviceName = this.args[i];
      const nameParts = serviceName.split(':');
      if (nameParts.length === 2) {
        serviceName = nameParts[0];
        this.args[i] = serviceName;
        this.serviceImageTags[serviceName] = nameParts[1];
      }
      this.serviceNameArgs.push(serviceName);
    }
  }

  /**
   * All the services in the command line are standalone services.
   * The `deployment.services` configuration
   * @returns {boolean}
   */
  allServicesAreStandalone() {
    if (this.serviceNameArgs.length === 0) {
      return false;
    }
    const configFile = this.saasContext.configFile;
    const nameList = configFile.get('deploy.services.saas', []);
    if (Array.isArray(nameList)) {
      if (nameList.some((name) => this.serviceNameArgs.includes(name))) {
        return false;
      }
    } else {
      throw new LogicalError("Expected array value under configuration object: deploy.services.saas");
    }
    return true;
  }

  buildResourceNames(names, suffix) {
    this.resourceNames = names.length > 0
        ? _.map(names, (n) => n.endsWith(suffix) ? n : `${n}-${suffix}`)
        : undefined;
  }

  async listDeployments() {
    const results = await this.app.listDeployments((resources) => this.filterResources(resources));
    if (!(results && results.length)) {
      log.warn(`No deployments found (subset=${this.app.subsetName})`);
    }
    return results;
  }

  async listMissingDeployments() {
    const configFile = this.saasContext.configFile;
    let existingDeployments = await this.app.listDeployments();
    let existingNames = _.map(existingDeployments, (deployment) => deployment.getName().replace(/-v\d+$/, ''));
    let wantedNames = configFile.get('deploy.services.saas', []);
    return _.difference(wantedNames, existingNames);
  }

  filterResources(resources) {
    if (this.resourceNames && this.resourceNames.length > 0) {
      return _.filter(resources, (res) => {
        return _.includes(this.resourceNames, res.getName());
      });
    } else if (this.isOptionPresent(OPT_ALL)) {
      return resources;
    } else {
      throw new LogicalError(`Either ${OPT_ALL} or a list of names is required`);
    }
  }

  /**
   * @abstract
   * @returns {Promise<unknown>}
   */
  async run() {
  }
}

module.exports.ApplicationCommand = ApplicationCommand;
