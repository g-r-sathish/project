const _ = require('underscore');
const chai = require('chai');
const assert = chai.assert;

const artifactory = require('../lib/common/artifactory');

describe('Artifactory', function () {

  it('should compile', function () {
    assert.isDefined(artifactory);
  });


});
