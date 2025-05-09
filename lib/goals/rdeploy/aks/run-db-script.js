const assert = require('assert').strict;
const config = require('../../../common/config');
const rdeployUtil = require('../../../common/rdeploy-util');
const {EnvironmentFile} = require('../../../classes/models/EnvironmentFile');

async function runDbScript (bundle, params) {
  const parameterValues = {
    scriptPath: config._all['db-script-path'],
    dockerImageTag: config._all['db-script-image-tag'] || 'latest'
  };
  assert.ok(parameterValues.scriptPath);
  assert.ok(parameterValues.dockerImageTag);
  return rdeployUtil.runGenericPipeline(bundle, 'run-db-script', parameterValues);
  // TODO: config yaml should run the kappctl goal like:
  //           "args": "job databasescripts --phase adhoc --var scriptPath=${scriptPath}" --var dockerImageTag=${dockerImageTag}
  // However the dockerImageTag needs to be passed through and honored (by k8s-job.yml.njk).
  // This is for changesets, releases should be fine with "latest" (?)
}

exports['run-db-script'] = {
  requiredSettings: ['azure_devops_token'],
  checkout: async (bundle) => rdeployUtil.initDeploymentProjects(bundle, EnvironmentFile.SELECT_CURRENT),
  callback: async (bundle, name, params) => runDbScript(bundle, params)
};