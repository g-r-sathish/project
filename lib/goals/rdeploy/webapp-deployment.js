//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;
const yaml = require('js-yaml');
const config = require('../../common/config');
const util = require('../../common/util');
const binUtil = require('../../common/bin-util');
const rdeployUtil = require('../../common/rdeploy-util');
const BuildError = require('../../classes/BuildError');
const Feed = require('../../classes/Feed');
const {VersionEx} = require('../../classes/VersionEx');
const {EnvironmentFile} = require('../../classes/models/EnvironmentFile');

exports['get-pipeline-status'] = {
  requiredSettings: ['azure_devops_token'],
  checkout: async (bundle, goal, params) => rdeployUtil.initDeploymentProjects(bundle, EnvironmentFile.SELECT_NEXT),
  callback: async (bundle, name, params) => {
    let projects = bundle.getDeploymentProjects();
    return rdeployUtil.waitForPipelinesToComplete(params.name, bundle);
  }
};

exports['run-pipelines'] = {
  requiredSettings: ['azure_devops_token'],
  checkout: async (bundle, goal, params) => rdeployUtil.initDeploymentProjects(bundle, EnvironmentFile.SELECT_NEXT),
  callback: async (bundle, name, params) => {
    let projects = bundle.getDeploymentProjects();
    switch (params.name) {
      case 'kappctl':
        await rdeployUtil.runKappctlPipeline(bundle, params.args);
        break;
      case 'deploy':
        await rdeployUtil.runKappctlPipeline(bundle, 'roll-out');
        break;
      case 'image':
        await rdeployUtil.runPipelines(params.name, bundle, projects, true);
        break;
      default:
        throw new BuildError(`Unsupported pipeline name: ${params.name}`);
    }
  }
};

exports['webapp-deployment'] = {
  requiredSettings: [
    'azure_devops_token',
    'azdo_git_username',
    'azdo_git_password',
    'github_token'
  ],

  checkout: async (bundle, goal, params) => {
    return rdeployUtil.initDeploymentProjects(bundle, EnvironmentFile.SELECT_NEXT);
  },

  callback: async (bundle, name, params) => {
    const {updatedProjects, rolloutRequest} = await stageDeployment(bundle, name, params);
    if (updatedProjects.length > 0) {
      if (bundle.isManualRollout) {
        util.bulletRow('Manual rollout:');
        console.log(yaml.dump({rollout: rolloutRequest.composeRequest()}))
      } else {
        bundle.saveRolloutRequest();
        if (!config._all['skip-deploy-pipelines']) {
          await rdeployUtil.runKappctlPipeline(bundle, 'roll-out');
        }
        util.bulletRow('Applied changes', 'Finished'.good)
      }
    }
  }
};

async function stageDeployment(bundle, name, params) {
  const rolloutRequest = bundle.rolloutRequest;
  rolloutRequest.loadDeploymentVersions(params);
  const updatedProjects = rolloutRequest.determineVersionUpdates();
  if (updatedProjects.length > 0) {
    util.subAnnounce('Ensuring artifacts exists'.plain);
    let feed = new Feed(config.azure.feeds.stay);
    let transferList = identifyMissingArtifacts(updatedProjects, feed, rolloutRequest.effectiveVersions);
    let reviewMessage = 'Review version changes';
    if (transferList.length > 0) {
      reviewMessage += ` (${transferList.length} artifacts will be transferred)`;
    }
    util.subAnnounce(reviewMessage.plain)
    binUtil.typeYesToContinue();
    uploadMissingArtifacts(feed, transferList);
    if (!config._all['skip-image-pipelines']) {
      await buildNecessaryImages(bundle, updatedProjects);
    }
  } else {
    util.bulletRow('Nothing has changed', 'Finished'.good)
  }
  return {updatedProjects, rolloutRequest};
}

async function buildNecessaryImages(bundle, updatedProjects) {
  let necessary = [];
  for (let project of updatedProjects) {
    let version = new VersionEx(project.getServiceVersion());
    //let currentVersion = project.currentVersion;
    //let newVersion = project.newVersion;
    if (
      !bundle.isDockerImagePublished(project) ||
      (version.isSnapshot() && project.alwaysDeploySnapshots() && !config._all['skip-snapshot-transfer']) ||
      config._all['run-image-pipelines'] || 
      ((config._all['env'] === 'stay-prod-westus' || config._all['env'] === 'stay-prod-westeu' || config._all['env'] === 'mi-prod-01-eastus') && !bundle.isImagePromoted(project))
    ) {
      necessary.push(project);
    }
  }

  if (necessary.length > 0) {
    await rdeployUtil.runPipelines('image', bundle, necessary, true);
  } else {
    util.subAnnounce('All necessary images exist'.plain);
  }
}



function identifyMissingArtifacts(projects, feed, effectiveVersions) {
  let transferList = [];
  for (var project of projects) {
    for (var artifact of project.getArtifacts(effectiveVersions)) {
      util.startBullet(project.getName().plain);
      util.continueBullet(artifact.getDisplayName().plain);
      if (feed.doesAzureArtifactExist(artifact)) {
        if (artifact.isMaintainedByGithubPackage()) {
          artifact.existsInAzure = true;
          if (artifact.isSnapshot()) {
            util.continueBullet('Exists'.good);
            if (config._all['skip-snapshot-transfer']) {
              util.endBullet('Skipping snapshot transfer'.warn);
            } else {
              transferList.push(artifact);
              util.endBullet('Always transfer'.bad);
            }
          } else {
            util.endBullet('Exists'.good);
          }
        } else {
          util.endBullet('Exists'.good);
        }
      } else {
        if (artifact.isMaintainedByGithubPackage()) {
          util.endBullet('Missing'.bad);
          transferList.push(artifact);
        } else {
          util.endBullet('Missing'.bad);
          throw new BuildError(`Missing artifact for: ${project.getName()}`)
        }
      }
    }
  }
  return transferList;
}

function uploadMissingArtifacts(feed, transferList) {
  let missingCount = 0;
  try {
    for (var artifact of transferList) {
      util.startBullet(artifact.getDisplayName().plain);
      let isGitHubPackageExist = feed.doesGithubPackageExist(artifact);
      if (isGitHubPackageExist) {
        util.continueBullet('GitHubPackage -> Azure'.bad);  
        let tempFile = artifact.downloadFromGithubUsingMaven();
        if (!tempFile) {
          util.endBullet('Download failed'.bad);
          missingCount++;
        } else {
          if (artifact.uploadToAzure(tempFile)) {
            util.endBullet('Uploaded'.good);
          } else {
            util.endBullet('Upload failed'.bad);
            missingCount++;
          }
        }
      } else {
        util.endBullet(`Missing from GitHubPackage`.bad);
        if (!artifact.existsInAzure) {
          missingCount++;
        }
      }
    }
  } finally {
    feed.purgeLocalRepositoryArtifacts();
  }
  if (missingCount > 0) {
    throw new BuildError(`Cannot continue, there are ${missingCount} missing artifacts`);
  }
}
