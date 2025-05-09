const _ = require('underscore');
const fs = require('fs');
const path = require('path');

const azureDevOps = require('../common/azure-devops').azureDevOpsService;
const githubService = require('../common/github').githubService;
const BuildError = require('./BuildError')
const config = require('../common/config');
const ExecError = require('./ExecError');
const {Projects} = require('./Constants');
const sprintf = require('sprintf-js').sprintf;
const stash = require('../common/stash').stashService;
const util = require('../common/util');

class GitRepository {
  static Host = {
    AGILYSYS: 'agilysys',
    AZURE: 'azure',
    GITHUB: 'github'
  }

  /**
   * @param {string} definition.repo_host
   * @param {string} [definition.repo_id]
   * @param {string} definition.repo_path
   * @param {string} [definition.clone_path]
   * @param {string} definition.mainline
   * @param {string} [options.workDir]
   * @param {boolean} [options.shallowClone]
   */
  static create(definition, options) {
    const repo = new GitRepository();
    repo.options = _.extend({
      workDir: config.workDir,
      shallowClone: false
    }, options);
    if (!definition) {
      throw new BuildError('No repository definition provided');
    }
    if (!definition.mainline) {
      throw new BuildError('No mainline defined for repository');
    }

    repo.repoHost = definition.repo_host || GitRepository.Host.AGILYSYS;
    const hostConfig = config.repo_hosts[repo.repoHost];

    repo.repoId = definition.repo_id;
    repo.repoPath = definition.repo_path;
    repo.repoBase = hostConfig.gitBaseUrlSpec;
    repo.clonePath = definition.clone_path || repo.repoPath;
    repo.dirname = path.basename(repo.repoPath);
    repo.mainline = definition.mainline;
    repo.setUpstream = false;
    repo.defaultBranch = undefined;
    repo.branchName = undefined;

    const parts = repo.repoPath.split('/');
    repo.browseUrlSpec = sprintf(hostConfig.gitBrowseUrlSpec, parts[0], parts[1], '%s');
    repo.pullRequestUrlSpec = sprintf(hostConfig.pullRequestUrlSpec, parts[0], parts[1], '%s');

    process.env.GIT_SSH_COMMAND = 'ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no';

    return repo;
  }

  static fromJsonObject(object) {
    const repo = new GitRepository();
    _.extend(repo, object);
    return repo;
  }

  /**
   * @param {string} params.fromBranch
   * @param {string} params.toBranch
   */
  abandonPullRequest(params) {
    switch (this.repoHost) {
      case GitRepository.Host.AGILYSYS:
        // nothing to do, PR will auto-decline
        return;
      case GitRepository.Host.AZURE:
        params = _.extend({
          repoPath: this.repoPath,
        }, params);
        return azureDevOps.abandonPullRequest(params);
    }
  }

  abortMergeInProgress() {
    if (this.isMergeInProgress()) {
      this.git('merge', '--abort');
      return true;
    }
    return false;
  }

  add(filePaths) {
    util.exec('git', ['add'].concat(util.asArray(filePaths)), this.getRepoDir());
  }

  addCommitPush(filePath, message) {
    this.git('add', filePath);
    this.git('commit', '--message', message);
    this.git('push');
  }

  addAndCommit(message, options) {
    options = _.extend({
      force: false
    }, options);
    this.git('add', '--all');
    if (options.force || this.hasTrackedChanges() || this.isMergeInProgress()) {
      this.git('commit', '--all', '--message', message);
    }
  }

  changeBranch(branch) {
    this.checkout(branch, {pull: false});
  }

  /**
   * @param {string} [params.message]
   * @param {boolean} [params.tags]
   * @param {boolean} [params.retryWithPull]
   * @return {boolean} indicates if an add/commit/push was done
   */
  checkIn(params) {
    if (!config._all.commit) {
      return false;
    }
    params = _.extend({
      message: '',
      tags: false,
      retryWithPull: true
    }, params);
    this.git('add', '--all');
    if (this.hasTrackedChanges() || this.isMergeInProgress()) {
      this.git('commit', '--all', '--message', params.message);
    }
    let acted = false;
    if (this.getCurrentBranch() && this.hasLocalCommits()) {
      if (this.setUpstream) {
        this.gitOrSkip('push', '--set-upstream', 'origin', this.branchName);
      } else {
        this._executeWithOptionToRetryWithPull(function (params) {
          if (this.branchName) {
            this.gitOrSkip('push', 'origin', this.branchName);
          } else {
            this.gitOrSkip('push');
          }
        }, params);
      }
      acted = true;
    }
    if (params.tags) {
      this._executeWithOptionToRetryWithPull(function (params) {
        if (this.branchName) {
          this.gitOrSkip('push', '--tags', '--force', 'origin', this.branchName);
        } else {
          this.gitOrSkip('push', '--tags', '--force');
        }
      }, params);
      acted = true;
    }
    if (!acted) {
      util.narrateln('No local commits (nothing to push)');
    }
    return acted;
  }

  checkout(branch, options) {
    options = _.extend({pull: true}, options);
    if (this.getCurrentBranch() !== branch) {
      this.git('checkout', branch);
    }
    this.branchName = branch;
    if (options.pull) {
      try {
        this.pull();
        this.setUpstream = false;
      } catch (ex) {
        this.setUpstream = true;
      }
    }
    return this;
  }

  checkoutDetached(tagOrCommitId) {
    this.git('-c', 'advice.detachedHead=false', 'checkout', tagOrCommitId);
    this.setUpstream = false;
    this.branchName = undefined;
    return this;
  }

  checkoutPrevious() {
    this.git('-c', 'advice.detachedHead=false', 'checkout', '-');
    this.getCurrentBranch();
  }

  confirmHeadIsAtTag(tag) {
    let tagCommit = this.gitCapture('rev-parse', '--verify', sprintf('refs/tags/%s^{commit}', tag));
    let headCommit = this.gitCapture('rev-parse', '--verify', 'HEAD');
    if (tagCommit !== headCommit) {
      throw new BuildError(sprintf('HEAD commit %s is not the same as tag %s commit %s', headCommit, tag, tagCommit));
    }
  }

  createBranch(branch, setUpstreamImmediately) {
    let created = false;
    if (this.doesBranchExist(branch)) {
      this.setUpstream = !this.doesBranchExistRemotely(branch);
      if (this.setUpstream) {
        this._setUpstream(setUpstreamImmediately);
      }
      this.branchName = branch;
      this.git('checkout', branch);
      return;
    }
    this.git('checkout', '-b', branch);
    created = true;
    this.branchName = branch;
    this._setUpstream(setUpstreamImmediately);
    return created;
  }

  createPendingMarkerCommit(branchName) {
    let currentBranch = this.getCurrentBranch();
    this.git('checkout', '--orphan', branchName);
    this.git('reset', '--hard');
    this.git('commit', '--allow-empty', '--message', 'marker commit');
    this.git('push', '--set-upstream', 'origin', branchName);
    this.changeBranch(currentBranch);
  }

  /**
   * @param {string} [params.username]
   * @param {string} [params.password]
   * @param {string} params.title
   * @param {string} params.description
   * @param {string} params.fromBranch
   * @param {string} params.toBranch
   * @param {UserData[]} params.reviewers
   */
  createPullRequest(params) {
    switch (this.repoHost) {
      case GitRepository.Host.AGILYSYS:
        params = _.extend({
          repoPath: this.repoPath
        }, params);
        return stash.createPullRequest(params);
      case GitRepository.Host.AZURE:
        params = _.extend({
          repoPath: this.repoPath,
          pullRequestUrlSpec: this.pullRequestUrlSpec,
        }, params);
        return azureDevOps.createPullRequest(params);
      case GitRepository.Host.GITHUB:
        params = _.extend({
          repoPath: this.repoPath,
          pullRequestUrlSpec: this.pullRequestUrlSpec,
        }, params);
        return githubService.createPullRequest(params);
    }
  }

  deleteLocalAndRemoteBranch(branchName, options) {
    options = _.extend({
      localOnly: false
    }, options);
    this.gitOkToFail('branch', '--delete', '--force', branchName);
    !options.localOnly && this.gitOrSkipOkToFail('push', 'origin', '--delete', branchName);
  }

  deleteCommitPush(filePath, message) {
    this.git('rm', filePath);
    this.git('commit', '--message', message);
    this.git('push');
  }

  disablePomMergeDriver() {
    fs.writeFileSync(this.getGitAttributesPath(), 'pom.xml -merge', 'utf-8');
  }

  doesBranchContainCommitId(branchName, commitId) {
    if (!this.isTracking(branchName)) {
      throw new BuildError(sprintf('Branch is not being tracked: %s', branchName));
    }
    let stdout = this.gitCapture('branch', '--contains', commitId);
    let found = _.find(util.textToLines(stdout), function (line) {
      return line.endsWith(branchName);
    });
    return !!found;
  }

  doesBranchExist(branchName) {
    return !!this.gitCaptureOkToFail('rev-parse', '--quiet', '--verify', sprintf('origin/%s', branchName));
  }

  doesBranchExistRemotely(branchName) {
    let remoteUrl = this.getRemoteOriginUrl();
    return !!this.gitCaptureOkToFail('ls-remote', '--heads', remoteUrl, branchName);
  }

  doesCommitExist(commitId) {
    let result = this.gitCaptureOkToFail('cat-file', '-t', commitId);
    return result === 'commit';
  }

  doesRemoteBranchContainCommitId(branchName, commitId) {
    let stdout = this.gitCapture('branch', '--remote', '--contains', commitId);
    let found = _.find(util.textToLines(stdout), function (line) {
      return line.endsWith('origin/' + branchName);
    });
    return !!found;
  }

  doesTagContainCommitId(tagName, commitId) {
    let stdout = this.gitCapture('tag', '--contains', commitId);
    let found = _.find(util.textToLines(stdout), function (line) {
      return line === tagName;
    });
    return !!found;
  }

  doesTagExist(tag) {
    return !!this.gitCaptureOkToFail('rev-parse', '--quiet', '--verify', sprintf('refs/tags/%s', tag));
  }

  enablePomMergeDriver() {
    if (fs.existsSync(this.getGitAttributesPath())) {
      fs.unlinkSync(this.getGitAttributesPath());
    }
  }

  // Ensure that a NOT-RFLOW-INTERNAL repository is in good standing
  /**
   *
   * @param options
   */
  ensureRepository(options) {
    options = _.extend({
      forceCheckout: false
    }, options);
    let repoDir = this.getRepoDir();
    let doClone = true;
    if (util.directoryExists(repoDir)) {
      doClone = false;
      if (!util.directoryExists(sprintf('%s/.git', repoDir))) {
        if (!options.forceCheckout) {
          throw new BuildError(sprintf('Directory %s exists but does not appear to be a Git repository', repoDir));
        } else {
          doClone = true;
        }
      }
      if (!doClone) {
        let repoUrl = this.getRepoUrl();
        let remoteUrl = this.getRemoteOriginUrl();
        if (repoUrl === remoteUrl) {
          this.fetch();
          return;
        } else {
          throw new BuildError(sprintf('Directory %s contains repo %s; expected %s', repoDir, remoteUrl, repoUrl));
        }
      }
    }
    if (doClone) {
      util.mkdirs(repoDir);
      this.gitClone(this.getRepoUrl(), repoDir);
      this.readBranchName();
    }
  }

  fetch(branchOrTag) {
    if (branchOrTag) {
      if (config.gitForDevOps) {
        // old version of Git requires separate fetch call for tags
        this.git('fetch', '--prune', 'origin', branchOrTag);
        this.git('fetch', '--tags', '--force');
      } else {
        this.git('fetch', '--tags', '--prune', '--force', 'origin', branchOrTag);
      }
    } else {
      if (config.gitForDevOps) {
        // old version of Git requires separate fetch call for tags
        this.git('fetch', '--prune');
        this.git('fetch', '--tags', '--force');
      } else {
        this.git('fetch', '--tags', '--prune', '--force');
      }
    }
    return this;
  }

  fileExists(filePath) {
    let fullPath = path.join(this.getRepoDir(), filePath);
    return util.fileExists(fullPath);
  }

  findBranchesMatchingPattern(pattern) {
    let stdout = this.gitCapture('branch', '--remotes', '--list', 'origin/'.concat(pattern), '--format',
      '%(refname:lstrip=3)');
    return util.textToLines(stdout);
  }

  getAbsolutePath(subpath) {
    return path.join(this.getRepoDir(), subpath);
  }

  getBrowseUrl(relativePath) {
    return sprintf(this.browseUrlSpec, relativePath);
  }

  getChangelog(prettyFormat, fromRef, toRef, extraArgs) {
    fromRef = fromRef || this.getForkPoint();
    toRef = toRef || 'HEAD';
    let range = fromRef ? `${fromRef}..${toRef}` : toRef;

    let args = ['log', range, '--no-decorate', '--reverse', '--pretty=format:' + prettyFormat,
      '--abbrev=' + config.gitCommitHashSize];

    let stdout = this.gitCapture.apply(this, args.concat(util.asArray(extraArgs)));
    return util.textToLines(stdout);
  }

  getChangelogFirstParent(prettyFormat, fromRef, toRef) {
    return this.getChangelog(prettyFormat, fromRef, toRef, '--first-parent');
  }

  getCommitHistory(relativePath, options) {
    options = _.extendOwn({follow: false}, options);
    let args = ['log', '--no-decorate', '--pretty=%h|%cn|%ce|%cI', '--abbrev=' + config.gitCommitHashSize];
    if (options.follow) {
      // TODO: NOFOLLOW - We don't think there ever is a need for --follow and it can be removed entirely.
      // Just need to remove and test the shipment workflow.
      args.push('--follow')
    }
    if (relativePath) {
      args.push(relativePath);
    }
    let proc = this.gitOkToFail.apply(this, args);
    let commits = [];
    if (proc.status === 0) {
      _.each(util.textToLines(proc.stdout.toString()), function (entry) {
        let info = entry.trim().split(/\|/);
        commits.push({
          id: info[0],
          name: info[1],
          email: info[2],
          date: new Date(info[3])
        })
      });
    }
    return commits;
  }

  getConflictedFiles(regex) {
    let stdout = this.gitCapture('status', '--porcelain');
    let found = _.filter(util.textToLines(stdout),
      function (line) {
        return line.substring(0, 3).trim().length === 2 && line.substring(3).match(regex);
      });
    return _.map(found, function (line) {
      return line.substring(3);
    });
  }

  getCurrentBranch() {
    this.branchName = this.gitCaptureOkToFail('symbolic-ref', '--short', '-q', 'HEAD');
    return this.branchName;
  }

  getEmailAddress() {
    return this.gitCaptureOkToFail('config', '--global', '--get', 'user.email');
  }

  getFileIfExists(path) {
    let proc = this.gitOkToFail('cat-file', '-p', sprintf('HEAD:%s', path));
    if (proc.status === 0) {
      return proc.stdout.toString().trim();
    }
    return undefined;
  }

  getFileByCommitOrTag(relativePath, commitId) {
    return this.gitCapture('show', sprintf('%s:%s', commitId, relativePath));
  }

  getFileStatus() {
    let stdout = this.gitCapture('status', '--porcelain');
    return util.textToLines(stdout);
  }

  /**
   * If --fork-point proves inadequate, we'll have to replicate this tortuous command:
   * '!zsh -c '\''diff -u <(git rev-list --first-parent "${1:-master}") <(git rev-list --first-parent "${2:-HEAD}") | sed
   * -ne "s/^ //p" | head -1'\'' -' http://stackoverflow.com/questions/1527234/finding-a-branch-point-with-git
   */
  getForkPoint(parentBranch) {
    parentBranch = parentBranch || this.mainline;
    if (!util.isPresent(parentBranch)) {
      throw new BuildError('parentBranch needed to determine fork point');
    }
    try {
      return this.gitCapture('merge-base', '--fork-point', parentBranch);
    } catch (ex) {
      if (ex instanceof ExecError && ex.status === 1) {
        return undefined;
      }
      throw ex;
    }
  }

  getGitAttributesPath() {
    return sprintf('%s/.git/info/attributes', this.getRepoDir());
  }

  getHeadCommitId(target) {
    target = _.extend({
      branch: undefined,
      tag: undefined
    }, target);

    if (target.branch) {
      if (this.doesBranchExist(target.branch)) {
        return this.gitCapture('rev-list', '-n', '1', sprintf('origin/%s', target.branch));
      } else {
        return undefined;
      }
    } else if (target.tag) {
      if (this.doesTagExist(target.tag)) {
        return this.gitCapture('rev-list', '-n', '1', sprintf('refs/tags/%s', target.tag));
      } else {
        return undefined;
      }
    } else {
      assert('No target identified, need branch or target');
    }
  }

  getHeadLabel() {
    let branch = this.gitCapture('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch !== 'HEAD') return branch;
    let stdout = this.gitCapture('status');
    let match = util.textToLines(stdout)[0].match(/^HEAD detached at (.*)$/);
    return Projects.GitTarget.TAG_PREFIX + match[1];
  }

  getLatestCommitId(source) {
    return this.gitCapture('log', '--max-count=1', '--pretty=format:%h', '--abbrev=' + config.gitCommitHashSize,
      source);
  }

  getRemoteOriginUrl() {
    return this.gitCapture('config', '--get', 'remote.origin.url');
  }

  getRepoDir() {
    return sprintf('%s/%s', this.options.workDir, this.clonePath);
  }

  getRepoUrl() {
    return sprintf(this.repoBase, this.repoPath);
  }

  getTagsForHead() {
    let stdout = this.gitCapture('show', '--no-patch', '--pretty=%D', 'HEAD');
    let entries = stdout.split(/, /);
    return _.chain(entries).filter(function (entry) {
      return entry.startsWith('tag: ');
    }).map(function (entry) {
      return entry.substring(5);
    }).value();
  }

  git(/* arguments */) {
    util.exec('git', arguments, this.getRepoDir());
  }

  gitClone(/* arguments */) {
    let args = ['clone'];
    if (this.options.shallowClone) {
      args.push('--depth', '1', '--no-single-branch');
    }
    args = args.concat(Array.prototype.slice.call(arguments));
    if (this.options.async) {
    }
    util.exec('git', args, this.getRepoDir());
  }

  gitCapture(/* arguments */) {
    let proc = util.exec('git', arguments, this.getRepoDir());
    return proc.stdout.toString().trim();
  }

  gitCaptureOkToFail(/* arguments */) {
    let proc = util.exec('git', arguments, this.getRepoDir(),
      {okToFail: true, errorByStatus: {129: "Unsupported Git operation"}});
    return proc.stdout.toString().trim();
  }

  gitOkToFail(/* arguments */) {
    return util.exec('git', arguments, this.getRepoDir(),
      {okToFail: true, errorByStatus: {129: "Unsupported Git operation"}});
  }

  gitOrSkip(/* arguments */) {
    if (config._all.commit) {
      if (arguments[0] !== 'commit' || options.workDir === config.workDir) {
        util.exec('git', arguments, this.getRepoDir());
      }
    }
  }

  gitOrSkipOkToFail(/* arguments */) {
    if (config._all.commit) {
      if (arguments[0] !== 'commit' || options.workDir === config.workDir) {
        util.exec('git', arguments, this.getRepoDir(),
          {okToFail: true, errorByStatus: {129: "Unsupported Git operation"}});
      }
    }
  }

  gitQuietlyOkToFail(/* arguments */) {
    return util.exec('git', arguments, this.getRepoDir(),
      {noLogs: true, okToFail: true, errorByStatus: {129: "Unsupported Git operation"}});
  }

  hasCloned() {
    return util.directoryExists(this.getRepoDir()) && util.directoryExists(sprintf('%s/.git', this.getRepoDir()))
      && this.getRepoUrl() === this.getRemoteOriginUrl();
  }

  hasConflictedFile(regex) {
    let stdout = this.gitCapture('status', '--porcelain');
    let found = _.find(util.textToLines(stdout),
      function (line) {
        return line.substring(0, 3).trim().length === 2 && line.substring(3).match(regex);
      });
    return !!found;
  }

  hasDiff(fromRef, toRef) {
    let proc = this.gitQuietlyOkToFail('diff', '--summary', '--name-only', '--exit-code', `${fromRef}..${toRef}`);
    if (proc.status > 1) {
      throw new BuildError('Git error code ' + proc.status + ' not anticipated here');
    }
    return proc.status === 1;
  }

  hasLocalChanges() {
    let stdout = this.gitCapture('status', '--porcelain');
    return stdout && stdout.length > 0;
  }

  hasLocalCommits() {
    if (this.setUpstream) return true;
    try {
      let stdout = this.gitCapture('log', '@{u}..', '--pretty=format:%H %s');
      return !!stdout;
    } catch (ex) {
      if (!config._all.commit) {
        return true;
      }
      throw ex;
    }
  }

  hasTrackedChanges() {
    let stdout = this.gitCapture('status', '--porcelain');
    let found = _.find(util.textToLines(stdout),
      function (line) {
        return !line.startsWith('??') && !line.startsWith(' ');
      });
    return !!found;
  }

  hasUntrackedChanges() {
    let stdout = this.gitCapture('status', '--porcelain');
    let found = _.find(util.textToLines(stdout), function (line) {
      return line.startsWith('??') && line.startsWith(' ');
    });
    return !!found;
  }

  hasCleanStatus(branch) {
    let stdout = this.gitCapture('status', '--short');
    return stdout.length === 0;
  }

  isMergeInProgress() {
    let mergeHeadPath = path.join(this.getRepoDir(), '.git', 'MERGE_HEAD');
    return util.fileExists(mergeHeadPath);
  }

  isTracking(branchName) {
    let stdout = this.gitCapture('branch', '--list');
    let found = _.find(util.textToLines(stdout), function (line) {
      return line.endsWith(branchName);
    });
    return !!found;
  }

  normalizeCommitHash(commitHash) {
    return this.gitCapture('show', '--quiet', '--pretty=format:%h', '--abbrev=' + config.gitCommitHashSize, commitHash);
  }

  pull() {
    if (config.gitForDevOps) {
      // old version of Git requires separate fetch call for tags
      this.git('pull', '--prune');
      this.git('fetch', '--tags', '--force');
    } else {
      this.git('pull', '--tags', '--prune', '--force');
    }
    return this;
  }

  pullMainline() {
    this.pull();
    // temporary (?) measure to handle case of reset HEAD on master
    this.git('checkout', '-B', this.mainline, sprintf('origin/%s', this.mainline));
    return this;
  }

  push(params) {
    this._executeWithOptionToRetryWithPull(() => {
      this.gitOrSkip('push', 'origin', this.branchName);
    }, params);
  }

  pushTagsFromDetached(params) {
    this._executeWithOptionToRetryWithPull(function () {
      this.gitOrSkip('push', '--tags', '--force');
    }, params);
  }

  pushWithTags(params) {
    this._executeWithOptionToRetryWithPull(function () {
      this.gitOrSkip('push', 'origin', this.branchName);
      this.gitOrSkip('push', '--tags', '--force', 'origin', this.branchName);
    }, params);
  }

  readBranchName() {
    this.branchName = util.directoryExists(sprintf('%s/.git', this.getRepoDir()))
      ? this.gitCapture('rev-parse', '--abbrev-ref', 'HEAD')
      : undefined;
  }

  readFile(filePath) {
    return fs.readFileSync(path.join(this.getRepoDir(), filePath), 'utf8');
  }

  resetRepository() {
    // first establish or update the cache
    let cacheRepo = GitRepository.create({repo_path: this.repoPath, repo_host: this.repoHost, clone_path: this.clonePath, mainline: this.mainline},
      {workDir: config.repoCacheDir, shallowClone: this.options.shallowClone});
    let cacheDir = sprintf('%s/%s', config.repoCacheDir, this.clonePath);
    let repoUrl = this.getRepoUrl();
    if (util.directoryExists(cacheDir)) {
      let faulty = false;
      if (util.directoryExists(sprintf('%s/.git', cacheDir)) && repoUrl === cacheRepo.getRemoteOriginUrl()) {
        cacheRepo.pullMainline();
      } else {
        util.narratef('Removing faulty cache: %s\n', cacheDir);
        util.removeDirectory(cacheDir);
      }
    }
    if (!util.directoryExists(cacheDir)) {
      util.mkdirs(cacheDir);
      util.narratef('Cloning project: %s\n', repoUrl);
      cacheRepo.gitClone(repoUrl, cacheDir);
    }

    // replace the existing repo with a copy of the up-to-date cache
    let repoDir = this.getRepoDir();
    if (util.directoryExists(repoDir)) {
      util.removeDirectory(repoDir)
    }
    util.copyFileOrDirectory(cacheDir, repoDir);
    this.readBranchName();
  }

  symlink(target, filePath) {
    let fullPath = path.join(this.getRepoDir(), filePath);
    if (util.fileExists(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    return fs.symlinkSync(target, fullPath);
  }

  tag(tag, message) {
    this.git('tag', '--annotate', '--force', tag, '--message', message);
  }

  track(branchName) {
    if (!this.isTracking(branchName)) {
      let currentBranch = this.branchName;
      this.checkout(branchName);
      this.checkout(currentBranch, {pull: false}); // track does not mean switch
    }
    return this;
  }

  writeFile(filePath, data) {
    let absPath = path.join(this.getRepoDir(), filePath);
    util.mkfiledir(absPath);
    return fs.writeFileSync(absPath, data, 'utf8');
  }

  _executeWithOptionToRetryWithPull(callback, params) {
    try {
      callback.call(this, params);
    } catch (ex) {
      if (params && params.retryWithPull) {
        util.narrateln('Push failed, trying again after pulling');
        this.pull();
        callback.call(this, params);
      } else {
        throw(ex);
      }
    }
  }

  /**
   * @param {boolean} immediately
   * @private
   */
  _setUpstream(immediately) {
    if (immediately) {
      this.gitOrSkip('push', '--set-upstream', 'origin', this.branchName);
      this.setUpstream = false;
    } else {
      this.setUpstream = true;
    }
  }
}

module.exports = GitRepository;
