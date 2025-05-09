//  Copyright (C) Agilysys, Inc. All rights reserved.

const {SwapCommand} = require("./base/SwapCommand");

module.exports.help = {
  summary: "Swap test pool with production (if production is ahead)",
  usages: ["[--force]"]
}

class RollBackCommand extends SwapCommand {
  /**
   * @override
   * @param {Number} prodVersion
   * @param {Number} testVersion
   * @return {boolean}
   */
  checkDirection(prodVersion, testVersion) {
    if (prodVersion < testVersion) {
      throw new Error('Testpool is ahead of production (perhaps you want to roll forward?)');
    }
  }
}

module.exports.Command = RollBackCommand;
module.exports.RollBackCommand = RollBackCommand;