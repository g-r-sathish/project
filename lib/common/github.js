const _ = require('underscore');
const fs = require('fs');
const request = require('sync-request');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../classes/BuildError');
const config = require('./config');
const ConfigError = require('../classes/ConfigError');
const util = require('./util');
const {Users} = require('../classes/Users');

let githubService = {};
/**
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} params.fromBranch
 * @param {string} params.toBranch
 * @param {UserData[]} params.reviewers
 * @param {string} params.repoPath
 * @returns {{isNew: boolean, uri: string}|{error: {message: string, status: number}}}
 */

githubService.createPullRequest = function (params) {
  const token = config.personal_settings.github_token;
  let repoPathParts = params.repoPath.split('/');
  let project = repoPathParts[0];
  let repository = repoPathParts[1];

// https://api.github.com/
  let uri = sprintf('%s/repos/%s/%s/pulls', config.githubApiBaseUrl, config.githubOwner, project);
  let authorization = "Bearer " + token;
  let requestBody = {
  owner: config.githubOwner,
  repo: project,
  title: params.title,
  body: params.description,
  head: config.githubOwner+":"+params.fromBranch,
  base: params.toBranch
  }

  let response;
  let pullrequests;
  if (config._all.commit) {
    response = request('POST', uri, {
      headers: {
        Accept: "application/vnd.github+json",
        'user-agent' : 'curl/7.68.0',
        Authorization: authorization
      },
      json: requestBody
    });
  } else {
    response = {
      statusCode: 201,
      body: sprintf('{"links":{"self":[{"href":"https://github.somewhere.local/%s/pull-requests/1"}]}}', params.repoPath)
    }
  }

  util.narratef('POST %s\n', uri);
  util.narrateln(JSON.stringify(requestBody, null, 2));
  let responseBody = JSON.parse(response.body);
  util.narratef('HTTP %s\n', response.statusCode);
  util.narrateln(JSON.stringify(responseBody));

  if (response.statusCode === 201) {
    return {
      isNew: true,
      uri: responseBody._links.html.href
    };
  } else if (response.statusCode === 422 && responseBody.errors[0].message) {
        pullrequestsList = request('GET', uri, {
            headers: {
                Accept: "application/vnd.github+json",
                'user-agent' : 'curl/7.68.0',
                Authorization: authorization
            }
        });
        pullrequests = JSON.parse(pullrequestsList.body)
        old_pullrequest = _.find(pullrequests, function(pullrequest) {
            return pullrequest.head.label === requestBody.head && pullrequest.base.ref === requestBody.base
        })
        return {
            isNew: false,
            uri: old_pullrequest._links.html.href
        }
  } else {
    return {
      error: {
        status: response.statusCode,
        message: responseBody.errors ? responseBody.errors[0].message : undefined
      }
    };
  }
};

module.exports.githubService = githubService;