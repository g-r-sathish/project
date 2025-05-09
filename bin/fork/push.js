require('colors');

const {ForkedProjectOp} = require('../../lib/classes/ForkedProjectOp');
const util = require('../../lib/common/util');

/** @class PushFork */

process.on('message', message => {
  ForkedProjectOp.processOnFork(message, (project, input) => {
    try {
      project.repo.push();
      ForkedProjectOp.sendFinal(project.dirname, 'Pushed'.good, true, undefined);
    } catch (ex) {
      util.narrateln(ex.stack);
      ForkedProjectOp.sendFinal(project.dirname, ex.toString().bad, false, undefined);
    }
  });
});