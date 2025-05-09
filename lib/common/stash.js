const _ = require('underscore');
const fs = require('fs');
const request = require('sync-request');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../classes/BuildError');
const config = require('./config');
const ConfigError = require('../classes/ConfigError');
const util = require('./util');
const {Users} = require('../classes/Users');

let stashService = {};

/**
 * @param {string} [adUsername]
 * @return {{password: undefined, username: string}}
 */
stashService.obtainCredentials = function (adUsername) {
  let username = adUsername || config.personal_settings.ad_username;
  let password = undefined;

  while (!password) {
    password = util.promptHidden(sprintf('AD password for \'%s\': '.plain, username));
    if (!password) {
      throw new BuildError('Password is required');
    }

    if (config._all.commit) {
      let uri = sprintf('%s/projects', config.stashApiBaseUrl);
      let authorization = "Basic " + Buffer.from(sprintf('%s:%s', username, password)).toString('base64');
      let response = request('GET', uri, {
        headers: {
          Authorization: authorization
        }
      });

      util.narratef('GET %s\n', uri);
      util.narratef('HTTP %s\n', response.statusCode);

      if (response.statusCode === 401) {
        util.println('Invalid username or password!'.bad);
        password = undefined;
      }
    }
  }

  return {
    username: username,
    password: password,
  };
};

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
stashService.createPullRequest = function (params) {
  let repoPathParts = params.repoPath.split('/');
  let project = repoPathParts[0].toUpperCase();
  let repository = repoPathParts[1];

  let uri = sprintf('%s/projects/%s/repos/%s/pull-requests', config.stashApiBaseUrl, project, repository);
  let authorization = "Basic " + Buffer.from(sprintf('%s:%s', params.username, params.password)).toString('base64');
  let requestBody = {
    title: params.title,
    description: params.description,
    state: "OPEN",
    fromRef: {
      id: "refs/heads/" + params.fromBranch,
      repository: {
        slug: repository,
        project: {
          key: project
        }
      }
    },
    toRef: {
      id: "refs/heads/" + params.toBranch,
      repository: {
        slug: repository,
        project: {
          key: project
        }
      }
    },
    reviewers: []
  };
  _.each(params.reviewers, reviewer => {
    if (!reviewer.stashUsername) return;
    requestBody.reviewers.push({
      user: {
        name: reviewer.stashUsername
      }
    });
  });

  let response;
  if (config._all.commit) {
    response = request('POST', uri, {
      headers: {
        Authorization: authorization
      },
      json: requestBody
    });
  } else {
    response = {
      statusCode: 201,
      body: sprintf('{"links":{"self":[{"href":"https://stash.somewhere.local/%s/pull-requests/1"}]}}', params.repoPath)
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
      uri: responseBody.links.self[0].href
    };
  } else if (response.statusCode === 409 && responseBody.errors[0].existingPullRequest) {
    return {
      isNew: false,
      uri: responseBody.errors[0].existingPullRequest.links.self[0].href
    };
  } else {
    return {
      error: {
        status: response.statusCode,
        message: responseBody.errors ? responseBody.errors[0].message : undefined
      }
    };
  }
};

stashService.getUsername = function (adUsername, adPassword) {
  const uri = sprintf('%s/users/%s', config.stashApiBaseUrl, adUsername);
  const authorization = "Basic " + Buffer.from(sprintf('%s:%s', adUsername, adPassword)).toString('base64');

  const response = request('GET', uri, {
    headers: {
      Authorization: authorization
    }
  });

  util.narratef('GET %s\n', uri);
  let responseBody = JSON.parse(response.body);
  util.narratef('HTTP %s\n', response.statusCode);
  util.narrateln(JSON.stringify(responseBody));

  if (response.statusCode === 200) {
    return responseBody.name;
  } else {
    throw new ConfigError('Unable to retrieve username from Stash');
  }
};

module.exports.stashService = stashService;