require('colors');

const docker = require('../../lib/common/docker').dockerService;
const {ForkedProjectOp} = require('../../lib/classes/ForkedProjectOp');
const util = require('../../lib/common/util');
const {VersionEx} = require('../../lib/classes/VersionEx');

/** @class ValidateDockerImageFork */

process.on('message', message => {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      let image = project.getDockerImage();
      const version = VersionEx.fromJsonObject(input.version);
      ForkedProjectOp.sendInterim(project.dirname, image.plain);
      ForkedProjectOp.sendInterim(project.dirname, version.toString().plain);
      if (docker.isImageReleased(image, version)) {
        ForkedProjectOp.sendFinal(project.dirname, 'Released'.useful, true, undefined);
      } else {
        ForkedProjectOp.sendFinal(project.dirname, 'Missing'.bad, true, {missingImage: true});
      }
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
});