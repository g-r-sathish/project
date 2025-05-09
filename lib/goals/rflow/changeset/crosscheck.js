const _ = require('underscore');

const {ChangesetFile} = require('../../../classes/ChangesetFile');
const rflowUtil = require('../../../common/rflow-util');

module.exports['crosscheck'] = {
  summary: 'Cross-check versions',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: [],

  callback: function (bundle, goal) {
    bundle.init();
    rflowUtil.ensureStatusIs(bundle.changeset,
      [ChangesetFile.Status.DEV, ChangesetFile.Status.RC, ChangesetFile.Status.RELEASED]);
    rflowUtil.ensureCorrectPomAndDependencyVersions(bundle);
  }
};
