//  Copyright (C) Agilysys, Inc. All rights reserved.

/*
Entry points for adhoc debugging.
Remember to append .skip before pushing.
 */

const {GitRepo} = require("../lib/repo/GitRepo");
const {YAMLFile} = require('../lib/repo/YAMLFile');
const {ConfigClient, Inputs} = require('../../config-client/lib/ConfigClient');
const {KubernetesClient} = require('../lib/k8s/KubernetesClient');

describe.skip('git-repo', function () {
  it ('detect remote changes', async () => {
    let repo = new GitRepo({baseDir: '../environments'});
    await repo.remote(['update']);
    let status = await repo.status(['--short']);
  });
  it ('does local branch exist', async () => {
    const repo = new GitRepo({baseDir: '../config-repo'});
    const expectTrue = await repo.doesLocalBranchExist('aks-stay-dev-v1');
    const expectFalse = await repo.doesLocalBranchExist('foo/bar/baz');
    console.log(expectFalse);
  });
  it ('does remote branch exist', async () => {
    const repo = new GitRepo({baseDir: '../config-repo'});
    const list = await repo.getRemoteBranchRefs();
    const ok = await repo.doesRemoteBranchExist('aks-stay-dev-v1');
    console.log(list);
  });
});

describe.skip('manifest', function () {
  let inputs = new Inputs();
  inputs.cloudConfig.label = 'master';
  inputs.cloudConfig.profiles = 'default';
  inputs.cloudConfig.auth.user = 'user';
  inputs.cloudConfig.auth.pass = 'Agile1';
  let configClient = new ConfigClient(inputs);
  let k8sClient = new KubernetesClient('agys-stay', {dryRun: true});

  it ('can parse template yamls', async () => {
    let manifest = await configClient.render('k8s-pools.yml.njk');
    let definitions = YAMLFile.multiLoad(manifest);
    for (let definition of definitions) {
      let api = k8sClient.getAccessor(definition.kind);
    }
  });
});