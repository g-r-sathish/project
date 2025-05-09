'use strict'
const _ = require('underscore');

const binUtil = require('../common/bin-util');
const BuildError = require('./BuildError');
const config = require('../common/config');
const deasync = require('deasync');
const ExecError = require('./ExecError');
const http = require('http');
const maven = require('../common/maven').mavenService;
const Path = require('path');
const util = require('../common/util');
const {VersionEx} = require('./VersionEx');

function Artifact(definition, versions) {
  this.definition = definition;
  this.groupId = definition.groupId;
  this.artifactId = definition.artifactId;
  this.version = versions[definition.version_key];
  this.existsInAzure = undefined;
  if (!this.version) {
    throw new BuildError(`Cannot resolve version: ${definition.version_key}`);
  }
}

let proto = Artifact.prototype;

proto.isSnapshot = function () {
  let versionEx = new VersionEx(this.version);
  return versionEx.isSnapshot();
}

proto.getName = function () {
  return `${this.groupId}:${this.artifactId}-${this.version}`;
};

proto.getDisplayName = function () {
  return `${this.groupId.trivial}:${this.artifactId.useful}-${this.version}`;
};

proto.getFilename = function () {
  return util.renderText(this.definition.filename, {version: this.version});
};

proto.isMaintainedByGithubPackage = function () {
  return this.definition.hasOwnProperty('artifactory');
};

proto.getArtifactoryUrl = function () {
  return util.renderText(this.definition.artifactory.url, {version: this.version});
};


// @deprecated Suspect of succeeded with incomplete downloads (postres-ops-data uploaded to azure
// was not the correct checksum, smaller, and gave unexpected end of file. Swithing to the Maven
// approach below.
proto.downloadFromArtifactory = function () {
  let downloadComplete = false;
  let artifactoryUrl = this.getArtifactoryUrl();
  let filename = this.getFilename();
  let tmp = util.createTempWriteStream(filename);
  let error = false;
  if (config._all.commit) {
    let request = http.get(artifactoryUrl, function (response) {
      response.pipe(tmp.stream);
      response.on('end', () => downloadComplete = true);
      response.on('error', (e) => {
        util.narrateln(e);
        downloadComplete = true
        return error = true;
      });
    });
    deasync.loopWhile(() => !downloadComplete);
  }
  return error ? false : tmp.path;
};

proto.downloadFromGithubUsingMaven = function () {
  if (!config._all.commit) {
    return false;
  }
  let tmpDir = util.createTempDir();
  let settingsXmlPath = maven.getSettingsXmlPath(); // Artifcatory
  let artifactoryContext = _.extend({version: this.version}, this.definition.artifactory);
  let moduleFormat = '{{groupId}}:{{artifactId}}:{{version}}:{{packaging}}';
  if (this.definition.artifactory.classifier) {
    moduleFormat += ':{{classifier}}';
  }
  let moduleId = util.renderText(moduleFormat, artifactoryContext);
  let filename = this.getFilename();
  let downloadPath = Path.join(tmpDir, filename);
  let dependencyGetGoal = binUtil.mvnVersionLessThanThreeFive()
    ? 'org.apache.maven.plugins:maven-dependency-plugin:2.10:get' // 2.7 fails with unnecessary repositoryUrl error
    : 'dependency:get';
  this.purgeLocalRepositoryArtifact();
  util.exec('mvn', [
    '-U', '-s', settingsXmlPath, dependencyGetGoal,
    `-Ddest=${downloadPath}`,
    `-Dartifact=${moduleId}`
  ]);
  util.narrateln(`Downloaded artifact to: ${downloadPath}`);
  return downloadPath;
}

proto.purgeLocalRepositoryArtifact = function () {
  const artifactId = this.definition.artifactory.artifactId;
  const groupId = this.definition.artifactory.groupId;
  util.exec('mvn', [
    '-s', maven.getSettingsXmlPath(),
    'org.apache.maven.plugins:maven-dependency-plugin:3.1.2:purge-local-repository',
    `-DmanualInclude=${groupId}:${artifactId}`,
    `-DsnapshotsOnly=true`,
    `-DreResolve=false`
  ]);
}

proto.uploadToAzure = function (path, cleanup=true) {
  if (!path) {
    return false;
  }
  // Render a temporary settings.xml with the personal access token
  let content = util.renderTemplate('settings-azure.xml');
  let settingsXmlPath = util.writeTempFile(content, {postfix: '.xml'});
  let args = util.renderText(this.definition.azure, {version: this.version, path: path});
  let hasUploaded = false;
  if (!config._all.commit) {
    return false;
  } else {
    // We're way too often getting 503 responses, and trying again just works
    let attemptsRemaining = 3;
    while (attemptsRemaining > 0) {
      try {
        util.exec('mvn', ['-s', settingsXmlPath].concat(args.split(' ')), process.env.NODE_BASE_DIRECTORY);
        attemptsRemaining = 0;
        hasUploaded = true;
      } catch (ex) {
        if (ex instanceof ExecError) {
          attemptsRemaining--;
        } else {
          throw ex;
        }
      } finally {
        if (cleanup) {
          util.removeFileRecklessly(path);
        }
      }
    }
  }
  return hasUploaded;
};

module.exports = Artifact;
