const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;
const config = require('../../common/config');
const util = require('../../common/util');
const releasePipe = require('../../common/release-pipe');

function updateSourceControl (bundle, commitMessage) {
  util.announce('Updating source control'.plain);
  util.startBullet(bundle.versionsRepo.dirname.plain);
  if (bundle.versionsRepo.checkIn({ message: commitMessage })) {
    util.endBullet('Committed & pushed'.good);
  } else {
    util.endBullet('No changes'.warn);
  }
}

module.exports['update'] = {
  heading: 'Updating release pipes',
  summary: 'Set the release constraint for each pipe',
  requiredArguments: ['constraint'],
  optionalArguments: ['include', 'dry-run'],
  requiredSettings: [],

  callback: function (bundle, params) {
    util.startBullet(config.bundleName.plain);
    let newConstraint = config._all.constraint;
    let oldConstraint = bundle.getReleaseConstraint();
    if (oldConstraint !== newConstraint) {
      util.endBullet(sprintf('%s -> %s', oldConstraint.trivial, bundle.setReleaseConstraint(newConstraint).good));
      updateSourceControl(bundle, params.heading);
      releasePipe.notifyOnConstraintChange(config.bundleName, oldConstraint, newConstraint);
    } else{
      util.endBullet(oldConstraint.warn);
    }
  }
};
