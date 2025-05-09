//  Copyright (C) Agilysys, Inc. All rights reserved.

const assert = require("assert").strict;
const tk = require('../util/tk');
const {GitBackedYAMLFile} = require('./GitBackedYAMLFile');

const DEFAULT_SUBSET_VERSION = 'v1';
const NODE_SELECTOR_BLUE = 'blue';
const NODE_SELECTOR_GREEN = 'green';

class EnvironmentFile extends GitBackedYAMLFile {
  // Options
  static KAPPTCTL_CONFIG = 'options.kappctl.config';
  static USE_MANAGED_CONFIG_BRANCHES = 'options.config-repo.branch.managed';
  static UPSTREAM_CONFIG_BRANCH = 'options.config-repo.branch.source';
  static TEST_POOL_ENABLED = 'pools.enabled';
  static NODE_POOLS_ENABLED = 'pools.nodeSelectors.enabled';
  // Per-subset settings
  static SUBSET_CONFIG_SOURCE = 'config_repo_branch_source';
  static SUBSET_CONFIG_BRANCH = 'config_repo_branch';
  static SUBSET_NODE_POOL = 'node_pool';
  // Roll-out settings
  static ROLLOUT_CONFIG_SOURCE = 'rollout.versions.config_repo_branch_source';

  static KEY_DELETE_KINDS = 'delete.kinds'
  static DEFAULT_DELETE_KINDS = ['VirtualService', 'DestinationRule', 'PodDisruptionBudget', 'Deployment', 'Job'];

  constructor(path, {dryRun=false}) {
    super(path, {required: true, dryRun: dryRun});
  }

  getSubset(subset) {
    try {
      return this.data.subsets[subset];
    } catch (e) {
      return undefined;
    }
  }

  getOrCreateSubset(subset) {
    const key = `subsets.${subset}`;
    let subsetConfig = this.get(key);
    if (!subsetConfig) {
      subsetConfig = {};
      this.set(key, subsetConfig);
    }
    return subsetConfig;
  }

  setSubset(subset, data) {
    return this.set(`subsets.${subset}`, data);
  }

  getAllowedResourceKindsAllowedForDelete() {
    return this.get(EnvironmentFile.KEY_DELETE_KINDS, EnvironmentFile.DEFAULT_DELETE_KINDS);
  }

  getImplicitSubset() {
    let testPoolSubset = this.get('pools.test', DEFAULT_SUBSET_VERSION)
    let prodPoolSubset = this.get('pools.prod', DEFAULT_SUBSET_VERSION);
    if (this.isTestpoolEnabled()) {
      let prodPoolSubsetNumber = tk.versionToNumber(prodPoolSubset);
      if (tk.versionToNumber(testPoolSubset) < prodPoolSubsetNumber) {
        testPoolSubset = tk.numberToVersion(++prodPoolSubsetNumber);
        this.set('pools.test', testPoolSubset);
      }
      return testPoolSubset;
    } else {
      return prodPoolSubset;
    }
  }

  reconcileNodePoolSelectors() {
    if (this.areNodeSelectorsEnabled()) {
      let prodSelector = NODE_SELECTOR_BLUE;
      let testSelector = NODE_SELECTOR_GREEN;

      const testVersion = this.get('pools.test', DEFAULT_SUBSET_VERSION)
      const prodVersion = this.get('pools.prod', DEFAULT_SUBSET_VERSION);

      const prodData = this.getSubset(prodVersion);
      const testData = this.getSubset(testVersion);

      if (!prodData[EnvironmentFile.SUBSET_NODE_POOL]) {
        if (testData[EnvironmentFile.SUBSET_NODE_POOL]) {
          testSelector = this._validateNodeSelector(testData[EnvironmentFile.SUBSET_NODE_POOL]);
          prodSelector = this._alternateNodeSelector(testSelector);
        }
      } else {
        prodSelector = this._validateNodeSelector(prodData[EnvironmentFile.SUBSET_NODE_POOL]);
        testSelector = this._alternateNodeSelector(prodSelector);
      }

      testData[EnvironmentFile.SUBSET_NODE_POOL] = testSelector;
      prodData[EnvironmentFile.SUBSET_NODE_POOL] = prodSelector;
    }
  }

  _validateNodeSelector(selectorValue) {
    assert.ok([NODE_SELECTOR_BLUE, NODE_SELECTOR_GREEN].includes(selectorValue));
    return selectorValue;
  }

  _alternateNodeSelector(selectorValue) {
    return this._validateNodeSelector(selectorValue) === NODE_SELECTOR_BLUE ? NODE_SELECTOR_GREEN : NODE_SELECTOR_BLUE;
  }

  isModerated() {
    return !!this.get('approvals.enabled', false);
  }

  isTestpoolEnabled() {
    return !!this.get('pools.enabled', false);
  }

  areNodeSelectorsEnabled() {
    return this.isTestpoolEnabled() && !!this.get(EnvironmentFile.NODE_POOLS_ENABLED, false);
  }

}

module.exports.EnvironmentFile = EnvironmentFile;
