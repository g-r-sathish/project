const _ = require('underscore');
const os = require('os');
const Path = require('path');

/**
 * @class Config
 * @property {{}} _all The input parameters to the application.
 * @property [_all.trunk]
 * @property {AliasId} [aliasId]
 * @property {string} azureDevOpsApiUrl
 * @property {string} azureDevOpsBrowseUrlSpec
 * @property {string} [bundleName]
 * @property {string} changeset_branch_prefix
 * @property {ChangesetId} [changesetId]
 * @property defaultThemes
 * @property {{}} defaultThemes.light
 * @property {{}} defaultThemes.dark
 * @property display
 * @property {string} display.arrowChar
 * @property {string} display.spinner
 * @property {string} display.bulletChar
 * @property {string} dotDir
 * @property {number} gitCommitHashSize
 * @property {string} jenkinsTeamsChannel
 * @property {LogFile} logger The actual {@link LogFile} instance.
 * @property logFile
 * @property {string} logFile.path
 * @property {number} logFile.threshold
 * @property {string} mainline_branch_name
 * @property {number} maxForkCount
 * @property {string} messageDir
 * @property {string[]} ops_reviewers
 * @property personal_settings
 * @property {string} personal_settings.ad_username
 * @property {string} release_branch_prefix
 * @property {string} releaseModeratorsTeamsChannel
 * @property {string} releaseTagSpec
 * @property {{}} repo_hosts
 * @property {string} review_branch_prefix
 * @property {string} review_branch_source_segment
 * @property {string} review_branch_target_segment
 * @property {string[]} reviewers
 * @property {ShipmentId} [shipmentId]
 * @property {string} stashApiBaseUrl
 * @property {string} support_hotfix_branch_prefix
 * @property {string} support_ops_mainline_branch_name
 * @property {{}} teams
 * @property {AliasId} [toAliasId]
 * @property {regex} trackedArtifactsGroupRegex
 * @property (string} trunk_alias_spec
 * @property {string} trunk_candidate_alias_spec
 * @property versions_files
 * @property {string} versions_files.user_spec
 * @property {string} workDir The location of the application's working directory (as opposed to the user's working
 *   directory).
 * @property {string} whatami
 * @property {string} whoami
 */

function getUserHome () {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
}

function getUsername () {
  return process.env.SUDO_USER || process.env.LOGNAME || process.env.USER || process.env.LNAME || process.env.USERNAME;
}

function rName () {
  let name = Path.basename(process.argv[1]);
  return name[0] + name[1].toUpperCase() + name.substr(2).toLowerCase();
}

// Note that NODE_BASE_DIRECTORY is provided during app bootstrap
let defaultConfig = {};

defaultConfig['consoleVerbosityLevel'] = 0;
defaultConfig['logger'] = undefined;

defaultConfig['whoami'] = getUsername();
defaultConfig['whatami'] = Path.basename(process.argv[1]).replace(/\.js$/, '');
defaultConfig['rName'] = rName();
defaultConfig['homeDir'] = getUserHome();
defaultConfig['dotDir'] = Path.join(defaultConfig['homeDir'], '.' + defaultConfig['whatami']);
defaultConfig['workDir'] = Path.join(defaultConfig['dotDir'], 'repos');
defaultConfig['repoCacheDir'] = Path.join(defaultConfig['dotDir'], 'repo-cache');
defaultConfig['cacheDir'] = Path.join(defaultConfig['dotDir'], 'cache');
defaultConfig['gitCredentialsPath'] = Path.join(defaultConfig['dotDir'], 'git-credentials');
defaultConfig['systemConfigDir'] = Path.join('/etc', defaultConfig['whatami']);
defaultConfig['messageDir'] = Path.join(defaultConfig['dotDir'], 'messages');

defaultConfig['logFile'] = {
  path: Path.join(defaultConfig['dotDir'], defaultConfig['whatami'] + '.log'),
  threshold: Math.pow(1024, 2) * 10
};

defaultConfig['pidFile'] = Path.join(defaultConfig['dotDir'], defaultConfig['whatami'] + ".pid");
defaultConfig['tmpdir'] = os.tmpdir();

defaultConfig['gitMinVersion'] = '2.10.0';
defaultConfig['gitOpsVersion'] = '1.8.3';
defaultConfig['gitCommitHashSize'] = 9;
defaultConfig['azureDevOpsApiUrl'] = 'https://dev.azure.com/agilysys';
defaultConfig['azureDevOpsBrowseUrlSpec'] = 'https://dev.azure.com/agilysys/Stay/_workitems/edit/%s';

defaultConfig['stashApiBaseUrl'] = 'http://stash.agilysys.local/rest/api/1.0';
defaultConfig['githubApiBaseUrl'] = 'https://api.github.com';
defaultConfig['githubOwner'] = 'Agilysys-Inc';
defaultConfig['artifactoryBaseUrl'] = 'http://artifactory.bellevue.agilysys.com';
defaultConfig['dockerRegistryUrl'] = 'docker-registry-build.bellevue.agilysys.com:5001';
defaultConfig['dockerApiBaseUrl'] = 'http://docker-registry.bellevue.agilysys.com:5000/v2/';
defaultConfig['defaultIncludes'] = ['com\\.agilysys'];
defaultConfig['trackedArtifactsGroupRegex'] = /^com\.agilysys/;
defaultConfig['templateDirectory'] = Path.resolve(`${__dirname}/../../res`);

defaultConfig['jenkinsEnabled'] = true;
defaultConfig['jenkinsHost'] = 'jenkins.bellevue.agilysys.com';
defaultConfig['jenkinsPort'] = '8443';
defaultConfig['jenkinsOrchestratedBuild'] = 'STAY_orchestrated_build';
defaultConfig['jenkinsProtocol'] = 'https';
defaultConfig['jenkinsTeamsChannel'] = '#stay-jenkins-builds';
defaultConfig['releaseModeratorsTeamsChannel'] = '#stay-release-managers';
defaultConfig['releasePipeChannel'] = '#stay-release-pipe';
defaultConfig['releasePipeTrunksChannel'] = '#stay-release-pipe-trunks';
defaultConfig['stayPullRequests'] = '#stay-pull-requests';

defaultConfig['targetLocking'] = false;
defaultConfig['maxForkCount'] = 100;

defaultConfig['releaseTagSpec'] = 'release-%s-%s';

defaultConfig['artifactNameMap'] = {
  'reservation-implementation': 'reservation-service'
};

defaultConfig['changeset_branch_prefix'] = 'changeset';
defaultConfig['release_branch_prefix'] = 'release';
defaultConfig['review_branch_prefix'] = 'review';
defaultConfig['review_branch_source_segment'] = 'source';
defaultConfig['review_branch_target_segment'] = 'target';
defaultConfig['mainline_branch_name'] = 'master';
defaultConfig['support_ops_mainline_branch_name'] = 'master';
defaultConfig['support_hotfix_branch_prefix'] = 'hotfix';
defaultConfig['support_trunk_branch_prefix'] = 'trunk';
defaultConfig['devops_pipelines_branch'] = 'master';
defaultConfig['reviewers'] = [];
defaultConfig['ops_reviewers'] = [];

defaultConfig['trunk_alias_spec'] = '%s';
defaultConfig['trunk_candidate_alias_spec'] = '%s-candidate';

defaultConfig['defaultThemes'] = {
  light: {
    plain: [],
    useful: 'blue',
    trivial: 'gray',
    good: 'green',
    warn: 'yellow',
    bad: 'red',
    bulletChar: '\u25CF',
    arrowChar: '\u25B6',
    spinner: ['\u25C0', '\u25B2', '\u25B6', '\u25BC']

  },
  dark: {
    plain: [],
    useful: 'cyan',
    trivial: 'gray',
    good: 'green',
    warn: 'yellow',
    bad: 'brightRed',
    bulletChar: '\u25CF',
    arrowChar: '\u25B6',
    spinner: ['\u25C0', '\u25B2', '\u25B6', '\u25BC']
  }
}

defaultConfig['qualifiers'] = {
  default: 'RGSTAY',
  azure_devops: ['RGSTAY'],
  other: ['TEST']
};

defaultConfig['versions_files'] = {
  bundle_config_spec: 'stay/%s/config.json',
  changeset_spec: 'stay/%s/changesets/%s.yml',
  shipment_spec: 'stay/%s/shipments/%s.yml',
  alias_spec: 'stay/%s/%s.yml',
  trunk_spec: Path.join('stay/%s/', defaultConfig['trunk_alias_spec'], '.yml'),
  user_spec: 'stay/user/%s.yml',
  base_versions_path: 'stay/base.yml',
  ops_shipment_spec: 'stay/deploy/%s.yml',
  lock_spec: 'stay/locks/%s.lock',
  rdeploy_config_path: 'stay/rdeploy/config.json',
  rdeploy_config_altspec: 'stay/rdeploy/config-%s.json',
  rdeploy_config_devtest_path: 'stay/rdeploy/config-devtest.json',
  rdeploy_config_artifacts_path: 'stay/rdeploy/artifacts-metadata.yml',
  rdeploy_config_root: 'stay/rdeploy',
  repo_host: 'github',
  repo_path: 'stay-versions-files',
  mainline: 'master'
};

defaultConfig['repo_hosts'] = {
  agilysys: {
    gitBaseUrlSpec: 'ssh://git@stash.agilysys.local:7999/%s.git',
    gitBrowseUrlSpec: 'http://stash.agilysys.local/projects/%s/repos/%s/browse/%s',
    pullRequestUrlSpec: 'http://stash.agilysys.local/projects/%s/repos/%s/pull-requests/%s'
  },
  azure: {
    gitBaseUrlSpec: 'git@ssh.dev.azure.com:v3/agilysys/%s',
    gitBrowseUrlSpec: 'https://dev.azure.com/agilysys/%s/_git/%s?path=%s',
    pullRequestUrlSpec: 'https://dev.azure.com/agilysys/%s/_git/%s/pullrequest/%s'
  },
  github: {
    gitBaseUrlSpec: 'git@github.com:Agilysys-Inc/%s.git', // TODO: Need to update to https.
//    gitBaseUrlSpec: 'https://github.com/Agilysys-Inc/%s.git',
    gitBrowseUrlSpec: 'https://github.com/Agilysys-Inc/%s',
    pullRequestUrlSpec: 'https://github.com/Agilysys-Inc/%s/pull/%s'
  }
};

defaultConfig['x_ray'] = {
  dir: Path.join(defaultConfig['dotDir'], 'x-ray'),
  app_group_id: 'com.agilysys',
  app_artifact_id: 'x-ray',
  artifact_spec: '%s:%s:zip:x-ray',
  action: 'analyze',
  node_filter: '^(REST:|RMQ:|SOAP:|QUARTZ:)',
  diff_file: 'diff.txt',
  output_file: 'output.txt'
};

defaultConfig['debug'] = {
  keep_temp: false,
  no_checkout_versions_repo: false,
  notify_during_dry_run: false,
  skip_azure_devops_interaction: false
  // all_bundle_names: Set in ~/.rboss/config.json only
};

defaultConfig['rboss'] = {
  all_bundle_names: ['svc', 'ui', 'naag']
};

defaultConfig['teams'] = {
  channels_enabled: true,
  channels: {
    "#stay-deployments": {
      name: "rGuest Stay / Deployments",
      channel_url: "https://teams.microsoft.com/l/channel/19%3ac5cbf57984de4b21a3723ee098f0b676%40thread.skype/Deployments?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-137.westus.logic.azure.com:443/workflows/7ec7db4c29d4420ea4edfea2e8703599/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=fb1Mjk7RvlME3hTZWwhQAfevOsM4yCQdDDun19p9O1Y"
    },
    "#stay-notification-testing": {
      name: "rGuest Stay / Notification Testing",
      channel_url: "https://teams.microsoft.com/l/channel/19%3a9c19f4f9eae941388d40d0dda893fefb%40thread.skype/Shipments?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-125.westus.logic.azure.com:443/workflows/4ef062907b224c8f9241501c1cc79b9a/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=7ai1z5Maj_NAb-uU2LWQg0mEX4bJaLYnM_gHdBbGbl4"
    },
    "#stay-changesets": {
      name: "rGuest Stay / Changesets",
      channel_url: "https://teams.microsoft.com/l/channel/19%3a97a1eed967754b26a3ebc8eb90276fa5%40thread.skype/Changesets?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-45.westus.logic.azure.com:443/workflows/2142bb5d5d204acb95be09eba19e7e2f/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=HB5xZ6di8i0vGG7ooUD6PdKjnTGXSeX-DoGQzS6Xumk"
    },
    "#stay-jenkins-builds": {
      name: "rGuest Stay / Jenkins Builds",
      channel_url: "https://teams.microsoft.com/l/channel/19%3a3fc8bc6c26e54477a849c1ae92e1314d%40thread.skype/Jenkins%2520Builds?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-122.westus.logic.azure.com:443/workflows/2d21fb5eda4543bd82835f0637f30051/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=uE18MlTHn8tN8G_fVMGOw-2m52LizVWfwhr6_U0yzQg"
    },
    "#stay-release-pipe": {
      name: "rGuest Stay / Release Pipe",
      channel_url: "https://teams.microsoft.com/l/channel/19%3a50d3166409ae4542b60a3eaf57ed8d00%40thread.skype/Release%2520Pipe?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-04.westus.logic.azure.com:443/workflows/3d3b970cd63d47ed83ca90cac912b4c4/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=jgW3dXXQ0P-NUNSCtIzstk4M2IBtPF3VwiG0OfSdh98"
    },
    "#stay-release-pipe-trunks": {
      name: "rGuest Stay / Release Pipe (Trunks)",
      channel_url: "https://teams.microsoft.com/l/channel/19%3acbb275c546f04787904967f52885f19e%40thread.skype/Release%2520Pipe%2520(Trunks)?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-37.westus.logic.azure.com:443/workflows/25a126098afc4c9d9cc176294256286c/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=x7LvRMZ9no6CWNiYEtwfb1BprnS40MaKY64JwaEhiU8"
    },
    "#stay-release-managers": {
      name: "rGuest Stay / Release Approvers",
      channel_url: "N/A for private channels",
      webhook_url: "https://prod-11.westus.logic.azure.com:443/workflows/5b9729b53521482e90c2d1f494d3c16d/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=MBAS138BTV0v8pwMhcSnXDimbwMRR1Q6XZTqFqHe__A"
    },
    "#stay-approvals-prod": {
      name: "rGuest Stay / Production Deployment Approval",
      channel_url: "N/A for private channels",
      webhook_url: "https://prod-57.westus.logic.azure.com:443/workflows/3c4f5962a16248d6a30c485c8390a4d9/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=V2VGqb2uyhZa3iwBofrlIt2iU1J961YhFlTBdKQUv5w"
    },
    "#stay-approvers-qa": {
      name: "rGuest Stay / QA Deployment Approval",
      channel_url: "",
      webhook_url: "https://prod-125.westus.logic.azure.com:443/workflows/0f3225a6517547aa92f8888b737fd33b/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=KorkHmoTd_SEZuychWUn5x7e8eDsig85TKwXb4vqSEg"
    },
    "#stay-pull-requests": {
      name: "rGuest Stay / Pull Requests",
      channel_url: "https://teams.microsoft.com/l/channel/19%3aeb3c7463b85f46b88e35b4594e4da95a%40thread.skype/Pull-requests?groupId=3e85caa3-6780-41b6-8c87-bfb93d297305&tenantId=9750a820-9364-4bc3-9990-123c1645274b",
      webhook_url: "https://prod-100.westus.logic.azure.com:443/workflows/64270e0e58784a2d865a72a1d6fd39d7/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=GLgpRCO7dazoeX8f1M5vhCWLoXQPzp5b1OO_45IWpAY"
    },
  },
  message_defaults: {
    channel: "#stay-changesets"
  }
};

defaultConfig['azure'] = {
  artifact_info_url: 'https://pkgs.dev.azure.com/{{organization}}/{{project}}/_apis/packaging/feeds/{{feed}}/maven/groups/{{groupId}}/artifacts/{{artifactId}}/versions/{{version}}?api-version=5.1-preview.1',
  feeds: {
    stay: {
      organization: "agilysys",
      project: "Stay",
      feed: "PMS"
    }
  }
}

defaultConfig['github'] = {
  artifact_info_url: 'https://api.github.com/orgs/{{organization}}/packages/maven/{{groupId}}.{{artifactId}}/versions',
  package: {
    stay: {
      organization: "Agilysys-Inc"
    }
  }
};

defaultConfig['environments'] = {
  k3d: {
    "containerRegistry": "agysacrdev",
    "promoteRegistry": "agysacrprod",
    "config_repo": {
      "repo_host": "azure",
      "repo_path": "Stay/config-repo"
    },
    "env_repo": {
      "repo_host": "azure",
      "repo_path": "Stay/environments"
    }
  },
  lab: {
    "containerRegistry": "agysacrdev",
    "promoteRegistry": "agysacrprod",
    "config_repo": {
      "repo_host": "azure",
      "repo_path": "Stay/config-repo"
    },
    "env_repo": {
      "repo_host": "azure",
      "repo_path": "Stay/environments"
    }
  },
  aks: {
    "containerRegistry": "agysacrdev",
    "promoteRegistry": "agysacrprod",
    "config_repo": {
      "repo_host": "azure",
      "repo_path": "Stay/config-repo"
    },
    "env_repo": {
      "repo_host": "azure",
      "repo_path": "Stay/environments"
    }
  }
}

/**
 * @class
 * @param {{}} defaults
 */
function Config (defaults) {
  this.$extend(defaults);
}

Config.prototype.$extend = function (config) {
  overlay(this, config);
  this.centralRepoUrl = this.artifactoryBaseUrl + '/artifactory/repo/';
  this.releaseRepoUrl = this.artifactoryBaseUrl + '/artifactory/libs-release-local/';
  this.releaseGithubPackageUrl = this.githubApiBaseUrl + '/orgs/';
  return this;
};

/**
 * @function overlay
 * Recursively copy members of one object to another by key.
 *
 *  var dest = {a:1};
 *  overlay(dest, {b:2}, {c:3});
 *  // dest is now {a:1, b:2, c:3}
 */
function overlay (/* arguments */) {
  let args = Array.prototype.slice.call(arguments);
  let dest = args.shift();
  if (typeof(dest) !== 'object') throw new Error('invalid argument');
  for (let i = 0; i < args.length; i++) {
    let src = args[i];
    if (typeof(src) === 'undefined') continue;
    if (typeof(dest) !== typeof(src)) throw new Error('type mismatch');
    if (dest === src) continue;
    for (let k in src) {
      if (src.hasOwnProperty(k)) {
        if (typeof(dest[k]) === 'function') {
          dest[k] = src[k];
        } else if (typeof(dest[k]) === 'object') {
          overlay(dest[k], src[k]);
        } else {
          dest[k] = src[k];
        }
      }
    }
  }
  return dest;
}

module.exports = new Config(defaultConfig);
