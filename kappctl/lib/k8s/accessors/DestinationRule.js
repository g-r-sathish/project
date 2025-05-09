//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {CustomObjectsAccessor} = require("./base/CustomObjectsAccessor");

class DestinationRule extends CustomObjectsAccessor {
  static CRD_KIND = 'DestinationRule';
  static API_GROUP = 'networking.istio.io';
  static API_VERSION = 'v1alpha3';
  static API_PLURAL = 'destinationrules';

  /**
   * Constructor
   * @param {k8s.KubeConfig} kubeConfig
   * @param {string} namespace
   * @param {object} options
   */
  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, DestinationRule.API_GROUP, DestinationRule.API_VERSION, DestinationRule.API_PLURAL, options);
  }
}

module.exports.DestinationRule = DestinationRule;