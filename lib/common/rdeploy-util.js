const _ = require('underscore');

const assert = require('assert').strict;
const BuildError = require('../classes/BuildError');
const config = require('./config');
const util = require('./util');
const binUtil = require('./bin-util');
const BuildState = require('../classes/BuildState');
const {EnvironmentFile} = require('../classes/models/EnvironmentFile');
const releasePipe = require('./release-pipe');

async function initDeploymentProjects(bundle, direction) {
  util.subAnnounce('Initializing projects'.plain)
  if (config._all['skip-testpool'] && direction === EnvironmentFile.SELECT_NEXT) {
    util.subAnnounce('The option --skip-testpool has been supplied, do you really want to target the production subset?'.bad)
    binUtil.typeYesToContinue();
    direction = EnvironmentFile.SELECT_PRODUCTION;
  }
  bundle.init(config._all.only, config._all.skip, direction);
}

function ensureApproval(bundle) {
  let env = bundle.getEnv();
  if (env.isModerated()) {
    util.subAnnounce('This deployment is moderated, would you like to continue?'.plain);
    binUtil.typeYesToContinue();
    let action = 'deploy';
    let subject = bundle.getEnvironmentName();
    let channel = env.getApprovalChannel();
    let approvalCode = env.establishApprovalGrant();
    releasePipe.ensureApproval(action, subject, channel, approvalCode);
  }
}

/**
 * Trigger deployment pipeline
 * @param bundle
 * @param args kappctl arguments
 */
async function runKappctlPipeline(bundle, args) {
  assert.ok(args, 'No arguments provided');
  return runGenericPipeline(bundle, 'kappctl', {args});
}

async function runPipelines(pipelineType, bundle, projects, bWaitUntilComplete=false) {
  util.subAnnounce(`Running ${pipelineType} pipelines`.plain);
  for (var project of projects) {
    let projectName = project.getName();
    util.startBullet(projectName.plain);
    try {
      let buildState = project.getBuild(pipelineType);
      await buildState.run();
      if (buildState.parameters.serviceVersion) {
        util.continueBullet(buildState.parameters.serviceVersion.plain);
      }
      util.continueBullet(buildState.webUrl.plain);
      util.endBullet(buildState.hasCompleted() ? 'Error'.bad : 'Started');
      bundle.setBuildState(projectName, pipelineType, buildState);
    } catch (ex) {
      if (ex instanceof BuildState.BuildNotFoundError) {
        util.endBullet(`Skipping (project does not specify a pipeline for: ${pipelineType})`.plain.italic)
      } else {
        throw ex;
      }
    }
  }
  bundle.saveBuildStates();
  if (bWaitUntilComplete) {
    await waitForPipelinesToComplete(pipelineType, bundle);
  }
}

async function runGenericPipeline(bundle, pipelineName, parameterValues) {
  ensureApproval(bundle);
  let pipelineType = "generic";
  let buildName = 'generic-' + Math.random().toString(10).substr(2, 4);
  let buildState = await bundle.runPipeline(pipelineName, buildName, parameterValues);
  bundle.setBuildState(buildName, pipelineType, buildState);
  util.bulletRow(
    'Pipeline'.plain,
    buildState.webUrl.plain,
    buildState.hasCompleted() ? 'Error'.bad : 'Started'.plain
  );
  bundle.saveBuildStates();
  if (buildState.hasCompleted()) {
    throw new BuildError(`Failed to launch pipeline: ${buildName}`);
  }
  return waitForPipelinesToComplete(pipelineType, bundle);
}

async function waitForPipelinesToComplete(pipelineType, bundle) {
  let failures = 0;
  let remaining = bundle.getRemainingBuildStates(pipelineType);
  util.subAnnounce(`Waiting for ${remaining.length} ${pipelineType} pipelines to complete`.plain);
  let start = new Date();
  while (remaining.length) {
    for (let i = 0; i < remaining.length; i++) {
      let elapsed = util.elapsedTime(start);
      util.updateWaitCursor(`Elapsed time: ${elapsed}`);
      let buildState = remaining[i];
      if (!buildState.hasCompleted()) {
        await buildState.refresh();
      }
      if (buildState.hasCompleted()) {
        util.clearWaitCursor();
        remaining.splice(i--, 1);
        if (pipelineType === 'image' && buildState.hasSucceeded()) {
          let project = bundle.getDeploymentProjectByName(buildState.projectName)
          bundle.markDockerImageAsPublished(project);
          bundle.markImageAsPromoted(project);
        }
        
        util.startBullet(`Build completed (${elapsed})`.plain);
        util.continueBullet(buildState.projectName.plain);
        if (buildState.parameters.serviceVersion) {
          util.continueBullet(buildState.parameters.serviceVersion.plain);
        }
        util.endBullet(buildState.hasSucceeded() ? buildState.result.good : buildState.result.bad);
        if (buildState.hasFailed()) {
          failures++;
        }
        bundle.saveBuildStates();
      }
    }
  }
  util.clearWaitCursor();
  if (pipelineType === 'image' && !(config._all['env'] === 'stay-prod-westus' || config._all['env'] === 'stay-prod-westeu')) {
    saveRegistryIndex(bundle);
  }
  if (pipelineType === 'image' && (config._all['env'] === 'stay-prod-westus' || config._all['env'] === 'stay-prod-westeu' || config._all['env'] === 'mi-prod-01-eastus')) {
    saveRegistryIndex(bundle);
    savePromoteRegistryIndex(bundle);
  }
  if (failures > 0) {
    throw new BuildError(`${pipelineType} pipeline failures: ${failures}`);
  }  
}

function saveRegistryIndex(bundle) {
  util.startBullet('Saving docker registry index'.plain);
  if (bundle.saveRegistryIndex()) {
    util.continueBullet(bundle.getRegistryIndexFilename().trivial);
    let commitMessage = `[${config.rName}] ${bundle.currentGoal} - save-docker-registry-index`;
    let pushed = bundle.versionsRepo.checkIn({message: commitMessage});
    util.endBullet(pushed ? 'Pushed'.good : 'No changes'.warn);
  } else {
    util.endBullet('No changes'.warn);
  }
}


function savePromoteRegistryIndex(bundle) {
  util.startBullet('Saving promote registry index'.plain);
  if (bundle.savePromoteRegistryIndex()) {
    util.continueBullet(bundle.getPromoteRegistryIndexFilename().trivial);
    let commitMessage = `[${config.rName}] ${bundle.currentGoal} - save-promote-registry-index`;
    let pushed = bundle.versionsRepo.checkIn({message: commitMessage});
    util.endBullet(pushed ? 'Pushed'.good : 'No changes'.warn);
  } else {
    util.endBullet('No changes'.warn);
  }
}

function initSupportProjects(bundle, params) {
  const msRestNodeAuth = require('@azure/ms-rest-nodeauth');
  msRestNodeAuth.interactiveLogin().then((credential) => {
    util.startBullet('Auth complete'.plain);
  }).catch((err) => {
    util.startBullet('Auth failure'.plain);
    console.error(err);
  });
}

module.exports = {
  initSupportProjects: initSupportProjects,
  waitForPipelinesToComplete: waitForPipelinesToComplete,
  runGenericPipeline: runGenericPipeline,
  runPipelines: runPipelines,
  runKappctlPipeline: runKappctlPipeline,
  initDeploymentProjects: initDeploymentProjects
};
