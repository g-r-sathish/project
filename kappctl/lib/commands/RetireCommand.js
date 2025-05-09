//  Copyright (C) Agilysys, Inc. All rights reserved.

const tk = require('../util/tk');
const {LogicalError} = require("../util/LogicalError");
const {InboundPool} = require('../saas/InboundPool');
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {log} = require("../util/ConsoleLogger");
const {Pools} = require("../saas/Pools");

module.exports.help = {
  summary: "Remove an application's resources (must not have active pods)",
  usages: ["[--subset {@pool|version}] [--keep-one] [--force]"],
}

const OPT_FORCE = '--force';
const OPT_KEEP_ONE = '--keep-one';

class RetireCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_FORCE] = true;
    this.spec.flags[OPT_KEEP_ONE] = true;
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
        throw new LogicalError(`Refusing to retire the production pool version ${prodVersion} (use ${OPT_FORCE})`);
      }
    }
  }

  async run() {
    let deployments = await this.listDeployments();
    if (deployments.length) {
      const replicas = this.isOptionPresent(OPT_KEEP_ONE) ? 1 :0;
      this.logResponses(await this.app.spinDown(deployments, replicas));
    } else {
      log.user('! No deployments found');
    }
  }

}

module.exports.Command = RetireCommand;
module.exports.RetireCommand = RetireCommand;