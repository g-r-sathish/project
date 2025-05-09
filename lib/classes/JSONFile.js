const sprintf = require('sprintf-js').sprintf;

const util = require('../common/util');

/**
 * @class
 * @param {string} absolutePath
 */
function JSONFile (absolutePath) {
  this.data = {};
  this.path = '';
  if (absolutePath) {
    this.load(absolutePath);
  }
}

JSONFile.prototype.load = function (absolutePath) {
  this.data = util.readJSON(absolutePath);
  this.path = absolutePath;
};

JSONFile.prototype.save = function () {
  this.saveAs(this.path);
};

JSONFile.prototype.saveAs = function (absolutePath) {
  util.writeJSON(absolutePath, this.data);
  this.path = absolutePath;
};

JSONFile.prototype.getValue = function (key) {
  return this.data[key];
};

JSONFile.prototype.setValue = function (key, value) {
  if (!util.isPresent(key)) throw new Error('Missing assignment key');
  if (!util.isPresent(value)) throw new Error(sprintf('Missing value for assignment to: %s', key));
  return this.data[key] = value;
};

JSONFile.prototype.deleteValue = function (key) {
  if (!util.isPresent(key)) throw new Error('Missing assignment key');
  return delete this.data[key];
};

module.exports = JSONFile;
