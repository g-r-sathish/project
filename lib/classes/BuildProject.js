const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;
const util = require('../common/util');

const {POM} = require('./POM');
const {Project} = require('./Project');
const {VersionEx} = require('./VersionEx');

class BuildProject extends Project {
  static create(definition, options, instanceName, trunkDefinitions) {
    const project = new BuildProject();
    Project.create(project, definition, options, instanceName, trunkDefinitions);
    project.pom = null;
    project.type = 'build';
    return project;
  }

  static fromJsonObject(object) {
    const project = new BuildProject();
    Project.fromJsonObject(project, object);
    project.pom = POM.fromJsonObject(object.pom);
    return project;
  }

  checkout(branch) {
    this.repo.checkout(branch); // will also pull
    this.reload();
    return this;
  }

  checkoutDetached(tag) {
    this.repo.checkoutDetached(tag);
    this.reload();
    return this;
  }

  getArtifacts() {
    return util.asArray(this.definition.artifact);
  }

  getDockerImage() {
    return this.definition.docker_image;
  }

  getName() {
    return this.pom
      ? this.pom.getName()
      : this.definition.repo_path;
  }

  getPrimaryVersionsKey() {
    return util.asArray(this.definition.versions_key)[0];
  }

  getReleasedVersion() {
    let version = new VersionEx(this.getVersion());
    return version.isSnapshot() ? version.getPriorReleaseString() : version.toString();
  }

  getVersion() {
    return this.pom ? this.pom.getVersion() : undefined;
  }

  getVersionsKey() {
    return this.definition.versions_key;
  }

  getXRayArtifacts() {
    return util.asArray(this.definition.x_ray_artifact);
  }

  hasActiveDependencies() {
    return !!this.definition.active_dependencies;
  }

  overlayJsonObject(object) {
    super.overlayJsonObject(object);
    this.pom = POM.fromJsonObject(object.pom);
    this.type = object.type;
  }

  reload() {
    let pomPath = sprintf('%s/%s', this.getProjectDir(), 'pom.xml');
    if (util.fileExists(pomPath)) {
      this.pom = POM.create(pomPath);
    }
    return this;
  }

  toJsonObject() {
    const object = super.toJsonObject();
    if (this.pom) {
      object.pom = this.pom.toJsonObject();
    }
    object.type = this.type;
    return object;
  }
}

module.exports.BuildProject = BuildProject;
