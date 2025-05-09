//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require('underscore');
const assert = require('assert').strict;
const errorMaker = require('custom-error');
const util = require('../common/util');

class YAMLFile {
  static FileNotFoundError = errorMaker('FileNotFoundError');
  static FileStructureError = errorMaker('FileStructureError');

  constructor(path, required=false) {
    this.path = undefined;
    this.data = undefined;
    if (path) {
      if (required && !util.fileExists(path)) {
        throw new YAMLFile.FileNotFoundError(`Required file does not exist: ${path}`);
      }
      this.load(path);
    }
  }

  load(path, vivify=true) {
    try {
      this.data = util.readYAML(path)
    } catch (ex) {
      if (vivify) {
        util.narrateln(ex);
        this.data = {};
      } else {
        throw ex;
      }
    }
    this.path = path;
    return this;
  }

  save() {
    util.writeYAML(this.path, this.data);
    return this;
  }

  saveAs(path) {
    util.writeYAML(path, this.data);
    this.path = path;
    return this;
  }

  get(path, defaultValue) {
    assert.ok(path);
    const segments = path.split('.');
    return _.get(this.data, segments, defaultValue);
  }

  set(path, value) {
    assert.ok(path);
    const segments = path.split('.');
    return _.set(this.data, segments, value);
  }
}

module.exports = YAMLFile;
