const _ = require('underscore');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError');
const {BuildProject} = require('./BuildProject');
const CommitNotFoundError = require('./Errors').CommitNotFoundError;
const config = require('../common/config');
const ExecError = require('./ExecError');
const GitRepository = require('./GitRepository');
const {Projects, Trunks} = require('./Constants');
const {SupportProject} = require('./SupportProject');
const util = require('../common/util');
const {VersionEx} = require('./VersionEx');

class ChangesetFile {
  static Alias = {
    CANDIDATE: 'candidate',
    HOTFIX: 'hotfix',
    PRODUCTION: 'production',
    RELEASED: 'released'
  }

  static Status = {
    DEV: 'IN_DEV',
    RC: 'IN_RC',
    RELEASED: 'RELEASED'
  }

  static create(versionsRepo, bundleName) {
    const file = new ChangesetFile();
    file.repo = versionsRepo;
    file.projectDir = bundleName || config.bundleName;
    file.filePath = undefined;
    file.data = undefined;
    file.alias = undefined;
    return file;
  }

  static fromJsonObject(object) {
    const file = new ChangesetFile();
    _.extend(file, object);
    file.repo = GitRepository.fromJsonObject(object.repo);
    return file;
  }

  addProjectVersions(projects, options) {
    options = _.extend({versionOffset: VersionEx.LITERAL}, options);
    _.each(projects, function (project) {
      let version = new VersionEx(project.getVersion());
      let versionString = options.versionOffset === VersionEx.RELEASED
        ? version.isSnapshot()
          ? version.getPriorReleaseString()
          : version.toString()
        : options.versionOffset === VersionEx.NEXT_RELEASE
          ? version.getReleaseString()
          : version.toString();
      _.each(util.asArray(project.definition.versions_key), function (key) {
        this.data[key] = versionString;
      }, this);
    }, this);
  }

  addSupportProjectInclusions(projects) {
    _.each(projects, function (project) {
      this.data[project.definition.inclusion_key] = true;
    }, this);
  }

  applyChangesetId() {
    this.data.tracking_id = config.changesetId.trackingId;
    this.data.bundle_name = config.changesetId.bundleName;
  }

  deleteValue(key) {
    if (!util.isPresent(key)) throw new Error('Missing assignment key');
    return delete this.data[key];
  }

  doesAliasExist(alias) {
    return util.fileExists(this.getAliasPath(alias));
  }

  doesChangesetExist(changesetId) {
    return util.fileExists(this.getChangesetPath(changesetId));
  }

  getAliasPath(alias) {
    return this.repo.getAbsolutePath(this.getRelativeAliasPath(alias));
  }

  getBuildReleaseTag(project) {
    if (!(project instanceof BuildProject)) return undefined;
    let artifacts = project.getArtifacts();
    if (!artifacts || artifacts.length === 0) return undefined;
    let artifact = project.getArtifacts()[0];
    let lastDot = artifact.lastIndexOf(":");
    let version = this.getVersion(project.getPrimaryVersionsKey());
    return version ? artifact.substring(lastDot + 1) + '-' + version.toString() : undefined;
  }

  getBundleVersion() {
    return new VersionEx(this.data.bundle_version || this.data.source_bundle_version);
  }

  getChangesetBranchName() {
    return sprintf('%s/%s', config.changeset_branch_prefix, this._bundleNamePrefixed(this.data.tracking_id));
  }

  getChangesetPath(changesetId) {
    return this.repo.getAbsolutePath(this.getRelativeChangesetPath(changesetId));
  }

  // TECH DEBT: not sure this is the most logical place to reside since its function is independent of the ChangesetFile
  // its called from
  getCommitHistory(alias) {
    let options = {};
    if (alias === ChangesetFile.Alias.HOTFIX) {
      options.follow = false; // TODO: NOFOLLOW - See corresponding comment in GitRepository
    } else {
      options.follow = true;
    }
    return this.repo.getCommitHistory(this.getRelativeAliasPath(alias), options);
  }

  getFilename() {
    return this.filePath ? path.basename(this.filePath) : this.filePath;
  }

  getForkPoints(changesetId, projects, supportProjects) {
    let history = this.repo.getCommitHistory(this.getRelativeChangesetPath(changesetId));
    let forkPoints = {};

    let head = history.shift();
    while (head) {
      let changeset;
      try {
        changeset =
          ChangesetFile.create(this.repo, this.bundleName).loadFromChangesetByCommitOrTag(changesetId, head.id);
      } catch (ex) {
        if (ex instanceof CommitNotFoundError) {
          // indicates changeset was destroy and re-started, no need to go further
          break;
        }
        throw ex;
      }
      _.each(projects, function (project) {
        let version = changeset.getVersion(project.getPrimaryVersionsKey());
        if (version && version.hasTrackingId() && version.getTrackingId() === changesetId.trackingId) {
          if (project.getStatus(changeset.getTrunk()) === Projects.Status.PENDING) {
            forkPoints[project.dirname] = Projects.Status.PENDING;
          } else {
            forkPoints[project.dirname] = changeset.getReleaseTag();
          }
        }
      });
      _.each(supportProjects, function (project) {
        if (!!changeset.data[project.getInclusionKey()]) {
          forkPoints[project.dirname] = changeset.getReleaseTag();
        }
      });
      head = history.shift();
    }

    return forkPoints;
  }

  getHotfixSupportBranch() {
    return sprintf('%s/%s', config.support_hotfix_branch_prefix,
      this._bundleNamePrefixed(this.getBundleVersion().toString()));
  }

  getProjectMetadata(dirname) {
    if (!this.data.projects || !this.data.projects[dirname]) {
      return undefined;
    }
    let metadata = this.data.projects[dirname];
    return {
      source: metadata.source,
      approvedTo: metadata.approved_to,
      approvedMergeParents: metadata.approved_merge_parents ? metadata.approved_merge_parents.slice() : [],
      handMergedFiles: metadata.hand_merged_files ? metadata.hand_merged_files.slice() : [],
      autoMergedFiles: metadata.auto_merged_files ? metadata.auto_merged_files.slice() : []
    };
  }

  getRelativeAliasPath(alias) {
    return sprintf(config.versions_files.alias_spec, this.projectDir, alias)
  }

  getRelativeChangesetPath(changesetId) {
    return sprintf(config.versions_files.changeset_spec, changesetId.bundleName, changesetId.trackingId);
  }

  getReleaseBranchName() {
    return sprintf('%s/%s', config.release_branch_prefix, this._bundleNamePrefixed(this.getBundleVersion().toString()));
  }

  getReleaseTag() {
    return sprintf(config.releaseTagSpec, this.projectDir, this.getBundleVersion().toString());
  }

  getReleaseTagForVersion(version) {
    return sprintf(config.releaseTagSpec, this.projectDir, version.clone().resize(2).toString());
  }

  /**
   * @param {boolean} remote
   * @return {string}
   */
  getReviewSourceBranchName(remote) {
    const base = sprintf('%s/%s/%s', config.review_branch_prefix, config.review_branch_source_segment,
      this._bundleNamePrefixed(config.changesetId.trackingId));
    return remote ? sprintf('origin/%s', base) : base;
  }

  /**
   * @param {boolean} remote
   * @return {string}
   */
  getReviewTargetBranchName(remote) {
    const base = sprintf('%s/%s/%s', config.review_branch_prefix, config.review_branch_target_segment,
      this._bundleNamePrefixed(config.changesetId.trackingId));
    return remote ? sprintf('origin/%s', base) : base;
  }

  getStatus() {
    return this.getValue('status');
  }

  getTrunk() {
    return this.getValueSafe('trunk');
  }

  getTrunkMarker(trunk) {
    let markers = this.data.trunk_markers;
    if (!markers) return undefined;
    return markers[trunk] ? new VersionEx(markers[trunk]) : undefined;
  }

  getTrunkMainlineBranchNameForSupportProjects() {
    if (!this.onTrunk()) {
      throw new BuildError('Expected trunk context on a non-trunk changeset');
    }
    return [config.support_trunk_branch_prefix, this.getTrunk()].join('/');
  }

  getValue(key) {
    return this.data[key];
  }

  getValueSafe(key) {
    return this.data ? this.data[key] : undefined;
  }

  getVersion(key) {
    let value = this.data[key];
    return value !== undefined ? new VersionEx(value) : value;
  }

  getVersions() {
    let versions = {};
    _.each(Object.keys(this.data), function (key) {
      versions[key] = this.getVersion(key);
    }, this);
    return versions;
  }

  getVersionProperties() {
    let versions = {};
    for (let key of Object.keys(this.data)) {
      if (key.endsWith('_version')) {
        versions[key] = this.data[key];
      }
    }
    return versions;
  }

  inStatus(statuses) {
    return _.contains(util.asArray(statuses), this.getStatus());
  }

  isChangesetFile() {
    return !this.alias;
  }

  isHotfix() {
    return !!this.getValue('hotfix') || this.isHotfixFile();
  }

  isHotfixFile() {
    return this.alias === ChangesetFile.Alias.HOTFIX;
  }

  isProductionFile() {
    return this.alias === ChangesetFile.Alias.PRODUCTION;
  }

  isReleasedFile() {
    return this.alias === ChangesetFile.Alias.RELEASED;
  }

  load(aliasOrTrackingId) {
    if (this.doesAliasExist(aliasOrTrackingId)) {
      return this.loadFromAlias(aliasOrTrackingId);
    }
    let changesetId = {
      bundleName: this.projectDir,
      trackingId: aliasOrTrackingId
    };
    return this.loadFromChangeset(changesetId);
  }

  loadFromAlias(alias, projects) {
    try {
      this._readFile(this.getAliasPath(alias));
    } catch (ex) {
      throw new BuildError(sprintf('Cannot load manifest: %s\n%s', alias.bold, ex));
    }
    this.alias = alias;
    this._removeRetiredProjects(this.getTrunk(), projects);
    return this;
  }

  loadFromAliasByCommitOrTag(alias, commitId) {
    try {
      let contents = this.repo.getFileByCommitOrTag(this.getRelativeAliasPath(alias), commitId);
      this._readFileContents(contents, this.getAliasPath(alias));
    } catch (ex) {
      if (ex instanceof ExecError && ex.stderr.indexOf('exists on disk, but not in') > 0) {
        throw new CommitNotFoundError();
      } else {
        throw new BuildError(sprintf('Cannot load manifest %s for commit %s\n%s', alias.bold, commitId.bold, ex));
      }
    }
    this.alias = alias;
    return this;
  }

  loadFromAliasQuietly(alias, projects) {
    try {
      this.loadFromAlias(alias, projects);
    } catch (ex) {
      util.narratef('Manifest file %s not loaded\n', this.getAliasPath(alias));
    }
    return this;
  }

  loadFromChangeset(changesetId, projects) {
    if (!this.doesChangesetExist(changesetId)) {
      throw new BuildError(sprintf('Changeset %s:%s does not exist', changesetId.bundleName, changesetId.trackingId))
    }
    this._readFile(this.getChangesetPath(changesetId));
    this._removeRetiredProjects(this.getTrunk(), projects);
    return this;
  }

  loadFromChangesetByCommitOrTag(changesetId, commitId) {
    try {
      let contents = this.repo.getFileByCommitOrTag(this.getRelativeChangesetPath(changesetId), commitId);
      this._readFileContents(contents, this.getChangesetPath(changesetId));
    } catch (ex) {
      if (ex instanceof ExecError && ex.stderr.indexOf('exists on disk, but not in') > 0) {
        throw new CommitNotFoundError();
      } else {
        throw new BuildError(sprintf('Cannot load manifest %s:%s for commit %s\n%s', changesetId.bundleName.bold,
          changesetId.trackingId.bold, commitId.bold, ex));
      }
    }
    return this;
  }

  loadFromFirstValidAlias(aliases, projects) {
    aliases = util.asArray(aliases);
    for (let i = 0; i < aliases.length; i++) {
      if (!this.data) {
        if (i < aliases.length - 1) {
          this.loadFromAliasQuietly(aliases[i], projects);
        } else {
          this.loadFromAlias(aliases[i], projects);
        }
      }
    }
    return this;
  }

  loadFromTrunk(trunk, projects) {
    let alias = trunk.getAlias();
    try {
      this._readFile(this.getAliasPath(alias));
    } catch (ex) {
      throw new BuildError(sprintf('Cannot load manifest: %s.yml\n%s', trunk.getAlias().bold, ex));
    }
    this.alias = alias;
    this._removeRetiredProjects(trunk, projects);
    return this;
  }

  loadFromTrunkQuietly(trunk, projects) {
    try {
      this.loadFromTrunk(trunk, projects);
    } catch (ex) {
      util.narratef('Manifest file %s.yml not loaded\n', trunk.getAlias());
    }
    return this;
  }

  onTrunk() {
    return !!this.getTrunk();
  }

  removeFile(candidateAlias) {
    if (this.filePath) {
      if (this.filePath !== this.getAliasPath(candidateAlias) &&
        this.filePath !== this.getAliasPath(ChangesetFile.Alias.HOTFIX)) {
        throw new BuildError(
          sprintf('Cowardly refusing to remove non-candidate file: %s', this.filePath));
      }
      util.removeFile(this.filePath);
      return true;
    }
    return false;
  }

  removeSupportProjectInclusion(parent, force) {
    let result = [];
    _.each(parent.all, function (project) {
      if (parent.included.includes(project) || force) {
        let previous = this.data[project.definition.inclusion_key];
        delete this.data[project.definition.inclusion_key];
        if (previous) {
          result.push(project.definition.inclusion_key);
        }
      }
    }, this);
    return result;
  }

  save() {
    return this.saveAs(this.filePath);
  }

  saveAs(filePath) {
    util.mkfiledir(filePath);
    fs.writeFileSync(filePath, yaml.dump(this.data, {lineWidth: 200}), 'utf8');
    this.filePath = filePath;
    return this;
  }

  saveAsAlias(alias) {
    return this.saveAs(this.getAliasPath(alias));
  }

  saveAsChangeset(changesetId) {
    return this.saveAs(this.getChangesetPath(changesetId));
  }

  setMasterMarker(version) {
    return this.setTrunkMarker(Trunks.MASTER, version);
  }

  setProjectMetadata(dirname, metadata) {
    if (!this.data.projects) {
      this.data.projects = {};
    }
    if (!metadata) {
      delete this.data.projects[dirname];
      return;
    }
    let domain = {
      source: metadata.source,
    };
    if (metadata.approvedTo) {
      domain.approved_to = metadata.approvedTo;
    }
    if (metadata.approvedMergeParents && metadata.approvedMergeParents.length) {
      domain.approved_merge_parents = metadata.approvedMergeParents.slice();
    }
    if (metadata.handMergedFiles && metadata.handMergedFiles.length) {
      domain.hand_merged_files = metadata.handMergedFiles.slice();
    }
    if (domain.hand_merged_files) {
      domain.hand_merged_files = _.uniq(domain.hand_merged_files);
      domain.hand_merged_files = _.sortBy(domain.hand_merged_files);
    }
    if (metadata.autoMergedFiles && metadata.autoMergedFiles.length) {
      domain.auto_merged_files = metadata.autoMergedFiles.slice();
    }
    if (domain.auto_merged_files) {
      domain.auto_merged_files = _.difference(domain.auto_merged_files, domain.hand_merged_files || []);
      domain.auto_merged_files = _.uniq(domain.auto_merged_files);
      domain.auto_merged_files = _.sortBy(domain.auto_merged_files);
      if (!domain.auto_merged_files.length) {
        delete domain.auto_merged_files;
      }
    }
    this.data.projects[dirname] = domain;
  }

  setSourceBundleVersion(versionAsString) {
    this.setValue('source_bundle_version', versionAsString);
    this.deleteValue('bundle_version'); // ensure there is only one version
  }

  setStatus(newStatus) {
    if (!_.contains(Object.values(ChangesetFile.Status), newStatus)) {
      throw new BuildError(sprintf('Invalid status: %s', newStatus));
    }
    return this.setValue('status', newStatus);
  }

  setOrRemoveValue(key, value) {
    if (!util.isPresent(key)) throw new Error('Missing assignment key');
    if (!util.isPresent(value)) {
      delete this.data[key];
      return undefined;
    }
    return this.data[key] = value;
  }

  setTrunk(trunk) {
    return this.setValue('trunk', trunk);
  }

  setTrunkMarker(trunk, version) {
    let markers = this.data.trunk_markers || {};
    if (!version) {
      delete markers[trunk];
    } else {
      markers[trunk] = version.toString();
    }
    this.data.trunk_markers = markers;
  }

  setValue(key, value) {
    if (!util.isPresent(key)) throw new Error('Missing assignment key');
    if (!util.isPresent(value)) throw new Error(sprintf('Missing value for assignment to: %s', key));
    return this.data[key] = value;
  }

  updateFrom(that, keys) {
    let updated = undefined;
    if (!keys) keys = that.keys();
    _.each(keys, function (key) {
      if (this.data[key] !== that.data[key]) {
        if (updated === undefined) updated = [];
        updated.push({
          key: key,
          from: this.data[key],
          to: that.data[key]
        });
      }

      if (that.data[key] !== undefined) {
        this.data[key] = that.data[key];
        util.narratef('ChangesetFile.updateFrom(%s) %s = %s\n', this.getFilename(), key, that.data[key]);
      } else {
        util.narratef('Ignored %s; from: %s, to: %s', key, this.data[key], that.data[key]);
      }
    }, this);
    return updated;
  }

  updateIncludedVersionsFromVersionMap(projects, map) {
    let result = [];
    _.each(projects, function (project) {
      let versionString = map[project.pom.getCanonicalArtifactId()];
      _.each(util.asArray(project.definition.versions_key), function (key) {
        let before = this.data[key];
        if (versionString !== VersionEx.RETIRED) {
          this.data[key] = versionString;
        } else {
          delete this.data[key];
        }
        result.push({
          key: key,
          before: before,
          after: versionString
        })
      }, this);
    }, this);
    return result;
  }

  updateSupportProjectInclusion(parent, options) {
    options = _.extend({
      prune: false
    });
    _.each(parent.all, function (project) {
      if (parent.included.includes(project)) {
        this.data[project.definition.inclusion_key] = true;
      } else if (options.prune) {
        delete this.data[project.definition.inclusion_key];
      }
    }, this);
  }

  /**
   * Used to distinguish between old-style branch names without bundle names and new-style branch names with.
   * @param {string} value
   * @return {string}
   * @private
   */
  _bundleNamePrefixed(value) {
    return this.data.bundle_name
      ? sprintf('%s/%s', this.data.bundle_name, value)
      : value;
  }

  _loadData(data, filePath) {
    this.data = data;
    if (config.excluded_changeset_properties) {
      _.each(Object.keys(this.data), function (key) {
        if (config.excluded_changeset_properties.includes(key)) {
          delete this.data[key];
        }
      }, this);
    }
    this.filePath = filePath;
  }

  _readFile(filePath) {
    let contents;
    try {
      contents = util.readFile(filePath);
    } catch (ex) {
      throw new BuildError(sprintf('Could not load `%s`: %s', filePath, ex.toString()));
    }
    this._readFileContents(contents, filePath);
  }

  _readFileContents(contents, filePath) {
    let data;
    try {
      data = yaml.load(contents);
    } catch (ex) {
      throw new BuildError(sprintf('Could not load `%s`: %s', filePath, ex.toString()));
    }
    this._loadData(data, filePath);
  }

  _removeRetiredProjects(trunk, projects) {
    if (projects) {
      _.each(projects, function (project) {
        if (project.getStatus(trunk) === Projects.Status.RETIRED) {
          if (project instanceof BuildProject && this.getValue(project.getVersionsKey())) {
            this.deleteValue(project.getVersionsKey());
          } else if (project instanceof SupportProject && this.getValue(project.getInclusionKey())) {
            this.deleteValue(project.getInclusionKey());
          }
        }
      }, this);
    }
  }
}

module.exports.ChangesetFile = ChangesetFile;
