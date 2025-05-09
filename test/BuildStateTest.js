const chai = require('chai');
const assert = chai.assert;
const BuildState = require('../lib/classes/BuildState');

describe('BuildState', function () {

  it('should construct without parameters', function () {
    let buildState = new BuildState();
    assert.isNotNull(buildState);
  });

  it('should construct from json', function () {
    let id = 'fourty-two';
    let buildState = new BuildState({buildId: id});
    assert.isNotNull(buildState);
    assert.equal(buildState.buildId, id);
  });

});
