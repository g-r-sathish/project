//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {CustomObjectsAccessor} = require("./base/CustomObjectsAccessor");

class Gateway extends CustomObjectsAccessor {
  static CRD_KIND = 'Gateway';
  static API_GROUP = 'networking.istio.io';
  static API_VERSION = 'v1alpha3';
  static API_PLURAL = 'gateways';

  /**
   * Constructor
   * @param {k8s.KubeConfig} kubeConfig
   * @param {string} namespace
   * @param {object} options
   */
  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, Gateway.API_GROUP, Gateway.API_VERSION, Gateway.API_PLURAL, options);
  }
}
module.exports.Gateway = Gateway;