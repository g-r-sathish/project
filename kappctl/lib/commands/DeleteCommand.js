//  Copyright (C) Agilysys, Inc. All rights reserved.

const tk = require('../util/tk');
const {LogicalError} = require("../util/LogicalError");
const {InboundPool} = require('../saas/InboundPool');
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {log} = require("../util/ConsoleLogger");
const {Pools} = require("../saas/Pools");

const OPT_FORCE = '--force';
const OPT_KIND = '--kind';

module.exports.help = {
  summary: "Remove an application's resources (must not have active pods)",
  usages: ["[--subset {@pool|version}] [--force] {--all | names...} [--kind {kind}]"]
}

class DeleteCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_FORCE] = true;
    this.spec.options[OPT_KIND] = true;
    this.force = false;
  }

  async init(saasContext) {
    await super.init(saasContext);
    this.force = this.isOptionPresent(OPT_FORCE);
    this.deployments = await this.listDeployments();

    if (this.force) {
      log.warn(`${OPT_FORCE} specified, skipping in-use guards`);
    } else {
      let production = new InboundPool(saasContext, Pools.PRODUCTION);
      let prodVersion = await production.getSubsetVersion();
      let testPool = new InboundPool(saasContext, Pools.TEST_POOL);
      let testVersion = await testPool.getSubsetVersion();

      if (this.subset === prodVersion || this.subset === testVersion) {
        tk.println('prod:' + prodVersion);
        tk.println('test:' + testVersion);
        throw new LogicalError(`Refusing to delete a pool version (use ${OPT_FORCE})`);
      }

      for (let deployment of this.deployments) {
        if (deployment.hasReplicas()) {
          throw new Error('DeploymentResource has replicas');
        }
      }
    }
  }

  async run() {
    const filter = (resources) => this.filterResources(resources);
    if (this.isOptionPresent(OPT_KIND)) {
      const kind = this.getOption(OPT_KIND);
      log.user(`! Deleting ${kind} resources (subset=${this.subset})`);
      this.logResponses(await this.app.deleteResources(kind, filter));
    } else {
      log.user(`! Deleting resources (subset=${this.subset})`);
      this.logResponses(await this.app.deleteAllResources(filter));
    }
  }

}

module.exports.Command = DeleteCommand;
module.exports.DeleteCommand = DeleteCommand;