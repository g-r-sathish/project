'use strict';
const _ = require('underscore');

process.on("warning", function (warning) {
  if (_.isString(warning) && _.includes(warning, 'NODE_TLS_REJECT_UNAUTHORIZED')) {
    return;
  }
  console.warn(warning);
});

