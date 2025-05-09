const chai = require('chai');
const assert = chai.assert;

const util = require('../lib/common/util');
const GitRepository = require('../lib/classes/GitRepository');

describe('GitRepository', function () {

  it('should not make assumptions', function () {
    assert.throws(GitRepository);
  });

  it('should read its definition', function () {
    var repo = GitRepository.create({
      repo_path: "pms/victorsrootpom",
      mainline: "feature/dev"
    });
    assert.equal(repo.mainline, "feature/dev");
    assert.equal(repo.repoPath, "pms/victorsrootpom");
    assert.isUndefined(repo.defaultBranch);
  });

  it('should handle the `build` argument', function () {
    assert.isFalse(util.isPresent())
    assert.isFalse(util.isPresent(undefined))
    assert.isFalse(util.isPresent(null))
    assert.isTrue(util.isPresent(false))
    assert.isTrue(util.isPresent(true))
  });

});
