const chai = require('chai');
const assert = chai.assert;


const VersionRange = require('../lib/classes/VersionRange').VersionRange;

describe('VersionRange', function () {

  var vr1 = new VersionRange('[68.0.0-SNAPSHOT,69.1.2-SNAPSHOT)');

  it('should parse correctly', function () {
    assert.equal(vr1.lowerBound, '[');
    assert.equal(vr1.upperBound, ')');
    assert.equal(vr1.lowerValue, '68.0.0-SNAPSHOT');
    assert.equal(vr1.upperValue, '69.1.2-SNAPSHOT');
    assert.equal(vr1.lowerVersion.toString(), '68.0.0-SNAPSHOT');
    assert.equal(vr1.upperVersion.toString(), '69.1.2-SNAPSHOT');
    assert.equal(vr1.toString(), '[68.0.0-SNAPSHOT,69.1.2-SNAPSHOT)');
    assert.equal(vr1.toString(true), '[68.0.0-SNAPSHOT,69.1.2-SNAPSHOT)');
    assert.equal(vr1.toString(false), '[68.0.0,69.1.2)');
  });

  it('should roll to the next major version', function () {
    var vr = vr1.clone();
    vr.upperVersion.rollMajor();
    assert.equal(vr.lowerVersion.toString(), '68.0.0-SNAPSHOT');
    assert.equal(vr.upperVersion.toString(), '70.0.0-SNAPSHOT');
    assert.equal(vr.toString(), '[68.0.0-SNAPSHOT,70.0.0-SNAPSHOT)');
  });

});
