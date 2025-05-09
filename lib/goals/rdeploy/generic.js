const _ = require('underscore');

const AnsibleCommand = require('../../classes/AnsibleCommand');
const config = require('../../common/config');
const {Projects} = require('../../classes/Constants');
const util = require('../../common/util');

module.exports['generic'] = {

  checkout: function (bundle, goal, params) {
    let checkoutMap = {};
    let relevantProjects = util.asArray(bundle.environment.repo).concat(goal.repo, util.asArray(goal.support_repo));
    _.each(bundle.supportProjects, function (project) {
      if (relevantProjects.includes(project.repo.repoPath)) {
        let checkout = [Projects.GitTarget.MAINLINE];
        if (goal.default_branch) {
          checkout.unshift(goal.default_branch);
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
    util.subAnnounce('Initiating Ansible'.plain);
    let command = new AnsibleCommand(bundle, name, params);
    bundle.ansibleCommands.push(command);
    util.println(command.getCommandText().italic.useful);
    command.execute();
  }
};
