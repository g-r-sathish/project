'use strict';

const mustache = require('mustache');
const sprintf = require('sprintf-js').sprintf;

const config = require('../common/config');
const markdown = require('../common/markdown');
const util = require('../common/util');

const ThemeColor = {
  NEUTRAL: '787878',
  STARTED: '787878',
  SUCCESS: '009A00',
  FAILURE: '9A0000'
};

const Status = {
  NEUTRAL: '',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  STARTED: 'STARTED'
};

// override escape function to disable HTML escaping
mustache.escape = (value) => value;

function _pushFact(facts, title, value) {
  let fact = {
    title: title,
    value: value
  };
  facts.push(fact);
  return fact;
}

// TODO: Use context + template = bodytext, heading
function TeamsMessageBuilder() {
  this.context = {
    target: undefined
  };
  this.materials = {
    title: '',
    status: Status.NEUTRAL,
    themeColor: ThemeColor.NEUTRAL,
    author: config.whoami,
    timestamp: new Date().toISOString(),
    bodyText: "",
    facts: [],
    actions: [],
    sections: [],
    pullRequests: undefined
  };
}

const prototype = TeamsMessageBuilder.prototype;
module.exports = TeamsMessageBuilder;

prototype.build = function () {
  let summary = this.materials.title;
  if (this.materials.status) {
    summary += ' (' + this.materials.status + ')';
  }
  if (this.context.target) {
    summary = '[' + this.context.target + '] ' + summary;
  }
  return {
    type: 'AdaptiveCard',
    version: '1.3',
    msteams: {
      width: 'Full'
    },
    body: [
      {
        type: 'TextBlock',
        text: summary,
        weight: 'Bolder',
        size: 'Medium',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: this.materials.author,
        weight: 'Bolder',
        isSubtle: true,
        spacing: 'None'
      },
      {
        type: 'TextBlock',
        text: this.materials.timestamp,
        isSubtle: true,
        spacing: 'None'
      },
      {
        type: 'TextBlock',
        text: this.materials.bodyText,
        wrap: true
      },
      {
        type: 'FactSet',
        facts: this.materials.facts
      }
    ].concat(this.materials.sections.map(section => ({
      type: 'Container',
      items: [
        {
          type: 'TextBlock',
          text: section.title,
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'FactSet',
          facts: section.facts
        }
      ]
    }))),
    actions: this.materials.actions,
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json"
  };
};

prototype.buildSimple = function (text, color) {
  return {
    type: 'AdaptiveCard',
    version: '1.3',
    msteams: {
      width: 'Full'
    },
    body: [
      {
        type: 'TextBlock',
        text: text,
        color: 'Default',
        wrap: true
      }
    ],
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json"
  };
};

prototype.template = function (templateName) {
    this.materials.templateName = templateName;
    return this;
};

prototype.buildFromTemplate = function () {
  let template = util.readFile(path.join(config.templateDirectory, this.materials.templateName));
  return {
    type: 'AdaptiveCard',
    version: '1.3',
    msteams: {
      width: 'Full'
    },
    body: [
      {
        type: 'TextBlock',
        text: mustache.render(template, this.context)
      }
    ],
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json"
  };
};

prototype.title = function (text) {
  this.materials.title = text;
  return this;
};

prototype.started = function () {
  this.materials.status = Status.STARTED;
  this.materials.themeColor = ThemeColor.STARTED;
  return this;
};

prototype.success = function () {
  this.materials.themeColor = ThemeColor.SUCCESS;
  this.materials.status = this.materials.status || Status.SUCCESS;
  this.addFactText('Result', Status.SUCCESS);
  return this;
};

prototype.failure = function (text) {
  this.materials.themeColor = ThemeColor.FAILURE;
  this.materials.status = Status.FAILURE;
  this.materials.bodyText = text;
  this.addFactText('Result', Status.FAILURE);
  return this;
};

prototype.addFactText = function (term, definition) {
  _pushFact(this.materials.facts, term, definition);
  return this;
};

prototype.addFactLink = function (term, url, text) {
  _pushFact(this.materials.facts, term, markdown.href(url, text));
  return this;
};

prototype.runtimeOptions = function (list) {
  if (list && list.length) {
    this.addFactText("Options", markdown.escape(list.join(' ')));
  }
  return this;
};

prototype.dashboardUrl = function (url) {
  return this.addFactLink("vDash URL", url);
};

prototype.environment = function (text) {
  return this.addFactText("Environment", text);
};

prototype.deploying = function (list) {
  return this.addFactText("Deploying", list.join(' '));
};

prototype.action = function (text) {
  return this.addFactText("Action", text);
};

prototype.changesetText = function (text) {
  this.context.target = text;
  return this.addFactText('Changeset', text);
};

prototype.changesetLink = function (uri, text) {
  return this.addFactLink('Changeset YAML', uri, text);
};

prototype.trunkText = function (text) {
  return this.addFactText('Trunk', text);
}

prototype.trunkLink = function (uri, text) {
  return this.addFactLink('Trunk YAML', uri, text);
}

prototype.shipmentText = function (text) {
  this.context.target = text;
  return this.addFactText('Shipment', text);
};

prototype.shipmentLink = function (uri, text) {
  return this.addFactLink('Shipment YAML', uri, text);
};

prototype.issueLink = function (uri, text) {
  return this.addFactLink('Issue link', uri, text);
};

prototype.workItemLink = function (uri, text) {
  return this.addFactLink('Work item link', uri, text);
};

prototype.pullRequest = function (status, uri, text) {
  if (undefined === this.materials.pullRequests) {
    this.materials.pullRequests = [];
    this.materials.sections.push({
      title: 'Pull Requests',
      facts: this.materials.pullRequests
    });
  }
  _pushFact(this.materials.pullRequests, `${text} (${status})`, markdown.href(uri));
  return this;
};
