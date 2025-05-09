const _ = require('underscore');
const azdev = require('azure-devops-node-api');
const deasync = require('deasync');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../classes/BuildError');
const ConfigError = require('../classes/ConfigError');
const config = require('./config');
const util = require('./util');

let azureDevOpsService = {};
azureDevOpsService.orgUrl = 'https://dev.azure.com/agilysys';
azureDevOpsService.project = 'Stay';
azureDevOpsService.identitiesApiUrl = 'https://vssps.dev.azure.com/agilysys/_apis/identities';

/**
 * @param {string} params.repoPath
 * @param {string} params.fromBranch
 * @param {string} params.toBranch
 * @returns {{error: {message: string, status: number}|undefined}}
 */
azureDevOpsService.abandonPullRequest = function (params) {
  const context = this._setupPullRequestContext(params);
  try {
    const existing = this._getExistingPullRequest(context);
    if (!existing) return undefined;

    this._callApi(async connection => connection.getGitApi(), async client => {
      const request = {
        status: 'abandoned'
      };
      util.narrateln('Abandoning pull request');
      util.narrateJSON(request);
      return client.updatePullRequest(request, context.repoId, existing.pullRequestId, context.project);
    });
  } catch (err) {
    return this._handleError(err);
  }
  return undefined;
};

/**
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} params.repoPath
 * @param {string} params.pullRequestUrlSpec
 * @param {string} params.fromBranch
 * @param {string} params.toBranch
 * @param {UserData[]} params.reviewers
 * @returns {{isNew: boolean, uri: string}|{error: {message: string, status: number}}}
 */
azureDevOpsService.createPullRequest = function (params) {
  const context = this._setupPullRequestContext(params);
  try {
    const existing = this._getExistingPullRequest(context);
    if (existing) {
      return {
        isNew: false,
        uri: sprintf(params.pullRequestUrlSpec, existing.pullRequestId)
      }
    }

    const result = this._callApi(async connection => connection.getGitApi(), async client => {
      const reviewers = _.chain(params.reviewers).filter(reviewer => reviewer.azureIdentityId).map(reviewer => {
        return {id: reviewer.azureIdentityId};
      }).value();
      const request = {
        title: params.title,
        description: params.description,
        sourceRefName: context.sourceRefName,
        targetRefName: context.targetRefName,
        reviewers: reviewers
      };
      util.narrateln('Creating pull request');
      util.narrateJSON(request);
      return client.createPullRequest(request, context.repoId, context.project);
    });

    return {
      isNew: true,
      uri: sprintf(params.pullRequestUrlSpec, result.pullRequestId)
    };
  } catch (err) {
    return this._handleError(err);
  }
}

azureDevOpsService.getBuild = async function (buildId) {
  const token = config.personal_settings.azure_devops_token;
  const authHandler = azdev.getPersonalAccessTokenHandler(token);

  util.narrateln('Opening connection to ' + config.azureDevOpsApiUrl);
  const connection = new azdev.WebApi(config.azureDevOpsApiUrl, authHandler);
  const client = await connection.getBuildApi();
  const url = `${this.orgUrl}/${this.project}/_apis/build/builds/${buildId}?api-version=6.0`;

  const response = await client.rest.get(url)
  let result;
  switch (response.statusCode) {
    case 200:
      result = response.result;
      break;
    case 404:
      result = undefined;
      break;
    default:
      throw new Error(`Build ${buildId} returned: ${response.statusCode}`);
  }
  return result;
};

/**
 * @param {string} token
 * @param {string} emailAddress
 * @return {*}
 */
azureDevOpsService.getIdentityId = function (token, emailAddress) {
  const result = this._callApi(async connection => connection.getGitApi(), async client => {
    const url = `${this.identitiesApiUrl}?api-version=6.0&searchFilter=MailAddress&filterValue=${emailAddress}`;
    return client.rest.get(url);
  }, token);
  if (result.statusCode !== 200 || result.result.count !== 1) {
    throw new ConfigError('Unable to retrieve identity ID from Azure');
  }
  return result.result.value[0].id;
}

azureDevOpsService.getWorkItemSummary = function (changesetId, options) {
  let id = changesetId.ticketId;
  let workItem = this._callApi(this._workItemTrackingClient, async client => {
    util.narrateln('Retrieving work item ' + id);
    return client.getWorkItem(id, ['System.Title'])
  });

  if (!workItem && !options.invalidOk) {
    throw new BuildError('Invalid Azure DevOps work item: ' + id);
  }
  return workItem ? workItem.fields['System.Title'].trim() : 'Invalid Azure DevOps work item';
}

azureDevOpsService.getWorkItemsForShipment = function (ids) {
  ids = util.asArray(ids);
  const workItems = this._callApi(this._workItemTrackingClient, async client => {
    util.narrateln('Retrieving work items ' + ids);
    return client.getWorkItems(ids, ['System.State', 'System.Title', 'System.WorkItemType'], undefined, undefined, 2);
  });

  const result = {};
  _.each(workItems, workItem => result[workItem.id] = workItem);
  return result;
};

azureDevOpsService.postPRLinks = function (changesetId, link) {
  if (!link) {
    return;
  }
  return this._callApi(this._workItemTrackingClient, async client => {
    const url = `${this.orgUrl}/${this.project}/_apis/wit/workItems/${changesetId}?api-version=6.0-preview.3`
    const body = [{
      "op": "add",
      "path": "/relations/-",
      "value": {
        "rel": "Hyperlink",
        "url": link
      }
    }];

    const requestOptions = {
      acceptHeader: 'application/json-patch+json',
      additionalHeaders: {
        'content-type': 'application/json-patch+json'
      }
    };

    return client.rest.update(url, body, requestOptions).then(response => {
      util.narrateln("Posting PRs in Azure Devops Ticket");
      if (response && response.statusCode === 200) {
        return response.result;
      }
      throw new Error(response.statusCode);
    }).catch((error) => {
      util.narrateln("Error response:");
      util.narrateJSON(error);
      if (error && error.statusCode === 401) {
        util.println('Requires valid devops token with Read & write access to add PR link to the corresponding ticket'.warn);
      }
    });
  });
}

azureDevOpsService.runPipeline = async function (definitionId, parameters, branch = config.devops_pipelines_branch) {
  const token = config.personal_settings.azure_devops_token;
  const authHandler = azdev.getPersonalAccessTokenHandler(token);

  util.narrateln('Opening connection to ' + config.azureDevOpsApiUrl);
  const connection = new azdev.WebApi(config.azureDevOpsApiUrl, authHandler);
  const client = await connection.getBuildApi();

  const url = `${this.orgUrl}/${this.project}/_apis/pipelines/${definitionId}/runs?api-version=6.0-preview.1`;
  const body = {
    resources: {
      repositories: {
        res: {
          refName: branch
        }
      }
    },
    templateParameters: parameters
  };
  const requestOptions = {
    acceptHeader: 'application/json',
  };

  util.narrateln(`Running pipeline: ${definitionId}`);
  const response = await client.rest.create(url, body, requestOptions);

  if (response && response.statusCode === 200) {
    return response.result;
  } else {
    throw new Error(`Build definition ${definitionId} returned: ${response.statusCode}`);
  }
};

azureDevOpsService._buildApiClient = async function (connection) {
  util.narrateln('Creating build API client');
  return connection.getBuildApi();
};

/**
 * @param clientFunction
 * @param opFunction
 * @param {string} [token]
 * @return {{}}
 * @private
 */
azureDevOpsService._callApi = function (clientFunction, opFunction, token) {
  let done = false;
  let result = undefined;
  let asyncError = undefined;

  async function _asyncCallApi() {
    try {
      token = token || config.personal_settings.azure_devops_token;
      const authHandler = azdev.getPersonalAccessTokenHandler(token);

      util.narrateln('Opening connection to ' + config.azureDevOpsApiUrl);
      const connection = new azdev.WebApi(config.azureDevOpsApiUrl, authHandler);

      const client = await clientFunction(connection);

      result = await opFunction(client);
      util.narrateJSON(result);
    } catch (err) {
      asyncError = err;
      util.narrateJSON(err);
    }
    done = true;
  }

  _asyncCallApi();
  deasync.loopWhile(() => !done);
  if (asyncError) {
    throw asyncError;
  }
  return result;
}

/**
 * @param {{}} context
 * @return {{}|undefined}
 * @private
 */
azureDevOpsService._getExistingPullRequest = function (context) {
  const existing = this._callApi(async connection => connection.getGitApi(), async client => {
    const criteria = {
      sourceRefName: context.sourceRefName,
      targetRefName: context.targetRefName
    }
    util.narrateln('Checking for existing pull request');
    util.narrateJSON(criteria);
    return client.getPullRequests(context.repoId, criteria, context.project);
  });

  return existing.length ? existing[0] : undefined;
}

/**
 * @param err
 * @return {{error: {message: string, status: number}}}}
 * @private
 */
azureDevOpsService._handleError = function (err) {
  if (err.statusCode && err.result && err.result.message) {
    return {
      error: {
        status: err.statusCode,
        message: err.result.message.replace('\r\n', ' ')
      }
    }
  }
  if (err.statusCode === 401) {
    return {
      error: {
        status: err.statusCode,
        message: "Unauthorized; ensure you are using an Azure token with full access"
      }
    }
  }
  throw err;
}

/**
 * @param {string} params.repoPath
 * @param {string} params.fromBranch
 * @param {string} params.toBranch
 * @return {{repoId: string, sourceRefName: string, targetRefName: string, project: string}}
 * @private
 */
azureDevOpsService._setupPullRequestContext = function(params) {
  const pathParts = params.repoPath.split('/');
  return {
    project: pathParts[0],
    repoId: pathParts[1],
    sourceRefName: 'refs/heads/' + params.fromBranch,
    targetRefName: 'refs/heads/' + params.toBranch
  }
}

azureDevOpsService._workItemTrackingClient = async function (connection) {
  util.narrateln('Creating work item tracking client');
  return connection.getWorkItemTrackingApi();
};

module.exports.azureDevOpsService = azureDevOpsService;
