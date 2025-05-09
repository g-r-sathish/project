//  Copyright (C) Agilysys, Inc. All rights reserved.

const {EOL} = require('os');
const assert = require('assert').strict;
const {simpleGit} = require('simple-git');
const tk = require("../util/tk");
const fs = require("fs");
const Path = require("path");
const {LogicalError} = require("../util/LogicalError");
const {FileNotFoundError} = require("../util/tk");
const {log} = require("../util/ConsoleLogger");

const GIT_DIR = '.git';
const GIT_INDEX_LOCK = `${GIT_DIR}/index.lock`;

class SimpleGitProxy {
  constructor(options) {
    return simpleGit(options);
  }
}

/**
 * @extends SimpleGitProxy
 * Extend simple-git with helper methods.
 * This is an odd constructor as simple-git doesn't actually provide a class to extend, rather it uses
 * a factory which instantiates a Git instance and wires up its plugins.
 */
class GitRepo extends SimpleGitProxy {
  constructor(options) {
    super(options);

    this._branchNames = undefined;
    this.baseDir = Path.resolve(options.baseDir);

    if (fs.existsSync(Path.join(this.baseDir, GIT_INDEX_LOCK))) {
      throw new LogicalError(`Git lock file exists: ${this.baseDir}`);
    }

    this.isClean = async function () {
      let status = await this.status(['--short']);
      return status.isClean();
    };

    /**
     * @param {string} path
     */
    this.repoPathOf = function (path) {
      assert.ok(path);
      const absPath = Path.resolve(path);
      assert(absPath.startsWith(this.baseDir), `Path ${path} is outside of repository root: ${this.baseDir}`);
      const repoPath = absPath.substring(this.baseDir.length);
      return repoPath.replace(/^\//, '');
    }

    this.switch = async function (branchName) {
      await this.checkout(branchName, ['--']);
      return this.mergeTrackedChanges();
    }

    this.safePull = async function () {
      await this.fetch();
      return this.mergeTrackedChanges();
    };

    this.mergeTrackedChanges = async function () {
      const status = await this.status(['--short']);
      if (status.behind > 0) {
        await this.merge([status.tracking]);
      }
      return this.status(['--short']);
    }

    /**
     * @param args Passed to push
     * @return {Promise<*>}
     */
    this.pullPush = async function (...args) {
      await this.pullIfBehind();
      return this.push(...args);
    }

    this.pushNewBranch = async function () {
      const branchName = await this.getCurrentBranchName();
      this._branchNames = undefined; // expire cache
      return this.push(['--set-upstream', 'origin', branchName]);
    }

    /**
     * Normal conditions (e.g., master)
     * @returns {Promise<string>}
     */
    this.getCurrentBranchName = async function () {
      return this.revparse(['--abbrev-ref', 'HEAD']);
    };

    /**
     * The upstream tracking branch (e.g., origin/master)
     * @returns {Promise<string>}
     */
    this.getUpstreamBranchName = async function () {
      return this.revparse(['--abbrev-ref', '--symbolic-full-name', '@{u}']);
    };

    /**
     * For when you're on a local branch that isn't tracked
     * @returns {Promise<string>}
     */
    this.getLocalBranchName = async function () {
      return this.raw(['symbolic-ref', '--short', 'HEAD', '2']);
    };

    this.doesLocalBranchExist = async function (branchName) {
      const summary = await this.getBranchStatus(branchName);
      return !!summary.all.length;
    }

    this.getBranchStatus = async function (branchName) {
      return this.branch(['--list', branchName]);
    }

    /**
     * Is the provided branch tracked by the remote named 'origin'
     * @param branchName Branch name
     * @returns {Promise<Boolean>}
     */
    this.doesRemoteBranchExist = async function (branchName) {
      assert.ok(branchName, 'No branchName provided');
      const branchNames = await this.getRemoteBranchRefs();
      return branchNames.has(branchName);
    };

    /**
     * TODO rename to just refs and include tags
     * @return {Promise<Map<string, string>>}
     */
    this.getRemoteBranchRefs = async function () {
      if (!this._branchNames) {
        const prefix = "refs/heads/";
        const branchNames = new Map();
        const heads = tk.trimLastEOL(await this.listRemote(['--heads']));
        const lines = heads.split(EOL);
        for (const line of lines) {
          const parts = line.split("\t");
          assert(parts.length === 2, `Unexpected fields: ${line}`);
          assert(parts[1].startsWith(prefix), `Unexpected prefix: ${parts[1]}`);
          const name = parts[1].substring(prefix.length);
          if ("PENDING" === name) {
            continue;
          }
          branchNames.set(parts[1].substring(prefix.length), parts[0]);
        }
        this._branchNames = branchNames;
      }
      return this._branchNames;
    }

    this.pullIfBehind = async function () {
      await this.fetch();
      let status = await this.status(['--short']);
      if (status.behind > 0) {
        return this.pull();
      }
    }

    this.addNewFile = async function (repoPath, textContent, encoding = 'utf8') {
      const fsPath = Path.join(this.baseDir, repoPath);
      if (fs.existsSync(fsPath)) {
        throw new LogicalError(`Path already exists: ${fsPath}`);
      }
      fs.writeFileSync(fsPath, textContent, encoding);
      await this.add(repoPath);
      return this.commit(`Added ${repoPath}`, repoPath);
    }

    this.setFileContent = async function (repoPath, textContent, encoding = 'utf8') {
      const fsPath = Path.join(this.baseDir, repoPath);
      if (!fs.existsSync(fsPath)) {
        throw new LogicalError(`Path does not exists: ${fsPath}`);
      }
      fs.writeFileSync(fsPath, textContent, encoding);
      return this.add(repoPath);
    }

    this.getFileContent = async function (repoPath, encoding = 'utf8') {
      const fsPath = Path.join(this.baseDir, repoPath);
      if (fs.existsSync(fsPath)) {
        return fs.readFileSync(fsPath, {encoding});
      }
    }

    this.getCommitIdFor = async function (pattern) {
      let commit;
      const ref = await this.getRef(pattern);
      if (ref) {
        return ref.hash;
      } else {
        if (/^[A-Fa-f0-9]+$/.test(pattern)) {
          commit = pattern;
        }
      }
      return commit;
    }

    this.isBranchOrTag = async function (pattern) {
      const ref = await this.getRef(pattern);
      return ref.isBranch || ref.isTag;
    }

    this.isBranch = async function (pattern) {
      const ref = await this.getRef(pattern);
      return ref.isBranch;
    }

    this.isTag = async function (pattern) {
      const ref = await this.getRef(pattern);
      return ref.isTag;
    }

    this.getRef = async function (branchOrTag) {
      const rawOutput = await this.raw(['show-ref', branchOrTag]);
      if (!!rawOutput) {
        let ref;
        for (const line of tk.trimLastEOL(rawOutput).split(/\r?\n/)) {
          const fields = line.split(/\s/);
          const hash = fields[0];
          const name = fields[1];
          const match = name.match(/^refs\/(tags|remotes\/origin)\/(.*)/);
          if (match && match[2] === branchOrTag) {
            if (!ref) ref = new Ref();
            if (match[1] === 'tags') {
              ref.isTag = true;
              ref.name = match[2];
            } else {
              ref.isBranch = true;
              ref.name = `origin/${match[2]}`;
            }
            if (ref.hash && hash !== ref.hash) {
              throw new Error(`Parsing logic fail, multiple commit hashes for ${branchOrTag}`);
            }
            ref.hash = hash;
          }
        }
        return ref;
      }
    }

    /**
     * @param branch branch
     * @param compareTo branch|tag|commit
     * @return {Promise<{behind, ahead}>}
     */
    this.compareBranchCommits = async function (branch, compareTo) {
      const branchRef = await this.getRef(branch);
      assert.ok(branchRef);

      let fromSpec;
      const compareToRef = await this.getRef(compareTo);
      if (compareToRef) {
        fromSpec = compareToRef.name;
      } else {
        fromSpec = compareTo;
      }

      const args = ['rev-list', '--left-right', '--count', `${fromSpec}...${branchRef.name}`];
      const rawOutput = await this.raw(args);
      if (rawOutput && rawOutput.length) {
        const expectedOutputRegExp = /^\d+\s+\d+/;
        const parseOutputRegExp = /^(\d+)\s+(\d+)/;
        if (expectedOutputRegExp.test(rawOutput)) {
          const matched = rawOutput.match(parseOutputRegExp);
          return {
            behind: matched[1],
            ahead: matched[2]
          }
        }
      }

      throw new Error(`Unexpected output: ${rawOutput}`);
    }

    /**
     * Checkout a remote branch.
     * Adds `--` to simple-git's behavior so to disambiguate.
     * See also: https://stackoverflow.com/questions/25322335/git-change-branch-when-file-of-same-name-is-present
     * @override
     * @param {string} branchName name of branch
     * @param {string} startPoint (e.g origin/development)
     * @return {Promise<SimpleGit & Promise<string>>}
     */
    this.checkoutBranch = async function (branchName, startPoint) {
      return this.checkout(['-b', branchName, startPoint, '--']);
    }
  }
}

function findGitRepoDirOf(givenPath) {
  assert.ok(givenPath);
  let path = Path.resolve(givenPath);
  if (fs.lstatSync(path).isFile()) {
    path = Path.dirname(path);
  }
  while (path) {
    assert.ok(fs.existsSync(path), `Path does not exist: ${path}`);
    const gitDirPath = Path.join(path, GIT_DIR);
    if (fs.existsSync(gitDirPath) && fs.lstatSync(gitDirPath).isDirectory()) {
      return path;
    }
    const parentDir = Path.dirname(path);
    assert.notEqual(parentDir, path);
    path = parentDir;
  }
  throw new FileNotFoundError()
}

class Ref {
  isTag = false;
  isBranch = false;
  hash = undefined;
  name = undefined;
}

module.exports.findGitRepoDirOf = findGitRepoDirOf;
module.exports.GitRepo = GitRepo;