//  Copyright (C) Agilysys, Inc. All rights reserved.

const {GitBackedYAMLFile} = require('./GitBackedYAMLFile');

class ApplicationFile extends GitBackedYAMLFile {
  constructor(path, {dryRun=false}) {
    super(path, {required: true, dryRun: dryRun});
  }

  enableTestpool() {
    return this.data.testPool = true;
  }

  disableTestpool() {
    return this.data.testPool = false;
  }
}

module.exports.ApplicationFile = ApplicationFile;