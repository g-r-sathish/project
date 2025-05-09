require('colors');

const _ = require('underscore');
const deasync = require('deasync');
const errorMaker = require('custom-error');
const {fork} = require('child_process');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;
const uuid = require('uuid');

const {BuildProject} = require('./BuildProject');
const config = require('../common/config');
const events = require('./Events');
const ForkedOutput = require('./ForkedOutput');
const LogFile = require('./LogFile');
const {SupportProject} = require('./SupportProject');
const util = require('../common/util');

class ForkedProjectOp {
  static SENSITIVE_FIELD = 'sensitive';
  static ForkedProjectOpError = errorMaker('ForkedProjectOpError');

  /**
   * @callback forkWorkerCallback
   * @param {BuildProject|SupportProject} project
   * @param {{}} input
   */

  /**
   * @param {ForkInboundMessage} message
   * @param {forkWorkerCallback} worker
   */
  static processOnFork(message, worker) {
    try {
      let project = message.input.project;
      if (!project || !project.dirname) {
        throw new ForkedProjectOp.ForkedProjectOpError('Project cannot be located on input');
      }

      util.overlay(config, message.config);
      config.logger = new LogFile(config.logFile, '[' + project.dirname + '] ');
      util.applyTheme();

      project = ForkedProjectOp._reconstitute(project);
      delete message.input.project;

      worker(project, message.input);

      process.exit(0);
    } catch (ex) {
      util.narrateln(ex.stack);
      process.exit(1);
    }
  }

  /**
   * @param {string} forkNodeJsFile
   * @param {[]} inputs
   * @param [options]
   * @param {boolean} [options.silent]
   * @returns {{outputs: {}, success: boolean, failureCount: number}}
   */
  static run(forkNodeJsFile, inputs, options) {
    options = _.extend({
      silent: false,
    }, options);

    const projects = {};
    const inProgress = {};
    _.each(inputs, input => {
      if (!input.project || !(input.project instanceof BuildProject || input.project instanceof SupportProject)) {
        throw new ForkedProjectOp.ForkedProjectOpError('Project cannot be located on input');
      }
      projects[input.project.dirname] = input.project;
      inProgress[input.project.dirname] = true;
      input.project = input.project.toJsonObject();
    });

    const forkedOutput = new ForkedOutput(Object.keys(projects), {silent: options.silent});
    const nodeJsFilePath = path.join(process.env.NODE_BASE_DIRECTORY, 'bin', 'fork', forkNodeJsFile)

    let count = inputs.length;
    let concurrency = 0;
    let result = {
      success: false,
      failureCount: 0,
      outputs: {},
    }

    /**
     * @param {ForkOutboundMessage} message
     */
    const processMessage = message => {
      this._verboseLog('Message %s received\n', message.id);
      message = ForkedProjectOp._readMessage(message);
      const dirname = message.dirname;
      if (message.complete) {
        if (!message.success) result.failureCount++;

        forkedOutput.endBullet(dirname, message.update);

        const output = message.output;
        if (output && output.project && projects[dirname]) {
          projects[dirname].overlayJsonObject(output.project);
          output.project = projects[dirname];
        }
        result.outputs[dirname] = output;
        delete inProgress[dirname];
      } else {
        forkedOutput.continueBullet(dirname, message.update);
      }
      forkedOutput.spin();
    }

    forkedOutput.startBullets();

    let forks = [];

    events.on('SIGINT', () => {
      util.narrateln('SIGINT event in ForkedProjectOp');
      _.each(forks, fork => {
        if (fork && !fork.killed) {
          fork.kill('SIGINT');
        }
      });
    })

    let index = 0;

    const forkAsAvailable = () => {
      while (concurrency < config.maxForkCount && index < inputs.length) {
        concurrency++;
        const forked = fork(nodeJsFilePath);
        forks.push(forked);
        forked.on('message', message => processMessage(message));
        forked.on('close', code => {
          ForkedProjectOp._verboseLog('Received close: %s\n', code);
          count--;
          concurrency--;
          forkAsAvailable();
        });
        forked.on('error', error => {
          ForkedProjectOp._verboseLog('Received error: %s\n', error);
          result.failureCount++;
          count--;
          concurrency--;
          forkAsAvailable();
        });
        const input = inputs[index++];
        forked.send({
          config: config,
          input: input
        });
      }
    }

    forkAsAvailable();

    while (count > 0 || Object.keys(inProgress).length > 0) {
      forkedOutput.spin();
      deasync.sleep(50);
    }
    forkedOutput.done();
    result.success = result.failureCount === 0;
    return result;
  }

  static sendInterim(dirname, update) {
    const message = {
      id: uuid.v4(),
      dirname: dirname,
      update: update
    };
    this._sendMessage(message);
  }

  static sendFinal(dirname, update, success, output) {
    const message = {
      id: uuid.v4(),
      dirname: dirname,
      update: update,
      complete: true,
      success: success,
      output: output
    };
    this._sendMessage(message);
  }

  /**
   * @param {ForkOutboundMessage} message
   * @returns {ForkOutboundMessage}
   * @private
   */
  static _readMessage(message) {
    const start = new Date().getMilliseconds();
    if (!message.external) {
      return message;
    }

    const messagePath = path.join(config.messageDir, sprintf('%s.json', message.id));
    const result = util.readJSON(messagePath);
    util.removeFile(messagePath);
    const sensitiveData = message[this.SENSITIVE_FIELD];
    if (sensitiveData) {
      result[this.SENSITIVE_FIELD] = sensitiveData;
    }
    this._verboseLog('Message %s read in %dms\n', message.id, new Date().getMilliseconds() - start);
    return result;
  }

  /**
   * @param {{}} project
   * @returns {BuildProject|SupportProject}
   * @private
   */
  static _reconstitute(project) {
    const start = new Date().getMilliseconds();

    let result;
    if (project.type === 'build') {
      result = BuildProject.fromJsonObject(project);
    } else {
      result = SupportProject.fromJsonObject(project);
    }

    this._verboseLog('Reconstituted in %dms\n', new Date().getMilliseconds() - start);
    return result;
  }

  /**
   * @param {ForkOutboundMessage} message
   * @private
   */
  static _sendMessage(message) {
    const start = new Date().getMilliseconds();

    if (!message.output) {
      process.send(message);
      return;
    }

    const messagePath = path.join(config.messageDir, sprintf('%s.json', message.id));

    const sensitiveData = message[this.SENSITIVE_FIELD];
    delete message[this.SENSITIVE_FIELD];
    util.writeJSON(messagePath, message);

    const wireMessage = {id: message.id, external: true};
    if (sensitiveData) {
      wireMessage[this.SENSITIVE_FIELD] = sensitiveData;
    }
    process.send(wireMessage);

    this._verboseLog('Message %s sent in %dms\n', message.id, new Date().getMilliseconds() - start);
  }

  /** @private */
  static _verboseLog(...params) {
    if (process.env.RFLOW_VERBOSE) {
      util.narratef(...params);
    }
  }
}

module.exports.ForkedProjectOp = ForkedProjectOp;
