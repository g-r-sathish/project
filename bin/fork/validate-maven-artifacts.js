require('colors');

const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const artifactory = require('../../lib/common/artifactory');
const {ForkedProjectOp} = require('../../lib/classes/ForkedProjectOp');
const util = require('../../lib/common/util');
const {VersionEx} = require('../../lib/classes/VersionEx');

/** @class ValidateMavenArtifactsFork */

process.on('message', message => {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      let released = 0;
      const version = VersionEx.fromJsonObject(input.version);
      const missing = [];
      ForkedProjectOp.sendInterim(project.dirname, version.toString().plain);
      _.each(project.getArtifacts(), artifact => {
        if (artifactory.isGithubPackageReleased(artifact, version)) {
          released++;
        } else {
          missing.push({
            artifact: artifact,
            version: version
          })
        }
      });
      if (released) {
        ForkedProjectOp.sendInterim(project.dirname, sprintf('%d released'.useful, released));
      }
      if (missing.length) {
        ForkedProjectOp.sendInterim(project.dirname, sprintf('%d missing'.bad, missing.length));
      }
      if (released + missing.length === 0) {
        ForkedProjectOp.sendInterim(project.dirname, 'No artifacts'.trivial.italic);
      }
      ForkedProjectOp.sendFinal(project.dirname, undefined, true, {
        missing: missing
      })
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
});