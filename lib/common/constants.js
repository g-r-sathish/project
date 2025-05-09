'use strict';

let thisModule = module;

function define (name, value) {
  if (exports[name]) {
    throw "Constant already defined: " + name;
  }
  Object.defineProperty(thisModule.exports, name, {
    value: value,
    enumerable: true
  });
  return value;
}

let projectSettings = {
  qualifiers: ['VCTRS', 'FUTURE'],
  ignoreFields: ['deploy_name', 'release_tag', 'rguest_haproxy_docker_version']
};


module.exports.define = define;
module.exports.projectSettings = projectSettings;
