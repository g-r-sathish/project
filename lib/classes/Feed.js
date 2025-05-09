'use strict'
const _ = require('underscore');
const config = require('../common/config');
const request = require('sync-request');
const util = require('../common/util');
const maven = require('../common/maven').mavenService;
const artifactory = require('../common/artifactory');

function Feed (definition) {
  this.definition = definition;
  this.headers = {};
  this.init()
}

let proto = Feed.prototype;

proto.init = function () {
  let credentials = 'agilysys:' + config.personal_settings.azure_devops_token;
  let encodedCredentials = Buffer.from(credentials).toString('base64');
  this.headers.Authorization = `Basic ${encodedCredentials}`;
}

proto.doesAzureArtifactExist = function (artifact) {
  let context = _.extend({}, this.definition, artifact);
  let url = util.renderText(config.azure.artifact_info_url, context);
  let response = request('GET', url, {headers: this.headers});
  if (response.statusCode === 200) {
    return true;
  } else if (response.statusCode === 401) {
    throw new Error(`${response.statusCode} Unauthorized (url=${url}). This may be due to an expired access token (azure_devops_token)`);
  } else {
    util.narrateln(JSON.stringify(response));
    return false;
  }
};


proto.isVersionExist = function (versions, ver) {
  return !_.isEmpty(_.find(versions, (version) => {
    return version.name === ver;
  }))
}

proto.doesGithubPackageExist = function (artifact) {
  let artifactName;
  if (artifact.hasOwnProperty('definition') && artifact.definition.hasOwnProperty('artifactory')) {
    artifactName = `${artifact.definition.artifactory.groupId}:${artifact.definition.artifactory.artifactId}`;
  } else {
    artifactName = `${artifact.groupId}:${artifact.artifactId}`;
  }
  return artifactory.isGithubPackageReleased(artifactName, artifact.version);
};

proto.uploadFromArtifactory = function (artifact) {
  return artifact.uploadToAzure(artifact.downloadFromGithubUsingMaven(), true);
}

proto.purgeLocalRepositoryArtifacts = function () {
  util.exec('mvn', [
    '-s', maven.getSettingsXmlPath(),
    'org.apache.maven.plugins:maven-dependency-plugin:3.1.2:purge-local-repository',
    '-DmanualInclude=com.agilysys',
    '-DsnapshotsOnly=true',
    '-DreResolve=false'
  ]);
}

module.exports = Feed;
