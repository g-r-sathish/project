const rflowUtil = require('../../lib/common/rflow-util');

process.on('message', message => rflowUtil.updateSourceControlForked(message));