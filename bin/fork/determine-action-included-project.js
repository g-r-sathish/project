const mergeUtil = require('../../lib/common/merge-util');

process.on('message', message => mergeUtil.determineActionForIncludedProjectForked(message));