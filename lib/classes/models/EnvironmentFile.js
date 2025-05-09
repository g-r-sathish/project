const {crc32} = require('crc');
const {v4: uuidv4} = require('uuid');
const errorMaker = require('custom-error');
const util = require('../../common/util');
const GitBackedYAMLFile = require('../GitBackedYAMLFile');

class EnvironmentFile extends GitBackedYAMLFile {
  static VERSION_PREFIX = 'v';
  static DEFAULT_SUBSET_VERSION = 'v1';

  static SELECT_CURRENT = 'CURRENT';
  static SELECT_NEXT = 'NEXT';
  static SELECT_TESTPOOL = 'TESTPOOL';
  static SELECT_PRODUCTION = 'PRODUCTION';

  static STATE_INITIATED = 'INITIATED';
  static STATE_FAILED = 'FAILED';
  static STATE_COMPLETE = 'COMPLETE';

  static ApprovalConfigError = errorMaker('ApprovalConfigError');
  static VersionFormatError = errorMaker('VersionFormatError');
  static TestpoolConfigError = errorMaker('TestpoolConfigError');
  static UnexpectedStateError = errorMaker('UnexpectedStateError');

  static MANUAL_ROLLOUT = 'options.rdeploy.manual-rollout';
  static USE_MANAGED_CONFIG_BRANCHES = 'options.config-repo.branch.managed';

  constructor(repo, path, selector, required=false) {
    super(repo, path, required);
    this.approvalRequest = undefined;
    this.deploymentVersion = undefined;
    this.selectSubset(selector);
  }

  selectSubset(selector) {
    switch (selector) {
      case EnvironmentFile.SELECT_CURRENT:
        this.deploymentVersion = this.nextDeploymentVersion(0);
        break;
      case EnvironmentFile.SELECT_NEXT:
        this.deploymentVersion = this.nextDeploymentVersion(1);
        break;
      case EnvironmentFile.SELECT_TESTPOOL:
        this.deploymentVersion = this.getTestVersion();
        break;
      case EnvironmentFile.SELECT_PRODUCTION:
        this.deploymentVersion = this.getProdVersion();
        break;
      default:
        throw new EnvironmentFile.VersionFormatError('Invalid selector');
    }
  }

  isModerated() {
    try {
      return !!this.data.approvals.enabled;
    } catch {
      return false;
    }
  }

  getApprovalChannel() {
    try {
      return this.data.approvals.channel.toString();
    } catch (ex) {
      util.narrateln(ex);
      throw new EnvironmentFile.ApprovalConfigError('Missing approval channel');
    }
  }

  // Matches crc32 function in the pipeline's approvals.rc
  establishApprovalGrant() {
    let code = Math.random().toString(10).substr(2, 6);
    let uuid = uuidv4();
    this.approvalRequest = `${uuid}-${code}`;
    this.data.approvals.grant = crc32(this.approvalRequest).toString(16);
    this.save();
    this.checkIn('New approval grant');
    return code;
  }

  getApprovalRequest() {
    return this.approvalRequest;
  }

  isTestpoolEnabled() {
    try {
      return !!this.data.pools.enabled;
    } catch {
      return false;
    }
  }

  getSubsetVersion() {
    return this.deploymentVersion;
  }

  getSubset() {
    return this.getSubsetByVersion(this.deploymentVersion);
  }

  getSubsetByVersion(version) {
    return this.data.subsets[version] || {};
  }

  getProdVersion() {
    try {
      return this.data.pools.prod.toString();
    } catch {
      return EnvironmentFile.DEFAULT_SUBSET_VERSION;
    }
  }

  setProdVersion(version) {
    return this.data.pools.prod = version;
  }

  getTestVersion() {
    try {
      return this.data.pools.test.toString();
    } catch {
      return EnvironmentFile.DEFAULT_SUBSET_VERSION;
    }
  }

  setTestVersion(version) {
    return this.data.pools.test = version;
  }

  getDeploymentVersion() {
    return this.deploymentVersion;
  }

  nextDeploymentVersion(increment = 1) {
    if (typeof increment !== 'number' || increment > 1 || increment < 0) {
      throw new Error('Invalid version increment');
    }
    try {
      if (!this.isTestpoolEnabled()) {
        return this.getProdVersion();
      }
      let vProduction = this.getProdVersion();
      let vTestpool = this.getTestVersion();
      let nProduction = versionToNumber(vProduction);
      let nTestpool = versionToNumber(vTestpool);
      let nDeployment = nTestpool <= nProduction ? nProduction + increment : nTestpool;
      return numberToVersion(nDeployment);
    } catch (ex) {
      throw new EnvironmentFile.TestpoolConfigError(ex);
    }
  }

  ensureTestpoolEnabled() {
    if (!this.isTestpoolEnabled()) {
      throw new BuildError('Testpool is not enabled for this environment');
    }
  }

  isTestpoolAhead() {
    let nTest = versionToNumber(this.getTestVersion());
    let nProd = versionToNumber(this.getProdVersion());
    return nTest > nProd;
  }

  ensureTestpoolAhead() {
    if (!this.isTestpoolAhead()) {
      throw new BuildError('Production is ahead of testpool');
    }
  }

  initiateSwap() {
    let newProdVersion = this.getTestVersion();
    let newTestVersion = this.getProdVersion();
    this.setProdVersion(newProdVersion);
    this.setTestVersion(newTestVersion);
    this.setSwapState(EnvironmentFile.STATE_INITIATED);
    this.save();
    this.checkIn('initiate swap');
  }

  completeSwap() {
    this.setSwapState(EnvironmentFile.STATE_COMPLETE);
    this.save();
    this.checkIn('initiate swap');
  }

  setSwapState(state) {
    return this.data.pools.swap_state = state;
  }

  getSwapState() {
    try {
      return this.data.pools.swap_state;
    } catch {
      return undefined;
    }
  }

  isSwapState(state) {
    return state !== undefined && this.getSwapState() === state;
  }

}

function numberToVersion(number) {
  if (typeof number === 'number') {
    return EnvironmentFile.VERSION_PREFIX + number;
  }
  throw new EnvironmentFile.VersionFormatError('Not a number');
}

function versionToNumber(version) {
  if (version === undefined) {
    return 0;
  }
  if (version instanceof Number) {
    return version;
  }
  if (version.toString().charAt(0) === EnvironmentFile.VERSION_PREFIX) {
    return Number.parseInt(version.substr(EnvironmentFile.VERSION_PREFIX.length));
  }
  throw new EnvironmentFile.VersionFormatError();
}

module.exports.EnvironmentFile = EnvironmentFile;