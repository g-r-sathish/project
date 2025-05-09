const _ = require('underscore');

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const {Projects} = require('../../../classes/Constants');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');

module.exports['shrink'] = {
  summary: 'Remove projects from an existing changeset',
  requiredArguments: ['changeset-id', 'include'],
  optionalArguments: ['max-fork-count', 'dry-run'],
  requiredSettings: ['jenkins_api_token'],
  optionalSettings: [],
  callback: function (bundle, goal) {

    function initialize(projects, removalNames) {
      let projectOptionPairs = [];
      _.each(projects, function (project) {
        if (_.contains(removalNames, project.dirname)) {
          projectOptionPairs.push({
            project: project,
            options: {
              checkout: [Projects.GitTarget.TAG_PREFIX + bundle.changeset.getReleaseTag(),
                Projects.GitTarget.MAINLINE]
            }
          });
        } else {
          projectOptionPairs.push({
            project: project,
            options: {
              checkout: bundle.getChangesetBranchName()
            }
          });
        }
      });
      bundle.checkoutEach(projectOptionPairs);
    }

    bundle.init({noCheckout: true});

    rflowUtil.ensureStatusIs(bundle.changeset, [ChangesetFile.Status.DEV, ChangesetFile.Status.RELEASED]);

    let removedProjects = bundle.getIncludedProjectsByName(config._all['include'], {
      includeProjects: true,
      includeSupportProjects: false
    });
    let removedSupportProjects = bundle.getIncludedProjectsByName(config._all['include'], {
      includeProjects: false,
      includeSupportProjects: true
    });

    if (bundle.changeset.isHotfix() && removedSupportProjects.length) {
      throw new BuildError('Support projects cannot be removed from a hotfix changeset!');
    }

    let removed = removedProjects.concat(removedSupportProjects);
    let removedNames = _.pluck(removed, 'dirname');

    initialize(bundle.getAllIncludedProjects(), removedNames);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle, bundle.changeset.getReleaseTag());
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    reviewUtil.identifyOrphanedCommits(bundle, removed, reviewStatus);

    rflowUtil.removeProjectsFromChangeset(bundle, removed);
  }
};
