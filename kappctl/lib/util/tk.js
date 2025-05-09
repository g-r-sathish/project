/* Copyright (C) Agilysys, Inc. All rights reserved. */
'use strict';

const assert = require('assert').strict;
const _ = require('lodash');
const {EOL} = require('os');
const readline = require('readline');
const {log} = require("./ConsoleLogger");
const fs = require("fs");
const Path = require("path");

module.exports.ONE_SECOND_AS_MS = 1000;
module.exports.ONE_MINUTE_AS_MS = 1000 * 60;

const VERSION_PREFIX = 'v';

class FileNotFoundError extends Error {
}

module.exports.FileNotFoundError = FileNotFoundError;

class EnsuringError extends Error {
  constructor(errorMessage, hint) {
    let messages = [];
    if (errorMessage) {
      messages.push(errorMessage);
    }
    if (hint) {
      messages.push(`(${hint})`);
    }
    super(messages.join(' '));
  }
}

module.exports.EnsuringError = EnsuringError;

class UserIOError extends Error {
}

module.exports.UserIOError = UserIOError;

function isValidString(ref) {
  return ref !== undefined && ref !== null && typeof ref === 'string';
}

module.exports.isValidString = isValidString;

function ensureValidString(ref, hint) {
  if (isValidString(ref)) {
    return ref;
  } else {
    throw new EnsuringError('Not a valid string', hint)
  }
}

module.exports.ensureValidString = ensureValidString;

function areEqualValidStrings(str1, str2) {
  return isValidString(str1) && isValidString(str2) && str1 === str2;
}

module.exports.areEqualValidStrings = areEqualValidStrings;

function ensureEqualValidStrings(str1, str2, hint) {
  if (areEqualValidStrings(str1, str2)) {
    return str1;
  } else {
    throw new EnsuringError('Not equal valid strings', hint)
  }
}

module.exports.ensureEqualValidStrings = ensureEqualValidStrings;

const FULFILLED = 'fulfilled';
module.exports.FULFILLED = FULFILLED

const REJECTED = 'rejected';
module.exports.REJECTED = REJECTED;

class SettlementError extends Error {
  constructor(results, rejections) {
    super();
    this.results = results;
    this.rejections = rejections;
  }
}

module.exports.SettlementError = SettlementError;

async function settleEach(collection, iteratee) {
  let promises = [];
  for (let item of collection) {
    const promise = iteratee(item);
    if (promise) {
      promises.push(promise);
    }
  }
  let results = [];
  let rejections = [];
  if (promises.length) {
    let settled = await Promise.allSettled(promises);
    for (let settlement of settled) {
      if (areEqualValidStrings(settlement.status, FULFILLED)) {
        results.push(settlement.value);
      } else {
        log.debug(settlement.reason);
        rejections.push(settlement.reason);
      }
    }
  }
  if (rejections.length) {
    throw new SettlementError(results, rejections);
  }
  return results;
}

module.exports.settleEach = settleEach;


/**
 * Unwrap values and reasons from a list of settled promises.
 * @param {iterable} settled
 * @returns {{results: *[], errors: *[]}}
 */
function unwrap(settled) {
  let results = [];
  let errors = [];
  for (let settlement of settled) {
    if (areEqualValidStrings(settlement.status, FULFILLED)) {
      results.push(settlement.value);
    } else {
      log.debug(settlement.reason);
      errors.push(settlement.reason);
    }
  }
  return {results, errors};
}

module.exports.unwrap = unwrap;

function numberToVersion(number) {
  if (typeof number === 'number') {
    return VERSION_PREFIX + number;
  }
  throw new Error('Not a number');
}

module.exports.numberToVersion = numberToVersion;

function versionToNumber(version) {
  if (version === undefined) {
    return 0;
  }
  if (version instanceof Number) {
    return version;
  }
  if (version.toString().charAt(0) === VERSION_PREFIX) {
    return Number.parseInt(version.substr(VERSION_PREFIX.length));
  }
  throw new Error('Unexpected version string');
}

module.exports.versionToNumber = versionToNumber;

/**
 * @param s
 * @return {string|*}
 */
function trimLastEOL(s) {
  if (_.isString(s)) {
    if (s.endsWith(EOL)) {
      return s.substr(0, s.length - EOL.length);
    }
  }
  return s;
}

module.exports.trimLastEOL = trimLastEOL;

function println(content) {
  if (content === null || content === undefined) {
    return;
  }
  let str = content.toString();
  if (!str.endsWith(EOL)) {
    str += EOL;
  }
  process.stdout.write(str);
}

module.exports.println = println;

function jsonDump(data) {
  return JSON.stringify(data, null, 2);
}

module.exports.jsonDump = jsonDump;

function safeReplace(value, search, replace) {
  return value && typeof (value) === 'string'
      ? value.replace(search, replace)
      : value;
}

module.exports.safeReplace = safeReplace;

function overlayMany(/* arguments */) {
  let args = Array.prototype.slice.call(arguments);
  let dest = args.shift();
  if (typeof (dest) !== 'object' || dest === null) throw new Error('invalid argument');
  for (let i = 0; i < args.length; i++) {
    let src = args[i];
    if (typeof (src) === 'undefined' || src === null) continue;
    if (dest === src) continue;
    overlay(dest, src, false);
  }
  return dest;
}

module.exports.overlayMany = overlayMany;

function overlay(dest, src, truncate = false) {
  if (dest === undefined || dest === null) throw new Error('invalid argument');
  if (typeof (dest) !== typeof (src)) throw new Error('type mismatch');
  if (dest === src) return dest;
  for (let k in src) {
    if (src.hasOwnProperty(k)) {
      if (typeof dest[k] === 'function') {
        dest[k] = src[k];
      } else if (typeof (dest[k]) === 'object') {
        overlay(dest[k], src[k], truncate);
      } else if (!(k in dest)) {
        dest[k] = _.cloneDeep(src[k]);
      } else {
        dest[k] = src[k];
      }
    }
  }
  if (truncate) {
    if (Array.isArray(src)) {
      for (let n = dest.length - src.length; n > 0; n--) {
        dest.pop();
      }
    }
  }
  return dest;
}

module.exports.overlay = overlay;


function update(dest, src) {
  if (dest === undefined || dest === null) throw new Error('invalid argument');
  if (typeof (dest) !== typeof (src)) throw new Error('type mismatch');
  if (dest === src) return 0;
  let updated = 0;
  for (let k in src) {
    if (src.hasOwnProperty(k)) {
      assert.notEqual(typeof dest[k], 'function');
      if (typeof (dest[k]) === 'object') {
        if (_.isArray(src[k])) {
          let affected = countUpdatedValues(dest[k], src[k]);
          if (affected > 0) {
            dest[k] = src[k];
            updated += affected;
          }
        } else {
          updated += update(dest[k], src[k]);
        }
      } else {
        if (dest[k] !== src[k]) {
          log.debug(`UPDATED:${k} '${dest[k]}' vs '${src[k]}'`);
          updated++;
          dest[k] = src[k];
        }
      }
    }
  }
  return updated;
}

module.exports.update = update;

function countUpdatedValues(dest, src) {
  let updated = 0;
  for (let k in src) {
    if (src.hasOwnProperty(k)) {
      assert.notEqual(typeof dest[k], 'function');
      if (typeof (dest[k]) === 'object') {
        updated += countUpdatedValues(dest[k], src[k]);
      } else {
        if (dest[k] !== src[k]) {
          log.debug(`UPDATED:${k} '${dest[k]}' vs '${src[k]}'`);
          updated++;
        }
      }
    }
  }
  return updated;
}

function flatten(obj, keys = [], dest = {}) {
  if (obj !== null && typeof obj === 'object') {
    for (let k in obj) {
      if (obj.hasOwnProperty(k)) {
        flatten(obj[k], keys.concat(k), dest);
      }
    }
  } else {
    dest[keys.join('.')] = obj;
  }
  return dest;
}

module.exports.flatten = flatten;

function base64(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  } else if (typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      acc[key] = base64(acc[key]);
      return acc;
    }, obj);
  } else {
    return Buffer.from(obj.toString()).toString('base64');
  }
}

module.exports.base64 = base64;

// https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#dns-subdomain-names
const DNS_LABEL_NAME_VALID_CHARS = /^[a-z0-9.-]+$/;
const DNS_LABEL_NAME_VALID_FIRST_LAST_CHAR = /^[a-z0-9]$/;

function isValidResourceName(name) {
  if (!name) return false;
  if (typeof name !== 'string') return false;
  if (name.length > 253) return false;
  if (!name.match(DNS_LABEL_NAME_VALID_CHARS)) return false;
  if (!name[0].match(DNS_LABEL_NAME_VALID_FIRST_LAST_CHAR)) return false;
  if (!name[name.length - 1].match(DNS_LABEL_NAME_VALID_FIRST_LAST_CHAR)) return false;
  return true;
}

module.exports.isValidResourceName = isValidResourceName;

async function slurpStdin() {
  if (process.stdin.isTTY) {
    return; // do not attempt to interact
  }
  let lines = [];
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  const rl = readline.createInterface({
    input: process.stdin
  });
  log.debug('Reading STDIN');
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.length ? lines.join(EOL) + EOL : undefined;
}

module.exports.slurpStdin = slurpStdin;

function ensureNoEmptyValues(obj, keyPath = []) {
  if (obj === null || obj === undefined || (typeof obj === 'string' && obj === '')) {
    throw new EnsuringError('Empty value found', keyPath.join('.'));
  } else if (typeof obj === 'object') {
    for (let k in obj) {
      if (obj.hasOwnProperty(k)) {
        ensureNoEmptyValues(obj[k], keyPath.concat(k));
      }
    }
  }
}

module.exports.ensureNoEmptyValues = ensureNoEmptyValues;

/**
 * Throw if string value matches given expression.
 * @param {Object|Array} obj to test
 * @param {RegExp} re
 * @param {Array} keyPath used recursively emit a hint
 */
function ensureNoValuesMatch(obj, re, keyPath = []) {
  if (typeof obj === 'string' && re.test(obj)) {
    throw new EnsuringError(`Value matches blacklist pattern (${re.toString()})`, keyPath.join('.'));
  } else if (typeof obj === 'object') {
    for (let k in obj) {
      if (obj.hasOwnProperty(k)) {
        ensureNoValuesMatch(obj[k], re, keyPath.concat(k));
      }
    }
  }
}

module.exports.ensureNoValuesMatch = ensureNoValuesMatch;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports.sleep = sleep;

class LoopTimeoutError extends Error {
  constructor(message) {
    super(message);
  }
}

module.exports.LoopTimeoutError = LoopTimeoutError;

/**
 * Execute worker function until it returns !(undefined || false)
 * @param worker
 * @param {Number?} timeoutMs includes work and pause time (will not interrupt worker)
 * @param {Number?} restIntervalMs pause between executions
 * @throws {LoopTimeoutError} when `timeoutMs` is exceeded
 * @return {Promise<*>} whatever worker returns
 */
async function doUntil(worker, timeoutMs = 30 * 1000, restIntervalMs = 250) {
  const startTime = Date.now();
  while (true) {
    if ((Date.now() - startTime) > timeoutMs) {
      throw new LoopTimeoutError(`Timeout exceeded: ${timeoutMs}ms`);
    }
    try {
      const result = await worker();
      if (result) {
        return result;
      }
    } catch (e) {
      if (e.code === 'ETIMEDOUT') {
        log.warn(e.message);
      } else {
        throw e;
      }
    }
    await sleep(restIntervalMs);
  }
}

module.exports.doUntil = doUntil;

function msToHMS(ms) {
  return new Date(ms).toISOString().substr(11, 8);
}

module.exports.msToHMS = msToHMS;

// const start = new Date();
// const elapsed = elapsedTime(start);
function elapsedTime(startDate) {
  return msToHMS(new Date() - startDate);
}

module.exports.elapsedTime = elapsedTime;

function mkdirs(givenPath) {
  let path = givenPath.substr(0, 1) === '/' ? '/' : process.cwd(); // absolute paths only
  let dirList = givenPath.split(Path.sep);
  for (const dir of dirList) {
    path = Path.join(path, dir);
    try {
      fs.mkdirSync(path);
      log.debug('MKDIR:', path);
    } catch (ex) {
      if (!/EISDIR|EEXIST/.test(ex)) throw ex
    }
  }
  return path;
}

module.exports.mkdirs = mkdirs;

function parseBoolean(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (_.isBoolean(value)) {
    return value;
  }
  assert.ok(_.isString(value));
  const lcValue = value.toLowerCase();
  if (lcValue === 'true') {
    return true;
  } else if (lcValue === 'false') {
    return false;
  } else if (lcValue === '') {
    return false;
  } else {
    throw new Error('String value does not indicate its boolean counterpart');
  }
}

module.exports.parseBoolean = parseBoolean;

module.exports.confirm = function (message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve, reject) => {
    rl.on('SIGINT', () => {
      rl.write('\n');
    });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      if (answer.toLowerCase() === 'y') {
        resolve(true);
      } else {
        reject(new UserIOError('Cancelled by user'));
      }
    });
  });
}
