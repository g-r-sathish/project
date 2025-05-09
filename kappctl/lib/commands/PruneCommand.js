//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Command} = require('./base/Command');
const _ = require('lodash');
const {log} = require("../util/ConsoleLogger");
const {Pools} = require("../saas/Pools");
const {LogicalError} = require("../util/LogicalError");

module.exports.help = {
  summary: "Cleanup unused references",
  usages: ['--confirm']
}

const OPT_CONFIRM = '--confirm';

class PruneCommand extends Command {
  constructor(args, options) {
    super(args, options);
    /** @member {Pools} */
    this.pools = undefined;
    this.spec.flags[OPT_CONFIRM] = true;
  }

  async init(saasContext) {
    await super.init(saasContext);
    this.pools = new Pools(saasContext);
  }

  async run() {
    if (!this.isOptionPresent(OPT_CONFIRM)) {
      throw new LogicalError(`Must specify --confirm to continue`);
    }
    const env = this.saasContext.environmentFile;
    const all = Object.keys(env.get('subsets'));
    const active = [
      await this.pools.test.getSubsetVersion(),
      await this.pools.prod.getSubsetVersion()
    ];
    const obsolete = _.difference(all, active);
    for (const subset of obsolete) {
      try {
        log.group(`# Remove subset ${subset}`);
        const app = await this.pools.selectApplication(subset);
        this.logResponses(await app.deleteAllResources());
        env.unset(`subsets.${subset}`);
        await env.save().checkIn(`cleanup (remove unused subset: ${subset})`);
      } finally {
        log.groupEnd();
      }
    }
  }
}

module.exports.Command = PruneCommand;
module.exports.PruneCommand = PruneCommand;