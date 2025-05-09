//  Copyright (C) Agilysys, Inc. All rights reserved.

const k8s = require('@kubernetes/client-node');
const {CustomObjectsAccessor} = require("./base/CustomObjectsAccessor");

class VirtualService extends CustomObjectsAccessor {
  static CRD_KIND = 'VirtualService';
  static API_GROUP = 'networking.istio.io';
  static API_VERSION = 'v1beta1';
  static API_PLURAL = 'virtualservices';

  /**
   * Constructor
   * @param {k8s.KubeConfig} kubeConfig
   * @param {string} namespace
   * @param {object} options
   */
  constructor(kubeConfig, namespace, options) {
    super(kubeConfig, namespace, VirtualService.API_GROUP, VirtualService.API_VERSION, VirtualService.API_PLURAL, options);
  }
}
module.exports.VirtualService = VirtualService;