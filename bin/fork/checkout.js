const _ = require('underscore');

const config = require('../../lib/common/config');
const {ForkedProjectOp} = require('../../lib/classes/ForkedProjectOp');
const util = require('../../lib/common/util');

/** @class CheckoutFork */

function output(project) {
  return { project: project.toJsonObject() };
}

process.on('message', message => {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      input.options = _.extend({
        workDir: config.workDir
      }, input.options);
      const label = project.init(input.options);
      if (label) {
        const update = util.repoStatusText(label, input.options.workDir, project.repo.clonePath);
        ForkedProjectOp.sendFinal(project.dirname, update, true, output(project));
      } else if (input.options.okIfMissing) {
        const update = util.repoStatusText(project.repo.branchName, input.options.workDir, project.repo.clonePath);
        ForkedProjectOp.sendFinal(project.dirname, update, true, output(project));
      } else {
        ForkedProjectOp.sendFinal(project.dirname, 'Missing'.bad, false, output(project));
      }
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
});