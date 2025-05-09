const _ = require('underscore');
const deasync = require('deasync');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError');
const {BuildProject} = require('./BuildProject');
const Bundle = require('./Bundle');
const {ChangesetFile} = require('./ChangesetFile');
const config = require('../common/config');
const constants = require('../common/constants');
const {ForkedProjectOp} = require('./ForkedProjectOp');
const {Projects, Trunks, GithubMapping} = require('./Constants');
const {SupportProject} = require('./SupportProject');
const util = require('../common/util');
const {Trunk} = require('./Trunk');
const {VersionEx} = require('./VersionEx');

/**
 * @class
 * @param {JSONFile} configFile
 * @param {GitRepository} versionsRepo
 * @param {string} instanceName
 */
function ChangesetBundle(configFile, versionsRepo, instanceName) {
  this._constructBundle(configFile, versionsRepo, instanceName || 'changeset', 'changeset-id');
  this.projects = {
    all: [],
    valid: [],
    included: [],
    excluded: []
  };
  this.supportProjects = {
    all: [],
    valid: [],
    included: [],
    excluded: []
  };
  if (this.configFile.data.trunks) {
    this.trunks = {};
    this.configFile.data.trunks.forEach(trunkConfig => {
      if (_.contains(Object.values(ChangesetFile.Alias), trunkConfig.name)) {
        throw new BuildError(sprintf('Configuration has a trunk named \'%s\', somebody is trying to cause trouble!',
          trunkConfig.name));
      }
      if (!trunkConfig.name.match(Trunk.NAME_REGEX)) {
        throw new BuildError(sprintf('Configuration has a trunk name \'%s\', does not conform to %s', trunkConfig.name,
          Trunk.NAME_REGEX));
      }
      this.trunks[trunkConfig.name] = new Trunk(trunkConfig, this.versionsRepo)
    });
  }

  this.changeset = ChangesetFile.create(this.versionsRepo);
  this.releasedFile = ChangesetFile.create(this.versionsRepo).loadFromAlias(ChangesetFile.Alias.RELEASED);
  this.hotfixFile = ChangesetFile.create(this.versionsRepo).loadFromAliasQuietly(ChangesetFile.Alias.HOTFIX);
  if (!this.hotfixFile.data) this.hotfixFile = undefined;
  this.productionFile = ChangesetFile.create(this.versionsRepo).loadFromAlias(ChangesetFile.Alias.PRODUCTION);
}

ChangesetBundle.prototype = new Bundle();
ChangesetBundle.prototype.constructor = ChangesetBundle;

ChangesetBundle.prototype.addDependentProjects = function (includedProjects, explicitProjects) {
  let artifactIds = [];
  _.each(explicitProjects, function (project) {
    if (project instanceof BuildProject) {
      function addModule(module) {
        artifactIds.push(module.getCanonicalArtifactId());
        _.each(module.modules, addModule);
      }

      addModule(project.pom);
    }
  });

  let dependentProjects = [];
  _.each(includedProjects, function (project) {
    if (!explicitProjects.includes(project)) {
      _.each(artifactIds, function (artifactId) {
        _.each(project.pom.findDependencies(artifactId, {}), function (dependency) {
          if (dependency && !dependentProjects.includes(project)) {
            dependentProjects.push(project);
          }
        })
      });
    }
  });
  if (dependentProjects.length === 0) {
    return explicitProjects;
  } else {
    return this.addDependentProjects(includedProjects, _.union(explicitProjects, dependentProjects));
  }
};

ChangesetBundle.prototype.addDownstreamProjects = function (includedProjects, explicitProjects) {
  let earliestPhase = undefined;
  _.each(explicitProjects, project => {
    let buildPhase = project.definition.build_phase;
    if (!earliestPhase || buildPhase < earliestPhase) {
      earliestPhase = buildPhase;
    }
  });
  let downstreamProjects = [];
  _.each(includedProjects, project => {
    if (project.definition.build_phase > earliestPhase && !explicitProjects.includes(project)) {
      downstreamProjects.push(project);
    }
  });
  return _.union(explicitProjects, downstreamProjects);
};

ChangesetBundle.prototype.addVersionsForArtifacts = function (changeset, versionMap, projects) {
  _.each(projects || this.projects.excluded, function (project) {
    if (project.getArtifacts().length > 0) {
      let version = changeset.getVersion(project.getPrimaryVersionsKey());
      if (version) {
        _.each(project.getArtifacts(), function (artifact) {
          if (!versionMap[artifact]) {
            versionMap[artifact] = version.toString();
          }
        });
      }
    }
  });
  return versionMap;
};

ChangesetBundle.prototype.checkout = function (projects, options, errorOnFailure) {
  let projectOptionPairs = [];
  _.each(projects, project => {
    projectOptionPairs.push({
      project: project,
      options: _.extend({
        checkout: [],
        workDir: config.workDir,
        okIfMissing: false
      }, options)
    });
  });

  this._checkoutEach(projectOptionPairs, errorOnFailure);
};

ChangesetBundle.prototype.checkoutEach = function (projectOptionPairs, errorOnFailure) {
  _.each(projectOptionPairs, pair => {
    pair.options = _.extend({
      checkout: [],
      workDir: config.workDir,
      okIfMissing: false
    }, pair.options);
  });
  this._checkoutEach(projectOptionPairs, errorOnFailure);
};

ChangesetBundle.prototype.ensureTrunkSupportProjectsMainline = function (supportProjects, options) {
  const trunkConfig = this._getTrunkConfig();
  const seededSupportProjects = trunkConfig.seeded_support_projects || [];

  const mainline = this.changeset.getTrunkMainlineBranchNameForSupportProjects();
  const projectOptionPairs = [];
  const unseededSupportProjects = [];
  supportProjects.forEach(project => {
    if (!_.contains(seededSupportProjects, project.dirname)) {
      projectOptionPairs.push({
        project: project,
        options: {
          checkout: [mainline, project.getMainlineBranchName(), project.definition.ops_mainline,
            config.support_ops_mainline_branch_name],
          workDir: options.workDir
        }
      });
      unseededSupportProjects.push(project.dirname);
    }
  });

  if (!projectOptionPairs.length) return

  util.announce('Ensuring mainline branches for support projects'.plain);
  this._checkoutEach(projectOptionPairs, 'Cannot continue due to one or more missing targets!');

  let atLeastOneNew = false;
  supportProjects.forEach(project => {
    let source = project.repo.getCurrentBranch();
    if (source !== mainline) {
      if (!atLeastOneNew) {
        util.announce('Adding mainline branches for support projects'.plain);
        atLeastOneNew = true;
      }
      util.startBullet(project.dirname.plain);
      util.continueBullet(sprintf('Branch %s from %s'.trivial, mainline.useful, source.useful));
      project.point({checkout: [source]});
      project.repo.createBranch(mainline, true);
      util.endBullet('Created'.good);
    }
  });

  trunkConfig.seeded_support_projects = _.union(trunkConfig.seeded_support_projects, unseededSupportProjects);
  this.configFile.save();

  util.announce('Initializing (continued)'.plain);
};

ChangesetBundle.prototype.getAllExcludedProjects = function () {
  return this.projects.excluded.concat(this.supportProjects.excluded);
}

ChangesetBundle.prototype.getAllIncludedProjects = function () {
  return this.projects.included.concat(this.supportProjects.included);
};

ChangesetBundle.prototype.getAllProjects = function () {
  return this.projects.all.concat(this.supportProjects.all);
}

ChangesetBundle.prototype.getAllValidProjects = function () {
  return this.projects.valid.concat(this.supportProjects.valid);
};

ChangesetBundle.prototype.getCandidateAlias = function () {
  if (this.changeset.onTrunk()) {
    return this.trunks[this.changeset.getTrunk()].getCandidateAlias();
  }
  return ChangesetFile.Alias.CANDIDATE;
}

ChangesetBundle.prototype.getChangesetBranchName = function () {
  return this.changeset.getChangesetBranchName();
};

ChangesetBundle.prototype.getIncludedProjectsByName = function (list, params) {
  params = _.extend({
    includeProjects: true,
    includeSupportProjects: false
  }, params);
  let result = [];
  if (params.includeProjects) {
    result = result.concat(this._getIncludedProjectsByName(list, this.projects.included));
  }
  if (params.includeSupportProjects) {
    result = result.concat(this._getIncludedProjectsByName(list, this.supportProjects.included));
  }
  return result;
};

ChangesetBundle.prototype.getIncludedProjectsWithActiveDependencies = function () {
  return _.filter(this.projects.included, function (project) {
    return project.hasActiveDependencies();
  });
};

ChangesetBundle.prototype.getIncludedProjectsWithPassiveDependencies = function () {
  return _.filter(this.projects.included, function (project) {
    return !project.hasActiveDependencies();
  });
};

ChangesetBundle.prototype.getProjectByDirname = function (dirname) {
  return _.find(this.getAllProjects(), project => project.dirname === dirname);
}

ChangesetBundle.prototype.getProjectStatus = function (project, trunkName) {
  if (!trunkName) trunkName = this.changeset.getTrunk();
  return project.getStatus(trunkName);
};

ChangesetBundle.prototype.getReleaseConstraint = function () {
  return this.configFile.getValue('bundle_release_constraint') || constants.RELEASE_CONSTRAINT_NONE;
};

ChangesetBundle.prototype.getReleasedAlias = function () {
  if (this.changeset.onTrunk()) {
    return this.trunks[this.changeset.getTrunk()].getAlias();
  }
  return ChangesetFile.Alias.RELEASED;
}

ChangesetBundle.prototype.getReleasedFile = function () {
  return this.changeset.onTrunk()
    ? this.trunks[this.changeset.getTrunk()].trunkFile || this.releasedFile
    : this.releasedFile;
}

/**
 * @param {boolean} remote
 * @return {string}
 */
ChangesetBundle.prototype.getReviewSourceBranchName = function (remote) {
  return this.changeset.getReviewSourceBranchName(remote);
};

/**
 * @param {boolean} remote
 * @return {string}
 */
ChangesetBundle.prototype.getReviewTargetBranchName = function (remote) {
  return this.changeset.getReviewTargetBranchName(remote);
};

ChangesetBundle.prototype.getSourceAliases = function (isStart) {
  let aliases;
  if ((isStart && config._all.hotfix) || (!isStart && this.changeset.isHotfix())) {
    aliases = [ChangesetFile.Alias.HOTFIX, ChangesetFile.Alias.PRODUCTION];
  } else if ((isStart && config._all.trunk) || (!isStart && this.changeset.onTrunk())) {
    let trunk = isStart ? config._all.trunk : this.changeset.getTrunk();
    aliases = [this.trunks[trunk].getAlias(), ChangesetFile.Alias.RELEASED];
  } else {
    aliases = ChangesetFile.Alias.RELEASED;
  }
  return aliases;
};

ChangesetBundle.prototype.getTagsForExcludedProjects = function () {
  let tags = {};
  _.each(this.projects.excluded,
    project => tags[project.dirname] = this.changeset.getBuildReleaseTag(project) || this.changeset.getReleaseTag());
  _.each(this.supportProjects.excluded, project => tags[project.dirname] = this.changeset.getReleaseTag());
  return tags;
};

ChangesetBundle.prototype.graduateProjects = function (projects, status) {
  if (!projects || !projects.length) return;
  if (!status) status = Projects.Status.ACTIVE;
  this._graduateProjects('projects', projects, status);
  this._graduateProjects('support_projects', projects, status);
  this.configFile.save();
};

ChangesetBundle.prototype.init = function (options) {
  if (_.get(options, 'includeList') && options.includeList.length) {
    options.includeList = _.map(options.includeList, project => {
      return GithubMapping[project] || project;
    })
  };
  options = _.extend({
    workDir: config.workDir,
    checkout: undefined,
    alias: undefined,
    noCheckout: false,
    allowMissingBranches: false,
    existingChangeset: true,
    addAutoInclude: false,
    trackingIdMatch: true,
    includeList: undefined,
    excludeList: undefined,
    checkoutExcluded: false,
    forceCheckout: false,
    productionTag: this.productionFile ? this.productionFile.getReleaseTag() : undefined
  }, options);

  // Construct BuildProject objects
  _.each(this.configFile.data.projects, function (definition) {
    let project = BuildProject.create(definition, options, this.instanceName, this.configFile.data.trunks);
    this.projects.all.push(project);
  }, this);

  // Construct SupportProject objects
  _.each(this.configFile.data.support_projects, function (definition) {
    let project = SupportProject.create(definition, options, this.instanceName, this.configFile.data.trunks);
    this.supportProjects.all.push(project);
  }, this);

  // Load changeset
  if (options.alias) {
    this._setupForAlias(options);
  } else {
    if (!options.existingChangeset) {
      this.changeset.loadFromFirstValidAlias(this.getSourceAliases(true), this.projects.all);
      this.changeset.applyChangesetId();
      if (config._all.trunk && !this.changeset.onTrunk()) {
        this.changeset.setTrunk(config._all.trunk);
        this.changeset.setTrunkMarker(Trunks.MASTER, this.changeset.getBundleVersion());
      }
      this._determineValidProjects();
      if (!this.changeset.isHotfix()) {
        this.changeset.removeSupportProjectInclusion(this.supportProjects, true);
      }
      if (this.changeset.onTrunk()) {
        this.ensureTrunkSupportProjectsMainline(this.supportProjects.valid, options);
      }
    } else {
      this.changeset.loadFromChangeset(config.changesetId, this.projects.all);
      this._determineValidProjects();
      if (options.addAutoInclude && this.changeset.onTrunk()) {
        this.ensureTrunkSupportProjectsMainline(this.supportProjects.valid, options);
      }
    }

    // Determine which projects are in scope
    this._determineProjects(options);
  }

  // Checkout projects as requested
  if (!options.noCheckout) {
    let supportOptions = _.extend(_.clone(options), {});
    this._checkoutAsRequested(this.projects, options, this.supportProjects, supportOptions, 'Cannot continue due to one or more missing targets or errors!');
  }
};

ChangesetBundle.prototype.initProjectMetadataMap = function (defaultSource) {
  let metadataMap = {};
  let forkPoints = undefined;
  _.each(this.projects.included.concat(this.supportProjects.included), function (project) {
    let metadata = this.changeset.getProjectMetadata(project.dirname);
    if (!metadata) {
      if (!forkPoints) {
        forkPoints = this.changeset.getForkPoints(config.changesetId, this.projects.included,
          this.supportProjects.included);
        util.narrateln('Fork points:' + JSON.stringify(forkPoints));
      }
      let source = forkPoints[project.dirname];
      if (!source && defaultSource) {
        source = defaultSource;
        metadata = {
          source: source,
          new: true
        };
      } else if (source) {
        metadata = {
          source: source
        };
      }
      if (source && !metadata.new) {
        metadata.modified = true;
      }
    }

    if (metadata.approvedTo && metadata.approvedTo.length !== config.gitCommitHashSize) {
      metadata.approvedTo = project.repo.normalizeCommitHash(metadata.approvedTo);
      metadata.modified = true;
    }
    if (metadata.approvedMergeParents) {
      _.each(metadata.approvedMergeParents, function (parent, index) {
        if (parent && parent.length !== config.gitCommitHashSize) {
          metadata.approvedMergeParents[index] = project.repo.normalizeCommitHash(parent);
          metadata.modified = true;
        }
      }, this);
    }
    metadataMap[project.dirname] = metadata;
  }, this);
  return metadataMap;
};

ChangesetBundle.prototype.initSomeOrAll = function (options) {
  options = _.extend({}, options);
  if (config._all['include']) {
    options.includeList = config._all['include'];
    options.trackingIdMatch = false;
  }
  this.init(options);
};

ChangesetBundle.prototype.mapVersions = function (projects, versionOffset) {
  // Collect all the current versions
  let versions = {};

  let addVersion = pom => {
    let k = pom.getCanonicalArtifactId();
    let v = pom.getVersion();
    if (versionOffset === VersionEx.RELEASED) {
      v = new VersionEx(v).getPriorReleaseString();
    } else if (versionOffset === VersionEx.NEXT_RELEASE) {
      v = new VersionEx(v).getReleaseString();
    } else if (versionOffset === VersionEx.RETIRED) {
      v = VersionEx.RETIRED;
    }
    versions[k] = v;
    _.each(pom.modules, addVersion);
  };

  _.each(_.pluck(projects, 'pom'), addVersion);
  return versions;
};

ChangesetBundle.prototype.setReleaseConstraint = function (state) {
  let aliasIndex = constants.ENUM_RELEASE_CONSTRAINTS.indexOf(state);
  if (aliasIndex === -1) {
    throw new BuildError(
      sprintf('Unexpected release constraint %s; allowed values are %s', state, constants.ENUM_RELEASE_CONSTRAINTS));
  }
  this.configFile.setValue('bundle_release_constraint', state);
  this.configFile.save();
  return state;
};

ChangesetBundle.prototype.takeCandidateVersion = function () {
  let rawValue = this.configFile.getValue('bundle_next_candidate_version');
  if (rawValue === undefined) {
    throw new BuildError('Config file is missing value for \'bundle_next_candidate_version\'');
  }
  let version = new VersionEx(rawValue);
  this.configFile.setValue('bundle_next_candidate_version', version.clone().rollMinor().toString());
  this.configFile.save();
  return version;
};

ChangesetBundle.prototype.takeHotfixVersion = function () {
  let rawValue = this.configFile.getValue('bundle_next_hotfix_version');
  if (rawValue === undefined) {
    throw new BuildError('Config file is missing value for \'bundle_next_hotfix_version\'');
  }
  let version = new VersionEx(rawValue);
  this._incrementHotfixVersion(version, this.configFile);
  return version;
};

ChangesetBundle.prototype.takeTrunkVersion = function () {
  const trunkName = this.changeset.getTrunk();
  let trunkConfig = this._getTrunkConfig();
  let version = trunkConfig.next_version ? new VersionEx(trunkConfig.next_version) :
    this._incrementTrunkVersion(trunkConfig, trunkName, this.changeset.getBundleVersion());
  this._incrementTrunkVersion(trunkConfig, trunkName, version);
  return version;
}

/**
 * Update the dependency versions in each project according to the provided map.
 * @param {BuildProject[]} projects Projects to update
 * @param {{}} versionMap As returned by `mapVersions`
 * @param [options] Additional options
 * @param {[]} [options.artifactIds] Dependencies to update (defaults to versionMap.keys())
 * @param {number} [options.versionType] Use {@link VersionEx.RANGE} to process ranges
 * @param {boolean} [options.ignoreParents] When true, do not update <parent> versions
 * @param {boolean} [options.ignoreDependencyVersionedModules] when true, don't update dependency-versioned modules
 */
ChangesetBundle.prototype.useCurrentVersions = function (projects, versionMap, options) {
  options = _.extend({
    artifactIds: _.keys(versionMap),
    versionType: undefined,
    replaceReferences: false,
    ignoreParents: false,
    ignoreDependencyVersionedModules: false,
    silent: false
  }, options);
  let updatedProjects = [];
  _.each(projects, function (project) {

    let pom = project.pom;
    let artifactIds = options.artifactIds;

    let dirty = this._useCurrentVersions(project, pom, artifactIds, versionMap, options);
    if (!options.ignoreDependencyVersionedModules) {
      let relevantModules = project.definition.dependency_versioned_modules;
      if (relevantModules && relevantModules.length) {
        artifactIds = _.without(artifactIds, pom.getCanonicalArtifactId());
        _.each(pom.modules, module => {
          if (relevantModules.includes(module.dirname)) {
            dirty = this._useCurrentVersions(project, module, artifactIds, versionMap, options) || dirty;
          }
        });
      }
    }

    if (dirty) {
      updatedProjects.push(project);
    }
  }, this);
  return updatedProjects;
};

ChangesetBundle.prototype._checkoutAsRequested = function (projects, options, supportProjects, supportOptions, errorOnFailure) {
  let projectOptionPairs = [];
  let excludedProjectTags = this.getTagsForExcludedProjects();
  projectOptionPairs.push.apply(projectOptionPairs,
    this._checkoutAsRequestedHelper(projects, options, excludedProjectTags));
  projectOptionPairs.push.apply(projectOptionPairs,
    this._checkoutAsRequestedHelper(supportProjects, supportOptions, excludedProjectTags));
  this._checkoutEach(projectOptionPairs, errorOnFailure);
};

ChangesetBundle.prototype._checkoutAsRequestedHelper = function (projects, options, excludedProjectTags) {
  let projectOptionPairs = [];

  // Projects included in the changeset
  _.each(projects.included, project => {
    let checkout = options.checkout;
    if (!checkout) {
      checkout = [this.getChangesetBranchName()];
      if (options.allowMissingBranches) {
        checkout.push(Projects.GitTarget.TAG_PREFIX + this.changeset.getReleaseTag());
        if (project instanceof SupportProject && this.changeset.onTrunk()) {
          checkout.push(this.changeset.getTrunkMainlineBranchNameForSupportProjects());
        }
        checkout.push(Projects.GitTarget.MAINLINE);
      }
    }

    projectOptionPairs.push({
      project: project,
      options: {
        checkout: checkout,
        workDir: options.workDir,
        forceCheckout: options.forceCheckout
      }
    })
  }, this);

  // Projects not in included in the changeset
  if (options.checkoutExcluded) {
    _.each(projects.excluded, project => {
      let checkout = [];
      let buildReleaseTag = excludedProjectTags[project.dirname];
      if (buildReleaseTag) {
        checkout.push(Projects.GitTarget.TAG_PREFIX + buildReleaseTag);
      }
      checkout.push(Projects.GitTarget.TAG_PREFIX + this.changeset.getReleaseTag());
      if (this.changeset.onTrunk() && project instanceof SupportProject) {
        checkout.push(this.changeset.getTrunkMainlineBranchNameForSupportProjects());
      } else {
        checkout.push(Projects.GitTarget.MAINLINE);
      }

      projectOptionPairs.push({
        project: project,
        options: {
          checkout: checkout,
          workDir: options.workDir,
          forceCheckout: options.forceCheckout
        }
      });
    }, this);
  }

  return projectOptionPairs;
};

ChangesetBundle.prototype._checkoutEach = function (projectOptionPairs, errorOnFailure) {
  /** Fork to {@link CheckoutFork} */
  const result = ForkedProjectOp.run('checkout.js', projectOptionPairs);
  if (!result.success) {
    throw new BuildError(errorOnFailure || `Failed to checkout projects; review error(s) above and ${config.logFile.path} for details`);
  }
};

ChangesetBundle.prototype._conditionalPush = function (list, project, statuses) {
  _.each(util.asArray(statuses), status => {
    if (this.getProjectStatus(project) === status) {
      list.push(project);
    }
  }, this);
}

ChangesetBundle.prototype._determineValidProjects = function () {
  this.projects.all.forEach(project => this._conditionalPush(this.projects.valid, project,
    [Projects.Status.PENDING, Projects.Status.ACTIVE]));
  this.supportProjects.all.forEach(project => this._conditionalPush(this.supportProjects.valid, project,
    [Projects.Status.PENDING, Projects.Status.ACTIVE]));
}

ChangesetBundle.prototype._determineProjects = function (options) {
  options = _.extend({
    existingChangeset: true,
    addAutoInclude: false,
    trackingIdMatch: true,
    includeList: undefined,
    excludeList: undefined
  }, options);

  // Include
  let onlyExcluding = util.isEmpty(options.includeList) && util.isNotEmpty(
    options.excludeList) && !options.existingChangeset;
  let includeAll = (util.isNotEmpty(options.includeList) && options.includeList[0] === 'all');
  if (onlyExcluding || includeAll) {
    this.projects.included = this.projects.valid;
    this.supportProjects.included = this.supportProjects.valid;
  } else {
    this._validateNamesList(options.includeList, this.projects.all, this.supportProjects.all);
    this._includeProjects(this.projects, options.addAutoInclude, options.includeList, project => {
      if (!options.trackingIdMatch) return false;

      // The 'VCTRS-12345' part if the version of this project as specified in the changeset file has one
      let changesetVersion = this.changeset.getVersion(project.getPrimaryVersionsKey());
      let changesetVersionTrackingId = changesetVersion ? changesetVersion.getTrackingId() : undefined;
      return (changesetVersionTrackingId && changesetVersionTrackingId === config.changesetId.trackingId);
    });
    this._includeProjects(this.supportProjects, options.addAutoInclude, options.includeList, function (project) {
      return options.trackingIdMatch && !!this.changeset.getValue(project.getInclusionKey());
    });
  }

  // Exclude
  if (util.isNotEmpty(options.excludeList)) {
    this._validateNamesList(options.excludeList, this.projects.all, this.supportProjects.all);
    this.projects.included = this._excludeProjects(this.projects, options);
    this.supportProjects.included = this._excludeProjects(this.supportProjects, options);
  }
};

ChangesetBundle.prototype._excludeProjects = function (projects, options) {
  let includeProjects = [];
  _.each(projects.included, function (project) {
    if (_.indexOf(options.excludeList, project.dirname) > -1) {
      projects.excluded.push(project);
    } else {
      includeProjects.push(project);
    }
  }, this);
  return includeProjects;
};

ChangesetBundle.prototype._getIncludedProjectsByName = function (list, projects) {
  let result = [];
  if (util.isNotEmpty(list) && list[0] === 'all') {
    result = projects;
  } else {
    this._validateNamesList(list, this.projects.included, this.supportProjects.included);
    _.each(projects, function (project) {
      if (_.indexOf(list, project.dirname) > -1) {
        result.push(project);
      }
    }, this);
  }
  return result;
};

/**
 * @return {TrunkConfig}
 * @private
 */
ChangesetBundle.prototype._getTrunkConfig = function () {
  const trunkName = this.changeset.getTrunk();
  if (!trunkName) {
    throw new BuildError('Cannot retrieve trunk config when changeset is not on a trunk');
  }
  const trunkConfigs = this.configFile.getValue('trunks');
  const trunkConfig = _.find(trunkConfigs, candidate => candidate.name === trunkName);
  if (!trunkConfig) {
    throw new BuildError(sprintf('Config file is missing value for \'trunks.%s\'', trunkName));
  }
  return trunkConfig;
}

ChangesetBundle.prototype._graduateProjects = function (field, projects, status) {
  let ourTrunk = this.changeset.getTrunk() || Trunks.MASTER;
  let definitions = this.configFile.getValue(field);
  let trunkDefinitions = this.configFile.getValue('trunks');
  _.each(definitions, definition => {
    let graduate =_.find(projects, project => project.getRepoPath() === definition.repo_path);
    if (!graduate) return;
    graduate.setStatus(ourTrunk, status);
    if (ourTrunk === Trunks.MASTER) {
      definition.status = status;
    } else {
      let trunkDefinition = _.find(trunkDefinitions, candidate => candidate.name === ourTrunk);
      if (!trunkDefinition) {
        throw new BuildError(sprintf('Trunk %s is not defined!', ourTrunk));
      }
      let statusMap = trunkDefinition.status || {};
      statusMap[graduate.dirname] = status;
      trunkDefinition.status = statusMap;
    }
  }, this);
  this.configFile.setValue(field, definitions);
  this.configFile.setValue('trunks', trunkDefinitions);
}

ChangesetBundle.prototype._includeProjects = function (projects, addAutoInclude, includeList, inclusionCallback) {
  _.each(projects.all, function (project) {
    if (_.indexOf(includeList, project.dirname) > -1) {
      projects.included.push(project);
    } else {
      if (this.getProjectStatus(project) === Projects.Status.IGNORED) return;
      if ((addAutoInclude && project.isAutoInclude()) || inclusionCallback.call(this, project)) {
        projects.included.push(project);
      } else {
        this._conditionalPush(projects.excluded, project, Projects.Status.ACTIVE);
      }
    }
  }, this);
};

ChangesetBundle.prototype._incrementTrunkVersion = function (trunkConfig, trunkName, oldVersion) {
  let version = oldVersion.clone();
  version.setTrunk(trunkName, version.getTrunkVersion() ? version.getTrunkVersion() + 1 : 1);
  trunkConfig.next_version = version.toString();
  this.configFile.save();
  return version;
};

ChangesetBundle.prototype._setupForAlias = function (options) {
  options = _.extend(options, {
    checkoutExcluded: true
  })
  let alias = options.alias;
  let aliases = [];
  if (alias === ChangesetFile.Alias.HOTFIX) {
    aliases = [ChangesetFile.Alias.HOTFIX, ChangesetFile.Alias.PRODUCTION];
  } else if (alias === ChangesetFile.Alias.PRODUCTION) {
    aliases = ChangesetFile.Alias.PRODUCTION;
  } else if (alias === ChangesetFile.Alias.RELEASED) {
    aliases = ChangesetFile.Alias.RELEASED;
  } else {
    let trunk = this.trunks[alias];
    if (!trunk) {
      throw new BuildError(sprintf('Not a trunk: %s', alias));
    }
    aliases = [this.trunks[alias].getAlias(), ChangesetFile.Alias.RELEASED];
  }

  this.changeset.loadFromFirstValidAlias(aliases, this.projects.all);
  this._determineValidProjects();
  _.each(this.projects.valid,
    project => this._conditionalPush(this.projects.excluded, project, Projects.Status.ACTIVE));
  _.each(this.supportProjects.valid,
    project => this._conditionalPush(this.supportProjects.excluded, project, Projects.Status.ACTIVE));
};

ChangesetBundle.prototype._useCurrentVersions = function (project, pom, artifactIds, versionMap, options) {
  let dirty = false;
  _.each(artifactIds, function (artifactId) {
    _.each(pom.findDependencies(artifactId, options), function (dep) {
      if (dep) {
        if (dep.isVersionAPropertyReference()) {
          return;
        }
        let specVersion = dep.getVersion();
        let currVersion = versionMap[dep.getCanonicalArtifactId()];
        if (specVersion && currVersion && (currVersion !== specVersion)) {
          if (!options.versionType || (options.versionType === VersionEx.RANGE &&
            (specVersion.startsWith('[') || specVersion.startsWith('(')))) {
            if (!options.silent) {
              util.startBullet(project.dirname.plain);
              if (pom !== project.pom) {
                util.continueBullet(pom.dirname.plain);
              }
              util.continueBullet(dep.toString().plain);
              if (currVersion !== VersionEx.RETIRED) {
                util.endBullet(sprintf('From %s to %s'.trivial, specVersion, currVersion.good));
              } else {
                util.continueBullet(sprintf('From %s to %s'.trivial, specVersion, currVersion.bad));
                util.endBullet('Manually remove this dependency!'.bad);
              }
            }
            dep.setVersion(currVersion);
            dirty = true;
          }
        }
      }
    });
  });
  return dirty;
}

ChangesetBundle.prototype._validateNamesList = function (list, projects, supportProjects) {
  _.each(list, name => {
    let project = _.find(projects, project => project.isCalled(name));
    if (!project) {
      project = _.find(supportProjects, project => project.isCalled(name));
    }
    if (!project || this.getProjectStatus(project) === Projects.Status.IGNORED) {
      throw new BuildError(sprintf("Project is not valid here: %s", name));
    }
    if (this.getProjectStatus(project) === Projects.Status.RETIRED) {
      throw new BuildError(sprintf("Retired project: %s", name));
    }
  }, this);
}

module.exports = ChangesetBundle;
