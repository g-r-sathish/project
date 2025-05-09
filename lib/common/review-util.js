require('colors');

const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../classes/BuildError');
const {BuildProject} = require('../classes/BuildProject');
const CancelledError = require('../classes/CancelledError');
const ChangesetBundle = require('../classes/ChangesetBundle');
const CommitGraph = require('../classes/CommitGraph');
const config = require('./config');
const Errors = require('../classes/Errors');
const {ForkedProjectOp} = require('../classes/ForkedProjectOp');
const ExecError = require('../classes/ExecError');
const GitRepository = require('../classes/GitRepository');
const Invocation = require('../classes/Invocation');
const mergePom = require('./merge-pom');
const {POM} = require('../classes/POM');
const {Projects, Trunks} = require('../classes/Constants');
const rflowUtil = require('./rflow-util');
const stash = require('./stash').stashService;
const {Users} = require('../classes/Users');
const util = require('./util');

/**
 * @param {ForkInboundMessage} message
 */
function createPullRequestForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const versionsRepo = GitRepository.fromJsonObject(input.versionsRepo);

      let reviewers = (config.reviewers || []).concat(project.definition.reviewers || [])
        .concat(config.personal_settings.reviewers ? config.personal_settings.reviewers.split(',') : [])
        .concat(config._all.reviewers || []).concat(input.options.addDevOps ? config.ops_reviewers : []);
      let uniqueReviewers = [];
      _.each(reviewers, reviewer => {
        reviewer = reviewer.toLowerCase();
        if (reviewer === config.personal_settings.ad_username) return;
        if (uniqueReviewers.indexOf(reviewer.trim()) === -1) {
          uniqueReviewers.push(reviewer.trim());
        }
      });

      const users = new Users(versionsRepo);
      uniqueReviewers = users.resolveUsers(uniqueReviewers);

      let credentials = input[ForkedProjectOp.SENSITIVE_FIELD];
      let result = project.repo.createPullRequest({
        username: credentials ? credentials.username : undefined,
        password: credentials ? credentials.password : undefined,
        title: sprintf('%s:%s %s', config.bundleName, input.targetId, project.dirname),
        description: '_This pull request conveniently created for you by rFlow_',
        fromBranch: input.source,
        toBranch: input.destination,
        reviewers: uniqueReviewers
      });

      if (result.error) {
        ForkedProjectOp.sendInterim(project.dirname,
          sprintf('HTTP %d: %s'.bad, result.error.status, result.error.message || '(unknown)'));
        ForkedProjectOp.sendFinal(project.dirname, 'Failed'.bad, false, undefined);
      } else if (result.isNew) {
        ForkedProjectOp.sendInterim(project.dirname, 'Created'.good);
        ForkedProjectOp.sendInterim(project.dirname, sprintf('%s'.useful, result.uri));
        rflowUtil.postPRLinks(input.targetId.split('-')[1], result.uri);
        ForkedProjectOp.sendFinal(project.dirname, undefined, true, {
          status: 'created',
          url: result.uri
        });
      } else {
        ForkedProjectOp.sendInterim(project.dirname, 'Exists'.trivial);
        ForkedProjectOp.sendFinal(project.dirname, sprintf('%s'.useful, result.uri), true, {
          status: 'existing',
          url: result.uri
        });
      }
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function createPullRequests(pullRequests, targetId, options) {
  options = _.extend({
    addDevOps: false
  }, options);
  util.announce('Creating pull requests'.plain);
  const requiresCredentials = _.chain(pullRequests)
    .filter(pullRequest => pullRequest.project.repo.repoHost === GitRepository.Host.AGILYSYS)
    .map(pullRequest => pullRequest.project.dirname).value();
  const credentials = requiresCredentials.length ? stash.obtainCredentials() : undefined;
  const inputs = _.map(pullRequests, pullRequest => {
    const input = {
      project: pullRequest.project,
      versionsRepo: pullRequest.versionsRepo,
      source: pullRequest.source,
      destination: pullRequest.destination,
      targetId: targetId,
      options: options
    }
    if (credentials && _.contains(requiresCredentials, pullRequest.project.dirname)) {
      input[ForkedProjectOp.SENSITIVE_FIELD] = credentials;
    }
    return input;
  });

  /** Fork to {@link createPullRequestForked} */
  const result = ForkedProjectOp.run('create-pull-request.js', inputs);
  if (!result.success) {
    throw new BuildError(sprintf('Unable to create pull requests for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }
  _.each(Object.keys(result.outputs), dirname => {
    const output = result.outputs[dirname];
    if (output) {
      const pullRequest = _.find(pullRequests, pullRequest => pullRequest.project.dirname === dirname);
      pullRequest.status = output.status;
      pullRequest.url = output.url;
    }
  });
}

function createReviewBranchesAsNeeded(bundle, reviewStatus, forceNew) {
  let projectsToPR = {};
  let forceNewProjects = [];
  let tasksForBranchCreation = [];
  let hasMissingCount = 0;

  util.announce('Identifying projects requiring review'.plain);
  _.each(bundle.getAllIncludedProjects(), function (project) {
    let metadata = bundle.changeset.getProjectMetadata(project.dirname);

    util.startBullet(project.dirname.plain);
    let task = {
      project: project
    };
    let status = reviewStatus[project.dirname];
    if (status && status.changesetCommits !== undefined) {
      task.approvedTo = status.approvedTo;
      task.approvedMergeParents = status.approvedMergeParents;
      task.changesetCommits = status.changesetCommits;
      if (status.changesetCommits.length > 0) {
        util.continueBullet(sprintf('%d commit%s to review'.good, status.changesetCommits.length,
          util.plural(status.changesetCommits.length)));
        if (status.missingMergeCommits.length) {
          if (!forceNew) {
            hasMissingCount++;
          }
          util.continueBullet(
            sprintf('%d missing merge commit%s'.bad, status.missingMergeCommits.length,
              util.plural(status.missingMergeCommits.length)));
        }
        if (forceNew && status.hasBranches) {
          util.continueBullet('Replacing branches'.warn);
          tasksForBranchCreation.push(task);
          forceNewProjects.push(project);
        } else if (!status.hasBranches) {
          util.continueBullet('New branches'.good);
          tasksForBranchCreation.push(task);
        } else {
          util.continueBullet('Existing branches'.trivial);
        }
        projectsToPR[project.dirname] = project;
        util.endBullet('Required'.good);
        _displayMissingMergeCommits(status, metadata, project.repo);
        return;
      } else {
        util.continueBullet('0 commits to review'.trivial);
        util.endBullet('Not required'.trivial);
        return;
      }
    }

    let commitGraph = getCommitGraph(project, metadata, status, bundle.getChangesetBranchName(), bundle.invocation);
    task.approvedTo = metadata.approvedTo || metadata.source;
    task.approvedMergeParents = metadata.approvedMergeParents;
    task.changesetCommits = commitGraph.getUnapprovedCommits();

    if (task.changesetCommits.length) {
      tasksForBranchCreation.push(task);
      projectsToPR[project.dirname] = project;
      util.continueBullet(sprintf('%d commits to review'.good, task.changesetCommits.length));
      util.continueBullet('New branches'.good);
      util.endBullet('Required'.good);
    } else {
      util.continueBullet('0 commits to review'.trivial);
      util.endBullet('Not required'.trivial);
    }
  });

  if (hasMissingCount) {
    throw new BuildError(sprintf(
      'Merge commits missing from the changeset branch for %d project%s; did you forget to push?', hasMissingCount,
      util.plural(hasMissingCount)));
  }

  if (forceNewProjects.length) {
    let plural = util.plural(forceNewProjects);
    let message = 'Deleting existing review branches'.inverse;
    message += sprintf(
      '\nReview branches for the %d project%s identified above will be deleted and any associated PR%s declined',
      forceNewProjects.length, plural, plural);
    _promptToContinue(message, 'warn');

    const inputs = _.map(forceNewProjects, project => {
      return {
        project: project,
        reviewSourceBranch: bundle.getReviewSourceBranchName(),
        reviewTargetBranch: bundle.getReviewTargetBranchName(),
      }
    });

    /** Fork to {@link removeReviewBranchesForked} */
    const result = ForkedProjectOp.run('remove-review-branches.js', inputs);
    if (!result.success) {
      throw new BuildError(sprintf('Unable to remove review branches for %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }
    _resynchronizeReviewStatus(bundle, undefined, reviewStatus);
  }

  let yamlModified = false;
  if (tasksForBranchCreation.length) {
    util.announce('Creating review branches'.plain);
    const inputs = _.map(tasksForBranchCreation, task => {
      return {
        project: task.project,
        approvedMergeParents: task.approvedMergeParents,
        approvedTo: task.approvedTo,
        changesetCommits: task.changesetCommits,
        ourTrunkName: bundle.changeset.getTrunk(),
        metadata: bundle.changeset.getProjectMetadata(task.project.dirname),
        changesetBranch: bundle.getChangesetBranchName(),
        reviewSourceBranch: bundle.getReviewSourceBranchName(),
        reviewSourceRemoteBranch: bundle.getReviewSourceBranchName(true),
        reviewTargetBranch: bundle.getReviewTargetBranchName(),
        reviewTargetRemoteBranch: bundle.getReviewTargetBranchName(true)
      }
    });

    /** Fork to {@link createReviewBranchesForked} */
    const result = ForkedProjectOp.run('create-review-branches.js', inputs);
    if (!result.success) {
      throw new BuildError(sprintf('Unable to create review branches for %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }
    _.each(Object.keys(result.outputs), dirname => {
      const output = result.outputs[dirname];
      if (output) {
        bundle.changeset.setProjectMetadata(dirname, output);
        delete projectsToPR[dirname];
        yamlModified = true;
      } else {
        let project = _.find(bundle.getAllProjects(), project => project.dirname === dirname);
        project.hasNewReviewBranches = true;
      }
    });
  }
  if (yamlModified) {
    bundle.changeset.save();
    rflowUtil.updateSourceControl(bundle, {silent: true, skipProjects: true});
  }

  let response = [];
  for (let dirname in projectsToPR) {
    response.push(projectsToPR[dirname]);
  }
  return response;
}

/**
 * @param {ForkInboundMessage} message
 */
function createReviewBranchesForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const invocation = new Invocation('changeset-id', config.personal_settings.ad_username);

      const repo = project.repo;
      const approvedMergeParentIds = new Set(input.approvedMergeParents || []);

      let ourPom = project instanceof BuildProject ? POM.create(project.pom.pathname) : undefined;
      rflowUtil.handleIfPending(repo, input.approvedTo);
      repo.checkout(input.approvedTo, {pull: false});
      repo.createBranch(input.reviewTargetBranch, true);
      const mergeIds = [];
      _.each(input.changesetCommits, function (commit) {
        let commitId;
        if (commit.parent && approvedMergeParentIds.has(commit.parent)) {
          commitId = commit.parent;
        } else if (approvedMergeParentIds.has(commit.id)) {
          commitId = commit.id;
        }
        if (commitId) {
          mergeIds.push(mergeToReviewTarget(project, commitId, ourPom, input.ourTrunkName, invocation));
        }
      });
      repo.push();

      repo.checkout(input.changesetBranch);
      repo.createBranch(input.reviewSourceBranch, true);
      _.each(mergeIds, mergeId => _mergeToReviewSource(repo, mergeId, invocation));
      repo.push();
      if (mergeIds.length > 0) {
        ForkedProjectOp.sendInterim(project.dirname,
          sprintf('%d merge commit%s processed'.good, mergeIds.length, util.plural(mergeIds.length)));
      }

      if (!repo.hasDiff(input.reviewSourceRemoteBranch, input.reviewTargetRemoteBranch)) {
        input.metadata.approvedTo = input.changesetCommits[input.changesetCommits.length - 1].id;
        ForkedProjectOp.sendInterim(project.dirname,
          sprintf('%d empty commit%s bypassed'.good, input.changesetCommits.length,
            util.plural(input.changesetCommits.length)));

        repo.deleteLocalAndRemoteBranch(input.reviewSourceBranch);
        repo.deleteLocalAndRemoteBranch(input.reviewTargetBranch);

        ForkedProjectOp.sendFinal(project.dirname, 'Bypassed'.useful, true, input.metadata);
      } else {
        ForkedProjectOp.sendFinal(project.dirname, 'Created'.useful, true, undefined);
      }
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function displayCommits(commits, metadata, options) {
  options = _.extend({
    unapprovedOnly: false
  }, options);

  let maxCommitterLength = 0;
  let maxWhenLength = 0;
  _.each(commits, function (commit) {
    if (!commit.approved || !options.unapprovedOnly) {
      maxCommitterLength = Math.max(commit.committer.length, maxCommitterLength);
      maxWhenLength = Math.max(commit.when.length, maxWhenLength);
    }
  });

  let parentFormat = '%\'--' + config.gitCommitHashSize + 's';
  let committerFormat = '%-' + maxCommitterLength + 's';
  let whenFormat = '%-' + maxWhenLength + 's';

  _.each(commits, function (commit) {
    if (!commit.approved || !options.unapprovedOnly) {
      util.startSubBullet(commit.parents.length > 1 ? 'M'.plain : 'C'.plain);
      let color = commit.approved ? 'useful' : 'warn';
      util.continueBullet(commit.id[color]);
      if (commit.parents.length > 1) {
        let color = commit.approved || _.contains(metadata.approvedMergeParents, commit.parents[1]) ? 'useful' :
          'warn';
        util.continueBullet(sprintf(parentFormat[color], commit.parents[1]));
      } else {
        util.continueBullet(sprintf(parentFormat.trivial.italic, ''));
      }
      util.continueBullet(sprintf(committerFormat.trivial, commit.committer));
      util.continueBullet(sprintf(whenFormat.trivial, commit.when));
      util.endBullet(commit.message.plain.italic);
    }
  });
}

/**
 * @param {ForkInboundMessage} message
 */
function ensureProjectIsReviewedForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      let metadata = input.metadata;
      let status = input.status;

      const invocation = new Invocation('changeset-id', config.personal_settings.ad_username);

      const commits = getCommitGraph(project, metadata, status, input.changesetBranch,
        invocation).getUnapprovedCommits();
      let hasMissing = false;
      if (status && status.missingMergeCommits.length) {
        hasMissing = true;
        ForkedProjectOp.sendInterim(project.dirname,
          sprintf('%d merge commit%s missing'.bad, status.missingMergeCommits.length,
            util.plural(status.missingMergeCommits.length)));
      }
      let hasToReview = false;
      if (commits.length) {
        hasToReview = true;
        ForkedProjectOp.sendInterim(project.dirname,
          sprintf('%d commit%s missing'.bad, commits.length, util.plural(commits.length)));
      }
      const update = hasMissing || hasToReview ? 'Incomplete'.bad : 'Reviewed'.good;
      const missingMergeCommits = _prepareMissingMergeCommits(status, metadata, project.repo);

      ForkedProjectOp.sendFinal(project.dirname, update, true, {
        metadata: metadata,
        hasMissing: hasMissing,
        hasToReview: hasToReview,
        missingMergeCommits: missingMergeCommits
      });
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function ensureProjectsAreNotRetired(bundle) {
  let count = 0;
  _.each(bundle.getAllIncludedProjects(), project => {
    if (project.getStatus(bundle.changeset.getTrunk()) === Projects.Status.RETIRED) {
      if (count++ === 0) util.announce('Ensuring projects are not retired'.plain);
      util.startBullet(project.dirname.plain);
      util.endBullet('Retired'.bad);
    }
  });
  if (count) {
    throw new BuildError(
      sprintf('%d project%s retired; this can be rectified with a pull', count, util.plural(count)));
  }
}

function ensureProjectsAreReviewed(bundle, reviewStatus) {
  util.announce('Ensuring projects are reviewed'.plain);
  let hasMissingCount = 0;
  let hasToReviewCount = 0;
  const inputs = _.map(bundle.getAllIncludedProjects(), project => {
    return {
      project: project,
      metadata: bundle.changeset.getProjectMetadata(project.dirname),
      status: reviewStatus[project.dirname],
      changesetBranch: bundle.getChangesetBranchName()
    };
  })

  /** Fork to {@link ensureProjectIsReviewedForked} */
  const result = ForkedProjectOp.run('ensure-project-is-reviewed.js', inputs);
  if (!result.success) {
    throw new BuildError(
      sprintf('Unable to ensure %d project%s reviewed', result.failureCount, util.plural(result.failureCount)));
  }
  const missingMergeCommits = {};
  _.each(Object.keys(result.outputs), dirname => {
    const output = result.outputs[dirname];
    if (output.hasMissing) hasMissingCount++;
    if (output.hasToReview) hasToReviewCount++;
    if (output.missingMergeCommits && output.missingMergeCommits.length > 0) {
      missingMergeCommits[dirname] = {
        commits: output.missingMergeCommits,
        metadata: output.metadata
      };
    }
  });
  _displayAllMissingMergeCommits(missingMergeCommits);

  if (hasMissingCount) {
    throw new BuildError(sprintf(
      'Merge commits missing from the changeset branch for %d project%s; did you forget to push?', hasMissingCount,
      util.plural(hasMissingCount)));
  }
  if (hasToReviewCount) {
    throw new BuildError(
      sprintf('Changeset not adequately reviewed; %d project%s have commits to review', hasToReviewCount,
        util.plural(hasToReviewCount)));
  }
}

function getApprovedMergeParentsAndConfirmUnapprovedIsOk(bundle, changeset, projectsToAdd, isPull) {
  let approvedMergeParents = _getApprovedMergeParents(bundle, changeset, projectsToAdd, isPull);
  if (!isPull) {
    let approvedProjectNames = Object.keys(approvedMergeParents);
    let allProjectNames = _.pluck(bundle.getAllIncludedProjects().concat(projectsToAdd || []), 'dirname');
    if (approvedProjectNames.length !== allProjectNames.length) {
      let unapprovedProjectNames = _.difference(allProjectNames, approvedProjectNames);

      if (config._all.formal) {
        throw new BuildError(
          'All projects must be fully reviewed when merging with the --formal option; the following are not: ' +
          unapprovedProjectNames.join(', '));
      }

      let message = sprintf('Acknowledging projects not fully reviewed for %s\n'.inverse,
        changeset.getValue('tracking_id'));
      _.each(unapprovedProjectNames, function (name) {
        message += sprintf('%s %s\n', config.display.bulletChar, name);
      });
      message += 'All merged changes from these projects will be included as changes in your pull requests';
      _promptToContinue(message, 'warn');
    }
  }
  return approvedMergeParents;
}

function getCommitGraph(project, metadata, status, changesetBranch, invocation) {
  rflowUtil.handleIfPending(project.repo, metadata.source);
  if (status && status.commitGraph) {
    return status.commitGraph instanceof CommitGraph ? status.commitGraph :
      CommitGraph.fromJsonObject(status.commitGraph);
  }
  return CommitGraph.create(project, _scopedSource(metadata.source),
    sprintf('origin/%s', changesetBranch), metadata.approvedTo, invocation);
}

function identifyOrphanedCommits(bundle, projects, reviewStatus) {
  // TODO: FORK THIS - will require restructuring
  util.announce('Identifying commits that will be orphaned'.plain);
  let hasOne = false;
  _.each(projects, function (project) {
    let metadata = bundle.changeset.getProjectMetadata(project.dirname);
    let commitGraph = getCommitGraph(project, metadata, reviewStatus[project.dirname], bundle.getChangesetBranchName(),
      bundle.invocation);

    let commits = _.filter(commitGraph.getCommits(),
      commit => !commit.message.startsWith(bundle.invocation.getCommitPrefix()));
    if (commits.length > 0) {
      hasOne = true;
      util.subAnnounce(project.dirname.plain);
      _.each(commits, function (commit) {
        util.startBullet(commit.id.useful);
        util.continueBullet(commit.committer.trivial);
        util.endBullet(commit.message.plain);
      });
    }
  });
  if (!hasOne) {
    util.startBullet('No commits'.trivial.italic);
    util.endBullet();
  }
}

function identifyTrunkMarkerUpdates(ourChangeset, theirChangeset, trunks) {
  let ourTrunk = ourChangeset.getTrunk();
  let theirTrunk = theirChangeset.getTrunk();
  let sameTrunk = theirTrunk === ourTrunk;

  let sameHotfix = theirChangeset.isHotfix() === ourChangeset.isHotfix();

  let fromTrunk = config._all.trunk;
  let fromProduction = config._all.production;
  let fromElsewhere = fromProduction || config._all.hotfix || fromTrunk || config._all.released;
  fromElsewhere = fromElsewhere || !sameTrunk || !sameHotfix;

  let updates = {};

  // TODO: should not get this when pulling --hotfix
  // ● master ▶ From 1.97 to 1.97-HF10
  // and watch out for the section at the bottom that removes if not defined

  if (fromTrunk) {
    updates[fromTrunk] = {
      from: ourChangeset.getTrunkMarker(fromTrunk),
      to: trunks[fromTrunk].getVersion()
    };
  }
  Object.keys(trunks).concat([Trunks.MASTER]).forEach(trunk => {
    let theirVersion = trunk === theirTrunk || (trunk === Trunks.MASTER && !theirTrunk) ?
      theirChangeset.getBundleVersion() : theirChangeset.getTrunkMarker(trunk);
    let ourVersion = trunk === ourTrunk || (trunk === Trunks.MASTER && !ourTrunk) ?
      ourChangeset.getBundleVersion() : ourChangeset.getTrunkMarker(trunk);
    if (!theirVersion) return;

    let theirVersionTrunk = theirVersion.getTrunkName();
    let ourVersionTrunk = ourVersion ? ourVersion.getTrunkName() : undefined;

    if (!ourVersion || (!ourVersionTrunk && ourTrunk && theirVersionTrunk === ourTrunk) ||
      (theirVersionTrunk === ourVersion.getTrunkName() && theirVersion.compareTo(ourVersion) > 0 && sameHotfix &&
        !fromProduction)) {
      updates[trunk] = {
        from: ourVersion,
        to: theirVersion
      }
    }
  });
  if (ourTrunk) {
    let trunkVersion = ourChangeset.getTrunkMarker(ourTrunk);
    if (trunkVersion) {
      ourChangeset.setTrunkMarker(ourTrunk);
      if (ourChangeset.getBundleVersion().compareTo(trunkVersion) < 0) {
        updates[ourTrunk] = {
          from: ourChangeset.getBundleVersion(),
          to: trunkVersion
        }
      }
    }
    if (fromElsewhere && !fromTrunk && !theirChangeset.onTrunk()) {
      let theirMasterVersion = theirChangeset.getBundleVersion();
      let ourMasterVersion = ourChangeset.getTrunkMarker(Trunks.MASTER);
      if (!ourMasterVersion || theirMasterVersion.compareTo(ourMasterVersion) > 0) {
        updates[Trunks.MASTER] = {
          from: ourMasterVersion,
          to: theirMasterVersion
        }
      }
    }
  } else {
    let current = ourChangeset.getTrunkMarker(Trunks.MASTER);
    if (current && !updates[Trunks.MASTER] && sameHotfix) {
      updates[Trunks.MASTER] = {
        from: current,
        to: undefined
      }
    }
  }

  if (!Object.keys(updates).length) {
    return updates;
  }

  util.announce('Identifying trunk marker updates'.plain);
  Object.keys(updates).forEach(trunk => {
    let update = updates[trunk];
    if (!update.to && !update.from) return;
    util.startBullet(trunk.plain);
    if (update.from && update.to) {
      util.endBullet(sprintf('From %s to %s', update.from.toString().useful, update.to.toString().useful));
    } else if (update.from && !update.to) {
      util.endBullet(sprintf('Remove %s', update.from.toString().useful));
    } else if (!update.from && update.to) {
      util.endBullet(sprintf('To %s', update.to.toString().useful));
    }
  });
  _promptToContinue('Confirm these trunk marker updates are expected', 'warn');

  return updates;
}

function initializeReviewBundle(bundle, reviewStatus, approvedMergeParents) {
  let includeList = [];
  let reviewBranches = [bundle.getReviewSourceBranchName(), bundle.getReviewTargetBranchName()];
  _.each(bundle.getAllIncludedProjects(), function (project) {
    let status = reviewStatus[project.dirname];
    if (status && status.branches && _.intersection(status.branches, reviewBranches).length === reviewBranches.length &&
      approvedMergeParents[project.dirname]) {
      includeList.push(project.dirname);
    }
  });

  if (includeList.length) {
    util.announce('Initializing secondary'.plain);
  }
  let reviewBundle = new ChangesetBundle(bundle.configFile, bundle.versionsRepo, 'review');
  reviewBundle.init({
    checkout: [bundle.getReviewTargetBranchName()],
    includeList: includeList,
    trackingIdMatch: false
  });
  return reviewBundle;
}

function mergeToReviewTarget(project, commitId, ourPom, ourTrunkName, invocation) {
  try {
    project.repo.disablePomMergeDriver();
    let proc = project.repo.gitOkToFail('merge', '--strategy-option=theirs', '--no-ff', '--no-commit',
      '--allow-unrelated-histories', commitId);
    if (proc.status !== 0) {
      project.repo.getFileStatus().forEach(function (one) {
        let status = one.substring(0, 2);
        let file = one.substring(3);
        switch (status) {
          case 'AA':
          case 'UA':
          case 'AU':
          case 'UU':
            if (file.indexOf('pom.xml') >= 0) {
              throw new BuildError("Conflicts in POM.xml during review target merge");
            }
            project.repo.git('add', file);
            break;
          case 'DU':
            // in this case there won't be any internal file conflicts
            project.repo.git('add', file);
            break;
          case 'DD':
          case 'UD':
            project.repo.git('rm', file);
            break;
          case '??':
            util.removeFile(path.join(project.repo.getRepoDir(), file));
            break;
        }
      });
    }

    if (project instanceof BuildProject && ourPom) {
      project.reload();
      if (project.pom) {
        let theirPom = project.pom;
        _mergePom(ourPom, theirPom, {ourTrunkName: ourTrunkName});
        if (theirPom.modules && theirPom.modules.length) {
          _.each(theirPom.modules, theirModule => {
            let ourModule = _.find(ourPom.modules, module => module.dir === theirModule.dir);
            if (ourModule) {
              _mergePom(ourModule, theirModule, {ourTrunkName: ourTrunkName});
            }
          });
        }
      }
    }

    let message = invocation.getCommitMessage(sprintf("merged %s", commitId));

    project.repo.addAndCommit(message);
    return project.repo.gitCapture('log', '--max-count=1', '--pretty=format:%h',
      '--abbrev=' + config.gitCommitHashSize);
  } catch (ex) {
    throw new Errors.TargetMergeError(sprintf('Failed to merge to review target: %s', ex.toString()));
  } finally {
    project.repo.enablePomMergeDriver();
  }
}

/**
 * @param {ForkInboundMessage} message
 */
function removeReviewBranchesForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const result = project.repo.abandonPullRequest({
        fromBranch: input.reviewSourceBranch,
        toBranch: input.reviewTargetBranch
      });
      if (result && result.error) {
        ForkedProjectOp.sendInterim(project.dirname,
          sprintf('HTTP %d: %s'.bad, result.error.status, result.error.message || '(unknown)'));
        ForkedProjectOp.sendFinal(project.dirname, 'Failed'.bad, false, undefined);
        return;
      }

      project.repo.deleteLocalAndRemoteBranch(input.reviewSourceBranch);
      project.repo.deleteLocalAndRemoteBranch(input.reviewTargetBranch);
      ForkedProjectOp.sendFinal(project.dirname, 'Deleted'.good, true, undefined);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

/**
 * @param {ChangesetBundle} bundle
 * @param {{}} reviewStatus
 */
function removeUnneededReviewBranches(bundle, reviewStatus) {
  let unneededReviews = {};
  _.each(Object.keys(reviewStatus), function (key) {
    let status = reviewStatus[key];
    if (status.changesetCommits && !status.changesetCommits.length && !status.missingMergeCommits.length) {
      unneededReviews[key] = reviewStatus[key];
    }
  });
  if (Object.keys(unneededReviews).length) {
    util.announce('Removing unneeded review branches'.plain);
    const inputs = _.map(Object.keys(unneededReviews), dirname => {
      return {
        project: _.find(bundle.getAllIncludedProjects(), project => project.dirname === dirname),
        status: unneededReviews[dirname],
        reviewSourceBranch: bundle.getReviewSourceBranchName(),
        reviewTargetBranch: bundle.getReviewTargetBranchName()
      }
    });

    /** Fork to {@link removeUnneededReviewBranchesForked} */
    const result = ForkedProjectOp.run('remove-unneeded-review-branches.js', inputs);
    if (!result.success) {
      throw new BuildError(sprintf('Unable to remove review branches for %d project%s', result.failureCount,
        util.plural(result.failureCount)));
    }
    _.each(Object.keys(result.outputs), dirname => {
      const output = result.outputs[dirname];
      const status = output.status;
      if (status) {
        status.commitGraph = CommitGraph.fromJsonObject(status.commitGraph);
      }
      reviewStatus[dirname] = status;
    });
  }
}

/**
 * @param {ForkInboundMessage} message
 */
function removeUnneededReviewBranchesForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const status = input.status;
        const remainingBranches = [];
        const result = project.repo.abandonPullRequest({
          fromBranch: input.reviewSourceBranch,
          toBranch: input.reviewTargetBranch
        });
        if (result && result.error) {
          ForkedProjectOp.sendInterim(project.dirname,
            sprintf('HTTP %d: %s'.bad, result.error.status, result.error.message || '(unknown)'));
          ForkedProjectOp.sendFinal(project.dirname, 'Failed'.bad, false, undefined);
          return;
        }
        _.each(status.branches, branch => {
          if (branch === input.reviewSourceBranch || branch === input.reviewTargetBranch) {
            project.repo.deleteLocalAndRemoteBranch(branch);
          } else {
            remainingBranches.push(branch);
          }
        });
        if (remainingBranches.length > 0) {
          status.branches = remainingBranches;
        } else {
          delete status.branches;
        }
        delete status.hasBranches;
        ForkedProjectOp.sendFinal(project.dirname, 'Deleted'.good, true, {
          status: status
        });
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

/**
 * @param {ForkInboundMessage} message
 */
function resynchronizeReviewStatusForked(message) {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      const invocation = new Invocation('changeset-id', config.personal_settings.ad_username);

      let yamlModified = false;
      let metadata = input.metadata;
      let status = {};
      let sendStatus = false;
      let finished = false;

      if (metadata.new) {
        delete metadata.new;
        yamlModified = true;
        finished = true;
        ForkedProjectOp.sendInterim(project.dirname, 'New project'.trivial);
        ForkedProjectOp.sendInterim(project.dirname, 'Registered'.useful);
      }

      let commits;
      if (!finished) {
        status.commitGraph =
          getCommitGraph(project, metadata, status, input.changesetBranch, invocation);

        if (metadata.approvedTo) {
          if (!status.commitGraph.isCommitIdApproved(metadata.approvedTo)) {
            util.narratef('approved_to value of %s is invalid and will be removed\n', metadata.approvedTo);
            metadata.approvedTo = undefined;
            metadata.modified = true;
          }
        }

        commits = _informCommits(project, metadata, status, input.reviewSourceBranch,
          input.reviewTargetBranch, invocation);

        if (!status.hasBranches) {
          ForkedProjectOp.sendInterim(project.dirname, 'No review branches'.trivial);
          _synchronizeWithoutReviewBranches(project, metadata, commits, invocation);
          if (metadata.modified) {
            delete metadata.modified;
            yamlModified = true;
          }
          finished = true;
        }
      }

      let missingMergeCommits;
      if (!finished) {
        let lookups = _constructLookups(project, commits, invocation);

        _processCommits(status, commits, lookups);

        if (status.mergedCount) {
          metadata.approvedTo = status.approvedTo;
          metadata.modified = true;
          ForkedProjectOp.sendInterim(project.dirname,
            sprintf('%d commit%s merged'.good, status.mergedCount, util.plural(status.mergedCount)));
        }

        if (status.notInReview || status.targetMergeIds.length) {
          project.repo.checkout(input.reviewSourceBranch);
          if (status.notInReview) {
            project.repo.disablePomMergeDriver();
            try {
              let message = invocation.getCommitMessage(sprintf("merged %s", input.changesetBranch));
              project.repo.git('merge', '--strategy-option=theirs', '-m', message, input.changesetBranch);
            } finally {
              project.repo.enablePomMergeDriver();
            }
            ForkedProjectOp.sendInterim(project.dirname,
              sprintf('%d commit%s added'.good, status.notInReview, util.plural(status.notInReview)));
            status.needsBuild = true;
          }
          if (status.targetMergeIds.length) {
            project.repo.checkout(input.reviewSourceBranch);
            _.each(status.targetMergeIds, function (mergeId) {
              _mergeToReviewSource(project.repo, mergeId, invocation);
            });
            ForkedProjectOp.sendInterim(project.dirname,
              sprintf('%d merge commit%s processed'.good, status.targetMergeIds.length,
                util.plural(status.targetMergeIds.length)));
            status.needsBuild = true;
          }
          project.repo.push();
          project.repo.checkoutPrevious();
        }

        if (status.missingMergeCommits.length) {
          ForkedProjectOp.sendInterim(project.dirname,
            sprintf('%d merge commit%s missing'.warn, status.missingMergeCommits.length,
              util.plural(status.missingMergeCommits.length)));
        } else if (status.hasBranches && status.changesetCommits && status.changesetCommits.length &&
          !project.repo.hasDiff(input.reviewSourceRemoteBranch, input.reviewTargetRemoteBranch)) {
          // if no delta, we can advance approvedTo and skip the pull request
          status.approvedTo = metadata.approvedTo = status.changesetCommits[status.changesetCommits.length - 1].id;
          metadata.modified = true;
          ForkedProjectOp.sendInterim(project.dirname,
            sprintf('%d empty commit%s bypassed'.good, status.changesetCommits.length,
              util.plural(status.changesetCommits.length)));
          status.changesetCommits = [];
        }

        if (status.notInReview || status.mergedCount || metadata.modified) {
          ForkedProjectOp.sendInterim(project.dirname, 'Synced'.useful);
        } else {
          ForkedProjectOp.sendInterim(project.dirname, 'No new commits'.trivial);
          ForkedProjectOp.sendInterim(project.dirname, 'Skipped'.trivial);
        }

        missingMergeCommits = _prepareMissingMergeCommits(status, metadata, project.repo);

        delete status.notInReview;
        sendStatus = true;

        if (metadata.modified) {
          delete metadata.modified;
          status.commitGraph.updatedApprovedTo(status.approvedTo);
          yamlModified = true;
        }
      }

      ForkedProjectOp.sendFinal(project.dirname, undefined, true, {
        yamlModified: yamlModified,
        metadata: metadata,
        status: sendStatus ? status : undefined,
        missingMergeCommits: missingMergeCommits
      });
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
}

function synchronizeReviewStatus(bundle, defaultSource, projectNamesToExclude) {
  return _resynchronizeReviewStatus(bundle, defaultSource, undefined, projectNamesToExclude);
}

function _constructLookups(project, commits, invocation) {
  let lookups = {
    sets: {
      changeset: _pseudoSet(commits.changeset, 'id'),
      changesetParent: _pseudoSet(commits.changeset, 'parent'),
      changesetNotApproved: _pseudoSet(commits.changesetNotApproved, 'id'),
      changesetNotApprovedParent: _pseudoSet(commits.changesetNotApproved, 'parent'),
      reviewSource: _pseudoSet(commits.reviewSource, 'id'),
      reviewSourceParent: _pseudoSet(commits.reviewSource, 'parent'),
      reviewSourceNotIgnored: _pseudoSet(commits.reviewSourceNotIgnored, 'id'),
      reviewSourceNotIgnoredParent: _pseudoSet(commits.reviewSourceNotIgnored, 'parent'),
      reviewTargetParent: _pseudoSet(commits.reviewTarget, 'parent')
    },
    maps: {
      changesetToReviewSource: {},
      changesetParentToReviewTarget: {},
      changesetToReviewSourceIgnored: {},
      reviewTargetParentToReviewTarget: {}
    }
  };

  _.each(commits.reviewSourceNotIgnored, function (commit) {
    if (lookups.sets.changesetNotApproved[commit.parent]) {
      lookups.maps.changesetToReviewSource[commit.parent] = commit.id;
    }
  });

  _.each(commits.reviewTarget, function (commit) {
    if (lookups.sets.changesetNotApprovedParent[commit.parent]) {
      lookups.maps.changesetParentToReviewTarget[commit.parent] = commit.id;
    }
    lookups.maps.reviewTargetParentToReviewTarget[commit.parent] = commit.id;
  });

  let lastChangesetId = undefined;
  _.each(commits.reviewSource, function (commit) {
    if (lookups.sets.changesetNotApproved[commit.id]) {
      lastChangesetId = commit.id;
    } else if (lookups.sets.changesetNotApproved[commit.parent]) {
      lastChangesetId = commit.parent;
    } else if (lastChangesetId && commit.message.startsWith(invocation.getIgnoredCommitPrefix())) {
      let ignoredReviewSourceIds = lookups.maps.changesetToReviewSourceIgnored[lastChangesetId];
      if (!ignoredReviewSourceIds) {
        ignoredReviewSourceIds = [];
        lookups.maps.changesetToReviewSourceIgnored[lastChangesetId] = ignoredReviewSourceIds;
      }
      ignoredReviewSourceIds.push(commit.id);
    } else {
      lastChangesetId = undefined;
    }
  });

  return lookups;
}

function _displayAllMissingMergeCommits(missingMergeCommits) {
  if (!Object.keys(missingMergeCommits).length) return;

  util.announce('Missing merge commits'.warn);
  _.each(Object.keys(missingMergeCommits), dirname => {
    const info = missingMergeCommits[dirname];
    util.startBullet(dirname.warn, 'warn');
    util.endBullet();
    displayCommits(info.commits, info.metadata);
  });
}

function _displayMissingMergeCommits(status, metadata, repo) {
  let commits = _prepareMissingMergeCommits(status, metadata, repo);
  if (commits) {
    displayCommits(commits, metadata, {})
  }
}

function _getApprovedMergeParents(bundle, changeset, projectsToAdd, isPull) {
  let approvedMergeParents = {};
  _.each(bundle.getAllIncludedProjects().concat(projectsToAdd || []), function (project) {
    let approved = false;
    let source = undefined;
    if (isPull) {
      approved = true;
    } else {
      if (project instanceof BuildProject) {
        let version = changeset.getVersion(project.getPrimaryVersionsKey());
        if (version && version.hasTrackingId() && version.getTrackingId() === changeset.getValue('tracking_id')) {
          source = sprintf('origin/%s', changeset.getChangesetBranchName());
        } else {
          approved = true;
        }
      } else {
        if (!!changeset.getValue(project.getInclusionKey())) {
          source = sprintf('origin/%s', changeset.getChangesetBranchName());
        } else {
          approved = true;
        }
      }
    }
    if (source) {
      let metadata = changeset.getProjectMetadata(project.dirname);
      let approvedTo = metadata ? metadata.approvedTo : undefined;
      let latestCommitId = project.repo.getLatestCommitId(source);
      util.narratef('ApprovedTo: %s <=> LastCommitId: %s\n', approvedTo, latestCommitId);

      if (approvedTo === latestCommitId) {
        approved = true;
      }
      if (!approved && !approvedTo && project.getStatus(changeset.getTrunk()) !== Projects.Status.PENDING) {
        let sourceCommitId = project.repo.getLatestCommitId(changeset.getReleaseTag());
        if (sourceCommitId === latestCommitId) {
          approved = true;
        }
      }
    }
    if (approved) {
      approvedMergeParents[project.dirname] = true;
    }
  });
  return approvedMergeParents;
}

function _getCommits(project, source, branch) {
  let entries;
  try {
    entries = project.repo.getChangelogFirstParent('%h|%p|%s', _scopedSource(source), sprintf('origin/%s', branch));
  } catch (ex) {
    if (ex instanceof ExecError && ex.stderr.indexOf('unknown revision or path not in the working tree') > 0) {
      // rare case where new project is added
      entries = project.repo.getChangelogFirstParent('%h|%p|%s', undefined, sprintf('origin/%s', branch));
    } else {
      throw ex;
    }
  }
  let commits = [];
  entries.forEach(function (entry) {
    let fields = entry.split('|', 3);
    let commit = {
      id: fields[0],
      message: fields[2]
    };
    let parents = fields[1].split(' ');
    if (parents.length > 1) {
      commit.parent = parents[1];
    }
    commits.push(commit);
  });
  return commits;
}

function _hasReviewBranches(branches, reviewSourceBranch, reviewTargetBranch) {
  return _.contains(branches, reviewSourceBranch) && _.contains(branches, reviewTargetBranch);
}

function _informCommits(project, metadata, status, reviewSourceBranch, reviewTargetBranch, invocation) {
  let commits = {
    changeset: [],
    changesetApproved: [],
    changesetNotApproved: [],
    reviewSource: [],
    reviewSourceIgnored: [],
    reviewSourceNotIgnored: [],
    reviewTarget: []
  };

  status.approvedTo = metadata.approvedTo || metadata.source;
  status.approvedMergeParents = metadata.approvedMergeParents || [];
  status.branches = project.repo.findBranchesMatchingPattern(
    sprintf('%s*/%s', config.review_branch_prefix, config.changesetId.trackingId));
  status.hasBranches = _hasReviewBranches(status.branches, reviewSourceBranch, reviewTargetBranch);

  commits.changeset = status.commitGraph.getCommits();
  commits.changesetApproved = status.commitGraph.getApprovedCommits();
  commits.changesetNotApproved = status.commitGraph.getUnapprovedCommits();

  if (status.hasBranches) {
    commits.reviewSource = _getCommits(project, status.approvedTo, reviewSourceBranch);
    commits.reviewTarget = _getCommits(project, status.approvedTo, reviewTargetBranch);
  }

  if (commits.reviewSource.length) {
    commits.reviewSource.forEach(function (commit) {
      if (commit.message.startsWith(invocation.getIgnoredCommitPrefix())) {
        commits.reviewSourceIgnored.push(commit);
      } else {
        commits.reviewSourceNotIgnored.push(commit);
      }
    });
  }

  return commits;
}

function _mergePom(ourPom, theirPom, options) {
  options = _.extend({
    writeToLog: true
  }, options);
  mergePom.mergeVersion(ourPom, undefined, theirPom, options);
  mergePom.mergeParent(ourPom, undefined, theirPom, options);
  mergePom.mergeDependencies(ourPom, undefined, theirPom, options);
  theirPom.setVersion(ourPom.getVersion());
  theirPom.saveAll();
}

function _mergeToReviewSource(repo, mergeCommitId, invocation) {
  let message = invocation.getIgnoredCommitMessage(sprintf("negating %s", mergeCommitId));
  repo.git('merge', '--strategy=ours', '--allow-unrelated-histories', '-m', message, mergeCommitId);
}

function _prepareMissingMergeCommits(status, metadata, repo) {
  if (!status || !status.missingMergeCommits) {
    return;
  }

  let commits = [];
  _.each(status.missingMergeCommits, id => {
    let stdout = repo.gitCapture('log', id, '-1', '--no-decorate', '--pretty=format:%h|%p|%cn|%cr|%s',
      '--abbrev=' + config.gitCommitHashSize);
    let entries = util.textToLines(stdout);
    _.each(entries, entry => {
      let fields = entry.split('|', 5);
      commits.push({
        id: fields[0],
        parents: fields[1].split(' '),
        committer: fields[2],
        when: fields[3],
        message: fields[4]
      });
    });
  });
  return commits;
}

function _processCommits(status, commits, lookups) {
  status.changesetCommits = commits.changesetNotApproved.slice();
  status.targetMergeIds = [];
  status.mergedCount = 0;
  status.notInReview = 0;
  status.missingMergeCommits = [];

  _.each(commits.changesetNotApproved, function (commit, index) {
    // | changeset | review/source | review/target |
    // | 365<-789  |   c6d<-adb*   |   adb<-789    |
    // from 365, identify adb for merge to review/source if c6d doesn't exist
    if (commit.parent && !lookups.sets.reviewSourceParent[commit.parent] &&
      lookups.sets.reviewTargetParent[commit.parent]) {
      let targetMergeId = lookups.maps.changesetParentToReviewTarget[commit.parent];
      if (targetMergeId && !lookups.sets.reviewSourceParent[targetMergeId]) {
        status.targetMergeIds.push(targetMergeId);
      }
    }

    // | changeset | review/source | review/target |
    // | 9c9       |   8e1<-9c9    |   123<-8e1    |
    // from 9c9, identify 123 is the approval merge (9c9->8e1->123)
    let sourceMergeId = lookups.maps.changesetToReviewSource[commit.id];
    if (lookups.sets.reviewTargetParent[commit.id] ||
      (sourceMergeId && lookups.sets.reviewTargetParent[sourceMergeId])) {
      status.approvedTo = commit.id;
      status.mergedCount = index + 1;
      return;
    }

    // | changeset | review/source | review/target |
    // | 365<-789  |               |   adb<-789    |
    // | 9c9       |   8e1<-9c9    |               |
    // |           |   c6d<-adb*   |   55d<-c6d    |
    // from 9c9, identify 55d is the approval merge (9c9->8e1=>c6d->55d)
    let ignoredReviewSourceIds = lookups.maps.changesetToReviewSourceIgnored[commit.id];
    if (ignoredReviewSourceIds) {
      _.find(ignoredReviewSourceIds, function (id) {
        if (lookups.sets.reviewTargetParent[id]) {
          status.approvedTo = commit.id;
          status.mergedCount = index + 1;
          return true;
        }
      });
    }

    if (lookups.sets.reviewSource[commit.id] || lookups.sets.reviewSourceParent[commit.id]) {
      status.notInReview = 0;
    } else {
      status.notInReview++;
    }
  });

  if (status.mergedCount) {
    status.changesetCommits = status.changesetCommits.slice(status.mergedCount);
  }

  // | changeset | review/source | review/target |
  // | 365<-789  |   c6d<-adb*   |   adb<-789    |
  // identify if 365 was never committed based on adb<-789 existing in review/target
  _.each(Object.keys(lookups.sets.reviewTargetParent), function (id) {
    // the last condition is a meager attempt at handling circular merge loops
    if (!lookups.sets.reviewSource[id] && !lookups.sets.changesetParent[id] && !lookups.sets.changeset[id]) {
      status.missingMergeCommits.push(lookups.maps.reviewTargetParentToReviewTarget[id]);
    }
  });
}

function _promptToContinue(message, color) {
  util.println(message[color]);
  let carryOn = util.prompt('Type "yes" if you wish to proceed: '[color]);
  if (!carryOn || carryOn.toLowerCase() !== 'yes') {
    throw new CancelledError();
  }
}

function _pseudoSet(array, field) {
  let pseudoSet = {};
  _.each(_.pluck(array, field), function (id) {
    pseudoSet[id] = true;
  });
  return pseudoSet;
}

function _resynchronizeReviewStatus(bundle, defaultSource, reviewStatus, projectNamesToExclude) {
  reviewStatus = reviewStatus || {};
  _.each(Object.keys(reviewStatus), function (key) {
    delete reviewStatus[key];
  });

  let metadataMap = bundle.initProjectMetadataMap(defaultSource);
  let yamlModified = false;

  util.announce('Synchronizing review status'.plain);

  let projects = _.filter(bundle.getAllIncludedProjects(),
    project => !_.contains(projectNamesToExclude, project.dirname));
  const inputs = _.map(projects, project => {
    return {
      project: project,
      metadata: metadataMap[project.dirname],
      changesetBranch: bundle.getChangesetBranchName(),
      reviewSourceBranch: bundle.getReviewSourceBranchName(),
      reviewSourceRemoteBranch: bundle.getReviewSourceBranchName(true),
      reviewTargetBranch: bundle.getReviewTargetBranchName(),
      reviewTargetRemoteBranch: bundle.getReviewTargetBranchName(true)
    };
  });

  /** Fork to {@link resynchronizeReviewStatusForked} */
  const result = ForkedProjectOp.run('resynchronize-review-status.js', inputs);
  if (!result.success) {
    throw new BuildError(sprintf('Unable to synchronize review status for %d project%s', result.failureCount,
      util.plural(result.failureCount)));
  }

  const missingMergeCommits = {};
  _.each(Object.keys(result.outputs), dirname => {
    const output = result.outputs[dirname];
    if (output.yamlModified) yamlModified = true;
    bundle.changeset.setProjectMetadata(dirname, output.metadata);
    if (output.status) {
      output.status.commitGraph = CommitGraph.fromJsonObject(output.status.commitGraph);
      reviewStatus[dirname] = output.status;
    }
    if (output.missingMergeCommits && output.missingMergeCommits.length > 0) {
      missingMergeCommits[dirname] = {
        commits: output.missingMergeCommits,
        metadata: output.metadata
      };
    }
  });
  _displayAllMissingMergeCommits(missingMergeCommits);
  if (yamlModified) {
    bundle.changeset.save();
    rflowUtil.updateSourceControl(bundle, {
      silent: true,
      skipProjects: true,
      message: bundle.invocation.getCommitMessage('(sync)')});
  }
  return reviewStatus;
}

function _scopedSource(source) {
  return source === Projects.Status.PENDING ? sprintf('origin/%s', source) : source;
}

function _synchronizeWithoutReviewBranches(project, metadata, commits, invocation) {
  let systemCommits = 0;

  _.each(commits.changesetNotApproved, function (commit, index) {
    if (systemCommits === index && commit.message.startsWith(invocation.getCommitPrefix()) && !commit.parent) {
      metadata.approvedTo = commit.id;
      metadata.modified = true;
      systemCommits++;
    }
  });

  if (systemCommits) {
    ForkedProjectOp.sendInterim(project.dirname,
      sprintf('%d system commit%s bypassed'.good, systemCommits, util.plural(systemCommits)));
    ForkedProjectOp.sendInterim(project.dirname, 'Synced'.useful);
  } else {
    ForkedProjectOp.sendInterim(project.dirname, 'No system commits'.trivial);
    ForkedProjectOp.sendInterim(project.dirname, 'Skipped'.trivial);
  }
}

module.exports = {
  createPullRequestForked: createPullRequestForked,
  createPullRequests: createPullRequests,
  createReviewBranchesAsNeeded: createReviewBranchesAsNeeded,
  createReviewBranchesForked: createReviewBranchesForked,
  displayCommits: displayCommits,
  ensureProjectIsReviewedForked: ensureProjectIsReviewedForked,
  ensureProjectsAreNotRetired: ensureProjectsAreNotRetired,
  ensureProjectsAreReviewed: ensureProjectsAreReviewed,
  getApprovedMergeParentsAndConfirmUnapprovedIsOk: getApprovedMergeParentsAndConfirmUnapprovedIsOk,
  getCommitGraph: getCommitGraph,
  identifyOrphanedCommits: identifyOrphanedCommits,
  identifyTrunkMarkerUpdates: identifyTrunkMarkerUpdates,
  initializeReviewBundle: initializeReviewBundle,
  mergeToReviewTarget: mergeToReviewTarget,
  synchronizeReviewStatus: synchronizeReviewStatus,
  removeReviewBranchesForked: removeReviewBranchesForked,
  removeUnneededReviewBranches: removeUnneededReviewBranches,
  removeUnneededReviewBranchesForked: removeUnneededReviewBranchesForked,
  resynchronizeReviewStatusForked: resynchronizeReviewStatusForked
};
