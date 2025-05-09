const chai = require('chai');
const assert = chai.assert;
const util = require('../lib/common/util');

describe('util', function () {

  it('should write a temp file', function () {
    const expectedContent = 'Not here long';
    let path = util.writeTempFile(expectedContent);
    let content = util.readFile(path);
    assert.equal(content, expectedContent);
  });

  it('should render a template', function () {
    const expectedContent = 'Hello World!';
    let content = util.renderTemplate('test-template.txt', {audience: 'World'});
    assert.equal(content, expectedContent);
  });

  it('should write /tmp/init-project.sh for inspection', function () {
    let content = util.renderTemplate('init-repo.sh');
    util.writeFile('/tmp/init-repo.sh', content);
  });

});
