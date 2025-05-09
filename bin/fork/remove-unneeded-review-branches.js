const reviewUtil = require('../../lib/common/review-util');

process.on('message', message => reviewUtil.removeUnneededReviewBranchesForked(message));