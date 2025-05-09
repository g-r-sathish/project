//  Copyright (C) Agilysys, Inc. All rights reserved.

const assert = require('assert').strict;
const {ApplicationCommand} = require('./base/ApplicationCommand');
const {Kind} = require("../k8s/accessors/base/AccessorFactory");
const {StatusManager} = require("../saas/management/StatusManager");
const {DeploymentManager} = require("../saas/management/DeploymentManager");
const {ApiResultsAccumulator} = require("../k8s/accessors/base/ApiResultsAccumulator");

module.exports.help = {
  summary: "Run deployment jobs",
  usages: ["[--subset {@pool|version}] --phase {phase} {--all | names...} [--wait]"]
}

const OPT_PHASE = '--phase';
const OPT_ALL = '--all';
const OPT_VAR = '--var';
const OPT_WAIT = '--wait';

/*
  PostgresOps (jobs) verification before
  service deployments.
 */

class JobCommand extends ApplicationCommand {
  constructor(args, options) {
    super(args, options);
    this.spec.options[OPT_PHASE] = true;
    this.spec.options[OPT_VAR] = true;
    this.spec.flags[OPT_ALL] = true;
    this.spec.flags[OPT_WAIT] = true;
  }

  async run() {
    let configFile = this.saasContext.configFile;
    let jobsByPhase = configFile.get('deploy.jobs', []);
    let phase = this.getRequiredOption(OPT_PHASE);
    let jobNameList;

    let definedJobs = jobsByPhase[phase];
    assert.ok(definedJobs, `Phase does not have any jobs: ${phase}`)

    if (this.isOptionPresent(OPT_ALL)) {
      assert.equal(this.args.length, 0, `Ambiguous instructions: both ${OPT_ALL} and job names are present`);
      jobNameList = Object.keys(definedJobs);
    } else {
      assert.notEqual(this.args.length, 0, `Specify ${OPT_ALL} or at least one job name: ${Object.keys(definedJobs).join(', ')}`);
      jobNameList = this.args;
    }

    const results = new ApiResultsAccumulator();
    const deployManager = new DeploymentManager(this.app);
    for (let jobName of jobNameList) {
      results.combine(await deployManager.deployJob(jobName, phase, this.vars));
    }

    if (this.isOptionPresent(OPT_WAIT)) {
      const statusManager = new StatusManager(this.app);
      const jobs = results.getResources((r) => Kind.Job === r.getKind());
      await statusManager.waitUntilAllComplete(jobs);
    }
  }
}

module.exports.Command = JobCommand;
module.exports.JobCommand = JobCommand;