const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const rflowUtil = require('../../../common/rflow-util');
const {ShipmentFile} = require('../../../classes/ShipmentFile');
const util = require('../../../common/util');
const GitRepository = require('../../../classes/GitRepository');

module.exports['prepare-shipment'] = {
  summary: 'Prepare a shipment for possible deployment to production',
  requiredArguments: ['shipment-id', 'include'],
  optionalArguments: ['dry-run', 'shipment-changeset'],
  requiredSettings: [],
  optionalSettings: [],
  callback: function (bundle, goal) {
    if (util.fileExists(bundle.shipment.getShipmentPath(config.shipmentId))) {
      throw new BuildError(sprintf('Shipment %s already exists.', config._all['shipment-id']));
    }

    let expectedTypes = bundle.getChangesetTypes();
    expectedTypes.sort();
    let includes = {};
    let includedTypes = [];
    let highestAliasIndex = -1;
    _.each(config._all.include, function (include) {
      let parts = include.split(':');
      if (parts.length !== 2) {
        throw new BuildError(sprintf('Invalid changeset alias %s', parts[0]));
      }
      if (!expectedTypes.includes(parts[0])) {
        throw new BuildError(sprintf('Unexpected changeset type %s; allowed types are %s', parts[0], expectedTypes));
      }

      let trunkAliases = bundle.getTrunkAliases(parts[0]);
      let aliasIndex = ShipmentFile.AllowedChangesetAliases.indexOf(parts[1]);
      if (aliasIndex === -1 && !trunkAliases.includes(parts[1])) {
        throw new BuildError(`Unexpected alias ${parts[1]} for one or more bundles. Please enter a valid alias.`);
      } else if (aliasIndex > highestAliasIndex) {
        highestAliasIndex = aliasIndex;
      }
        includes[parts[0]] = parts[1];
        includedTypes.push(parts[0]);  
    });
    includedTypes.sort();
    if (!_.isEqual(includedTypes, expectedTypes)) {
      throw new BuildError(
        sprintf('Expected changeset aliases for %s; you specified %s', expectedTypes, includedTypes));
    }

    bundle.initSupportProjects();

    // base YAML
    util.announce('Adding keys from base'.plain);
    _.each(Object.keys(bundle.baseVersions), function (key) {
      let value = bundle.baseVersions[key];
      if (value) {
        util.startBullet(key.trivial);
        bundle.shipment.setValue(key, value);
        util.endBullet(value.trivial);
      }
    });

    let supportProjectInclusionKeys = rflowUtil.getSupportProjectInclusionKeys(bundle.supportProjects);
    
    // changeset alias YAMLs
    let changesets = {};
    _.each(Object.keys(bundle.changesets), function (bundleName) {
      util.announce(sprintf('Adding keys from %s:%s'.plain, bundleName, includes[bundleName]));
      bundle.getMetadata().changesets[bundleName] = {
        alias: includes[bundleName]
      };
      let changeset = ChangesetFile.create(bundle.versionsRepo, bundleName).loadFromAliasQuietly(includes[bundleName]);
      if (!changeset.data) {
        throw new BuildError(sprintf('Manifest is missing for %s:%s', bundleName, includes[bundleName]));
      }
      changesets[bundleName] = changeset;

      _.each(Object.keys(changeset.data), function (key) {
        if (ShipmentFile.Properties.CONSTITUENT.includes(key)) {
          let value = changeset.getValue(key);
          let isObject = typeof value === 'object' && value !== null;
          if (!isObject) util.startBullet(key.useful);
          bundle.getMetadata().changesets[bundleName][key] = value;
          if (!isObject) util.endBullet(value ? value.useful : undefined);
        } else if (supportProjectInclusionKeys.includes(key)) {
          util.startBullet(key.trivial);
          util.endBullet('Ignored'.trivial);
        } else if (!ShipmentFile.Properties.EXCLUDED.includes(key)) {
          let value = changeset.getValue(key);
          util.startBullet(key.plain);
          bundle.shipment.setValue(key, value);
          util.endBullet(value.plain);
        }
      });
    });

    // TODO: this can probably be done with tags now that we have them

    util.announce('Identifying support project commit IDs'.plain);
    let highestAlias = ShipmentFile.AllowedChangesetAliases[highestAliasIndex];
    _.each(bundle.supportProjects, function (project) {
      util.startBullet(project.dirname.plain);
      let branchOrTag = undefined;
      switch (highestAlias) {
        case ChangesetFile.Alias.PRODUCTION:
          branchOrTag = {branch: project.definition.ops_mainline};
          break;
        case ChangesetFile.Alias.RELEASED:
          branchOrTag = {branch: project.definition.mainline};
          break;
        case ChangesetFile.Alias.HOTFIX:
          _.each(Object.keys(includes), function (bundleName) {
            let changeset = changesets[bundleName];

            // ensure correct branch name
            changeset.data.bundle_name = bundleName;
            
            if (!branchOrTag && changeset.data[project.definition.inclusion_key]) {
              branchOrTag = {branch: changeset.getHotfixSupportBranch()};
            }
          });
          if (!branchOrTag) {
            branchOrTag = {branch: project.definition.ops_mainline};
          }
          break;
        default:
          _.each(Object.keys(includes), function (bundleName) {
            let changeset = changesets[bundleName];
            changeset.data.bundle_name = bundleName; 

            let trunkBranch = changeset.getTrunkMainlineBranchNameForSupportProjects();

            // Check if the trunk branch exists
            if (trunkBranch && project.repo.doesBranchExistRemotely(trunkBranch)) {
              branchOrTag = {branch: trunkBranch};
            }
          });
  
          if (!branchOrTag) {
            branchOrTag = {branch: project.definition.mainline};
          }
          break;
      }
      
      util.continueBullet(branchOrTag.branch.plain || branchOrTag.tag.plain);
      let commitId = project.repo.getHeadCommitId(branchOrTag).substr(0, 7);
      bundle.getMetadata().commits[project.dirname] = {
        source: branchOrTag.branch || branchOrTag.tag,
        id: commitId
      };
      util.endBullet(commitId.plain);
    });

    bundle.shipment.saveAsShipment(config.shipmentId);

    util.announce('Updating source control'.plain);
    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.checkIn({
      message: bundle.invocation.getCommitMessage()
    });
    util.endBullet('Committed & pushed'.good);

    rflowUtil.documentChangesets(rflowUtil.auditShipment(bundle));
  }
};
