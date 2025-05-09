const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const AnsibleCommand = require('../../classes/AnsibleCommand');
const {ChangesetFile} = require('../../classes/ChangesetFile');
const config = require('../../common/config');
const constants = require('../../common/constants');
const Path = require('path');
const {Projects} = require('../../classes/Constants');
const {ShipmentFile} = require('../../classes/ShipmentFile');
const util = require('../../common/util');

constants.define('STAY_DEPLOY_TAG', 'deploy-stay-services');
constants.define('STAY_SUC_TAG', 'stay-start-up-user-creator');
constants.define('STAY_CONTENT_TAG', 'content-package');

module.exports['stay-deployment'] = {

  checkout: function (bundle, goal, params) {
    // load shipment or changesets to determine if we have specific checkout targets for support projects
    let checkoutTargets = {};
    if (params.shipments) {
      let key = _.first(Object.keys(params.shipments));
      let shipmentFile = new ShipmentFile(bundle.versionsRepo, key, params.shipments[key]).load();
      _.each(Object.keys(shipmentFile.data.shipment.commits), function (name) {
        checkoutTargets[name] = Projects.GitTarget.COMMIT_PREFIX + shipmentFile.data.shipment.commits[name].id;
      });
    } else if (params.changesets) {
      _.each(Object.keys(params.changesets), function (key) {
        let changesetFile = ChangesetFile.create(bundle.versionsRepo, key).load(params.changesets[key]);
        _.each(bundle.supportProjects, function (project) {
          if (!checkoutTargets[project.dirname]) {
            if (changesetFile.data[project.definition.inclusion_key]) {
              if (changesetFile.filePath === changesetFile.getAliasPath(ChangesetFile.Alias.HOTFIX)) {
                checkoutTargets[project.dirname] = Projects.GitTarget.TAG_PREFIX + changesetFile.getReleaseTag();
              } else {
                checkoutTargets[project.dirname] = changesetFile.getChangesetBranchName();
              }
            } else if (changesetFile.onTrunk()) {
              checkoutTargets[project.dirname] = changesetFile.getTrunkMainlineBranchNameForSupportProjects();
            }
          }
        });
      });
    }

    let checkoutMap = {};
    let relevantProjects = util.asArray(bundle.environment.repo).concat(goal.repo, util.asArray(goal.support_repo));
    _.each(bundle.supportProjects, function (project) {
      if (relevantProjects.includes(project.repo.repoPath)) {
        let checkout = [Projects.GitTarget.MAINLINE];
        if (goal.default_branch) {
          checkout.unshift(goal.default_branch);
        }
        if (checkoutTargets[project.dirname]) {
          checkout.unshift(checkoutTargets[project.dirname]);
        }
        if (goal.branch_arg && config._all[goal.branch_arg]) {
          checkout.unshift(config._all[goal.branch_arg]);
        }
        checkoutMap[project.dirname] = checkout;
      }
    });
    util.subAnnounce('Checking out relevant branches'.plain);
    bundle.pointSupportProjects(checkoutMap);
  },

  callback: function (bundle, name, params) {

    function symlink(id, targetFile, sourceFile) {
      util.startBullet(id.plain);
      let target = Path.join(bundle.getEnvironmentRepoPath(), bundle.environment.home_dir, bundle.environment.symlink_dir, targetFile);
      let source = Path.join(bundle.environment.symlink_source_root, sourceFile);
      util.startBullet(target.trivial);
      util.continueBullet(source.trivial);
      util.exec('ln', [ '-s', source, target ], config.workDir);
      util.endBullet('Done'.good);
    }

    params.vars = _.extend({
      docker_registry_url: bundle.environment.docker_registry_url || config.dockerRegistryUrl
    }, params.vars);

    let changesets = {};
    _.each(bundle.validChangesets, function (changeset) {
      changesets[changeset] = ChangesetFile.Alias.RELEASED;
    });
    params.changesets = _.extend(changesets, params.changesets);

    // 'de-dupe' tags that would result in redundant ansible activity
    if (params.tags.includes(constants.STAY_DEPLOY_TAG)) {
      if (params.tags.includes(constants.STAY_SUC_TAG)) {
        params.tags = _.without(params.tags, constants.STAY_SUC_TAG);
      }
      if (params.tags.includes(constants.STAY_CONTENT_TAG)) {
        params.tags = _.without(params.tags, constants.STAY_CONTENT_TAG);
      }
    }

    // create symlinks
    util.subAnnounce('Creating symlinks'.plain);
    util.removeFilesFromDirectory(Path.join(config.workDir, bundle.getEnvironmentRepoPath(), bundle.environment.home_dir, bundle.environment.symlink_dir), /.*\.yml/);
    if (params.shipments) {
      let key = _.first(Object.keys(params.shipments));
      let value = params.shipments[key];
      symlink(sprintf('%s:%s', key, value), sprintf('%s_%s.yml', key, value), bundle.verifyShipmentYaml(key, value));
    } else if (params.changesets) {
      symlink('base', 'base.yml', bundle.verifyBaseYaml());
      _.each(Object.keys(params.changesets), function (key) {
        let value = params.changesets[key];
        symlink(sprintf('%s:%s', key, value), sprintf('%s_%s.yml', key, value), bundle.verifyChangesetYaml(key, value));
      });
    }
    util.subAnnounce('Initiating Ansible'.plain);
    let command = new AnsibleCommand(bundle, name, params);
    bundle.ansibleCommands.push(command);
    util.println(command.getCommandText().italic.useful);
    command.execute();
  }

};
