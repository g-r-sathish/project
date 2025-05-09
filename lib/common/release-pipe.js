const config = require('./config');
const util = require('./util');
const sprintf = require('sprintf-js').sprintf;

const teams = require('./teams').teamsService;
const constants = require('./constants');
const BuildError = require('../classes/BuildError');
const ConfigError = require('../classes/ConfigError');

constants.define('ENUM_RELEASE_CONSTRAINTS', [
  constants.define('RELEASE_CONSTRAINT_NONE', 'none'),
  constants.define('RELEASE_CONSTRAINT_BLOCKED', 'blocked'),
  constants.define('RELEASE_CONSTRAINT_MODERATED', 'moderated')
]);

let infoByConstraint = {};
infoByConstraint[constants.RELEASE_CONSTRAINT_NONE] = {status: 'open', emoji: ':rocket:', color: '00EE00'};
infoByConstraint[constants.RELEASE_CONSTRAINT_BLOCKED] = {status: 'closed', emoji: ':no_entry:', color: 'EE0000'};
infoByConstraint[constants.RELEASE_CONSTRAINT_MODERATED] = {status: 'moderated', emoji: ':cop:', color: 'EEEE00'};

function notifyOnConstraintChange(bundleName, oldConstraint, newConstraint) {
  let info = infoByConstraint[newConstraint];
  teams.notify({
    channel: config.releasePipeChannel,
    color: info.color,
    icon_emoji: ':vertical_traffic_light:',
    text: sprintf('%s <!here> Release pipe is now *%s* for `%s:` changesets', info.emoji, info.status, bundleName)
  });
}

function generateApprovalCode() {
  return Math.random().toString(10).substr(2, 4);
}

function ensurePipeIsOpen(bundle, markerOutput) {
  if (bundle.changeset.onTrunk()) return;

  let constraint = bundle.getReleaseConstraint();
  if (constraint !== constants.RELEASE_CONSTRAINT_NONE) {
    if (constraint === constants.RELEASE_CONSTRAINT_MODERATED) {
      if (config._all.commit) {
        ensureApproval(bundle.currentGoal, config._all['changeset-id'], config.releaseModeratorsTeamsChannel,
          generateApprovalCode(), markerOutput);
      } else {
        util.narratef('Skipping approval for --dry-run');
      }
    } else {
      throw new BuildError(sprintf('Release constraint in effect: %s', constraint));
    }
  }
}

function ensureApproval(action, subject, channel, approvalCode, markerOutput) {
  if (!approvalCode) {
    throw new BuildError('Missing parameter: approvalCode')
  }
  // const requestText = sprintf('Approval code for **%s** on `%s` requested by _%s_ is: `%s`', action, subject,
  //   config.whoami, approvalCode);

  const requestText = sprintf('Approval code for **%s** on `%s` requested by _%s_ is: `%s` \n\n%s',
    action, subject, config.whoami, approvalCode, markerOutput ? '**Trunk marker updates:** \n\n```\n' + markerOutput + '```' : '');
  
  teams.notify({
    silent: true,
    hiddenMessage: true,
    sendingRequired: true,
    channel: channel,
    text: requestText
  });
  util.announce('Awaiting approval'.plain);
  util.println('Approval code has been sent to your PM'.italic.trivial);
  let enteredCode = undefined;
  let attempt = 0;
  while (enteredCode !== approvalCode) {
    try {
      enteredCode = util.prompt('Enter approval code: '.plain);
      if (enteredCode === null || !enteredCode) {
        throw new ConfigError('Approval code is required');
      }
      if (approvalCode !== enteredCode) {
        throw new ConfigError('Incorrect approval code');
      }
    } catch (ex) {
      if (++attempt > 3) {
        throw(ex);
      }
    }
  }
  let thankYouText = sprintf('Approval code for *%s* on *%s* used; _%s_ sends thanks!', action, subject, config.whoami);
  teams.notify({
    silent: true,
    hiddenMessage: true,
    sendingRequired: true,
    channel: channel,
    text: thankYouText
  });
  return true;
}

module.exports = {
  ensurePipeIsOpen: ensurePipeIsOpen,
  generateApprovalCode: generateApprovalCode,
  ensureApproval: ensureApproval,
  notifyOnConstraintChange: notifyOnConstraintChange
};