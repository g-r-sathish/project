//  Copyright (C) Agilysys, Inc. All rights reserved.

const {describe, it, before, beforeEach, afterEach, after} = require('mocha');
const chai = require('chai');
const assert = chai.assert;
const expect = chai.expect;
chai.use(require('chai-as-promised'))
const tk = require("../lib/util/tk");
const {log} = require("../lib/util/ConsoleLogger");

const {Application} = require("../lib/saas/Application");
const {TestEcosystem} = require("./src/TestEcosystem");
const {ProvisioningManager} = require("../lib/saas/management/ProvisioningManager");

describe('with node pools', function () {
  this.slow(2000);
  let ecosystem;
  const envOverlayData = {
    "pools": {
      "nodeSelectors": {
        "enabled": true
      }
    }
  };
  before('setup', async () => ecosystem = await _makeEcosystem(envOverlayData));
  after('cleanup', async () => _cleanup(ecosystem));

  it(`sets up node selector`, async () => {
    const app = await _initProdBranch(ecosystem);
    const appConfig = await app.getApplicationFile();
    assert.equal(appConfig.get('deployment.k8s.pod.nodePool'), '${rollout.node_pool}');
  });

  it(`provisions the next subset`, async () => {
    const provisioningManager = new ProvisioningManager(ecosystem.saasContext);
    await provisioningManager.initEnvironmentSubset('v2', 'v1');
    const app = new Application(ecosystem.saasContext, 'v2');
    const subsetConfig = app.env.getSubset('v2');
    assert.isUndefined(subsetConfig.config_repo_branch);
    assert.equal(subsetConfig.node_pool, 'green');
  });

  it(`updates the next subset`, async () => {
    const provisioningManager = new ProvisioningManager(ecosystem.saasContext);
    await provisioningManager.initEnvironmentSubset('v2', 'v1');
    const app = await _initBranch(ecosystem, 'v2');
    const subsetConfig = app.env.getSubset('v2');
    assert.equal(subsetConfig.config_repo_branch, 'test-v2');
  });
});

describe('pulls into upstream before runtime', function () {
  this.slow(2000);
  let ecosystem;
  const changelogPath = 'test/CHANGES.md';
  before('setup', async () => {
    ecosystem = await _makeEcosystem({
        "options": {
          "config-repo": {
            "branch": {
              "source": "test-main"
            }
          }
        }
      }
    );
    const configRepo = ecosystem.configRepo;
    await configRepo.switch( "master");
    await configRepo.addNewFile(changelogPath, 'Created\n');
    await configRepo.push();

    await configRepo.checkoutBranch("test-main", "master");
    await configRepo.commit('Initial commit');
    await configRepo.pushNewBranch();

    await _initProdBranch(ecosystem);
    await _initTestBranch(ecosystem);
  });
  after('cleanup', async () => _cleanup(ecosystem));
  it(`has expected upstream content`, async () => {
    const app = new Application(ecosystem.saasContext, 'v1');
    const appConfig = app.getApplicationFile();
    const content = await app.renderTemplate('CHANGES.md');
    assert.ok(content);
  });
  it(`updates via upstream`, async () => {
    const changeText = 'Release r1.0';
    const configRepo = ecosystem.configRepo;

    await configRepo.checkoutBranch("release-1.0", "master");
    const content = await configRepo.getFileContent(changelogPath);
    await configRepo.setFileContent(changelogPath, content + `${changeText}\n`)
    await configRepo.commit('testcase');
    await configRepo.pushNewBranch();

    const app = new Application(ecosystem.saasContext, 'v1');
    await app.initConfigRepoBranch({sourceRef:'release-1.0'});
    const updatedContent = await app.renderTemplate('CHANGES.md');
    assert.ok(updatedContent.includes(changeText));
  });
});

describe('with test pool', function () {
  this.slow(2000);
  let ecosystem;
  before('setup', async () => ecosystem = await _makeEcosystem());
  after('cleanup', async () => _cleanup(ecosystem));
  it(`inits the prod branch`, async () => _initProdBranch(ecosystem));
  it(`inits the test branch`, async () => _initTestBranch(ecosystem));
});

describe('without test pool', function () {
  this.slow(2000);
  let ecosystem;
  const envOverlayData = {
    "pools": {
      "enabled": false
    }
  };
  before('setup', async () => ecosystem = await _makeEcosystem(envOverlayData));
  after('cleanup', async () => _cleanup(ecosystem));
  it(`inits the prod branch`, async () => _initProdBranch(ecosystem));
  it(`inits the test branch`, async () => _initTestBranch(ecosystem));
});

describe('with test pool but without managed branches', function () {
  this.slow(2000);
  let ecosystem;
  const envOverlayData = {
    "options": {
      "config-repo": {
        "branch": {
          "managed": false
        }
      }
    }
  };
  before('setup', async () => ecosystem = await _makeEcosystem(envOverlayData));
  after('cleanup', async () => _cleanup(ecosystem));
  it(`fails to init the prod branch`, async () => {
    const app = new Application(ecosystem.saasContext, 'v1');
    await expect(app.initConfigRepoBranch()).to.be.rejectedWith(Error);
  });
});

describe('without test pool or managed branches', function () {
  this.slow(2000);
  let ecosystem;
  const envOverlayData = {
    "pools": {
      "enabled": false
    },
    "options": {
      "config-repo": {
        "branch": {
          "managed": false
        }
      }
    }
  };
  before('setup', async () => ecosystem = await _makeEcosystem(envOverlayData));
  after('cleanup', async () => _cleanup(ecosystem));
  it(`inits the prod branch`, async () => {
    const app = await _initProdBranch(ecosystem)
    assert.equal(app.getConfigRepoBranch(), 'master');
  });
});

async function _initProdBranch(ecosystem) {
  const app = await _initBranch(ecosystem, 'v1');
  const appConfig = await app.getApplicationFile();
  assert.isFalse(appConfig.get('testPool'));
  return app;
}

async function _initTestBranch(ecosystem) {
  const app = await _initBranch(ecosystem, 'v2');
  const appConfig = await app.getApplicationFile();
  assert.isTrue(appConfig.get('testPool'));
  return app;
}

async function _initBranch(ecosystem, subset) {
  const app = new Application(ecosystem.saasContext, subset);
  await app.initConfigRepoBranch();
  const appConfig = await app.getApplicationFile();
  assert.equal(appConfig.get('deployment.version'), subset);
  return app;
}

async function _cleanup(ecosystem) {
  if (ecosystem) {
    await ecosystem.cleanup();
  }
}

async function _makeEcosystem(overlayData) {
  const envData = tk.overlayMany({}, baseEnvData, overlayData);
  return new TestEcosystem(envData).init();
}

const baseEnvData = {
  "k8s": {
    "context": "test"
  },
  "approvals": {
    "enabled": false
  },
  "pools": {
    "enabled": true,
    "prod": "v1",
    "test": "v2"
  },
  "options": {
    "kappctl": {
      "config": "config.yml"
    },
    "config-repo": {
      "branch": {
        "source": "master",
        "managed": true
      }
    }
  },
  "subsets": {
    "v1": {}
  }
};