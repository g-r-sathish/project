//  Copyright (C) Agilysys, Inc. All rights reserved.

const tk = require('../util/tk');
const _ = require('lodash');
const {Application} = require('../saas/Application');
const {InboundPool} = require('../saas/InboundPool');
const {Command} = require('./base/Command');
const {ApplicationCommand} = require("./base/ApplicationCommand");
const {log} = require("../util/ConsoleLogger");
const {StatusManager} = require("../saas/management/StatusManager");

const OPT_WAIT = '--wait';

module.exports.help = {
  summary: "Restart application services",
  usages: [`[--subset {@pool|version}] {--all | names...} [${OPT_WAIT}]`]
}

class RestartCommand extends ApplicationCommand {

  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_WAIT] = true;
  }

  async run() {
    let restarts = [];
    const deployments = await this.listDeployments();
    log.user(`Found ${deployments.length} deployments to restart`);
    this.logResponses(await this.app.rolloutRestart(deployments));
    if (this.isOptionPresent(OPT_WAIT)) {
      const statusManager = new StatusManager(this.app);
      await statusManager.waitUntilAllComplete(deployments);
    }
  }
}

module.exports.Command = RestartCommand;
module.exports.RestartCommand = RestartCommand;