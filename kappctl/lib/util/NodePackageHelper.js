//  Copyright (C) Agilysys, Inc. All rights reserved.

const Path = require("path");
const semver = require("semver");
const fs = require("fs");
const files = require("./files");
const {spawnSync} = require('child_process');
const {log} = require("./ConsoleLogger");
const {LogicalError} = require("./LogicalError");
const assert = require("assert").strict;

class VersionEOLError extends Error {
  constructor(helper, ourVersion, minVersion) {
    super(`[${helper.packageName}] Upgrade required: current=${ourVersion}, required=${minVersion}`);
    this.helper = helper;
  }
}

class ProcessLockedError extends LogicalError {
  constructor(helper, pid) {
    const message = `An instance of ${helper.shortName} is already running with pid=${pid}. ` +
      `(Remove ${helper.pidFilePath} if this is pid is now owned by another process.)`;
    super(message);
    this.helper = helper;
  }
}

class NodePackageHelper {
  constructor(packageJsonPath) {
    this.packageJson = require(packageJsonPath);
  }

  get userHomeDir() {
    return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
  }

  get packageName() {
    return this.packageJson.name;
  }

  get shortName() {
    return this.packageName.replace(/^@[^/]+\//, '');
  }

  get dotName() {
    return "." + this.shortName;
  }

  get dotDir() {
    return Path.join(this.userHomeDir, this.dotName);
  }

  get pidFilePath() {
    return Path.join(this.dotDir, `pid.lock`);
  }

  /**
   * Ensure our version (`version` field from `package.json`) meets the requirement.
   * @throws {VersionEOLError} when our version is less than `minVersion`
   * @throws {Assertion} when `minVersion` is not valid
   * @param {String} minVersion minimum version (semver)
   * @return {Boolean} true when our version is gte `minVersion`
   */
  ensureVersion(minVersion) {
    assert.ok(semver.valid(minVersion), 'Minimum version is not valid');
    const ourVersion = this.packageJson.version;
    if (semver.lt(ourVersion, minVersion)) {
      throw new VersionEOLError(this, ourVersion, minVersion);
    }
    return true;
  }

  lockPidFile() {
    if (files.fileExists(this.pidFilePath)) {
      const pid = files.readFile(this.pidFilePath);
      const proc = spawnSync('ps', ['-p', pid], {stdio: ['ignore', 'pipe', 'pipe']});
      if (proc.error) {
        throw proc.error;
      }
      if (proc.status === 0) {
        throw new ProcessLockedError(this, pid);
      }
    }
    files.writeFile(this.pidFilePath, `${process.pid}`);
  }

  unlockPidFile() {
    if (files.fileExists(this.pidFilePath)) {
      const pid = files.readFile(this.pidFilePath);
      if (parseInt(pid) === process.pid) {
        fs.unlinkSync(this.pidFilePath);
      }
    }
  }
}

module.exports.VersionEOLError = VersionEOLError;
module.exports.ProcessLockedError = ProcessLockedError;
module.exports.NodePackageHelper = NodePackageHelper;
module.exports.ourPackage = new NodePackageHelper('../../package.json');