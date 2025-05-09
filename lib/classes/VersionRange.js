const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const {VersionEx} = require('./VersionEx');

/*
 * @class VersionRange
 */

function VersionRange (value) {
  this.parse(value);
}

VersionRange.prototype.clone = function () {
  return new VersionRange(this.toString());
};

VersionRange.prototype.parse = function (value) {
  let match = value ? value.match(/([\[\(])([A-Z0-9\.-]+)?,([A-Z0-9\.-]+)([\]\)])/) : [];
  this.lowerBound = match[1];
  this.lowerValue = match[2];
  this.upperValue = match[3];
  this.upperBound = match[4];
  this.lowerVersion = this.lowerValue ? new VersionEx(this.lowerValue) : undefined;
  this.upperVersion = this.upperValue ? new VersionEx(this.upperValue) : undefined;
};

VersionRange.prototype.isSnapshot = function () {
  return this.upperVersion.isSnapshot();
};

VersionRange.prototype.toString = function (withSnapshot) {
  let lowerValue = this.lowerVersion ? this.lowerVersion.toString(withSnapshot) : '';
  let upperValue = this.upperVersion ? this.upperVersion.toString(withSnapshot) : '';
  return sprintf('%s%s,%s%s', this.lowerBound, lowerValue, upperValue, this.upperBound);
};

VersionRange.prototype.getSnapshotString = function () {
  return this.toString(true);
};

VersionRange.prototype.getReleaseString = function () {
  return this.toString(false);
};

module.exports.VersionRange = VersionRange;
