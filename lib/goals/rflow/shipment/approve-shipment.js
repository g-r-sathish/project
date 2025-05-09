const _ = require('underscore');
const mustache = require('mustache');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const config = require('../../../common/config');
const {Projects} = require('../../../classes/Constants');
const reviewUtil = require('../../../common/review-util');
const rflowUtil = require('../../../common/rflow-util');
const {ShipmentFile} = require('../../../classes/ShipmentFile');
const util = require('../../../common/util');
const {VersionEx} = require('../../../classes/VersionEx');

// override escape function to disable HTML escaping
mustache.escape = (value) => value;

module.exports['approve-shipment'] = {
  summary: 'Approves a shipment for deployment to production',
  requiredArguments: ['shipment-id'],
  optionalArguments: ['reviewers', 'dry-run'],
  requiredSettings: [],
  optionalSettings: ['reviewers'],
  callback: function (bundle, goal) {

    function getCommit(project) {
      let commit = undefined;
      if (bundle.getMetadata().commits) {
        commit = bundle.getMetadata().commits[project.dirname];
      }
      if (!commit) {
        let commitId = undefined;
        if (bundle.getMetadata().commitIds) {
          commitId = bundle.getMetadata().commitIds[project.dirname];
        }
        if (commitId) {
          commit = {
            source: project.getMainlineBranchName(),
            id: commitId
          }
        }
      }
      return commit;
    }
    
    if (!util.fileExists(bundle.shipment.getShipmentPath(config.shipmentId))) {
      throw new BuildError(sprintf('Shipment %s does not exist', config._all['shipment-id']));
    } 
    
    bundle.initSupportProjects();
    
    util.announce(sprintf('Loading keys from %s'.plain, config._all['shipment-id']));
    bundle.initShipment(config.shipmentId);
    const aliaschangesets = bundle.shipment.data.shipment.changesets;
    
    // Extract alias from each changeset bundle
    Object.keys(aliaschangesets).forEach(aliaschangesetKey => {
     const aliaschangeset = aliaschangesets[aliaschangesetKey];
     if (!['released', 'hotfix', 'production'].includes(aliaschangeset.alias)) {
      throw new Error('Shipment created with trunk alias cannot be approved');
    }
  });

    _.each(Object.keys(bundle.shipment.data), function (key) {
      if (ShipmentFile.Properties.METADATA.includes(key)) {
        util.startBullet(key.useful);
        util.endBullet(JSON.stringify(bundle.shipment.data[key], null, 2).useful);
      } else {
        util.startBullet(key.plain);
        util.endBullet(bundle.shipment.data[key].plain);
      }
    });

    util.announce('Writing manifests'.plain);
    let approvedFile = bundle.shipment.saveAsAlias(ShipmentFile.Alias.APPROVED);
    util.startBullet(approvedFile.getFilename().plain);
    util.endBullet('Done'.good);
    let opsFile = bundle.shipment.saveForOps(ShipmentFile.OpsEnvironment.PROD);
    util.startBullet(opsFile.getFilename().plain);
    util.endBullet('Done'.good);

    // TODO: FORK THIS
    util.announce('Checking out support projects'.plain);
    _.each(bundle.supportProjects, function (project) {
      util.startBullet(project.dirname.plain);
      let commit = getCommit(project);
      if (commit) {
        if (commit.source) {
          project.repo.fetch(commit.source);
        }
        project.repo.checkoutDetached(commit.id);
        util.endBullet(util.repoStatusText(Projects.GitTarget.COMMIT_PREFIX + commit.id, config.workDir, project.repo.clonePath));
      } else {
        util.endBullet('Skipped'.warn);
      }
    });

    let releaseTag = bundle.shipment.getReleaseTag();
    let releaseMessage = bundle.invocation.getCommitMessage(releaseTag);
    util.announce(sprintf('Applying tag %s'.plain, releaseTag));
    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.addAndCommit(bundle.invocation.getCommitMessage());
    bundle.versionsRepo.tag(releaseTag, releaseMessage);
    util.endBullet('Tagged'.good);
    _.each(bundle.supportProjects, function (project) {
      let commit = getCommit(project);
      if (commit) {
        util.startBullet(project.dirname.plain);
        project.repo.tag(releaseTag, releaseMessage);
        util.endBullet('Tagged'.good);
      }
    });

    util.announce(sprintf('Updating source control'.plain, releaseTag));
    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.pushWithTags({retryWithPull: true});
    util.endBullet('Committed & pushed'.good);

    // TODO: FORK THIS
    _.each(bundle.supportProjects, function (project) {
      let commit = getCommit(project);
      if (commit) {
        util.startBullet(project.dirname.plain);
        project.repo.pushTagsFromDetached({retryWithPull: true});
        util.endBullet('Pushed'.good);
      }
    });

    let changesets = rflowUtil.auditShipment(bundle);

    let deployedVersions = [];
    let filter = new RegExp(config.deployed_versions_filter, "i");
    _.each(Object.keys(bundle.shipment.data), function (key) {
      if (ShipmentFile.Properties.METADATA.includes(key)) return;
      if (!key.match(filter)) return;
      let previous = new VersionEx(bundle.productionFile.data[key]);
      let current = new VersionEx(bundle.shipment.data[key]);
      if (current.compareTo(previous) !== 0) {
        deployedVersions.push({
          key: key,
          version: current.toString()
        });
      }
    });

    let template = util.readFile(path.join(process.env.NODE_BASE_DIRECTORY, 'res', 'deploy-template.txt'));
    let model = {
      releaseTag: releaseTag,
      deployedVersion: deployedVersions
    };
    let deployText = mustache.render(template, model);

    util.announce('Generating JIRA text for deployment ticket'.plain);
    util.println('Copy/paste the following block into the deployment JIRA ticket and resolve all ' + '<TBD>'.bold + ' occurrences:');
    util.println(deployText.trivial.italic);

    let updatedVersions = [];
    if (config.updated_versions_notes) {
      let versionKeys = [];
      _.each(Object.keys(config.updated_versions_notes), function (version) {
        versionKeys.push(version);
      });
      _.each(Object.keys(bundle.shipment.data), function (key) {
        if (ShipmentFile.Properties.METADATA.includes(key)) return;
        if (versionKeys.indexOf(key) === -1) return;
        let previous = new VersionEx(bundle.productionFile.data[key]);
        let current = new VersionEx(bundle.shipment.data[key]);
        if (current.compareTo(previous) !== 0) {
          updatedVersions.push({
            key: key,
            version: current.toString(),
            note: config.updated_versions_notes[key]
          })
        }
      });
    }

    rflowUtil.documentChangesets(changesets);

    if (updatedVersions.length > 0) {
      util.announce('Noteworthy'.warn);
      _.each(updatedVersions, function (update) {
        util.startBullet(update.key.useful);
        util.continueBullet(update.version.useful);
        util.endBullet(update.note.warn);
      });
    }
  }
};
