const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const {BuildProject} = require('../../../classes/BuildProject');
const config = require('../../../common/config');
const reviewUtil = require('../../../common/review-util');
const util = require('../../../common/util');

module.exports['show-info'] = {
  summary: 'Show information about the changeset',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['include', 'commits', 'unapproved', 'files', 'max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: [],
  notificationSettings: {
    skip: true
  },
  callback: function (bundle, goal) {
    function showExcludedProjectInfo(project) {
      util.startBullet('Version'.plain);
      let version = bundle.changeset.getValue(project.getPrimaryVersionsKey());
      util.endBullet(version ? version.useful : 'Unknown'.italic.trivial);
    }

    function showIncludedProjectInfo(project, status, includeCommits, includeMergedFiles, unapprovedOnly) {
      let metadata = bundle.changeset.getProjectMetadata(project.dirname);
      if (project instanceof BuildProject) {
        util.startBullet('Version'.plain);
        util.endBullet(project.pom.getVersion().useful);
      }
      util.startBullet('Source'.plain);
      util.endBullet(metadata.source.useful);
      let commits = reviewUtil.getCommitGraph(project, metadata, status, bundle.getChangesetBranchName(),
        bundle.invocation).getCommits();

      if (includeCommits && commits.length) {
        util.startBullet(unapprovedOnly ? 'Unapproved Commits:'.plain : 'Commits:'.plain);
        util.endBullet();

        reviewUtil.displayCommits(commits, metadata, { unapprovedOnly: unapprovedOnly });
      }

      if (includeMergedFiles) {
        if (metadata.handMergedFiles && metadata.handMergedFiles.length) {
          util.startBullet('Hand-Merged Files:'.plain);
          util.endBullet();
          _.each(metadata.handMergedFiles, file => {
            util.startSubBullet(file.italic.useful);
            util.endBullet();
          });
        }
        if (metadata.autoMergedFiles && metadata.autoMergedFiles.length) {
          util.startBullet('Auto-Merged Files:'.plain);
          util.endBullet();
          _.each(metadata.autoMergedFiles, file => {
            util.startSubBullet(file.italic.useful);
            util.endBullet();
          });
        }
      }
    }

    let optionCount = (config._all['commits'] ? 1 : 0) + (config._all['unapproved'] ? 1 : 0) +
      (config._all['files'] ? 1 : 0);
    if (optionCount > 1) {
      throw new BuildError('Only one of --commits, --unapproved, or --files is allowed');
    }

    bundle.initSomeOrAll();

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle);
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    let includeCommits = true;
    let includeMergedFiles = true;
    let includeExcluded = true;
    let unapprovedOnly = false;

    if (config._all['commits']) {
      includeMergedFiles = false;
      includeExcluded = false;
    } else if (config._all['unapproved']) {
      unapprovedOnly = true;
      includeMergedFiles = false;
      includeExcluded = false;
    } else if (config._all['files']) {
      includeCommits = false;
      includeExcluded = false;
    }

    util.announce(sprintf('Showing info on changeset %s'.plain, sprintf('%s:%s'.bold, config.changesetId.bundleName,
      config.changesetId.trackingId)));
    let summary = bundle.changeset.getValue('summary');
    if (summary) {
      util.startBullet('Summary'.plain);
      util.endBullet(summary.italic.useful);
    }

    util.startBullet('Status'.plain);
    util.endBullet(bundle.changeset.getStatus().useful);
    if (bundle.changeset.onTrunk()) {
      util.startBullet('Trunk'.plain);
      util.endBullet(bundle.changeset.getTrunk().useful);
    }
    if (bundle.changeset.isHotfix()) {
      util.startBullet('Hotfix'.plain);
      util.endBullet('true'.useful);
    }
    util.startBullet('Source Version'.plain);
    util.endBullet(bundle.changeset.getBundleVersion().toString().useful);
    if (bundle.changeset.getValue('merged_tracking_ids')) {
      util.startBullet('Formal Merges'.plain);
      util.endBullet((bundle.changeset.getValue('merged_tracking_ids') || []).join(', ').useful);
    }
    let releases = bundle.changeset.getValue('releases');
    if (releases && releases.length) {
      util.startBullet('Releases'.plain);
      util.endBullet();
      _.each(releases, release => {
        util.startSubBullet(release.useful);
        util.endBullet();
      });
    }
    let trunkMarkers = bundle.changeset.data.trunk_markers;
    if (trunkMarkers) {
      util.startBullet('Trunk Markers'.plain);
      util.endBullet();
      _.each(Object.keys(trunkMarkers), key => {
        util.startSubBullet(key.plain);
        util.endBullet(trunkMarkers[key].trivial);
      });
    }

    _.each(bundle.projects.included, function (project) {
      util.announce(sprintf('Showing info on included project %s'.plain, project.dirname.bold));
      showIncludedProjectInfo(project, reviewStatus[project.dirname], includeCommits, includeMergedFiles,
        unapprovedOnly);
    });
    _.each(bundle.supportProjects.included, function (project) {
      util.announce(sprintf('Showing info on included support project %s'.plain, project.dirname.bold));
      showIncludedProjectInfo(project, reviewStatus[project.dirname], includeCommits, includeMergedFiles,
        unapprovedOnly);
    });

    if (includeExcluded && !config._all['include'] && bundle.projects.excluded.length) {
      _.each(bundle.projects.excluded, function (project) {
        util.announce(sprintf('Showing info on excluded project %s'.plain, project.dirname.bold));
        showExcludedProjectInfo(project);
      });
    }
  }
};
