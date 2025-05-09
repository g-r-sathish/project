const _ = require('underscore');

const ChangesetBundle = require('../../../classes/ChangesetBundle');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const {Projects} = require('../../../classes/Constants');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const util = require('../../../common/util');

module.exports['destroy'] = {
  summary: 'Destroy an existing changeset',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: [],
  callback: function (bundle, goal) {
    bundle.changeset.loadFromChangeset(config.changesetId);
    bundle.init({
      checkout: [Projects.GitTarget.TAG_PREFIX + bundle.changeset.getReleaseTag(), Projects.GitTarget.MAINLINE]
    });
    rflowUtil.ensureStatusIs(bundle.changeset, [ChangesetFile.Status.DEV]);

    let reviewStatus = reviewUtil.synchronizeReviewStatus(bundle, bundle.changeset.getReleaseTag());
    reviewUtil.removeUnneededReviewBranches(bundle, reviewStatus);

    let allProjects = bundle.getAllIncludedProjects();

    reviewUtil.identifyOrphanedCommits(bundle, allProjects, reviewStatus);

    bundle.changeset.save();

    // give the user a chance to bail out
    rflowUtil.confirmIntent();

    util.announce('Initializing secondary'.plain);
    let localBundle = new ChangesetBundle(bundle.configFile, bundle.versionsRepo, 'local');
    localBundle.init({
      checkout: [Projects.GitTarget.TAG_PREFIX + bundle.changeset.getReleaseTag(), Projects.GitTarget.MAINLINE],
      workDir: util.cwd()
    });

    util.announce('Removing YAML file'.plain);
    util.startBullet(bundle.changeset.repo.dirname.plain);
    util.removeFile(bundle.changeset.filePath);
    bundle.versionsRepo.addAndCommit(bundle.invocation.getCommitMessage());
    bundle.versionsRepo.push({retryWithPull: true});
    util.endBullet('Committed & pushed'.good);

    rflowUtil.removeChangesetAndReviewBranches(bundle, allProjects);
    rflowUtil.removeChangesetAndReviewBranches(localBundle, localBundle.getAllIncludedProjects(),
      {quiet: true, localOnly: true});
  }
};
