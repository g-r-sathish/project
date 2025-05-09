const _ = require('underscore');

const config = require('../common/config');
const {Project} = require('./Project');

class SupportProject extends Project {
  static create(definition, options, instanceName, trunkDefinitions) {
    const project = new SupportProject();
    Project.create(project, definition, options, instanceName, trunkDefinitions);
    project.definition = _.extend({
      ops_mainline: config.support_ops_mainline_branch_name,
    }, project.definition);
    return project;
  }

  static fromJsonObject(object) {
    const project = new SupportProject();
    Project.fromJsonObject(project, object);
    return project;
  }

  getInclusionKey() {
    return this.definition.inclusion_key;
  }
}

module.exports.SupportProject = SupportProject;
