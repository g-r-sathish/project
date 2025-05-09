'use strict';

const _ = require('underscore');
const deasync = require('deasync');
const FormData = require('form-data');
const fs = require('fs');
const request = require('request');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../classes/BuildError');
const config = require('./config');
const util = require('./util');
const JSONFile = require('../classes/JSONFile');
const {BuildProject} = require('../classes/BuildProject');
const {SupportProject} = require('../classes/SupportProject');

let jenkinsService = {};

let jenkinsOrchestratedBuild = '';

jenkinsService.buildOrchestration = function (projects, branchName, release) {
  let buildPhaseMap = {};
  jenkinsOrchestratedBuild = config.jenkinsOrchestratedBuild;

  if (config._all['perf-impr'] && (config.bundleName === 'svc' || config.bundleName === 'ui')) {
    projects = onPerformanceImprovementEnabled(projects);
  } else if (config._all['perf-impr']) {
    util.printf('Option --perf-impr or -p is enabled only for svc and ui bundles\n'.bad);
  }

  _.each(projects, function (project) {

    // If the project doesn't define any Jenkins build information, we
    // presume it doesn't want to be built.
    if (_.filter([
        project.definition.build_phase,
        project.definition.release_build,
        project.definition.changeset_build
      ], function (item) {
        return !!item;
      }).length === 0) {
      return;
    }

    let buildPhase = project.definition.build_phase;

    if (!buildPhase) {
      throw new BuildError(sprintf('Project definition for %s does not contain: %s', project.dirname, 'build_phase'));
    }

    let buildKey = release ? 'release_build' : 'changeset_build';
    let build = project.definition[buildKey];

    if (!build) {
      throw new BuildError(sprintf('Project definition for %s does not contain: %s', project.dirname, buildKey));
    }

    let orchestrationItem = {
      JDK17: true,
      build: build,
      repo: project.repo.repoPath,
      branch: project.branchToBuild || branchName,
      version: project.pom.getVersion()
    };

    const buildParams = project.definition.buildParams;
    if (buildParams) {
      for (const param in buildParams) {
        orchestrationItem[param] = buildParams[param];
      }
    }

    if (config._all['jacoco']) {
      orchestrationItem['RUN_JACOCO'] = true
    }

    if (config._all['sb3build']) {
      orchestrationItem['sb3build'] = true
    }
    
    if (config._all['skip-test']) {
      orchestrationItem['SKIP_TEST'] = true
    }

    buildPhaseMap[buildPhase] = buildPhaseMap[buildPhase] || [];
    buildPhaseMap[buildPhase].push(orchestrationItem);
  });

  let buildPhaseMapKeys = Object.keys(buildPhaseMap).sort(function(a, b) {
    return a - b;
  });
  let orchestrationArray = [];

  _.each(buildPhaseMapKeys, function (phase) {
    if (buildPhaseMap[phase].length === 1) {
      orchestrationArray.push(buildPhaseMap[phase][0]);
    } else {
      orchestrationArray.push(buildPhaseMap[phase]);
    }
  });

  util.narrateln('Built orchestration array:');
  util.narrateln(JSON.stringify(orchestrationArray));

  return orchestrationArray;
};


jenkinsService.postOrchestration = (orchestrationArray) => {
  if (!orchestrationArray || orchestrationArray.length === 0) {
    return;
  }

  let json = { parameter: [{ name: 'BUILDS_JSON', value: JSON.stringify(orchestrationArray) }] };
  let done, error, fail;

  util.announce('Triggering orchestrated build'.plain);

  if (config.jenkinsEnabled) {
    if (config._all.commit) {

      let formData = {
        json: JSON.stringify(json)
      };

      let params = {
        uri: `${config.jenkinsProtocol}://${config.jenkinsHost}:${config.jenkinsPort}/job/${jenkinsOrchestratedBuild}/build`,
        form: formData,
        auth: {
          user: config.personal_settings.ad_username,
          pass: config.personal_settings.jenkins_api_token
        },
        rejectUnauthorized: false
      };
      util.narrateln(JSON.stringify(params, null, 2));

      request.post(params, function (err, res, body) {
        if (err) {
          error = err;
          done = true;
          return;
        }
        fail = res && res.statusCode !== 201 ? 'Failed with http status code: ' + res.statusCode : null;
        done = true;
      });

      deasync.loopWhile(() => {
        return !done;
      });

      if (error || fail) {
        throw new BuildError(sprintf("Jenkins: %s", error || fail));
      }
    }
  } else {
    util.startBullet('Manual trigger required'.plain);
    util.endBullet(JSON.stringify(orchestrationArray).trivial.italic);
  }

  let url = sprintf('https://%s/job/%s', config.jenkinsHost, jenkinsOrchestratedBuild);
  util.startBullet('Jenkins URL'.plain);
  util.endBullet(url.useful);
  util.startBullet('Teams Channel'.plain);
  util.endBullet(config.teams.channels[config.jenkinsTeamsChannel].name.useful);
  return url;
};

/**config_extras.json files are added on both /stay/svc and /stay/ui folders of stay-versions-files repo to make --perf-impr option work */
function onPerformanceImprovementEnabled(projects) {
  const bundleConfigExtrasPath = config.bundleConfigPath.replace('config', 'config_extras');
  try {
    util.narratef('Bundle config_extras:   %s\n', bundleConfigExtrasPath);

    projects = _.map(projects, (project) => {
      let projectObj = project.toJsonObject();
      projectObj = JSON.parse(JSON.stringify(projectObj));

      if (project.type === 'build') {
        return BuildProject.fromJsonObject(projectObj);
      } else {
        return SupportProject.fromJsonObject(projectObj);
      }
    });

    let extraConfigsBundleFile = new JSONFile(bundleConfigExtrasPath);
    const jenkinsOrchestratedBuildFromConfigExtras = extraConfigsBundleFile.data.config.jenkinsOrchestratedBuild;

    if (jenkinsOrchestratedBuildFromConfigExtras) {
      jenkinsOrchestratedBuild = jenkinsOrchestratedBuildFromConfigExtras;
    }
    else {
      util.narratef(`Parameter jenkinsOrchestratedBuild is missing in ${bundleConfigExtrasPath}; Using pipeline ${jenkinsOrchestratedBuild}\n`);
    }

    for (let project of projects) {
      const projectConfig = extraConfigsBundleFile.data.projects[project.definition.repo_path];
      if (projectConfig) {
        Object.assign(project.definition, projectConfig);
      }
      else {
        util.narratef(`Project config for repo_path ${project.definition.repo_path} is missing in ${bundleConfigExtrasPath}.\n`);
      }
    }
  } catch (ex) {
    util.printf(`File ${bundleConfigExtrasPath} is missing or invalid; Ignoring --perf-impr or -p.\n`.bad);
  }
  return projects;
}

module.exports.jenkinsService = jenkinsService;
