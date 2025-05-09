//  Copyright (C) Agilysys, Inc. All rights reserved.

class ResourceCache {
  /**
   * Simple object cache
   * @param {KubernetesClient} k8sClient
   */
  constructor(k8sClient) {
    this.k8sClient = k8sClient;
    this.cache = {};
    this.enabled = false; // Audit fetch usages and ensure eviction (possibly implement a TTL)
  }

  /**
   * Delete all cached resources
   */
  evictAll() {
    for (let key in this.cache) {
      if (this.cache.hasOwnProperty(key)) {
        delete this.cache[key];
      }
    }
  }

  /**
   * Delete cached resources
   * @param key cache key
   */
  evict(key) {
    if (this.cache.hasOwnProperty(key)) {
      delete this.cache[key];
    }
  }

  /**
   * Fetch and cache resources
   * @param key cache key
   * @param {upstreamCallback} upstream
   * @param refresh force upstream call
   * @returns {Promise<Resource|Resource[]>}
   */
  async fetch(key, upstream, refresh = false) {
    if (!this.cache[key] || refresh) {
      const v = await upstream(this.k8sClient);
      if (this.enabled) {
        this.cache[key] = v;
      } else {
        return v;
      }
    }
    return this.cache[key];
  }

  /**
   * @async upstream
   * @function upstreamCallback
   * @param {KubernetesClient} k8sClient
   */
}

module.exports.ResourceCache = ResourceCache;