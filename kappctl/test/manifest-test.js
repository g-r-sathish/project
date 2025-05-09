//  Copyright (C) Agilysys, Inc. All rights reserved.

const chai = require('chai');
const assert = chai.assert;
const {YAMLFile} = require('../lib/repo/YAMLFile');
const {ConfigClient, Inputs} = require('../../config-client/lib/ConfigClient');
const {KubernetesClient} = require('../lib/k8s/KubernetesClient');

// Exists for debugging (remove .skip to debug)
describe.skip('manifest', function () {
  let inputs = new Inputs();
  inputs.cloudConfig.uri = `${__dirname}/config-mock`;
  inputs.cloudConfig.label = 'master';
  inputs.cloudConfig.profiles = 'default';
  inputs.cloudConfig.auth.user = 'user';
  inputs.cloudConfig.auth.pass = 'Agile1';
  let configClient = new ConfigClient(inputs);
  let k8sClient = new KubernetesClient('agys-stay', {dryRun: true});

  it ('introspect version api', async () => {
    let version = await k8sClient.getKubernetesVersion();
    console.log(version);
  });

  it ('can parse template yamls', async () => {
    let manifest = await configClient.render('k8s-pools.yml.njk');
    let definitions = YAMLFile.multiLoad(manifest);
    for (let definition of definitions) {
      let api = k8sClient.getAccessor(definition.kind);
    }
  });
});
