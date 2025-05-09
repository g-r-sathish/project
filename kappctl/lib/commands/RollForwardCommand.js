//  Copyright (C) Agilysys, Inc. All rights reserved.

const {SwapCommand} = require("./base/SwapCommand");

module.exports.help = {
  summary: "Swap test pool with production (if test pool is ahead)",
  usages: ["[--force]"],
}

class RollForwardCommand extends SwapCommand {
  /**
   * @override
   * @param {Number} prodVersion
   * @param {Number} testVersion
   * @return {boolean}
   */
  checkDirection(prodVersion, testVersion) {
    if (prodVersion > testVersion) {
      throw new Error('Production is ahead of test pool (perhaps you want to roll back?)');
    }
  }
}

module.exports.Command = RollForwardCommand;
module.exports.RollForwardCommand = RollForwardCommand;