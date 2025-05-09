const _ = require('underscore');
const Path = require('path');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('./BuildError')
const config = require('../common/config');
const {Dependency} = require('./Dependency');
const maven = require('../common/maven').mavenService;
const util = require('../common/util');

class POM {
  static Location = {
    DEPENDENCIES: ['project', 'dependencies', 'dependency'],
    DEPENDENCY_MANAGEMENT: ['project', 'dependencyManagement', 'dependencies', 'dependency'],
    PARENT: ['project', 'parent'],
    PROFILE_DEPENDENCIES: ['project', 'profiles', 'profile', 'dependencies', 'dependency'],
    PROFILE_DEPENDENCY_MANAGEMENT: ['project', 'profiles', 'profile', 'dependencyManagement', 'dependencies',
      'dependency'],
  }

  static create(pathname, options) {
    const pom = new POM();
    pom.options = _.extend({
      detached: false, // completely independent
    }, options);
    if (pom.pathname && !util.fileExists(pathname)) {
      throw new BuildError(sprintf("File does not exist: %s", pathname));
    }
    if (util.directoryExists(pathname)) {
      pom.dir = pathname;
      pom.pathname = Path.join(pathname, 'pom.xml');
    } else {
      pom.pathname = pathname;
      pom.dir = Path.dirname(pathname);
    }
    pom.dirname = Path.basename(pom.dir);
    pom.modules = [];
    pom.dependencies = [];
    pom.xmlAsJson = pom.readFile(pathname);
    if (!pom.options.detached) {
        pom.readDependencies();
        pom.readModules();
    }
    return pom;
  }

  static fromJsonObject(object) {
    if (!object) return undefined;

    const pom = new POM();
    _.extend(pom, object);
    pom.modules = [];
    if (object.modules && object.modules.length) {
      _.each(object.modules, module => pom.modules.push(POM.fromJsonObject(module)));
    }
    pom.dependencies = [];
    if (object.dependencies && object.dependencies.length) {
      _.each(object.dependencies, dependency => pom.dependencies.push(Dependency.fromJsonObject(dependency)));
    }
    return pom;
  }

  findDependencies(id, options) {
    options = _.extend({
      ignoreParents: false
    }, options);
    return _.filter(this.dependencies, dependency => {
      return dependency.getCanonicalArtifactId() === id &&
        (!options.ignoreParents || dependency.location !== Location.PARENT);
    });
  }

  getArtifactId() {
    return POM._findNode(this.xmlAsJson, 'project', 'artifactId');
  }

  getCanonicalArtifactId() {
    return [this.getGroupId(), this.getArtifactId()].join(':');
  }

  getFilePaths() {
    return [this.pathname].concat(_.pluck(this.modules, 'pathname'));
  }

  getFilteredDependencies(filterFunction) {
    let result = _.filter(this.dependencies, filterFunction);

    _.each(this.modules, function (module) {
      result = result.concat(module.getFilteredDependencies(filterFunction));
    }, this);

    return result;
  }

  getFullyQualifiedDependency(id) {
    let matches = _.filter(this.dependencies, function (dep) {
      return dep.getFullyQualifiedName() === id;
    });
    if (matches.length > 1) {
      util.narratef('Multiple matching dependencies for %s\n', id);
    }
    return matches.length > 0 ? matches[0] : undefined;
  }

  getGroupId() {
    return POM._findNode(this.xmlAsJson, 'project', 'groupId') ||
      POM._findNode(this.xmlAsJson, 'project', 'parent', 'groupId');
  }

  getName() {
    return POM._findNode(this.xmlAsJson, 'project', 'name');
  }

  getOwnVersion() {
    return POM._findNode(this.xmlAsJson, 'project', 'version');
  }

  getParent() {
    let parent = POM._findNode(this.xmlAsJson, 'project', 'parent');
    if (!parent) {
      return;
    }
    return Dependency.create(parent, this);
  }

  getParentVersion() {
    return POM._findNode(this.xmlAsJson, 'project', 'parent', 'version');
  }

  getProperties() {
    return POM._findNode(this.xmlAsJson, 'project', 'properties');
  }

  getVersion() {
    return POM._findNode(this.xmlAsJson, 'project', 'version') || this.getParentVersion();
  }

  mvn() {
    let settingsXml = maven.getSettingsXmlPath();
    let args = Array.prototype.slice.call(arguments);
    if (settingsXml) {
      args.unshift(settingsXml);
      args.unshift('-s');
    }
    util.exec('mvn', args, this.dir);
  }
  
  readDependencies() {
    const addDependencies = location => {
      const nodes = POM._findNode(this.xmlAsJson, ...location);
      if (!nodes) return;
      _.each(util.asArray(nodes), node => {
        const dependency = Dependency.create(node, location, this);
        if (config.trackedArtifactsGroupRegex.test(dependency.getGroupId()) && dependency.getVersion()) {
          this.dependencies.push(dependency);
        }
      });
    };

    this.dependencies = [];
    addDependencies(POM.Location.PARENT);
    addDependencies(POM.Location.DEPENDENCY_MANAGEMENT);
    addDependencies(POM.Location.DEPENDENCIES);
    addDependencies(POM.Location.PROFILE_DEPENDENCIES);
    addDependencies(POM.Location.PROFILE_DEPENDENCY_MANAGEMENT);
  }

  /**
   * @param {string} pathname
   * @returns {string}
   */
  readFile(pathname) {
    try {
      return util.readXML(pathname);
    } catch (ex) {
      throw new BuildError(sprintf("Error while parsing %s: %s\n", pathname, ex.toString()));
    }
  }

  readModules() {
    this.modules = [];
    const nodes = POM._findNode(this.xmlAsJson, 'project', 'modules', 'module');
    if (!nodes) return;
    _.each(util.asArray(nodes), module => {
      let pathname = Path.join(this.dir, module, 'pom.xml');
      util.narrateln('Reading module:', pathname);
      if (util.fileExists(pathname)) {
        this.modules.push(POM.create(pathname));
      } else {
        util.narratef("Module `%s` has no `%s`\n", module, pathname);
      }
    }, this);
  }

  save() {
    this._mergeDependencies();
    util.writeXML(this.pathname, this.xmlAsJson);
    return this.pathname;
  }

  saveAll() {
    this.save();
    _.each(this.modules, function (module) {
      module.saveAll();
    }, this);
  }

  /**
   * @param {string} value
   */
  setParentVersion(value) {
    const parent = POM._findNode(this.xmlAsJson, ...POM.Location.PARENT);
    if (parent) {
      parent['version'] = value;
    }
  }

  /**
   * @param {string} value
   */
  setVersion(value) {
    const project = POM._findNode(this.xmlAsJson, 'project');
    if (project['version']) {
      project['version'] = value;
    }
    _.each(this.modules, module => {
      util.narratef("** %s parent.version: %s -> %s\n", module.toString(), module.getParentVersion(), value);
      module.setParentVersion(value);
      module._mergeVersions(POM.Location.PARENT, false);
    });
  }

  /**
   * @returns {{}}
   */
  toJsonObject() {
    const object = {};
    object.options = this.options;
    object.dir = this.dir;
    object.pathname = this.pathname;
    object.dirname = this.dirname;
    object.xmlAsJson = this.xmlAsJson;
    object.modules = [];
    if (this.modules && this.modules.length) {
      _.each(this.modules, module => object.modules.push(module.toJsonObject()));
    }
    object.dependencies = this.dependencies;
    return object;
  }

  /**
   * @returns {string}
   */
  toString() {
    return sprintf('%s (%s.%s)', this.getName(), this.getGroupId(), this.getArtifactId());
  }

  /**
   * @private
   */
  _mergeDependencies() {
    this._mergeVersions(POM.Location.PARENT, true);
    this._mergeVersions(POM.Location.DEPENDENCY_MANAGEMENT, true);
    this._mergeVersions(POM.Location.DEPENDENCIES, true);
    this._mergeVersions(POM.Location.PROFILE_DEPENDENCY_MANAGEMENT, true);
    this._mergeVersions(POM.Location.PROFILE_DEPENDENCIES, true);
  }

  /**
   * @param {string} location
   * @param {boolean} dependencyWins
   * @private
   */
  _mergeVersions(location, dependencyWins) {
    const nodes = POM._findNode(this.xmlAsJson, ...location);
    if (!nodes) return;

    _.each(util.asArray(nodes), node => {
      const match = _.find(this.dependencies, dependency => dependency.isMatch(location, node));
      if (match && node['version'] !== match.getVersion()) {
        if (dependencyWins) {
          node['version'] = match.getVersion();
        } else {
          match.setVersion(node['version']);
        }
      }
    });
  }

  /**
   *
   * @param {{}} xmlAsJson
   * @param {string} names
   * @returns {[]|{}|undefined}
   * @private
   */
  static _findNode(xmlAsJson, ...names) {
    let node = xmlAsJson;

    let name;
    while (name = names.shift()) {
      const child = node[name];

      if (child) {
        node = child;
      } else if (!child && node['#']) {
        // mixed mode array
        let array = [];
        _.each(node['#'], element => {
          if (element[name]) {
            array.push(element[name]);
          }
        });
        node = _.flatten(array);
      } else {
        return undefined;
      }
    }
    return node;
  }
}

module.exports.POM = POM;
