//  Copyright (C) Agilysys, Inc. All rights reserved.
const tmp = require("tmp");
const fs = require("fs");
const Path = require("path");
const {GitRepo} = require("../../lib/repo/GitRepo");
const {GitBackedYAMLFile} = require("../../lib/repo/GitBackedYAMLFile");
const {Context} = require("../../lib/saas/Context");
const {Application} = require("../../lib/saas/Application");

class TestEcosystem {

  constructor(environmentData, applicationData={}) {
    this._environmentData = environmentData;
    this._applicationData = applicationData;
    this._environmentName = 'test';
  }

  async init() {
    this._tmpDir = tmp.dirSync({unsafeCleanup: true});

    // initEnvironment
    this._environmentsRepo = await this._createEmptyRepo('environments');
    this._environmentFile = await GitBackedYAMLFile.newFile(this._environmentsRepo, `${this._environmentName}.yml`, this._environmentData);
    this._kappctlConfigFile = await GitBackedYAMLFile.newFile(this._environmentsRepo, `config.yml`, KAPPCTL_CONFIG_DATA);
    this._environmentsRepo.push();

    // initConfigRepo
    this._configRepo = await this._createEmptyRepo('config-repo');
    this._applicationFile = await GitBackedYAMLFile.newFile(this._configRepo, `${this._environmentName}/application.yml`, this._applicationData);
    this._configRepo.push();

    // init kube api
    const kubeConfigPath = Path.join(this._tmpDir.name, '.kubeconfig');
    fs.writeFileSync(kubeConfigPath, KUBECONFIG_YAML);
    process.env['KUBECONFIG'] = kubeConfigPath;

    // initContext
    this._saasContext = new Context({
      environmentName: this._environmentName,
      envRepoDir: this._environmentsRepo.baseDir,
      configRepoDir: this._configRepo.baseDir
    });
    await this._saasContext.postConstruct();

    return this;
  }

  async cleanup() {
    if (this._tmpDir) {
      this._tmpDir.removeCallback();
    }
  }

  get saasContext() {
    return this._saasContext;
  }

  get configRepo() {
    return this._configRepo;
  }

  async _createEmptyRepo(name) {
    // The upstream repository
    const upstreamRepoDir = `${this._tmpDir.name}/.${name}`;
    fs.mkdirSync(upstreamRepoDir);
    const upstreamRepo = new GitRepo({baseDir: upstreamRepoDir});
    await upstreamRepo.init(['--bare']);

    // The working repository
    const workingRepoDir = `${this._tmpDir.name}/${name}`;
    fs.mkdirSync(workingRepoDir);
    const workingRepo = new GitRepo({baseDir: workingRepoDir});
    await workingRepo.clone(upstreamRepoDir, workingRepoDir);
    await workingRepo.addNewFile('.gitignore', '.DS_Store');
    await workingRepo.commit('Initial commit');
    await workingRepo.push(['-u', 'origin', 'master']);

    return workingRepo;
  }
}

const KAPPCTL_CONFIG_DATA = {
  "context": {
    "namespace": "test",
    "virtualServicesBaseName": "test-services",
    "defaultSpringApplication": "test",
    "configSearchPaths": "${env}"
  },
  "deploy": {
    "services": {
      "cluster": [],
      "subset": [],
      "saas": []
    },
    "jobs": {
      "init": {},
      "deploy": {},
      "adhoc": {},
      "conclude": {},
      "rollback": {}
    }
  },
  "quirks": {
    "application-name-map": {}
  },
  "templates": {
    "init": {
      "cluster": [],
      "pools": [],
      "subset": [],
      "saas": []
    },
    "deploy": {
      "job": [],
      "saas": []
    },
    "promote": {
      "pools": []
    }
  }
};

const KUBECONFIG_YAML = `
apiVersion: v1
clusters:
- cluster:
    server: https://127.0.0.1:443
  name: test
contexts:
- context:
    cluster: "test"
    user: "admin"
  name: test
current-context: test
kind: Config
preferences: {}
users:
- name: test
  user:
    password: admin
    username: admin
`;

module.exports.TestEcosystem = TestEcosystem;