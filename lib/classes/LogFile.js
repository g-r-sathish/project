const _ = require('underscore');
const fs = require('fs');
const sprintf = require('sprintf-js').sprintf;
const stripAnsi = require('strip-ansi');

const config = require('../common/config');
const Package = require('../../package.json');
const util = require('../common/util');

const horizontalLine = '-'.repeat(60);

/**
 * @class
 * @param logConfig
 * @param prefix
 */
function LogFile (logConfig, prefix) {
  this.path = undefined;
  this.threshold = undefined;
  this.prefix = prefix;

  this.setThreshold(logConfig.threshold);
  this.load(logConfig.path);
  if (!prefix) {
    this.write(sprintf('\n%s\n', horizontalLine));
    this.write(sprintf('Date:      %s\n', new Date()));
    this.write(sprintf('Process:   %s\n', config.rName));
    this.write(sprintf('Version:   %s\n', Package.version));
    this.write(sprintf('Node:      %s\n', process.version));
    this.write(sprintf('Arguments: %s\n', process.argv));
    this.write(sprintf('%s\n\n', horizontalLine));
  }
}

LogFile.prototype.setThreshold = function (threshold) {
  this.threshold = threshold;
};

LogFile.prototype.load = function (absolutePath) {
  this.path = absolutePath;
  util.mkfiledir(this.path);
  try {
    let stat = fs.statSync(this.path);
    if (this.threshold && stat.size > this.threshold) {
      util.copyFile(this.path, this.path + '.bak', {overwrite: true});
      let fd = fs.openSync(this.path, 'w');
      fs.ftruncateSync(fd, 0);
    }
  } catch (ex) {
    if (!/ENOENT/.test(ex)) throw ex
  }
};

LogFile.prototype.write = function (content) {
  const fd = fs.openSync(this.path, "a+");
  let output = stripAnsi(content);
  if (this.prefix) {
    output = this.prefix + output.replace(/\n(?!$)/g, '\n' + this.prefix);
  }
  fs.appendFileSync(fd, output, 'utf8');
  fs.fdatasyncSync(fd);
};

module.exports = LogFile;
