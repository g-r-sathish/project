'use strict';

const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError')
const config = require('../common/config');
const util = require('../common/util');

class VersionEx {
  static RELEASED = -1;
  static LITERAL = 0;
  static NEXT_RELEASE = 1;
  static RANGE = 1;
  static RETIRED = 'RETIRED';

  /** @private */
  static SNAPSHOT = 'SNAPSHOT';

  /** @private */
  static SNAPSHOT_LOWERCASE = 'snapshot';

  /** @private */
  static HOTFIX_REGEX = /HF\d+/;

  /** @private */
  static HOTFIX_FORMAT = 'HF%d';

  /** @private */
  static LEGACY_TRUNK_DELIMITER = '#';

  /** @private */
  static TRUNK_DELIMITER = '.';

  static fromJsonObject(object) {
    const version = new VersionEx(undefined);
    _.extend(version, object);
    return version;
  }

  constructor(value) {
    this.parse(value);
  }

  parse(value) {
    let qualifierList = value && _.isString(value) ? value.split(/-/) : [];
    let version = qualifierList.shift();
    let segmentList = version ? version.split(/\./) : [];

    // Assign to members
    this.segments = segmentList.length || 3;
    this.major = segmentList.shift() || 0;
    this.minor = segmentList.shift() || 0;
    this.revision = segmentList.shift() || 0;
    this.build = segmentList.shift() || 1;
    this.qualifiers = qualifierList;
  }

  pruneBuildNumber() {
    if (this.segments > 3) {
      this.segments = 3;
    }
    this.build = 1; // default
  }

  clone() {
    return new VersionEx(this.toString());
  }

  isSnapshot() {
    return this.hasQualifier(VersionEx.SNAPSHOT) || this.hasQualifier(VersionEx.SNAPSHOT_LOWERCASE);
  }

  addSnapshot() {
    this.qualifiers = (this.qualifiers || []).concat(VersionEx.SNAPSHOT);
    return this;
  }

  removeSnapshot() {
    return this.removeQualifier(VersionEx.SNAPSHOT);
  }

  hasQualifier(qualifier) {
    return _.contains(this.qualifiers, qualifier);
  }

  hasTrackingId() {
    return !!this.getTrackingId();
  }

  getTrackingId() {
    let filtered = _.filter(this.qualifiers,
      qualifier => qualifier !== VersionEx.SNAPSHOT && !qualifier.match(VersionEx.HOTFIX_REGEX) &&
        !qualifier.includes(VersionEx.TRUNK_DELIMITER) && !qualifier.includes(VersionEx.LEGACY_TRUNK_DELIMITER));
    return (filtered.length >= 2 && filtered[0].match(/^[A-Z]+$/) && filtered[1].match(/^[0-9]{2,6}[a-z]?$/)
      ? sprintf('%s-%s', filtered[0], filtered[1])
      : undefined);
  }

  hasHotfix() {
    return !!this.getHotfix();
  }

  getHotfix() {
    let qualifier = _.find(this.qualifiers, function (qualifier) {
      return qualifier.match(VersionEx.HOTFIX_REGEX);
    });
    return (qualifier ? parseInt(qualifier.substring(2)) : undefined);
  }

  setHotfix(hotfix) {
    return this.removeHotfix().insertQualifier(sprintf(VersionEx.HOTFIX_FORMAT, hotfix));
  }

  removeHotfix() {
    let old = this.getHotfix();
    if (old) {
      this.removeQualifier(sprintf(VersionEx.HOTFIX_FORMAT, old));
    }
    return this;
  }

  hasTrunk() {
    return !!this.getTrunk();
  }

  getTrunk() {
    return _.find(this.qualifiers,
      qualifier => qualifier.includes(VersionEx.TRUNK_DELIMITER) || qualifier.includes(VersionEx.LEGACY_TRUNK_DELIMITER));
  }

  getTrunkName() {
    let qualifier = this.getTrunk();
    if (!qualifier) return undefined;
    let index = qualifier.indexOf(VersionEx.TRUNK_DELIMITER);
    if (index < 0) index = qualifier.indexOf(VersionEx.LEGACY_TRUNK_DELIMITER);
    return qualifier.substring(0, index);
  }

  getTrunkVersion() {
    let qualifier = this.getTrunk();
    if (!qualifier) return undefined;
    let index = qualifier.indexOf(VersionEx.TRUNK_DELIMITER);
    if (index < 0) index = qualifier.indexOf(VersionEx.LEGACY_TRUNK_DELIMITER);
    return parseInt(qualifier.substring(index + 1));
  }

  setTrunk(name, version) {
    let existingQualifier = this.getTrunk();
    let updatedQualifier = sprintf('%s%s%d', name, VersionEx.TRUNK_DELIMITER, version);
    if (existingQualifier) {
      if (name !== this.getTrunkName()) {
        throw new BuildError(sprintf('Unexpected trunk name %s encountered', this.getTrunkName()));
      }
      this.qualifiers[0] = updatedQualifier;
    } else {
      this.qualifiers.unshift(updatedQualifier);
    }
  }

  removeQualifier(qualifierToRemove) {
    this.qualifiers = _.reject(this.qualifiers, function (qualifier) {
      return qualifier === qualifierToRemove;
    });
    return this;
  }

  insertQualifier(qualifier) {
    this.qualifiers = [qualifier].concat(this.qualifiers);
    return this;
  }

  setQualifiers(qualifiersToAdd) {
    this.qualifiers = Array.isArray(qualifiersToAdd) ? qualifiersToAdd : [qualifiersToAdd];
    return this;
  }

// @param withSnapshot will use current qualifiers when it is undefined
  getQualifier(withSnapshot) {
    let validQualifiers = undefined === withSnapshot
      ? this.qualifiers
      : withSnapshot
        ? _.union(this.qualifiers, [VersionEx.SNAPSHOT])
        : _.without(this.qualifiers, VersionEx.SNAPSHOT);
    return validQualifiers.length ? '-' + validQualifiers.join('-') : '';
  }

  toString() {
    let segments = [];
    if (this.segments >= 1) {
      segments.push(this.major);
    }
    if (this.segments >= 2) {
      segments.push(this.minor);
    }
    if (this.segments >= 3) {
      segments.push(this.revision);
    }
    if (this.segments >= 4) {
      segments.push(this.build);
    }
    return sprintf('%s%s', segments.join('.'), this.getQualifier.apply(this, arguments));
  }

// 60.0.0.0 < 60.0.0 < 60.0.0.1
  compareSegment(that, n) {
    if (n > this.segments && n > that.segments) {
      return 0;
    } else if (n > this.segments) {
      return that.getValueBySegment(n) > 0 ? -1 : 1;
    } else if (n > that.segments) {
      return this.getValueBySegment(n) > 0 ? 1 : -1;
    } else {
      return Math.min(Math.max(this.getValueBySegment(n) - that.getValueBySegment(n), -1), 1);
    }
  }

  compareHotfix(that) {
    if (this.hasHotfix() && that.hasHotfix()) {
      let a = this.getHotfix();
      let b = that.getHotfix();
      return a > b ? 1 : b > a ? -1 : 0;
    } else {
      return this.hasHotfix() ? 1 : that.hasHotfix() ? -1 : 0;
    }
  }

  compareTrunk(that) {
    if (this.hasTrunk() && that.hasTrunk()) {
      let aName = this.getTrunkName();
      let bName = that.getTrunkName();
      if (aName !== bName) {
        throw new BuildError('Cannot compare versions from different trunks');
      }
      let a = this.getTrunkVersion();
      let b = that.getTrunkVersion();
      return a > b ? 1 : b > a ? -1 : 0;
    } else {
      return this.hasTrunk() ? 1 : that.hasTrunk() ? -1 : 0;
    }
  }


  getValueBySegment(n) {
    switch (n) {
      case 1:
        return this.major;
      case 2:
        return this.minor;
      case 3:
        return this.revision;
      case 4:
        return this.build;
      default:
        throw new BuildError('Unexpected segment number');
    }
  }

  compareTo(that) {
    let n = 1;
    let delta = 0;

    while (n <= 4 && delta === 0) {
      delta = this.compareSegment(that, n);
      n++;
    }

    delta = delta === 0 ? this.compareTrunk(that) : delta;
    return delta === 0 ? this.compareHotfix(that) : delta;
  }

// The following comparison functions would be better served by implementing `valueOf` so that native
// comparison operators will work. However, that isn't as straight-forward when qualifiers differ, or maybe
// qualifiers can be ignored, or maybe it should return NaN when they differ... Anyway, didn't take the time
// to figure that out...

  equals(that) {
    try {
      return this.compareTo(that) === 0;
    } catch (e) {
      util.narrateln(e.message);
      return false;
    }
  }

  isGreaterThan(that) {
    return this.compareTo(that) === 1;
  }

  isGreaterThanOrEqualTo(that) {
    return this.compareTo(that) >= 0;
  }

  isLessThan(that) {
    return this.compareTo(that) === -1;
  }

  isLessThanOrEqualTo(that) {
    return this.compareTo(that) <= 0;
  }

  getBundleString() {
    return sprintf('%d.%d.%d', this.major, this.minor, this.revision);
  }

  getSnapshotString() {
    return this.toString(true);
  }

  resize(segmentCount) {
    this.segments = segmentCount;
    if (this.segments < 1) {
      this.major = 0;
    }
    if (this.segments < 2) {
      this.minor = 0;
    }
    if (this.segments < 3) {
      this.revision = 0;
    }
    if (this.segments < 4) {
      this.build = 1;
    }
    return this;
  }

  getReleaseString() {
    return this.toString(false);
  }

  rollMajor() {
    this.major++;
    this.minor = 0;
    this.revision = 0;
    this.build = 1;
    return this;
  }

  rollMinor() {
    this.minor++;
    this.revision = 0;
    this.build = 1;
    return this;
  }

  roll() {
    if (this.segments >= 4) {
      this.build++;
    } else {
      this.revision++;
    }
    return this;
  }

  rollback() {
    if (this.segments >= 4) {
      this.build = Math.max(this.build - 1, 0);
    } else {
      this.revision = Math.max(this.revision - 1, 0);
    }
    return this;
  }

  getPriorReleaseString() {
    return this.getPriorReleaseVersion().toString(false);
  }

  getPriorReleaseVersion() {
    let v = this.clone();

    v.removeQualifier(VersionEx.SNAPSHOT);
    v.rollback();
    return v;
  }

  getNextBuildVersion() {
    let v = this.clone();

    v.roll();
    return v;
  }

  getNextIterationVersion() {
    let v = this.clone();

    v.rollMajor();
    return v;
  }
}

module.exports.VersionEx = VersionEx;
