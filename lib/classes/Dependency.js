const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError');
const util = require('../common/util');

function isPropertyReference (value) {
  return util.isPresent(value) && /^\$\{/.test(value) && /\}$/.test(value);
}

function buildName () {
  return _.filter(arguments, function (item) { return util.isPresent(item); }).join(':');
}

class Dependency {
  static PROJECT_VERSION = 'project.version';

  static create(xmlAsJson, location, parentPom) {
    const dependency = new Dependency();
    dependency.xmlAsJson = xmlAsJson;
    dependency.location = location;
    if (parentPom) {
      dependency.parentCanonicalArtifactId = parentPom.getCanonicalArtifactId();
      dependency.parentProperties = parentPom.getProperties();
      dependency.parentGroupId = parentPom.getGroupId();
      dependency.parentVersion = parentPom.getVersion();
    }
    return dependency;
  }

  static fromJsonObject(object) {
    const dependency = new Dependency();
    _.extend(dependency, object);
    return dependency;
  }

  getGroupId() {
    return this.xmlAsJson['groupId'] || this.parentGroupId;
  }

  getArtifactId() {
    return this.xmlAsJson['artifactId'];
  }

  getType() {
    return this.xmlAsJson['type'] || 'jar';
  }

  getClassifier() {
    return this.xmlAsJson['classifier'];
  }

  getVersion() {
    return this.xmlAsJson['version'];
  }

  setVersion(newVersion) {
    this.xmlAsJson['version'] = newVersion;
  }

  getFullyQualifiedName() {
    return buildName(
      this.parentCanonicalArtifactId,
      this.location,
      this.getGroupId(),
      this.getArtifactId(),
      this.getType(),
      this.getClassifier()
    );
  }

  getName() {
    return buildName(
      this.getArtifactId(),
      this.getType(),
      this.getClassifier()
    );
  }

  toString() {
    return buildName(
      this.getGroupId(),
      this.getArtifactId(),
      this.getType(),
      this.getClassifier()
    );
  }

  getCanonicalArtifactId() {
    return buildName(
      this.getGroupId(),
      this.getArtifactId()
    );
  }

  isMatch(location, xmlAsJson) {
    return _.isEqual(location, this.location) &&
      xmlAsJson['groupId'] === this.xmlAsJson['groupId'] &&
      xmlAsJson['artifactId'] === this.xmlAsJson['artifactId'] &&
      xmlAsJson['type'] === this.xmlAsJson['type'] &&
      xmlAsJson['classifier'] === this.xmlAsJson['classifier'] &&
      xmlAsJson['scope'] === this.xmlAsJson['scope'];
  }

  isVersionAPropertyReference() {
    return isPropertyReference(this.getVersion());
  }

  isProjectVersionReference() {
    let version = this.getVersion();
    if (isPropertyReference(version)) {
      let name = version.replace(/^\$\{|\}$/g, '');
      return name === Dependency.PROJECT_VERSION;
    }
    return false;
  }

  /**
   * A dependency can, and often does, have its version provided by a property in another POM.
   * This common utility handles the case where the property references yet another property.
   */
  getResolvedVersion() {
    let version = this.getVersion();
    while (isPropertyReference(version)) {
      let name = version.replace(/^\$\{|\}$/g, '');

      let parentVersion = name === 'project.version' ? this.parentVersion : this.parentProperties[name];
      if (!parentVersion) {
        throw new BuildError(sprintf("Cannot resolve %s", name));
      }
      version = parentVersion;
    }
    return version;
  }
}

module.exports.Dependency = Dependency;
