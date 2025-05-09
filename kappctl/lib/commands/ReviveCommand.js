//  Copyright (C) Agilysys, Inc. All rights reserved.

const {ApplicationCommand} = require('./base/ApplicationCommand');
const {log} = require("../util/ConsoleLogger");

module.exports.help = {
  summary: "Remove an application's resources (must not have active pods)",
  usages: ["[--subset {@pool|version}] {--all | names...}"]
}

class ReviveCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
  }

  async run() {
    let deployments = await this.listDeployments();
    if (deployments.length) {
      this.logResponses(await this.app.spinUp(deployments));
    } else {
      log.user('! No deployments found');
    }
  }

}

module.exports.Command = ReviveCommand;
module.exports.ReviveCommand = ReviveCommand;