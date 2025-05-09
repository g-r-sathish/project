//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('underscore');
const assert = require('assert').strict;
const config = require('../common/config');
const util = require('../common/util');
const BuildError = require('./BuildError');
const Path = require('path');
const {VersionEx} = require('./VersionEx');
const {EnvironmentFile} = require('./models/EnvironmentFile');
const {ChangesetFile} = require('./ChangesetFile');
const {ShipmentFile} = require("./ShipmentFile");
const DeploymentProject = require("./DeploymentProject");

const BRANCH_SOURCE_KEY = 'config_repo_branch_source';
const DOCKER_TAG_SUFFIX_KEY = 'docker_tag_suffix';

class RolloutRequest {
  constructor(bundle) {
    this.bundle = bundle;
    this.environmentFile = bundle.environmentFile;
    this.usesManagedBranches = this.environmentFile.get(EnvironmentFile.USE_MANAGED_CONFIG_BRANCHES);
    this.effectiveVersions = {};
    this.versionData = {};
  }

  composeRequest() {
    const namesByType = (type) => {
      const projects = this.bundle.getDeploymentProjectsByType(type, {markedForDeployment: true});
      return _.map(projects, (project) => project.getAppName());
    }

    const data = {
      jobs: namesByType(DeploymentProject.TYPE_JOB),
      services: namesByType(DeploymentProject.TYPE_SERVICE),
      versions: util.overlay({}, this.effectiveVersions)
    };
    data.versions[BRANCH_SOURCE_KEY] = this.getConfigSource();

    if (config._all['docker-tag-suffix']) {
      for (const name of data.services) {
        const project = this.bundle.getDeploymentProjectByAppName(name);
        const dockerTagSuffix = project.getDockerTagSuffix();
        if (dockerTagSuffix) {
          let varsToUpdate = project.definition.pipeline_vars;
          for (let varName in varsToUpdate) {
            let versionKey = varsToUpdate[varName];
            if (data.versions[versionKey]) {
              data.versions[versionKey] += dockerTagSuffix;
            }
          }
        }
      }
    }

    return data;
  }

  /**
   * Source branch for config-repo. First valid set takes precedence.
   * @param marker Git commit-id, branch, or tag
   * @param hint Origin of marker definition
   * @returns {undefined|String} The marker when it is set, undefined when it is ignored
   */
  setConfigSource(marker, hint) {
    assert.ok(hint);
    if (!marker) return;
    if (!this.configSource) {
      this.configSource = marker;
      this.versionData[BRANCH_SOURCE_KEY] = marker;
      util.bulletRow(BRANCH_SOURCE_KEY, hint.trivial, marker.bold, 'Set'.good);
      return marker;
    } else {
      util.bulletRow(BRANCH_SOURCE_KEY, hint.trivial, marker.trivial, 'Ignored'.warn);
    }
  }

  getConfigSource() {
    return this.configSource;
  }

  loadDeploymentVersions(params) {
    util.subAnnounce('Reading deployment versions'.plain);

    if (config._all['config-repo-branch']) {
      this.setConfigSource(config._all['config-repo-branch'], 'command-line parameter')
    }

    let changesets = {};
    for (let changeset of this.bundle.validChangesets) {
      // Default to released versions (for bundles not specified)
      changesets[changeset] = ChangesetFile.Alias.RELEASED;
    }
    params.changesets = _.extend(changesets, params.changesets);

    if (params.shipments) {
      let key = _.first(Object.keys(params.shipments));
      let shipmentName = params.shipments[key];
      let displayName = `${key}:${shipmentName}`;

      util.startBullet(displayName);
      let shipmentFile = new ShipmentFile(this.bundle.versionsRepo, key, shipmentName).load();
      util.continueBullet(`${shipmentFile.filePath}`.trivial);
      _.extend(this.versionData, shipmentFile.getVersionProperties());
      util.endBullet('Loaded'.good);

      let configRepoCommitId = _.get(shipmentFile.data, ['shipment', 'commits', 'config-repo', 'id'], 'master');
      this.setConfigSource(configRepoCommitId, displayName);
    } else if (params.changesets) {
      this.includeYaml('base', this.versionData, this.bundle.verifyBaseYaml());

      for (let key of Object.keys(params.changesets)) {
        let changesetName = params.changesets[key];
        let displayName = `${key}:${changesetName}`;
        util.startBullet(displayName);
        let changesetFile = ChangesetFile.create(this.bundle.versionsRepo, key).load(changesetName);
        util.continueBullet(`${changesetFile.filePath}`.trivial);
        _.extend(this.versionData, changesetFile.getVersionProperties());
        util.endBullet('Loaded'.good);

        if (changesetFile.isChangesetFile() && changesetFile.getValue('includes_config_repo')) {
          this.setConfigSource(changesetFile.getChangesetBranchName(), displayName);
        } else {
          if (!this.getConfigSource()) {
            let tag = `release-${key}-${changesetFile.getBundleVersion()}`;
            this.setConfigSource(tag, 'implied tag from bundle version')
          }
        }
      }
    }

    return this.versionData;
  }

  determineVersionUpdates() {
    util.subAnnounce('Detecting version changes'.plain);
    let updatedProjects = [];
    let projects = this.bundle.getDeploymentProjects();
    let currentVersions = this.bundle.getEnvironmentVersions();
    for (let project of projects) {
      let varsToUpdate = project.definition.pipeline_vars;
      let hasUpdates = false;
      for (let varName in varsToUpdate) {
        let versionKey = varsToUpdate[varName];
        let newValue = this.versionData[versionKey];
        let currentValue = currentVersions[versionKey] || '0.0.0';
        let finalValue = currentValue;
        let currentVersion = new VersionEx(currentValue);
        let newVersion = new VersionEx(newValue);
        project.currentVersion = currentVersion;
        project.newVersion = newVersion;
        util.startBullet(project.getName().plain);
        util.continueBullet(`${varName} (${versionKey})`.useful);
        if (currentVersion.equals(newVersion)) {
          if (newVersion.isSnapshot() && project.alwaysDeploySnapshots()) {
            finalValue = newValue;
            hasUpdates = true;
            util.continueBullet(finalValue.good);
            util.endBullet("Always deploy".good);
          } else if (config._all.force) {
            finalValue = newValue;
            hasUpdates = true;
            util.continueBullet(finalValue.good);
            util.endBullet("Forcing".good);
          } else {
            util.continueBullet(finalValue.plain);
            util.endBullet('Unchanged'.plain);
          }
        } else if (
          currentVersion.getTrunkName() === newVersion.getTrunkName() &&
          currentVersion.isGreaterThan(newVersion)) {
          util.continueBullet(currentValue.trivial);
          if (config._all['no-downgrade']) {
            util.endBullet(`${newValue} (Skipping, no downgrade)`.warn);
          } else {
            finalValue = newValue;
            hasUpdates = true;
            util.endBullet(finalValue.bad);
          }
        } else {
          finalValue = newValue;
          hasUpdates = true;
          util.continueBullet(currentValue.trivial);
          util.endBullet(finalValue.good);
        }
        this.effectiveVersions[versionKey] = finalValue;
      }
      if (hasUpdates) {
        project.resolvePipelineVars(this.effectiveVersions);
        project.markForDeployment();
        updatedProjects.push(project);
      }
    }
    return updatedProjects;
  }

  includeYaml(id, data, sourceFile) {
    let source = Path.join(this.bundle.versionsRepo.getRepoDir(), sourceFile);
    try {
      util.startBullet(id.plain);
      util.continueBullet(source.trivial);
      _.extend(data, util.readYAML(source));
      util.endBullet('Loaded'.good);
    } catch (ex) {
      throw new BuildError(sprintf('Could not load `%s`: %s', source, ex.toString()));
    }
  }
}


module.exports.RolloutRequest = RolloutRequest;