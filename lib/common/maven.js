const sprintf = require('sprintf-js').sprintf;
const config = require('./config');
const util = require('./util');

let mavenService = {};
let settingsXmlPath = undefined;

function getSettingsXmlPath () {
  if (!settingsXmlPath) {
    let content = util.renderTemplate('settings.xml');
    settingsXmlPath = util.writeTempFile(content, {postfix: '.xml'});
  }
  return settingsXmlPath;
}

function getDependency(args, location, options) {
  if (!util.directoryExists(location)) {
    util.mkdirs(location);
  }
  args.unshift(getSettingsXmlPath());
  args.unshift('-s');
  let proc = util.exec('mvn', args, location, options);
  return proc.status === 0;
}

mavenService.copy = function (artifact, location, options) {
  let args = ['org.apache.maven.plugins:maven-dependency-plugin:3.0.0:copy', sprintf('-Dartifact=%s', artifact), '-DoutputDirectory=.', '-Dmdep.stripVersion=true'];
  return getDependency(args, location, options);
};

mavenService.unpack = function (artifact, location, options) {
  let args = ['org.apache.maven.plugins:maven-dependency-plugin:3.0.0:unpack', sprintf('-Dartifact=%s', artifact), '-DoutputDirectory=.', '-Dproject.basedir.'];
  return getDependency(args, location, options);
};

mavenService.getSettingsXmlPath = function () {
  return getSettingsXmlPath();
};

module.exports.mavenService = mavenService;
