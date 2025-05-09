const _ = require('underscore');
const colors = require('colors');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const config = require('../../../common/config');
const maven = require('../../../common/maven').mavenService;
const util = require('../../../common/util');

module.exports['x-ray'] = {
  summary: 'Run x-ray to identify impacts',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['use-cwd', 'max-fork-count'],
  requiredSettings: [],
  optionalSettings: ['rflow_workdir'],
  notificationSettings: {
    skip: true
  },
  callback: function (bundle, goal) {
    let _hasFailedArtifact = false;

    function xrayPath(localPath) {
      return Path.join(config.x_ray.dir, localPath);
    }

    function processArtifact(artifact, mavenOp, options) {
      let artifactPath = xrayPath(artifact);
      util.continueBullet(artifact.plain);
      if (artifact.indexOf('SNAPSHOT') > 0 || !util.directoryExists(artifactPath)) {
        util.removeDirectory(artifactPath);
        if (mavenOp(artifactPath)) {
          toKeep.push(artifactPath);
          util.endBullet('Loaded'.good);
        } else {
          _hasFailedArtifact = true;
          util.removeDirectory(artifactPath); // to ensure we try again next time
          util.endBullet('Failed'.bad);
        }
      } else {
        toKeep.push(artifactPath);
        util.endBullet('Cached'.trivial);
      }
      return artifactPath;
    }

    bundle.init({ workDir: util.cwd() });
    if (!config.x_ray.app_version) {
      throw new BuildError(sprintf('x-ray is not configured for %s', config.bundleName));
    }

    // generate diff
    util.println("Generating diff file".inverse);
    let diffPath = xrayPath(config.x_ray.diff_file);
    util.removeFile(diffPath);
    _.each(bundle.projects.included, function (project) {
      util.startBullet(project.dirname.plain);
      let releaseTag = sprintf(config.releaseTagSpec, config.bundleName, bundle.changeset.getBundleVersion());
      project.repo.git('fetch', 'origin', project.repo.doesTagExist(releaseTag) ? releaseTag : project.getMainlineBranchName());
      let content = project.repo.gitCapture('diff', 'FETCH_HEAD', '--unified=1');
      if (content) {
        util.appendFile(diffPath, content);
        let count = (content.match(/diff --git/g) || []).length;
        util.endBullet(sprintf('%d changes'.good, count));
      } else {
        util.endBullet('No changes'.trivial);
      }
    });

    util.announce('Assembling x-ray artifacts'.plain);

    // identify what we have cached
    let cache = util.readSubdirectories(config.x_ray.dir);
    let toKeep = [];

    // download x-ray app
    util.startBullet('x-ray application'.plain);
    let appArtifact = sprintf('%s:%s:%s:jar', config.x_ray.app_group_id, config.x_ray.app_artifact_id, config.x_ray.app_version);
    let appArtifactPath = processArtifact(appArtifact, function (artifactPath) {
      return maven.copy(appArtifact, artifactPath);
    });

    // TODO: FORK THIS - will require restructuring
    // assemble artifacts
    _.each(bundle.projects.valid, function (project) {
      _.each(project.getXRayArtifacts(), function (name) {
        util.startBullet(project.dirname.plain);
        let artifact = sprintf(config.x_ray.artifact_spec, name, bundle.changeset.getVersion(project.getPrimaryVersionsKey()));
        processArtifact(artifact, function (artifactPath) {
          return maven.unpack(artifact, artifactPath, {okToFail: true});
        });
      }, this);
    }, this);

    // remove everything we're not keeping
    if (cache && cache._length > 0) {
      util.startBullet('Removing undesirables'.plain);
      _.chain(cache).without(toKeep).each(function (path) {
        util.removeDirectory(path);
      });
      util.endBullet('Completed'.good);
    }

    // run x-ray
    util.announce('Running x-ray'.plain);
    let args = [
      '-jar',
      sprintf('%s.jar', config.x_ray.app_artifact_id),
      config.x_ray.action,
      Path.join('..', config.x_ray.diff_file),
      Path.join('..', config.x_ray.output_file),
      config.x_ray.node_filter,
      '..',
      'false'
    ];
    util.exec('java', args, appArtifactPath);

    let output = util.readFile(xrayPath(config.x_ray.output_file));
    if (output) {
      let lines = _.filter(output.split(/[\r\n]+/), function (line) {
        return line && line.length > 0
      });
      _.each(lines, function (line) {
        let fields = line.split(':');
        util.printf('%s: '.useful, fields.shift());
        util.println(fields.join(':'));
      });

      util.announce('Generating JIRA text'.plain);
      util.println('Copy/paste the following block into the changeset JIRA ticket for proof of compliance:');
      util.printf('{panel:title=X-Ray Results for %s:%s}\n'.trivial.italic, config.changesetId.bundleName, config.changesetId.trackingId);
      _.each(lines, function (line) {
        let fields = line.split(':');
        util.printf('%s: '.trivial.italic, fields.shift());
        util.println(fields.join(':').replace(/\{http(.*?)}/g, 'http$1 ').replace(/\{(.+?)\}/g, '_$1_').trivial.italic);
      });
      util.println('{panel}'.trivial.italic);
    } else {
      util.println('No impacts identified'.warn.bold);
    }
    if (_hasFailedArtifact) {
      util.println('Results are NOT reliable due to missing artifacts!'.bold.bad);
    }
  }
};
