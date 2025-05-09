const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {BuildProject} = require('../../../classes/BuildProject');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const {ForkedProjectOp} = require('../../../classes/ForkedProjectOp');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');

module.exports['push'] = {
  summary: 'Push my changeset branches',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['message', 'use-cwd', 'max-fork-count', 'dry-run', 'build', 'skip-test', 'jacoco', 'perf-impr'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: ['rflow_workdir'],
  callback: function (bundle, goal) {
    let unpushable = [];
    let pushable = [];

    function scanProjects (projects) {
      _.each(projects, function (project) {
        util.startBullet(project.dirname.plain);
        if (project.repo.isMergeInProgress()) {
          util.endBullet('Merge in progress'.bad);
          unpushable.push(project);
        } else if (project.repo.hasTrackedChanges()) {
          util.endBullet('Local changes'.bad);
          unpushable.push(project);
        } else if (project.repo.hasLocalCommits()) {
          util.endBullet('Local commits'.good);
          pushable.push(project);
        } else {
          util.endBullet('No local commits'.trivial);
        }
      });
    }

    bundle.init({ workDir: util.cwd() });

    rflowUtil.ensureStatusIs(bundle.changeset,
      [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);

    // TODO: FORK THIS
    util.announce('Scanning projects'.plain);
    scanProjects(bundle.projects.included);
    scanProjects(bundle.supportProjects.included);

    if (unpushable.length > 0) {
      throw new BuildError(sprintf('Invalid status in [%s]', unpushable.join(', ')));
    }

    if (pushable.length > 0) {
      util.announce('Pushing projects'.plain);
      const inputs = _.map(pushable, project => {
        return {project: project};
      });

      /** Fork to {@link PushFork} */
      ForkedProjectOp.run('push.js', inputs);
    }

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);

    if (pushable.length > 0) {
      let buildable = _.filter(pushable, function (project) { return project instanceof BuildProject });
      if (buildable.length > 0 && config._all['build']) {
        rflowUtil.triggerBuild(bundle, buildable, reviewStatus);
      }
    }
  }
};
