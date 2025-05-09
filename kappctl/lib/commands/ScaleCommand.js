//  Copyright (C) Agilysys, Inc. All rights reserved.

const tk = require('../util/tk');
const {LogicalError} = require("../util/LogicalError");
const {InboundPool} = require('../saas/InboundPool');
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {log} = require("../util/ConsoleLogger");
const {Pools} = require("../saas/Pools");

module.exports.help = {
  summary: "Scale an application's resources",
  usages: ["[--subset {@pool|version}] {--all | names...} {--replicas count} [--force]"]
}

const OPT_FORCE = '--force';
const OPT_REPLICAS = '--replicas'

class ScaleCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_FORCE] = true;
    this.spec.options[OPT_REPLICAS] = true;
  }

  async init(saasContext) {
    await super.init(saasContext);

    if (this.isOptionPresent(OPT_FORCE)) {
      log.warn(`${OPT_FORCE} specified, skipping in-use guards`);
    } else {
      let production = new InboundPool(saasContext, Pools.PRODUCTION);
      let prodVersion = await production.getSubsetVersion();

      if (this.subset === prodVersion) {
        tk.println('prod:' + prodVersion);
        throw new LogicalError(`Refusing to update the production pool version ${prodVersion} (use ${OPT_FORCE})`);
      }
    }
  }

  async run() {
    let deployments = await this.listDeployments();
    if (deployments.length) {
      const replicas = Number.parseInt(this.getRequiredOption(OPT_REPLICAS));
      this.logResponses(await this.app.setDeploymentReplicas(deployments, replicas));
    } else {
      log.user('! No deployments found');
    }
  }
}

module.exports.Command = ScaleCommand;
module.exports.ScaleCommand = ScaleCommand;