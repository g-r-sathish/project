const _ = require('underscore');
const request = require('sync-request');
const sprintf = require('sprintf-js').sprintf;

const config = require('./config');
const ConfigError = require('../classes/ConfigError');
const constants = require('./constants');
const TeamsMessageBuilder = require('../classes/TeamsMessageBuilder');
const util = require('./util');
const {UpdateTypes} = require('../classes/Constants');

constants.define('TEAMS_1_OF_2_MESSAGE', 0);
constants.define('TEAMS_2_OF_2_MESSAGE', 1);
constants.define('TEAMS_1_OF_1_MESSAGE', 2);

let teamsService = {};
module.exports.teamsService = teamsService;

teamsService.notify = function (params) {
  let builder = new TeamsMessageBuilder();
  _notify(params, builder.buildSimple(params.text, params.color));
};

teamsService.notifyOnDeploy = function (params) {
  params = _.extend({
    completed: false,
    success: true,
    environment: {},
    actions: [],
    options: [],
    commands: undefined
  }, params);

  let builder = new TeamsMessageBuilder();
  let envName = params.environment.name;

  builder.title(`Deployment to: ${envName}`).deploying(params.actions);

  if (params.options.length) {
    builder.runtimeOptions(params.options);
  }

  builder.environment(envName);

  if (params.completed) {
    if (params.success) {
      builder.success();
    } else {
      let resultsText = _.map(params.commands, function (command) {
        return sprintf('[%s] %s', command === params.commands[params.commands.length - 1] ? '*FAILED*' : 'OK', command);
      }).join('\n');
      builder.failure(resultsText);
    }
  } else {
    builder.started();
  }

  if (params.environment.dashboard_url_spec) {
    builder.dashboardUrl(sprintf(params.environment.dashboard_url_spec, envName));
  }

  _notify(params, builder.build());
};

teamsService.notifyOnStartedRC = function (bundle) {
  let params = {
    channel: bundle.changeset.onTrunk() ? config.releasePipeTrunksChannel : config.releasePipeChannel,
    activity: 'Started RC'
  };
  _notify(params, _newMessageBuilder(bundle, params).build());
};

teamsService.notifyOnAbandonedRC = function (bundle) {
  let params = {
    channel: bundle.changeset.onTrunk() ? config.releasePipeTrunksChannel : config.releasePipeChannel,
    activity: 'Abandoned RC'
  };
  _notify(params, _newMessageBuilder(bundle, params).build());
};

teamsService.notifyOnReleased = function (bundle) {
  let params = {
    channel: bundle.changeset.onTrunk() ? config.releasePipeTrunksChannel : config.releasePipeChannel,
    activity: 'Released',
  };
  _notify(params, _newMessageBuilder(bundle, params).build());
};

teamsService.notifyOnSubmitPr = function (bundle, updates) {
  let params = {
    channel: config.stayPullRequests,
    activity: 'Pull Request',
    updates: updates
  };
  _notify(params, _newMessageBuilder(bundle, params).build());
};

teamsService.notifyOnChangeset = function (bundle, params) {
  _notify(params, _newMessageBuilder(bundle, params).build());
};

teamsService.notifyOnShipment = function (bundle, params) {
  params = _.extend({
    type: constants.TEAMS_1_OF_1_MESSAGE,
    success: true,
    shipmentId: undefined,
    options: undefined,
    errorMessage: undefined,
    silent: false
  }, params);

  _notify(params, _newMessageBuilder(bundle, params).build());
};

function _newMessageBuilder(bundle, params) {
  params = _.extend({
    type: undefined,
    shipmentId: undefined,
    changesetId: config.changesetId,
    options: undefined,
    updates: undefined,
    errorMessage: undefined,
    activity: undefined,
    silent: false
  }, params);

  switch (params.type) {
    case constants.TEAMS_1_OF_2_MESSAGE:
      params.activity = "Initiated";
      break;
    case constants.TEAMS_2_OF_2_MESSAGE:
      params.success = !params.errorMessage;
      params.activity = "Finished";
      break;
  }

  let title;

  let builder = new TeamsMessageBuilder().action(bundle.currentGoal);

  if (params.shipmentId) {
    let shipmentId = params.shipmentId;
    let shipmentText = sprintf('%s:%s', shipmentId.bundleName, shipmentId.version);
    builder.shipmentText(shipmentText);
    builder.shipmentLink(sprintf('%s/blob/%s/%s', bundle.versionsRepo.getBrowseUrl(), config.versions_files.mainline, bundle.shipment.getRelativeShipmentPath(shipmentId)));

    title = shipmentText;
  } else if (params.changesetId) {
    let changesetId = params.changesetId;
    let changeset = bundle.changeset;
    let changesetText = sprintf('%s:%s', changesetId.bundleName, changesetId.trackingId);
    builder.changesetText(changesetText);
    builder.changesetLink(sprintf('%s/blob/%s/%s', bundle.versionsRepo.getBrowseUrl(), config.versions_files.mainline, changeset.getRelativeChangesetPath(changesetId)));

    if (_.contains(config.qualifiers.azure_devops, changesetId.qualifier)) {
      builder.workItemLink(sprintf(config.azureDevOpsBrowseUrlSpec, changesetId.ticketId));
    }

    if (changeset.onTrunk()) {
      let trunkName = changeset.getTrunk();
      builder.trunkText(trunkName);
      if (changeset.doesAliasExist(trunkName)) {
        builder.trunkLink(sprintf('%s/blob/%s/%s', bundle.versionsRepo.getBrowseUrl(), config.versions_files.mainline, changeset.getRelativeAliasPath(trunkName)));
      }
    }

    title = changeset.getValueSafe('summary') || changesetText;
  }


  if (params.activity) {
    title += ' - ' + params.activity;
  }

  builder
    .title(title)
    .runtimeOptions(params.options);

  if (params.updates && params.updates.length) {
    _.each(params.updates, function (update) {
      if (update.type === UpdateTypes.PULL_REQUEST) {
        builder.pullRequest(update.status, update.url, update.project);
      } else if (update.type === UpdateTypes.X_RAY_RESULT) {
        // TBD
      }
    });
  }

  if (params.errorMessage) {
    builder.failure(params.errorMessage);
  } else if (params.success) {
    builder.success();
  }

  return builder;
}

_getTeamsChannel = function (channelId) {
  let channel = config.teams.channels[channelId];
  if (!channel) {
    throw new ConfigError(sprintf('No MS Teams channel configuration for: %s', channelId));
  }
  return channel;
};

_notify = function (params, message) {
  params = _.extend({}, config.teams.message_defaults, params);

  if (!params.channel) {
    throw new Error("No notification channel specified")
  }
  if (!params.silent) {
    util.subAnnounce('Sending Teams notification'.plain);
    util.startBullet('Channel'.plain);
    util.continueBullet(_getTeamsChannel(params.channel).name.useful);
  }
  let webhookUrl = _getTeamsChannel(params.channel).webhook_url;
  util.narratef('POST %s\n', webhookUrl);
  if (!params.hiddenMessage) {
    util.narrateln(JSON.stringify(message, null, 2));
  }

  let response = null;
  let statusText = "";
  if (params.sendingRequired || (!!config.teams.channels_enabled && (config._all.commit || !!config.debug.notify_during_dry_run))) {
    try {
      response = request('POST', webhookUrl, {json: message});
      util.narratef('HTTP %s\n', response.statusCode);
      if (response.statusCode !== 202) {
        util.narrateln(response.body);
        statusText = `Unsuccessful response: HTTP ${statusCode}`.bad;
      } else {
        statusText = "Sent".good;
      }
    } catch (ex) {
      statusText = "Failed to send".bad;
    }
  } else {
    statusText = "(intentionally not sent)".warn;
  }
  if (!params.silent) {
    util.endBullet(statusText);
  }

  return response;
};
