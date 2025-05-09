const _ = require('underscore');
const {sprintf} = require('sprintf-js');
const errorMaker = require('custom-error');
const stripAnsi = require('strip-ansi');

const config = require('../common/config');
const events = require('./Events');
const util = require('../common/util');

class ForkedOutput {
  static ForkedOutputError = errorMaker('ForkedOutputError');

  constructor(keys, options) {
    this.options = _.extend({
      silent: false
    }, options);
    this.keys = keys;
    this.cursor = {
      x: 0,
      y: 0
    }
    this.positions = {};
    this.complete = false;
    this.spinnerFrames = config.display.spinner;
    this.spinnerFramesDivisor = 1000 / this.spinnerFrames.length;

    events.on('SIGINT', () => {
      util.narrateln('SIGINT event in ForkedOutput');
      this.done();
    });
  }

  /**
   *
   * @param {string} key
   * @param {string} text
   */
  continueBullet(key, text) {
    if (this.complete || this.options.silent) return;
    const position = this.positions[key];
    if (!position) {
      throw new ForkedOutput.ForkedOutputError(sprintf('Position not found for %s', key));
    }
    if (this._move(position)) {
      const output = util.continueBullet(text, {console: false});
      this._write(key, output);
    }
  }

  endBullet(key, text) {
    if (this.complete || this.options.silent) return;
    const position = this.positions[key];
    if (!position) {
      throw new ForkedOutput.ForkedOutputError(sprintf('Position not found for %s', key));
    }
    if (this._move(position)) {
      const output = util.endBullet(text, {console: false});
      this._write(key, output);
    }
    delete this.positions[key];
  }

  done() {
    if (this.complete || this.options.silent) return;
    _.each(Object.keys(this.positions), key => delete this.positions[key], this);
    this.complete = true;
    this._move({x: 0, y: 0});
  }

  spin() {
    if (this.complete || this.options.silent) return;
    _.each(Object.keys(this.positions), key => {
      const position = this.positions[key];
      const frame = Math.floor((Date.now() % 1000) / this.spinnerFramesDivisor);
      if (!position.spinner) {
        position.spinner = {
          frame: frame
        };
      }
      const spinner = position.spinner;
      if (frame !== spinner.frame) {
        if (this._move(position)) {
          this._write(key, this.spinnerFrames[frame].plain, true);
          spinner.frame = frame;
        }
      }
    });
  }

  startBullets() {
    if (this.complete || this.options.silent) return;
    _.each(this.keys, (key, index) => {
      const output = util.startBullet(key.plain);
      const displayLength = stripAnsi(output).length;
      this.positions[key] = {
        x: displayLength,
        y: index - this.keys.length
      }
      process.stdout.write('\n');
    }, this);
  }


  _move(position) {
    const xOffset = position.x - this.cursor.x;
    const yOffset = position.y - this.cursor.y;

    const newX = this.cursor.x + xOffset;
    const newY = this.cursor.y + yOffset;
    if (newX < 0 || newX >= process.stdout.columns || newY > 0 || newY <= -process.stdout.rows) {
      return false;
    }

    process.stdout.moveCursor(xOffset, yOffset);
    this.cursor.x += xOffset;
    this.cursor.y += yOffset;
    this._verboseLog('Moving cursor %d, %d to %d, %d\n', xOffset, yOffset, this.cursor.x, this.cursor.y);
    return true;
  }

  /**
   * @param {string} key
   * @param {string} output
   * @param {boolean} [spinner]
   * @private
   */
  _write(key, output, spinner) {
    const position = this.positions[key];
    let maxLength = process.stdout.columns - this.cursor.x;
    if (maxLength <= 0) return;
    let text = output.match(/^.*$/gm)[0];
    let displayLength = stripAnsi(text).length;
    while (displayLength > maxLength) {
      text = text.substring(0, text.length - 1);
      displayLength = stripAnsi(text).length;
    }
    const differential = position.spinner && position.spinner.size && displayLength < position.spinner.size
      ? position.spinner.size - displayLength
      : 0;
    if (differential > 0) {
      text += ' '.repeat(differential);
    }
    process.stdout.write(text);
    const priorX = this.cursor.x;
    this.cursor.x += displayLength + differential;
    if (spinner) {
      position.x = priorX;
      position.spinner.size = displayLength;
    } else {
      position.x = priorX + displayLength;
      delete position.spinner;
    }
  }

  /** @private */
  _verboseLog(...params) {
    if (process.env.RFLOW_VERBOSE) {
      util.narratef(...params);
    }
  }
}

module.exports = ForkedOutput;