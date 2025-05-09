const _ = require('underscore');
const chai = require('chai');
const assert = chai.assert;

const config = require('../lib/common/config');

describe('Config', function () {

  it('should compile', function () {
    assert.isDefined(config);
  });

});
