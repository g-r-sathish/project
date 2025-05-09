const FileSystem = require('fs');
const SyncRequest = require('sync-request');
const _ = require('underscore');
const config = require('./config');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;
const util = require('./util');
const {VersionEx} = require('../classes/VersionEx');

var filePathCache = {};

function getArtifactPath (dep) {
  var artifactId = dep.getArtifactId();
  if (config.artifactNameMap[artifactId]) {
    artifactId = config.artifactNameMap[artifactId];
  }
  var groupId = dep.getGroupId();
  return Path.join(dep.getGroupId().replace(/\./g, '/'), artifactId);
}


//http://artifactory.bellevue.agilysys.com/artifactory/libs-release/com/agilysys/pms/root-pom/1.32.0/root-pom-1.32.0.pom
//^---------------------------------------------------------------^ ^-----------------------^ ^----^ ^------^ ^----^
//                         repo url                                     artifactPath          version  artifactId  version

function getReleasedPOMURL (project) {
  var artifactPath = getArtifactPath(project.pom);
  var version = new VersionEx(project.getReleasedVersion());
  var scope = version.isSnapshot() ? 'latest' : 'release';
  var filename = sprintf('%s-%s.pom', project.pom.getArtifactId(), version.toString());
  var path = Path.join(artifactPath, version.toString(), filename);
  var url = version.isSnapshot() ? config.centralRepoUrl : config.releaseRepoUrl;
  url += path;
  return url;
}

function getPublishedPOMURL (dep, version) {
  var artifactPath = getArtifactPath(dep);
  version = version || new VersionEx(dep.getVersion());
  var filename = sprintf('%s-%s.pom', dep.getArtifactId(), version.toString());
  var path = Path.join(artifactPath, version.toString(), filename);
  var url = sprintf("%s%s", version.isSnapshot() ? config.centralRepoUrl : config.releaseRepoUrl, path);
  return url;
}

function fetchPublishedPOM (dep, version) {
  var artifactPath = getArtifactPath(dep);
  version = version || new VersionEx(dep.getVersion());
  var snapshot = version.isSnapshot();
  var scope = snapshot ? 'latest' : 'release';
  var filename = sprintf('%s-%s.pom', dep.getArtifactId(), version.toString());
  var path = Path.join(artifactPath, version.toString(), filename);
  var localPath = Path.join(config.cacheDir, scope, path);

  if (!filePathCache[localPath] && util.fileExists(localPath)) {
    filePathCache[localPath] = true;
  }

  if (!filePathCache[localPath] || config['no-cache']) {
    util.mkfiledir(localPath);
    var url = !snapshot ? config.releaseRepoUrl : config.centralRepoUrl;
    url += path;
    util.narrateln('GET ' + url);
    util.narrateln('--> ' + localPath);
    var content = SyncRequest('GET', url).getBody();
    FileSystem.writeFileSync(localPath, content);
    filePathCache[localPath] = true;
  }

  return localPath;
}

function getPackageUrl(packageName, pageNo) {
  let url = sprintf('%s%s/packages/maven/%s/versions?per_page=100&page=%s', config.releaseGithubPackageUrl, config.github.package.stay.organization, packageName, pageNo);
  util.narratef('GET %s\n', url);
  return url;
}

function requestGithubPackage(url) {
  let response = SyncRequest('GET', url, {
    headers: {
      'Authorization': `Bearer ${config.personal_settings.github_token}`,
      'User-Agent': 'curl/7.68.0'
    }
  });
  util.narratef('HTTP %s\n', response.statusCode);
  return response;
}

function throwGithubError(response, url) {
  if (response.statusCode === 401) {
    util.narrateln(`Error: ${response.statusCode} - Github Token Unauthorized. URL: ${url}`);
    throw new Error(`${response.statusCode} Github Token Unauthorized (url=${url}).`);
  } else if (response.statusCode === 403) {
    util.narrateln(`Error: ${response.statusCode} - Github user lacks permission, was the token authorised? URL: ${url}`);
    throw new Error(`${response.statusCode} Github user lacks permission, was the token authorised? (url=${url}).`);
  } else {
    util.narrateln('Request failed: ' + JSON.stringify(response));
  }
}

function checkIfGithubPackageExists(packageName, version) {
  let isExist = false;
  let pageNo = 1;
  let url = getPackageUrl(packageName, pageNo);
  let response = requestGithubPackage(url);
  if (response.statusCode === 200) {
    let versions = JSON.parse(response.body);
    let isExistInCurrentPage = false;
    isExistInCurrentPage = !_.isEmpty(_.find(versions, (ver) => {
      return ver.name === version.toString()
    }))
    if (isExistInCurrentPage) {
      return true;
    } else {
      if (response.headers.hasOwnProperty('link')) {
        let link = response.headers.link;
        let links = link.split(',');
        let lastLink = links[1];
        let lastPage = lastLink.match(/page=(\d+)>; rel="last"/)[1];
        for (let i = 2; i <= lastPage; i++) {
          url = getPackageUrl(packageName, i);
          response = requestGithubPackage(url);
          if (response.statusCode === 200) {
            versions = JSON.parse(response.body);
            isExistInCurrentPage = !_.isEmpty(_.find(versions, (ver) => {
              return ver.name === version.toString()
            }))
            if (isExistInCurrentPage) {
              return true;
            }
          }
        }
      }
    }
  } else {
    throwGithubError(response, url);
  }
  return isExist;
}
function isGithubPackageReleased(canonicalId, version) {
  let packageName = canonicalId.split(':').join('.');
  let isExist = checkIfGithubPackageExists(packageName, version);

  if (isExist) {
    util.narrateln(`Github Package Exist: ${packageName}: ${version.toString()}`);
  } else {
    util.narrateln(`Github Package does not Exist: ${packageName}: ${version.toString()}`);
  }

  return isExist;
}


exports.getArtifactPath = getArtifactPath;
exports.getReleasedPOMURL = getReleasedPOMURL;
exports.getPublishedPOMURL = getPublishedPOMURL;
exports.fetchPublishedPOM = fetchPublishedPOM;
exports.isGithubPackageReleased = isGithubPackageReleased;
