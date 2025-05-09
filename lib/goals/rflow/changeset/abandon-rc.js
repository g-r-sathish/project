const _ = require('underscore');

const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const rflowUtil = require('../../../common/rflow-util');
const teams = require('../../../common/teams').teamsService;
const util = require('../../../common/util');

module.exports['abandon-rc'] = {
  summary: 'Abandons a release candidate',
  requiredArguments: ['changeset-id'],
  optionalArguments: ['max-fork-count', 'dry-run'],
  requiredSettings: [],
  optionalSettings: [],
  callback: function (bundle) {
    bundle.init({noCheckout: true});

    rflowUtil.ensureStatusIs(bundle.changeset, ChangesetFile.Status.RC);

    let candidate = rflowUtil.ensureManifestMatchesChangeset(bundle.versionsRepo, bundle.getCandidateAlias(),
      config.changesetId);

    let changeset = bundle.changeset;
    changeset.setStatus(ChangesetFile.Status.DEV);
    changeset.save();

    // See ya
    candidate.removeFile(bundle.getCandidateAlias());

    util.announce('Updating source control'.plain);
    util.startBullet(bundle.versionsRepo.dirname.plain);
    bundle.versionsRepo.checkIn({
      message: bundle.invocation.getCommitMessage()
    });
    util.endBullet('Committed & pushed'.good);

    teams.notifyOnAbandonedRC(bundle);
  }
};
