//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Command} = require("./base/Command");
const {InboundPool} = require("../saas/InboundPool");
const {log} = require("../util/ConsoleLogger");
const {Pools} = require("../saas/Pools");

module.exports.help = {
  summary: "Show as much information as possible about the state of the application",
  usages: [""]
}

class InfoCommand extends Command {
  async run() {
    const pools = new Pools(this.saasContext)
    const prod = await pools.prod.getApplication();
    const test = await pools.test.getApplication();
    const env = this.saasContext.environmentFile;

    log.group('# General');
    log.user('[%s] %s', 'Test pool enabled', env.isTestpoolEnabled());
    log.groupEnd()

    if (env.isTestpoolEnabled()) {
      log.group('# Subsets');
      log.user('[%s] %s', 'Production', prod.getSubsetVersion());
      log.user('[%s] %s', 'Test-pool', test.getSubsetVersion());
      log.groupEnd()
      log.group('# Config branch');
      log.user('[%s] %s', 'Upstream', prod.getConfigRepoBranchUpstream());
      log.user('[%s] %s', 'Production', prod.getConfigRepoBranch());
      log.user('[%s] %s', 'Test-pool', test.getConfigRepoBranch());
      log.groupEnd()
      if (prod.usesManagedConfigRepoBranches()) {
        log.group('# Config branch source');
        log.user('[%s] %s', 'Production', prod.getConfigRepoBranchSource());
        log.user('[%s] %s', 'Test-pool', test.getConfigRepoBranchSource());
        log.groupEnd()
      }
    } else {
      log.group('# Details');
      log.user('[%s] %s', 'Subset', prod.getSubsetVersion());
      log.user('[%s] %s', 'Config branch', prod.getConfigRepoBranch());
      if (prod.usesManagedConfigRepoBranches()) {
        log.user('[%s] %s', 'Config branch source', prod.getConfigRepoBranchSource());
      }
      log.groupEnd()
    }
  }
}

module.exports.Command = InfoCommand;