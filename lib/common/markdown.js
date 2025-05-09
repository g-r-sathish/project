'use strict';

const sprintf = require('sprintf-js').sprintf;

const escapeSearch = /[\*#]/g;
const escapeReplace = {
  '*': '\u2217',
  '#': '\u0023'
};

module.exports.escape = function (text) {
  if (undefined === text) return undefined;
  return text.replace(escapeSearch,function(match) {return escapeReplace[match];})
};

module.exports.href = function (url, text) {
  if (undefined === url) return undefined;
  if (!text && text !== 0) {
    return sprintf('<%s>', url);
  }
  return sprintf('[%s](%s)', text, url);
};
