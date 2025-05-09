const chai = require('chai');
const assert = chai.assert;
const util = require('../lib/common/util');

const TEST_FILE='test/fixtures/yaml-serialization.yml';
const TEMP_FILE='/tmp/yaml-serialization.yml'
const NUMBER = typeof 1;
const STRING = typeof '';


describe('YAML de/serialization', function () {

  function checkDeserialized(obj) {
    // Up to spec
    // https://github.com/yaml/yaml-grammar/blob/master/yaml-spec-1.2.txt
    assert.equal(typeof obj.unquoted, NUMBER);
    assert.equal(typeof obj.quoted, STRING);
    assert.equal(typeof obj.infinity, NUMBER);
    assert.equal(typeof obj.hex, NUMBER);
    assert.equal(obj.infinity, Number.POSITIVE_INFINITY);
    // Not handled
    assert.equal(typeof obj.octal, STRING); // should be NUMBER
  }

  it('should handle commit-ids as expected', function () {
    let data = util.readYAML(TEST_FILE);
    checkDeserialized(data);

    util.writeYAML(TEMP_FILE, data);
    checkDeserialized(util.readYAML(TEMP_FILE));
  });

});
