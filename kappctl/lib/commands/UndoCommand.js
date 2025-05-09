//  Copyright (C) Agilysys, Inc. All rights reserved.

const {ApplicationCommand} = require("./base/ApplicationCommand");
const {log} = require("../util/ConsoleLogger");

module.exports.help = {
  summary: "Undo the last deployment",
  usages: ["[--subset {@pool|version}] {--all | names...}"]
}

class UndoCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
  }

  async run() {
    const deployments = await this.listDeployments();
    log.user(`Found ${deployments.length} deployments to undo`);
    this.logResponses(await this.app.rolloutUndo(deployments));
  }
}

module.exports.Command = UndoCommand;