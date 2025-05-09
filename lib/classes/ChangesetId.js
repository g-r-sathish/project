const constants = require('../../lib/common/constants');

/**
 * @class
 */
function ChangesetId (changesetId) {
    let match = changesetId.match(constants.CHANGESET_ID_REGEX)

    this.changesetId = match[0];
    this.bundleName = match[1];
    this.trackingId = match[2];
    this.qualifier = match[3];
    this.qualifierId = match[4];
    this.ticketId = match[5];
}

module.exports = ChangesetId;
