//  Copyright (C) Agilysys, Inc. All rights reserved.

const chai = require('chai');
const assert = chai.assert;

const tmp = require("tmp");
const fs = require("fs");
const {GitRepo} = require("../lib/repo/GitRepo");
const {YAMLFile} = require("../lib/repo/YAMLFile");
const {GitBackedYAMLFile} = require("../lib/repo/GitBackedYAMLFile");

const tmpDir = '/tmp';
const repoSubDir = __dirname;
const repoRoot = `${__dirname}/../`;

describe('git-repo', function () {
  it(`knows ${tmpDir} is not a repo`, async () => {
    let repo = new GitRepo({baseDir: tmpDir});
    assert.isFalse(await repo.checkIsRepo('root'));
  });

  it(`knows ${repoSubDir} is in a repo`, async () => {
    let repo = new GitRepo({baseDir: repoSubDir});
    assert.isTrue(await repo.checkIsRepo());
  });

  it(`knows ${repoSubDir} is not the repo root`, async () => {
    let repo = new GitRepo({baseDir: repoSubDir});
    assert.isFalse(await repo.checkIsRepo('root'));
  });

  it(`knows ${repoRoot} is the root`, async () => {
    let repo = new GitRepo({baseDir: repoRoot});
    assert.isTrue(await repo.checkIsRepo('root'));
  });

  it ('will merge tracked changes when switching branches', async () => {
    const tmpDir = tmp.dirSync();
    const tmpDirPath = tmp.dirSync().name;
    try {
      // Setup directories
      const repoDir = `${tmpDirPath}/repo`;
      const clone1Dir = `${tmpDirPath}/clone1`;
      const clone2Dir = `${tmpDirPath}/clone2`;
      fs.mkdirSync(repoDir);
      fs.mkdirSync(clone1Dir);
      fs.mkdirSync(clone2Dir);
      const repo = new GitRepo({baseDir: repoDir});
      const clone1 = new GitRepo({baseDir: clone1Dir});
      const clone2 = new GitRepo({baseDir: clone2Dir});

      // Initialize the upstream repository
      await repo.init(['--bare']);

      // Initialize the master branch with an initial commit
      await clone1.clone(repoDir, clone1Dir);
      const testFilename = 'test.yml';
      const testFilePath1 = `${clone1Dir}/${testFilename}`;
      YAMLFile.newFile(testFilePath1, {});
      await clone1.add(testFilename);
      await clone1.commit('Initial commit');
      await clone1.push(['-u', 'origin', 'master']);

      // Sync up the second clone
      await clone2.clone(repoDir, clone2Dir);

      // Push a change from first clone
      const testFile1 = new GitBackedYAMLFile(testFilePath1, {});
      testFile1.set('changes', 'v1');
      testFile1.save();
      await testFile1.checkIn('First change');

      // Test case - git merge
      await clone2.checkout(['-b', 'develop']);
      await clone2.fetch(['--all']);
      const status = await clone2.switch('master');
      assert.ok(status.behind === 0);

    } finally {
      tmpDir.removeCallback();
      // Too dangerous
      // if (tmpDirPath) {
      //   fs.rmdirSync(tmpDirPath, {recursive:true});
      // }
    }
  });
});