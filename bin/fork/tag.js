require('colors');

const {ForkedProjectOp} = require('../../lib/classes/ForkedProjectOp');
const util = require('../../lib/common/util');

/** @class TagFork */

process.on('message', message => {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      if (!input.included && input.priorTag) {
        project.repo.confirmHeadIsAtTag(input.priorTag);
      }
      project.repo.tag(input.tag, input.commitMessage);
      ForkedProjectOp.sendFinal(project.dirname, 'Tagged'.good, true, undefined);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
});