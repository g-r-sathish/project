//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Command} = require('./base/Command');
const {ProvisioningManager} = require("../saas/management/ProvisioningManager");
const {PoolManager} = require("../saas/management/PoolManager");

module.exports.help = {
  summary: "Cluster-level resource management",
  usages: ["{[--cluster] [--pools] [--services] [--subset {version} [--config-repo] [--only-inbound]}"],
}

const OPT_CLUSTER = '--cluster';
const OPT_CONFIG_REPO = '--config-repo';
const OPT_POOLS = '--pools';
const OPT_SERVICES = '--services';
const OPT_SUBSET = '--subset';
const OPT_ONLY_INBOUND = '--only-inbound';

class InitCommand extends Command {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_CONFIG_REPO] = true;
    this.spec.flags[OPT_CLUSTER] = true;
    this.spec.flags[OPT_POOLS] = true;
    this.spec.flags[OPT_SERVICES] = true;
    this.spec.flags[OPT_ONLY_INBOUND] = true;
    this.spec.options[OPT_SUBSET] = true;
  }

  async init(saasContext) {
    await super.init(saasContext);
  }

  async run() {
    const provisioner = new ProvisioningManager(this.saasContext);
    if (this.isOptionPresent(OPT_CLUSTER)) {
      await provisioner.clusterInit();
    }
    if (this.isOptionPresent(OPT_POOLS)) {
      await provisioner.initPools();
    }
    if (this.isOptionPresent(OPT_SERVICES)) {
      await provisioner.servicesInit();
    }
    if (this.isOptionPresent(OPT_SUBSET)) {
      const subset = this.getOption(OPT_SUBSET);
      if (this.isOptionPresent(OPT_CONFIG_REPO)) {
        await provisioner.initConfigRepo(subset);
      }
      await provisioner.subsetInit(subset);
      // Part of Istio sidecar routing
      // if(!this.isOptionPresent(OPT_ONLY_INBOUND)) {
      //   await provisioner.subsetInitAppMesh(subset);
      // }
    }
  }
}

module.exports.Command = InitCommand;
module.exports.InitCommand = InitCommand;