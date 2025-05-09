const chai = require('chai');
const assert = chai.assert;

const {VersionEx} = require('../lib/classes/VersionEx');

describe('VersionEx', function () {

  let newbie = new VersionEx();
  let basic = new VersionEx('1.2.3.4');
  let sprint68 = new VersionEx('68.0.0.1-SNAPSHOT');
  let lowercased = new VersionEx('74.1554-rgstay-2880-snapshot');
  let crazy = new VersionEx('99.9.9.9-VCTRS-9999-FOOBAR-SNAPSHOT');
  let nonNumeric = new VersionEx('${stay.dependencies.version}');

  it('should have a sensible default constructor', function () {
    assert.equal(newbie.major, 0);
    assert.equal(newbie.minor, 0);
    assert.equal(newbie.revision, 0);
    assert.equal(newbie.build, 1);
    assert.equal(newbie.toString(), '0.0.0');
    assert.isFalse(newbie.isSnapshot());
    assert.isFalse(newbie.hasQualifier('HF'));
  });

  it('should parse correctly', function () {
    assert.equal(basic.major, 1);
    assert.equal(basic.minor, 2);
    assert.equal(basic.revision, 3);
    assert.equal(basic.build, 4);
    assert.equal(basic.toString(), '1.2.3.4');
    assert.isFalse(basic.isSnapshot());
    assert.isFalse(basic.hasQualifier('HF'));
  });

  it('should provide common sense functionality', function () {
    assert.equal(basic.getBundleString(), '1.2.3');
    assert.equal(basic.getReleaseString(), '1.2.3.4');
    assert.equal(basic.getSnapshotString(), '1.2.3.4-SNAPSHOT');
    assert.equal(basic.getPriorReleaseString(), '1.2.3.3');
  });

  it('should exclude -SNAPSHOT when told', function () {
    assert.isTrue(sprint68.hasQualifier('SNAPSHOT'));
    assert.isTrue(sprint68.isSnapshot());
    assert.equal(sprint68.toString(), '68.0.0.1-SNAPSHOT');
    assert.equal(sprint68.toString(true), '68.0.0.1-SNAPSHOT');
    assert.equal(sprint68.toString(false), '68.0.0.1');
    assert.equal(sprint68.getPriorReleaseString(), '68.0.0.0');
  });

  it('should not emit negative values', function () {
    var v = new VersionEx('1.2.3.0');
    assert.equal(v.getPriorReleaseString(), '1.2.3.0');
  });

  it('should preserve all non-snapshot qualifiers', function () {
    assert.isTrue(crazy.hasQualifier('SNAPSHOT'));
    assert.isTrue(crazy.hasQualifier('9999'));
    assert.isTrue(crazy.hasQualifier('VCTRS'));
    assert.isTrue(crazy.hasQualifier('FOOBAR'));
    assert.isFalse(crazy.hasQualifier('VCTRS-9999'));
    assert.isFalse(crazy.hasQualifier('FOO'));
    assert.equal(crazy.toString(), '99.9.9.9-VCTRS-9999-FOOBAR-SNAPSHOT');
    assert.equal(crazy.getSnapshotString(), '99.9.9.9-VCTRS-9999-FOOBAR-SNAPSHOT');
    assert.equal(crazy.getReleaseString(), '99.9.9.9-VCTRS-9999-FOOBAR');
  });

  it('should roll to the next sprint', function () {
    assert.equal(newbie.getNextIterationVersion().toString(true), '1.0.0-SNAPSHOT');
  });

  it('should be able to compare numerically', function () {
    function cmp (a, b) {
      return new VersionEx(a).compareTo(new VersionEx(b));
    }
    // three-segment
    assert.equal(cmp('1.0.0', '1.0.0'), 0);
    assert.isBelow(cmp('1.0.0', '1.0.1'), 0);
    assert.isBelow(cmp('1.0.0', '1.1.0'), 0);
    assert.isBelow(cmp('1.0.0', '2.0.0'), 0);
    assert.isBelow(cmp('74.0.1', '74.9.0'), 0);
    assert.isAbove(cmp('74.9.0', '74.0.1'), 0);

    // four-segment
    assert.equal(cmp('1.0.0.0', '1.0.0.0'), 0);
    assert.isBelow(cmp('1.0.0.0', '1.0.0.1'), 0);
    assert.isBelow(cmp('1.0.0.0', '1.0.1.0'), 0);
    assert.isBelow(cmp('1.0.0.0', '1.1.0.0'), 0);
    assert.isBelow(cmp('1.0.0.0', '2.0.0.0'), 0);

    // mixed (60.0.0.0 < 60.0.0 < 60.0.0.1)
    assert.isBelow(cmp('60.0.0.0', '60.0.0'), 0);
    assert.isBelow(cmp('60.0.0', '60.0.0.1'), 0);
    assert.isBelow(cmp('60.0.0.0', '60.0.0.1'), 0);
    assert.isAbove(cmp('60.0.0', '60.0.0.0'), 0);
    assert.isAbove(cmp('60.0.0.1', '60.0.0'), 0);
    assert.isAbove(cmp('60.0.0.1', '60.0.0.0'), 0);
  });

  it('should be able to compare by hotfix version', function () {
    function cmp(a, b) {
      return new VersionEx(a).compareTo(new VersionEx(b));
    }
    assert.equal(cmp('1.0.0-HF1', '1.0.0-HF1'), 0);
    assert.equal(cmp('1.0.0-HF1', '1.0.0-HF2'), -1);
    assert.equal(cmp('1.0.0-HF3', '1.0.0-HF2'), 1);
    assert.equal(cmp('1.0.0-HF11', '1.0.0-HF2'), 1);
    assert.equal(cmp('1.0.0-HF1', '1.0.0'), 1);
    assert.equal(cmp('1.0.0', '1.0.0-HF1'), -1);
  });

  it('should know how to detect tracking-ids', function () {
    assert.isTrue(new VersionEx('73.0.1-RSI-123').hasTrackingId());
    assert.isTrue(new VersionEx('73.0.1-VCTRS-54321').hasTrackingId());
    assert.isTrue(new VersionEx('73.0.1-VCTRS-54321-SNAPSHOT').hasTrackingId());
    assert.isTrue(new VersionEx('73.0.1-FOOBAR-12345-SNAPSHOT').hasTrackingId());
    assert.equal(new VersionEx('74.0-HF1-VCTRS-12345-SNAPSHOT').getTrackingId(), 'VCTRS-12345');
    assert.isFalse(new VersionEx('73.0.1-FOO-BAR-12345-SNAPSHOT').hasTrackingId());
    assert.isFalse(new VersionEx('73.0.1-SNAPSHOT').hasTrackingId());
    assert.isFalse(new VersionEx('73.0.1-SNAPSHOT-12345').hasTrackingId());
    assert.isFalse(new VersionEx('73.0.1-HF1').hasTrackingId());
    assert.isFalse(new VersionEx('73.0.1-HF-1').hasTrackingId());
  });

  it('should handle hotfix qualifiers', function() {
    assert.isTrue(new VersionEx('74.0-HF1').hasHotfix());
    assert.isTrue(new VersionEx('74.0.1-HF1-SNAPSHOT').hasHotfix());
    assert.isTrue(new VersionEx('74.0-HF1-VCTRS-12345-SNAPSHOT').hasHotfix());
    assert.equal(new VersionEx('74.0-HF2').getHotfix(), 2);
    assert.equal(new VersionEx('74.0.1-HF11-SNAPSHOT').getHotfix(), 11);
    assert.equal(new VersionEx('74.0-HF3-VCTRS-12345-SNAPSHOT').getHotfix(), 3);
  });

  it('should handle unexpected values', function() {
    let bTrue = new VersionEx(true);
    assert.equal(bTrue.toString(), '0.0.0');
  });

  it('should support easy comparisons', function() {
    let v1 = new VersionEx('1.0.0');
    let v2 = new VersionEx('2.0.0');
    assert.isTrue(v1.equals(v1));
    assert.isTrue(v1.isGreaterThanOrEqualTo(v1));
    assert.isTrue(v1.isLessThanOrEqualTo(v1));
    assert.isTrue(v1.isLessThan(v2));
    assert.isTrue(v2.isGreaterThan(v1));
    assert.isTrue(v2.isGreaterThanOrEqualTo(v1));
  });

  it('should not be case sensitive wrt snapshots', function () {
    assert.isTrue(lowercased.isSnapshot());
  });

  it('should handle docker image suffixes', function() {
    assert.isTrue(new VersionEx('74.0-HF1-8u232').hasHotfix());
    assert.isTrue(new VersionEx('74.0.1-HF1-SNAPSHOT-8u232').hasHotfix());
    assert.isTrue(new VersionEx('74.0-HF1-VCTRS-12345-SNAPSHOT-8u232').hasHotfix());
    assert.equal(new VersionEx('74.0-HF2-8u232').getHotfix(), 2);
    assert.equal(new VersionEx('74.0.1-HF11-SNAPSHOT-8u232').getHotfix(), 11);
    assert.equal(new VersionEx('74.0-HF3-VCTRS-12345-SNAPSHOT-8u232').getHotfix(), 3);
    assert.equal(new VersionEx('74.0-HF3-VCTRS-12345-SNAPSHOT-8u232').major, 74);
    assert.equal(new VersionEx('74.0-HF3-VCTRS-12345-SNAPSHOT-8u232').minor, 0);
  });

});
