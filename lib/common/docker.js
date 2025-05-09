const _ = require('underscore');
const request = require('sync-request');
const sprintf = require('sprintf-js').sprintf;

const config = require('./config');
const util = require('./util');

let dockerService = {};

dockerService.isImageReleased = function (imageName, version) {
  let url = sprintf('%s%s/manifests/%s', config.dockerApiBaseUrl, imageName, version.toString());

  util.narratef('HEAD %s\n', url);
  let response = request('HEAD', url);
  util.narratef('HTTP %s\n', response.statusCode);
  return response.statusCode === 200;
};

module.exports.dockerService = dockerService;
