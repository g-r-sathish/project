//  Copyright (C) Agilysys, Inc. All rights reserved.

const {Command} = require('./base/Command');
const {log} = require("../util/ConsoleLogger");
const {Pools} = require("../saas/Pools");
const tk = require("../util/tk");
const {ConfigRepoBranch} = require("../saas/ConfigRepoBranch");

module.exports.help = {
  summary: "Maintenance utilities to help manage and recover state",
  usages: [
    "--test-pools",
    "--config-pull [--subset {version}] [--rebuild]",
    "--config-from {branch|tag|commit} --subset {version}",
    "--mark-rollout-complete",
    "--ensure-standalone-versions"
  ]
}

const OPT_ENSURE_STANDALONE_VERSIONS = '--ensure-standalone-versions';
const OPT_MARK_ROLLOUT_COMPLETE = '--mark-rollout-complete';
const OPT_TEST_POOLS = '--test-pools';
const OPT_CONFIG_FROM = '--config-from';
const OPT_CONFIG_PULL = '--config-pull';
const OPT_REBUILD = '--rebuild';
const OPT_SUBSET = '--subset';

class MaintenanceCommand extends Command {
  constructor(args, options) {
    super(args, options);
    this.spec.flags[OPT_TEST_POOLS] = true;
    this.spec.flags[OPT_MARK_ROLLOUT_COMPLETE] = true;
    this.spec.flags[OPT_CONFIG_PULL] = true;
    this.spec.flags[OPT_REBUILD] = true;
    this.spec.flags[OPT_ENSURE_STANDALONE_VERSIONS] = true;
    this.spec.options[OPT_CONFIG_FROM] = true;
    this.spec.options[OPT_SUBSET] = true;
    /** @member {Pools} */
    this.pools = undefined;
  }

  async init(saasContext) {
    await super.init(saasContext);
    this.pools = new Pools(saasContext);
  }

  async run() {
    if (this.isOptionPresent(OPT_TEST_POOLS)) {
      await this.ensureTestpoolState();
    }

    if (this.isOptionPresent(OPT_MARK_ROLLOUT_COMPLETE)) {
      await this.markRolloutComplete();
    }

    if (this.isOptionPresent(OPT_ENSURE_STANDALONE_VERSIONS)) {
      await this.ensureStandaloneVersions();
    }

    if (this.isOptionPresent(OPT_CONFIG_PULL)) {
      const subsetVersion = this.getOption(OPT_SUBSET);
      if (subsetVersion) {
        const app = await this.pools.selectApplication(subsetVersion);
        await app.pullConfigRepoBranch({rebuild: this.isOptionPresent(OPT_REBUILD)});
      } else {
        const env = this.saasContext.environmentFile;
        if (env.isTestpoolEnabled()) {
          log.warn(`Default behavior has changed, only pulling @test (use --subset @prod to update the current production branch)`);
          const test = await this.pools.test.getApplication();
          await test.pullConfigRepoBranch({rebuild: this.isOptionPresent(OPT_REBUILD)});
        } else {
          const prod = await this.pools.prod.getApplication();
          await prod.pullConfigRepoBranch({rebuild: this.isOptionPresent(OPT_REBUILD)});
        }
      }
    }

    if (this.isOptionPresent(OPT_CONFIG_FROM)) {
      const env = this.saasContext.environmentFile;
      const branchFrom = this.getRequiredOption(OPT_CONFIG_FROM);
      const app = env.isTestpoolEnabled()
        ? await this.pools.selectApplication(this.getRequiredOption(OPT_SUBSET))
        : await this.pools.prod.getApplication();
      return app.initConfigRepoBranch({sourceRef:branchFrom});
    }
  }

  async ensureTestpoolState() {
    let errors = [];

    if (this.saasContext.environmentFile.isTestpoolEnabled()) {

      let testInboundSubset = await this.pools.test.getSubsetVersion();
      try {
        log.user(`test(${testInboundSubset}): test-pool-on`);
        const testApp = await this.pools.test.getApplication();
        await testApp.testPoolOn();
      } catch (e) {
        errors.push(e);
      }

      let prodInboundSubset = await this.pools.prod.getSubsetVersion();
      if (await this.pools.singleSubset()) {
        log.user(`prod(${prodInboundSubset}): same subset as test, skipping`);
      } else {
        try {
          log.user(`prod(${prodInboundSubset}): test-pool-off`);
          const prodApp = await this.pools.prod.getApplication();
          await prodApp.testPoolOff();
        } catch (e) {
          errors.push(e);
        }
      }
    } else {
      log.error('Test pools are not enabled');
    }

    return new Promise((resolve, reject) => {
      errors.length ? reject(errors) : resolve();
    })
  }

  async markRolloutComplete() {
    const env = this.saasContext.environmentFile;
    const app = await this.pools.selectApplication(this.getOption(OPT_SUBSET));
    const subset = app.getSubsetVersion();
    const subsetConfig = env.getOrCreateSubset(tk.ensureValidString(subset));

    const rollout = env.get('rollout');
    if (!rollout) {
      log.user('No rollout request exists');
      return;
    }

    log.group('# Marking rollout complete')

    if (rollout.jobs && rollout.jobs.length) {
      log.user(`! Removing ${rollout.jobs.length} Job definitions`);
    }

    if (rollout.services && rollout.services.length) {
      log.user(`! Removing ${rollout.services.length} Deployment definitions`);
    }

    log.user(`Applying versions to subset: ${subset}`);
    Object.assign(subsetConfig, env.get('rollout.versions', {}));

    env.unset('rollout');

    if (this.saasContext.dryRun) {
      log.user('Showing updated environment (--dry-run)');
      log.groupEnd();
      log.stopCursor();
      log.info(env.stringify())
    } else {
      await env.save().checkIn('Roll out complete (manual entry)');
      log.user('Environment updated');
      log.groupEnd();
    }
  }

  async ensureStandaloneVersions() {
    const app = await this.pools.selectApplication('prod');
    const results = await app.listDeployments();
    const serviceImageTags = {};
    for (const deployment of results) {
      const containers = deployment.definition.spec.template.spec.containers;
      if (containers.length !== 1) {
        throw new Error(`Expected 1 container in deployment ${deployment.name}`);
      }
      const container = containers[0];
      if (container && container.image) {
        const imageEntry = container.image;
        if (!imageEntry) {
          throw new Error(`No image entry in deployment ${deployment.name}`);
        }
        const tagDelimiter = imageEntry.lastIndexOf(':');
        const imageTag = tagDelimiter === -1
            ? "latest"
            : imageEntry.substring(tagDelimiter + 1);
        serviceImageTags[container.name] = imageTag ?? 'latest';
      }
    }
    const configRepoBranch = new ConfigRepoBranch(app);
    await configRepoBranch.writeImageTags(serviceImageTags);
  }
}

module.exports.Command = MaintenanceCommand;
module.exports.MaintenanceCommand = MaintenanceCommand;
