const jenkins = require('../../../common/jenkins').jenkinsService;
const rcUtil = require('../../../common/rc-util');
const util = require('../../../common/util');

module.exports['resume-rc'] = {
  summary: 'Resumes RC build after a Jenkins failure',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run', 'jacoco', 'sb3build', 'perf-impr'],
  requiredSettings: [],
  optionalSettings: [],
  notificationSettings: {
    onStart: true
  },
  callback: function (bundle, goal) {
    let info = rcUtil.validateInProgressReleaseCandidate(bundle);
    let projectsToBuild = rcUtil.syncProjectsWithBuildOutcomes(bundle, info.candidate);

    // Trigger orchestrated build
    if (projectsToBuild.length) {
      let orchestrationArray = jenkins.buildOrchestration(projectsToBuild, info.candidate.getReleaseBranchName(), true);
      jenkins.postOrchestration(orchestrationArray);
    } else {
      util.announce('Noteworthy'.warn);
      util.println('No build was initiated; the expected Maven artifacts and Docker images already exist!'.warn);
    }
  }
};
