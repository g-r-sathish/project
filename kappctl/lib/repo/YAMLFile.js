//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const mkdirp = require('mkdirp');
const Path = require("path");
const tk = require('../util/tk');
const jsyaml = require('js-yaml');
const tmp = require('tmp');
const {log} = require("../util/ConsoleLogger");
const {FileNotFoundError} = require("../util/tk");
tmp.setGracefulCleanup();

class YAMLFile {
  static OPTIONS = {lineWidth: 200};
  static ENCODING = 'utf8';

  /**
   * Load multi-document YAML content into separate document objects
   * @param {string} content
   * @returns {object[]}
   */
  static multiLoad(content) {
    let buffer = '';
    let contentParts = [];
    for (const line of content.split(/[\r\n]+/)) {
      if (line === '---') {
        if (buffer) {
          contentParts.push(buffer);
        }
        buffer = '';
      } else {
        buffer += line + "\n";
      }
    }
    if (buffer) {
      contentParts.push(buffer);
    }
    let documents = [];
    for (const part of contentParts) {
      if (part) {
        documents.push(jsyaml.load(part));
      }
    }
    return documents;
  }

  static mktemp(data) {
    const file = tmp.fileSync({
      tmpdir: os.tmpdir(),
      mode: 0o644,
      postfix: '.yaml',
      discardDescriptor: true
    });
    return YAMLFile.newFile(file.name, data);
  }

  static newFile(path, data) {
    const yamlFile = new YAMLFile(path, {});
    if (data) {
      yamlFile.data = data;
      yamlFile.save();
    }
    return yamlFile;
  }

  constructor(path, {flatten = false, required = false, sortKeys = false} = {}) {
    this.path = undefined;
    this.data = undefined;
    this._exists = false;
    this.options = {
      flatten: flatten,
      sortKeys: sortKeys,
      vivify: !required
    };
    if (path) {
      if (required && !fs.statSync(path).isFile()) {
        throw new FileNotFoundError(path);
      }
      this.load(path, !required);
    }
  }

  exists() {
    return this._exists;
  }

  reload(path, vivify = true) {
    return this.load(this.path);
  }

  load(path, vivify = true) {
    try {
      let content = fs.readFileSync(path, YAMLFile.ENCODING);
      this.data = jsyaml.load(content);
      this._exists = true;
    } catch (e) {
      if (vivify) {
        log.debug(e);
        this.data = {};
      } else {
        throw e;
      }
    }
    this.path = path;
    return this;
  }

  stringify() {
    let data = this.options.flatten ? tk.flatten(this.data) : this.data;
    let dumpOptions = _.extend({}, YAMLFile.OPTIONS, {sortKeys: this.options.sortKeys});
    return "---\n" + jsyaml.dump(data, dumpOptions);
  }

  save() {
    if (this.options.vivify) {
      const dir = Path.dirname(this.path);
      if (!fs.existsSync(dir)) {
        mkdirp.sync(dir);
      }
    }
    fs.writeFileSync(this.path, this.stringify(), YAMLFile.ENCODING);
    this._exists = true;
    return this;
  }

  /**
   * Get data value
   * @param {string|Array} path
   * @param {*} defaultValue
   * @returns {*}
   */
  get(path, defaultValue = undefined) {
    return _.get(this.data, path, defaultValue);
  }

  /**
   * Remove data at given path
   * @param {string} path
   * @returns {*}
   */
  unset(path) {
    return _.unset(this.data, path);
  }

  /**
   * Set data value
   * @param {string|Array} path
   * @param {*} value
   * @returns {*}
   */
  set(path, value) {
    return _.set(this.data, path, value);
  }
}

module.exports.YAMLFile = YAMLFile;
