const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const jenkins = require('../../../common/jenkins').jenkinsService;
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');

module.exports['start'] = {
  summary: 'Create changeset branches, update project versions, and update dependency versions',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['include', 'hotfix', 'trunk', 'max-fork-count', 'dry-run', 'skip-test', 'jacoco', 'sb3build', 'perf-impr'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: [],
  callback: function (bundle, goal) {
    if (util.fileExists(bundle.changeset.getChangesetPath(config.changesetId))) {
      throw new BuildError(sprintf('Changeset %s already started. Sure you have the correct changeset ID?', config._all['changeset-id']));
    }

    let qualifiers = [];
    _.each(Object.keys(config.qualifiers), type => qualifiers = qualifiers.concat(config.qualifiers[type]));
    if (!_.contains(qualifiers, config.changesetId.qualifier)) {
      throw new BuildError(sprintf('Invalid changeset qualifier: %s', config.changesetId.qualifier));
    }

    let trunk = undefined;
    if (config._all.trunk) {
      trunk = bundle.trunks[config._all.trunk];
      if (!trunk) {
        throw new BuildError(sprintf('Invalid trunk: %s', config._all.trunk));
      }
      if (!trunk.isActive()) {
        throw new BuildError(sprintf('Trunk is inactive: %s', config._all.trunk));
      }
      if (config._all.hotfix) {
        throw new BuildError(sprintf('Hotfix is not allowed for trunks'));
      }
    }

    bundle.init({
      existingChangeset: false,
      addAutoInclude: true,
      allowMissingBranches: true,
      includeList: config._all['include']
    });

    rflowUtil.prepareChangeset(bundle, {
      isNew: true,
      callback: function (params) {
        let changeset = params.changeset;
        changeset.data.source_bundle_version = changeset.data.bundle_version;
        delete changeset.data.bundle_version;
        delete changeset.data.merged_tracking_ids;
        changeset.setStatus(ChangesetFile.Status.DEV);
      }
    });

    let orchestrationArray = jenkins.buildOrchestration(bundle.projects.included, bundle.getChangesetBranchName(), false);
    jenkins.postOrchestration(orchestrationArray);
  }
};
