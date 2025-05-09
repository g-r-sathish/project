const errorMaker = require('custom-error');

module.exports.CommitGraphError = errorMaker('CommitGraphError');
module.exports.CommitNotFoundError = errorMaker('CommitNotFoundError');
module.exports.LockedError = errorMaker('LockedError');
module.exports.TargetMergeError = errorMaker('TargetMergeError');
