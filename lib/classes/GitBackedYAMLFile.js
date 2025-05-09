const config = require('../common/config');
const Path = require('path');
const YAMLFile = require('./YAMLFile');

class GitBackedYAMLFile extends YAMLFile {

  static resolveRepoPath(repo, path) {
    let repoDir = repo.getRepoDir();
    if (Path.isAbsolute(path)) {
      if (path.startsWith(repoDir)) {
        return path;
      } else {
        throw new Error('Path outside of repository');
      }
    } else {
      return Path.join(repoDir, path);
    }
  }

  constructor(repo, path, required=false) {
    super(GitBackedYAMLFile.resolveRepoPath(repo, path), required);
    this.repo = repo;
  }

  getRepoPath() {
    let repoDir = this.repo.getRepoDir().replace(/[/]$/, '');
    return this.path.substr(repoDir.length);
  }

  /**
   * Commit and push _saved_ changes.
   * @param message Commit message (optional)
   * @returns {boolean} A git operation was needed and succeeded
   *
   * TODO: Should only commit/push this file. GitRepository.checkInFile() would be handy
   * (currently all the niceties are bound to --all behavior)
   */
  checkIn(message) {
    return this.repo.checkIn({message: `[${config.rName}] ${message}`});
  }
}

module.exports = GitBackedYAMLFile;
