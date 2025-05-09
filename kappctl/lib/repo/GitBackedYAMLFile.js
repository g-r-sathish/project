const _ = require('lodash');
const assert = require('assert').strict;
const Path = require("path");
const tk = require('../util/tk');
const {YAMLFile} = require('./YAMLFile.js');
const packageJson = require('../../package.json');
const {GitRepo, findGitRepoDirOf} = require("./GitRepo");
const {log} = require("../util/ConsoleLogger");

class GitBackedYAMLFile extends YAMLFile {

  static async newFile(repo, repoPath, data) {
    const path = Path.join(repo.baseDir, repoPath);
    const file = new GitBackedYAMLFile(path, {repoDir: repo.baseDir});

    if (data) {
      file.data = data;
    }
    file.save();

    await repo.add(file.repoPath);
    await file.checkIn(`Added ${repoPath}`);
    return file;
  }

  constructor(path, {required=false, flatten=false, dryRun=false, repoDir=undefined}={}) {
    super(path, arguments[1]);
    if (!repoDir) {
      repoDir = findGitRepoDirOf(path);
    }
    this.repo = new GitRepo({baseDir: repoDir});
    this.repoPath = this.repo.repoPathOf(path);
    this.isIgnored = undefined;
    this.branch = undefined;
  }

  /**
   * Current repository branch
   * @returns {Promise<SimpleGit & Promise<string>>}
   */
  async getWorkingBranch() {
    return this.repo.revparse(['--abbrev-ref', 'HEAD']);
  }

  async checkOut(branch) {
    let workingBranch = await this.getWorkingBranch();
    if (!tk.areEqualValidStrings(branch, workingBranch)) {
      let status = await this.repo.status(['--short']);
      if (!status.isClean()) {
        throw new Error('Refusing to change branches with a dirty repository');
      }
      await this.repo.switch(branch);
      status = await this.repo.status(['--short']);
      if (status.behind > 0) {
        await this.repo.pull();
      }
      this.reload();
    }
    this.branch = branch;
    await this.checkIgnore();
  }

  /**
   * Commit _saved_ changes.
   * @param message Commit message
   */
  async commit(message) {
    assert.ok(message);
    if (this.branch !== undefined) {
      let workingBranch = await this.getWorkingBranch();
      const hint = `Refusing to commit to branch *${workingBranch}* as this file was loaded from *${this.branch}* (${this.path})`;
      tk.ensureEqualValidStrings(this.branch, workingBranch, hint);
    }
    if (this.isIgnored === undefined) {
      await this.checkIgnore();
    }
    if (!this.options.dryRun && !this.isIgnored) {
      return this.repo.commit(`[${packageJson.name}] ${message}`, this.repoPath);
    }
  }

  async checkIgnore() {
    this.isIgnored = false;
    try {
      const ignoredList = await this.repo.checkIgnore([this.repoPath]);
      this.isIgnored = ignoredList.includes(this.repoPath);
    } catch (e) {
      log.debug(e.message);
    }
  }

  /**
   * Commit and push _saved_ changes.
   * @param {String} message Commit message
   * @param {Boolean} notifyUser? When true write pushed-message to console
   */
  async checkIn(message, notifyUser=false) {
    let commitResult = await this.commit(message);
    if (!this.options.dryRun && !this.isIgnored) {
      let status = await this.repo.status(['--short']);
      if (status.ahead > 0) {
        let pushResult = await this.repo.pullPush();
        let branch = _.get(commitResult, 'branch') || await this.repo.getCurrentBranchName();
        let from = _.get(pushResult, 'update.hash.from');
        let to = _.get(pushResult, 'update.hash.to');
        let repo = _.get(pushResult, 'repo');
        const repoName = Path.isAbsolute(repo) ? Path.basename(repo) : repo;
        const logMessage = `Pushed ${from}..${to} -> ${repoName} at *${branch}*: ${message}`;
        if (notifyUser) {
          log.user(logMessage);
        } else {
          log.verbose(logMessage);
        }
        return {commitResult, pushResult};
      }
      return {commitResult};
    }
    return {};
  }
}

module.exports.GitBackedYAMLFile = GitBackedYAMLFile;