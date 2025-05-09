/**
 * @typedef AliasId
 * @property {string} bundleName The bundle name, e.g. 'svc'.
 * @property {('released'|'production'|'hotfix'|'candidate'|string)} alias The alias.
 */

/**
 * @typedef ChangesetId
 * @property {string} bundleName The bundle name, e.g. 'svc'.
 * @property {string} trackingId The tracking ID, e.g. 'RGSTAY-12345'.
 * @property {string} qualifier The qualifier of the tracking ID, e.g. 'RGSTAY' from 'RGSTAY-12345'.
 * @property {qualifierId} qualifierId The qualifier ID of the tracking ID, e.g. '12345' from 'RGSTAY-12345'.
 */

/**
 * @typedef ForkInboundMessage
 * @property input
 * @property {BuildProject|SupportProject} input.project
 * @property {Config} config
 */

/**
 * @typedef ForkOutboundMessage
 * @property {string} id,
 * @property {string} dirname
 * @property {string} update
 * @property {boolean} start
 * @property {boolean} complete
 * @property {boolean} success
 * @property {{}[]} output
 */

/**
 * @typedef ShipmentId
 * @property {string} bundleName The bundle name, e.g. 'uat'.
 * @property {string} version The version (or label), e.g. '20210709'.
 */

/**
 * @typedef TrunkConfig
 * @property {string} name
 * @property {string} next_version
 * @property {string[]} seeded_support_projects
 */

/**
 * @typedef UserData
 * @property {string} adUsername
 * @property {string} stashUsername
 * @property {string} azureIdentityId
 */

module.exports = {};