//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const packageJson = require('../../package.json');
const assert = require('assert').strict;
const Path = require("path");
const {log} = require("../util/ConsoleLogger");
const {EnvironmentFile} = require("../repo/EnvironmentFile");
const {EnsuringError} = require("../util/tk");
const {LogicalError} = require("../util/LogicalError");
const {YAMLFile} = require("../repo/YAMLFile");

class ConfigRepoBranch {
  /**
   * @param {Application} app
   */
  constructor(app) {
    this._app = app;
    this._subsetVersion = app.getSubsetVersion();
    this._subsetConfig = app.getSubsetConfig();
    this._env = app.env;
    this._repo = app.saasContext.configRepo;
    this._managed = app.usesManagedConfigRepoBranches();
  }

  get subsetVersion() {
    return this._subsetVersion;
  }

  get _branchName() {
    return this._app.getConfigRepoBranch();
  }

  get _sourceBranchName() {
    return this._subsetConfig[EnvironmentFile.SUBSET_CONFIG_SOURCE];
  }

  get _upstreamBranchName() {
    return this._env.get(EnvironmentFile.UPSTREAM_CONFIG_BRANCH, 'master');
  }

  /**
   * Should we write to this branch.
   * @return {boolean}
   * @private
   */
  get _isWritable() {
    const branchName = this._branchName;
    return branchName !== this._upstreamBranchName && branchName !== this._upstreamBranchName;
  }

  async establish() {
    if (this._managed) {
      return this._establishBranch(this._branchName, this._upstreamBranchName);
    } else {
      return this._ensureBranchExists(this._branchName);
    }
  }

  async switchTo() {
    const workingBranch = await this._repo.getCurrentBranchName();
    if (workingBranch !== this._branchName) {
      return this._repo.switch(this._branchName);
    }
  }

  async _establishBranch(branchName, upstreamBranchName) {
    if (!await this._repo.doesRemoteBranchExist(branchName)) {
      if (await this._repo.doesLocalBranchExist(branchName)) {
        log.info('[%s] Branch exists locally but not upstream, deleting', branchName);
        await this._repo.deleteLocalBranch(branchName);
      }

      log.user(`Branching config-repo from *${upstreamBranchName}* to *${branchName}*`);
      await this._ensureBranchExists(upstreamBranchName);
      await this._repo.switch(upstreamBranchName);
      await this._repo.checkoutBranch(branchName, upstreamBranchName);
      await this._repo.pushNewBranch();
      await this._app.saveConfigRepoBranch(branchName);
    }
  }

  async rebuild() {
    if (!this._managed) {
      throw new LogicalError('Branch management is not enabled for this environment');
    }
    const targetBranch = this._branchName;
    if (await this._repo.doesLocalBranchExist(targetBranch)) {
      log.info('[%s] Branch exists locally, deleting', targetBranch);
      await this._repo.deleteLocalBranch(targetBranch);
    }

    if (await this._repo.doesRemoteBranchExist(targetBranch)) {
      log.info('[%s] Branch exists upstream, deleting', targetBranch);
      await this._repo.push(['origin', '--delete', targetBranch]);
    }

    return this.establish();
  }

  async writeImageTags(serviceImageTags) {
    const branchName = this._app.getConfigRepoBranch();
    const envName = this._app.getEnvironmentName();
    const saasContext = this._app.saasContext;

    await this._repo.switch(branchName);

    let updated = [];

    try {
      log.group(`Ensuring image tags for *${envName}* on branch *${branchName}*`);
      for (const [serviceName, imageTag] of Object.entries(serviceImageTags)) {
        const repoPath = Path.join(envName, `${serviceName}.yml`);
        const path = Path.join(this._repo.baseDir, repoPath);
        const configFile = new YAMLFile(path);
        const currentTag = configFile.get("deployment.image.tag");
        let hasChanges = false;

        if (!configFile.exists()) {
          log.user(`⚠️ [${serviceName}.yml]: ${imageTag} (*new file*)`);
          configFile.set("deployment.image.tag", imageTag);
          configFile.set("deployment.version", "prod");
          hasChanges = true;
        } else if (currentTag !== imageTag) {
          log.user(`⚠️ [${serviceName}.yml]: ${currentTag} -> ${imageTag} (*updated*)`);
          configFile.set("deployment.image.tag", imageTag);
          hasChanges = true;
        } else {
          log.user(`~ ✅ [${serviceName}.yml]: ${imageTag} (no change)`);
        }

        if (hasChanges && !saasContext.dryRun) {
          updated.push(repoPath);
          configFile.save();
          await this._repo.add(repoPath);
        }
      }
    } finally {
      log.groupEnd();
    }

    if (!saasContext.dryRun && updated.length > 0) {
      log.user(`Committing ${updated.length} changes to *${branchName}*`);
      const message = `Update image tags for ${updated.length} services`;
      let commitResult = await this._repo.commit(`[${packageJson.name}] ${message}`);
      let status = await this._repo.status(['--short']);
      if (status.ahead > 0) {
        const pushResult = await this._repo.pullPush();
        const branch = _.get(commitResult, 'branch') || await this._repo.getCurrentBranchName();
        const from = _.get(pushResult, 'update.hash.from');
        const to = _.get(pushResult, 'update.hash.to');
        const repo = _.get(pushResult, 'repo');
        const repoName = Path.isAbsolute(repo) ? Path.basename(repo) : repo;
        const logMessage = `Pushed ${from}..${to} -> ${repoName} at *${branch}*: ${message}`;
        log.user(logMessage);
      } else {
        await this._repo.stash(['save', '-u', 'aborting due to error']);
        throw new LogicalError(`Expected ${updated.length} changes to commit`);
      }
    }
  }

  async writeSubsetConfig() {
    if (!this._isWritable) {
      log.verbose('[%s] Runtime branch is not writable', this._branchName);
      return;
    }

    const applicationFile = await this._app.getApplicationFile();
    const prodSubset = this._env.get('pools.prod', 'v1');

    applicationFile.set('deployment.version', this._subsetVersion);
    applicationFile.set('testPool', this._subsetVersion !== prodSubset);

    if (this._env.get(EnvironmentFile.NODE_POOLS_ENABLED)) {
      applicationFile.set('deployment.k8s.pod.nodePool', '${rollout.node_pool}');
    } else {
      applicationFile.unset('deployment.k8s.pod.nodePool');
    }

    applicationFile.save();
    return applicationFile.checkIn('Runtime branch settings', true);
  }

  /**
   * @param branchName
   * @return {Promise<void>}
   */
  async _ensureBranchExists(branchName) {
    if (!await this._repo.doesRemoteBranchExist(branchName)) {
      throw new EnsuringError(`Branch does not exist: ${branchName}`);
    }
  }

  async dovetail(sourceRef) {
    if (!sourceRef) {
      if (this._upstreamBranchName) {
        if (this._branchName === 'master') {
          return this._app.saveConfigRepoBranch(this._upstreamBranchName);
        } else {
          return this._mergeFromTo(this._upstreamBranchName, this._branchName);
        }
      }
    }
    if (!this._app.usesManagedConfigRepoBranches()) {
      await this._app.saveConfigRepoBranch(sourceRef);
      return;
    }
    if (sourceRef === this._branchName) {
      log.warn("Redundant merge: sourceRef is also the working branch");
      return;
    }
    if (sourceRef === this._upstreamBranchName) {
      await this._mergeFromTo(sourceRef, this._branchName);
    } else if (this._upstreamBranchName === 'master') {
      await this._mergeFromTo(sourceRef, this._branchName);
    } else {
      await this._mergeFromTo(sourceRef, this._upstreamBranchName);
      await this._mergeFromTo(this._upstreamBranchName, this._branchName);
    }
    await this._app.saveConfigRepoBranchSource(sourceRef);
    await this._app.saveConfigRepoBranch(this._branchName);
  }

  async _isBehind(sourceRef, targetRef) {
    const sourceCommit = await this._repo.getCommitIdFor(sourceRef);
    const targetCommit = await this._repo.getCommitIdFor(targetRef);

    assert.ok(sourceCommit, `No commit hash for: ${sourceCommit}`);
    assert.ok(targetRef, `No commit hash for: ${targetRef}`);

    if (targetCommit === sourceCommit) {
      return false;
    }

    const summary = await this._repo.compareBranchCommits(targetRef, sourceRef);
    return summary.behind > 0;
  }

  async _mergeFromTo(sourceRef, targetBranch) {
    if (targetBranch === sourceRef) {
      log.verbose('Not merging, source and target are the same');
      return;
    }
    if (targetBranch === 'master') {
      log.verbose('Refusing to merge into *master*');
      return;
    }

    if (await this._isBehind(sourceRef, targetBranch)) {
      log.info('Target branch *%s* is behind *%s*', targetBranch, sourceRef);
    } else {
      log.info('Target branch *%s* is up-to-date with *%s*', targetBranch, sourceRef);
      return;
    }

    let mergeResponse;
    await this._repo.switch(sourceRef);
    await this._repo.switch(targetBranch);

    try {
      //
      // '-X', 'theirs'
      //
      //    This is how it was, but vulnerable to when environment changes aren't merged into master.
      //    Even if they are merged in to master, the sourceRef may be at a point in time before that
      //    merged happened.
      //
      // '-X', 'ours'
      //
      //    This is how it probably should be, however could make a bad choice if one really wants to
      //    overwrite manual changes made to the runtime/upstream branch.
      //
      // Nothing (current choice)
      //
      //    Means this will fail to merge and manual intervention will be required. The downside is
      //    folk will probably glaze over the details and just think the "deploy is broken".
      //
      mergeResponse = await this._repo.merge([sourceRef, targetBranch, '--ff', '--no-edit']);
    } catch (e) {
      try {
        await this._repo.merge(['--abort']);
      } catch (e2) {
        log.debug(e2.message)
      }
      throw e;
    }

    if (mergeResponse.failed) {
      throw new Error(`Failed to merge ${sourceRef} into *${targetBranch}*`);
    } else {
      log.info(`Merged ${sourceRef} -> *${targetBranch}*`);
      await this._repo.push();
    }
  }
}

module.exports.ConfigRepoBranch = ConfigRepoBranch;
