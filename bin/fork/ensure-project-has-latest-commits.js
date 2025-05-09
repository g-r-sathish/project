const rcUtil = require('../../lib/common/rc-util');

process.on('message', message => rcUtil.ensureProjectHasLatestCommitsForked(message));