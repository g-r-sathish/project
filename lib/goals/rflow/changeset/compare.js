const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const BuildError = require('../../../classes/BuildError');
const {ChangesetFile} = require('../../../classes/ChangesetFile');
const config = require('../../../common/config');
const rflowUtil = require('../../../common/rflow-util');

module.exports['compare'] = {
  summary: 'Compare one alias to another',
  requiredArguments: ['alias-id', 'to-alias-id'],
  optionalArguments: ['document', 'simple', 'max-fork-count'],
  requiredSettings: [],
  optionalSettings: [],
  notificationSettings: {
    skip: true
  },
  callback: function (bundle, goal) {
    function confirmAlias(aliasId) {
      if (!bundle.changeset.doesAliasExist(aliasId.alias)) {
        throw new BuildError(
          sprintf('Alias ID %s:%s cannot be resolved at this time', aliasId.bundleName, aliasId.alias));
      }

      if (aliasId.alias.indexOf(ChangesetFile.Alias.CANDIDATE) >= 0) {
        throw new BuildError('Compare does not support candidates!');
      }
    }

    if (config.aliasId.bundleName !== config.toAliasId.bundleName) {
      throw new BuildError('Cannot compare aliases from different bundles!');
    }

    if (config.aliasId.alias === ChangesetFile.Alias.HOTFIX && config.toAliasId.alias !==
      ChangesetFile.Alias.PRODUCTION) {
      throw new BuildError('Hotfix can only be compared to production!');
    }

    let isFromTrunk = !_.contains(Object.values(ChangesetFile.Alias), config.aliasId.alias);
    if (config.toAliasId.alias === ChangesetFile.Alias.HOTFIX && isFromTrunk) {
      throw new BuildError('Cannot compare trunk to hotfix!');
    }

    confirmAlias(config.aliasId);
    confirmAlias(config.toAliasId);

    let changesetsMetadata = {};
    changesetsMetadata[config.bundleName] = {alias: config.aliasId.alias}

    let changesetBundles = {};
    changesetBundles[config.bundleName] = bundle;

    bundle.init({
      noCheckout: true,
      alias: config.aliasId.alias
    });

    let fromTrunk = isFromTrunk ? config.aliasId.alias : undefined;
    let changesets = rflowUtil.compareAliases(bundle.supportProjects.all, changesetsMetadata, fromTrunk,
      config.toAliasId.alias, changesetBundles, bundle.versionsRepo, config._all.simple);

    if (config._all.document) {
      rflowUtil.documentChangesets(changesets);
    }
  }
};
