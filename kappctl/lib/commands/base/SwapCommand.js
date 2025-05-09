//  Copyright (C) Agilysys, Inc. All rights reserved.

const tk = require('../../util/tk');
const {log} = require("../../util/ConsoleLogger");
const {Command} = require('./Command');
const {InboundPool} = require('../../saas/InboundPool');
const {LogicalError} = require("../../util/LogicalError");
const {PoolManager} = require("../../saas/management/PoolManager");
const {StatusManager} = require("../../saas/management/StatusManager");
const {Pools} = require("../../saas/Pools");
const {HealthcheckManager} = require("../../saas/management/HealthcheckManager");

const OPT_FORCE = '--force';

class SwapCommand extends Command {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_FORCE] = true;
    this.pools = undefined;
  }

  async init(saasContext) {
    await super.init(saasContext);
    this.pools = new Pools(saasContext);

    const prodInboundSubset = await this.pools.prod.getSubsetVersion();
    const testInboundSubset = await this.pools.test.getSubsetVersion();
    this.checkDirection(tk.versionToNumber(prodInboundSubset), tk.versionToNumber(testInboundSubset));
  }

  /**
   * @abstract
   * @param {Number} prodVersion
   * @param {Number} testVersion
   * @return {boolean}
   */
  checkDirection(prodVersion, testVersion) {}

  async run() {
    const ascendingApp = await this.pools.test.getApplication();
    const descendingApp = await this.pools.prod.getApplication();
    const poolManager = new PoolManager(this.saasContext);
    const statusManager = new StatusManager(ascendingApp);

    log.group(`# Ensuring ascending subset (${ascendingApp.subset}) is healthy`);
    this.ensuringGate('missing', await statusManager.getMissingDeployments());
    this.ensuringGate('unhealthy', await statusManager.getUnhealthyDeployments());
    log.groupEnd();

    return poolManager.swap(ascendingApp, descendingApp);
  }

  ensuringGate(adjective, list) {
    if (list.length) {
      if (this.isOptionPresent(OPT_FORCE)) {
        log.warn(`${OPT_FORCE} specified, continuing while ${list.length} deployments are ${adjective}`);
      } else {
        throw new LogicalError(`Refusing to continue (without ${OPT_FORCE}) while ${list.length} deployments are ${adjective}`);
      }
    }
  }
}

module.exports.SwapCommand = SwapCommand;