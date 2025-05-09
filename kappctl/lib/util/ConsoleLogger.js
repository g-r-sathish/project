//  Copyright (C) Agilysys, Inc. All rights reserved.

const _ = require("lodash");
const chalk = require("chalk");
const util = require("util");
const assert = require('assert').strict;
const Console = require("console").Console;
const {EOL} = require('os');

const LEVEL = {
  NOTHING: 'NOTHING',
  USER: 'USER',
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  VERBOSE: 'VERBOSE',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
  EVERYTHING: 'EVERYTHING'
};

const LEVELS_RANKED = [
  LEVEL.NOTHING, // always first
  LEVEL.USER,
  LEVEL.ERROR,
  LEVEL.WARN,
  LEVEL.INFO,
  LEVEL.VERBOSE,
  LEVEL.DEBUG,
  LEVEL.TRACE,
  LEVEL.EVERYTHING // always last
];

function rankOf(level) {
  const rank = LEVELS_RANKED.indexOf(level);
  assert.ok(rank > -1, `Unknown log level: ${level}`);
  return rank;
}

class ConsoleLogger extends Console {
  /** @return {ConsoleLogger & Console} */
  static Default() {
    let logLevel = process.env.LOG_LEVEL;
    if (logLevel) {
      if (logLevel in LEVEL) {
        logLevel = LEVEL[logLevel];
      } else {
        console.log('Environment variable LOG_LEVEL does not match an existing level');
      }
    }
    return new ConsoleLogger(logLevel || LEVEL.INFO, process.stdout, process.stderr);
  }

  constructor(level, ...args) {
    super(...args);
    this._preamble = [];
    this._gutter = [];
    this._cursor = {
      enabled: false,
      timeout: undefined,
      gutterIndex: undefined,
      busyMessage: ''
    }
    this._level = {
      enabled: {},
      name: undefined
    };
    this.loggingLevel = level;
    const kGroupIndent = this._symbolFor("kGroupIndent");
    this.getIndent = function () {
      return this[kGroupIndent];
    }
  }

  _symbolFor(name) {
    const symbols = Object.getOwnPropertySymbols(this);
    for (const symbol of symbols) {
      if (symbol.toString() === `Symbol(${name})`) {
        return symbol;
      }
    }
  }

  set loggingLevel(level) {
    this._level.name = level;
    let loggingRank = rankOf(level);
    let messageRank = 0;
    for (const messageLevel of LEVELS_RANKED) {
      this._level.enabled[messageLevel] = messageRank++ <= loggingRank;
    }
  }

  /**
   * Ask if a level is enabled at the moment.
   * @param {LEVEL} [level] Logging level
   * @return {Boolean} True when `level` messages are being written (or _any_ messages at all in the case `level` isn't
   *   provided).
   */
  enabled(level) {
    if (!level) {
      level = level = LEVEL.NOTHING;
    }
    assert.ok(level in LEVEL, `Unknown log level: ${level}`);
    return this._level.enabled[level];
  }

  get loggingLevel() {
    return this._level.name;
  }

  get preamble() {
    return this._preamble.join(' ');
  }

  get gutter() {
    const gutter = this._gutter.join(' ');
    return gutter.length > 0 ? gutter + ' ' : '';
  }

  prefix(prefix) {
    this._preamble.push(this._format([prefix], LEVEL.NOTHING));
  }

  prefixEnd() {
    return this._preamble.pop();
  }

  _out(args, level) {
    this._write(this._stdout, this._format(args, level));
  }

  _format(args, level) {
    if (args.length) {
      return this._colorize(util.format(...args), level);
    }
  }

  _prefix(str) {
    const parts = _.filter([this.preamble, str], (segment) => !!segment);
    const line = parts.join(' ');
    return this.getIndent() + line;
  }

  _colorize(str, level) {
    if (str !== undefined && _.isString(str) && !str.match(/[\r\n]/)) {
      if (str.match(/^~ /)) {
        str = chalk.dim(str.substr(2));
      } else if (str.match(/^# /)) {
        str = chalk.inverse(str.substr(2));
      } else if (str.match(/^! /)) {
        str = chalk.bold(str.substr(2));
      }
      str = str.replace(/^\[([^\]]+)]/, (match, p1) => '[' + chalk.magenta(p1) + ']');
      str = str.replace(/\*{1}([^*]+)\*{1}/g, (match, p1) => chalk.bold(p1));
      switch (level) {
        case LEVEL.WARN:
          str = chalk.yellow(str);
          break;
        case LEVEL.ERROR:
          str = chalk.red(str);
          break;
      }
    }
    return str;
  }

  _write(stream, str = "") {
    this._pauseCursor();
    try {
      const chomp = str.endsWith(EOL)
        ? str.substr(0, str.length - EOL.length)
        : str;
      for (const line of chomp.split(EOL)) {
        stream.write(this._prefix(line));
        stream.write(EOL);
      }
    } finally {
      this._resumeCursor();
    }
  }

  logAt(level, args) {
    if (this._level.enabled[level]) {
      this._out(args, level);
    }
  }

  group(...args) {
    if (this._level.enabled[LEVEL.USER]) {
      this._pauseCursor();
      try {
        super.group(this._format(args, LEVEL.USER));
      } finally {
        this._resumeCursor();
      }
    }
  }

  groupEnd(...args) {
    if (this._level.enabled[LEVEL.USER]) {
      super.groupEnd(...args);
    }
  }

  fatal(...args) {
    this.stopCursor();
    const kGroupIndentWidth = this._symbolFor("kGroupIndentWidth");
    for (let i = this[kGroupIndentWidth]; i > 1; i--) {
      this.groupEnd();
    }
    super.error(this._format(args, LEVEL.ERROR));
  }

  user(...args) {
    this.logAt(LEVEL.USER, args);
  }

  /** @override */
  error(...args) {
    this.logAt(LEVEL.ERROR, args);
  }

  /** @override */
  warn(...args) {
    this.logAt(LEVEL.WARN, args);
  }

  /** @override */
  info(...args) {
    this.logAt(LEVEL.INFO, args);
  }

  /** @override */
  verbose(...args) {
    this.logAt(LEVEL.VERBOSE, args);
  }

  /** @override */
  debug(...args) {
    this.logAt(LEVEL.DEBUG, args);
  }

  /** @override */
  trace(...args) {
    if (this._level.enabled[LEVEL.TRACE]) {
      try {
        super.trace(...args);
      } finally {
        this._resumeCursor();
      }
    }
  }

  busy(...args) {
    this._cursor.busyMessage = this._format(args, LEVEL.USER);
  }

  _pauseCursor() {
    if (this._cursor.enabled) {
      this._cursor.enabled = false;
      this._cursor.busyMessage = '';
      if (this._stdout.isTTY) {
        this._stdout.cursorTo(0);
        this._stdout.write(this.gutter);
        this._stdout.clearScreenDown();
      }
    }
  }

  _resumeCursor() {
    if (this._cursor.timeout) {
      this._cursor.enabled = true;
    }
  }

  startCursor() {
    const updateCursor = () => {
      this._gutter[this._cursor.gutterIndex] = new Date().toLocaleTimeString();
      if (this._cursor.enabled) {
        if (this._stdout.isTTY) {
          this._stdout.cursorTo(0);
          this._stdout.write(this.gutter + this._cursor.busyMessage);
          this._stdout.clearScreenDown();
        }
      }
    };
    this._cursor.gutterIndex = this._gutter.push(new Date().toLocaleTimeString()) - 1;
    this._cursor.timeout = setInterval(updateCursor, 1000);
    this._cursor.timeout.unref();
    this._cursor.enabled = true;
    updateCursor();
  }

  stopCursor() {
    this._cursor.enabled = false;
    if (this._cursor.timeout) {
      clearInterval(this._cursor.timeout);
      this._cursor.timeout = undefined;
      if (this._stdout.isTTY) {
        this._stdout.cursorTo(0);
        this._stdout.clearScreenDown();
      }
    }
  }
}

module.exports.ConsoleLogger = ConsoleLogger;
module.exports.log = ConsoleLogger.Default();
module.exports.LOG_LEVEL = LEVEL;