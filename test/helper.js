const colors = require('colors');
const Path = require('path');

const config = require('../lib/common/config');
const util = require('../lib/common/util');
const Bundle = require('../lib/classes/Bundle');

function getUserHome () {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
};

before(function () {
  this.timeout(0);

  config['workDir'] = Path.join(getUserHome(), '.rbuild', 'test', 'repos');
  config['cacheDir'] = Path.join(getUserHome(), '.rbuild', 'test', 'cache');

  /*
  var buildFile = util.readJSON('test/buildfile.json');
  var bundle = new Bundle(buildFile);
  config.testHelper = {
    buildFile: buildFile,
    bundle: bundle
  };
  */

});
