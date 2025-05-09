//  Copyright (C) Agilysys, Inc. All rights reserved.

const { Writable } = require('stream');
const {ConsoleLogger, LOG_LEVEL} = require("../lib/util/ConsoleLogger");
const fs = require("fs");

class MyWritable extends Writable {
  constructor(options) {
    super(options);
  }

  /** @override */
  write(chunk, cb) {
    return super.write(chunk, cb);
  }
}

describe('LevelConsole', function () {

  const devNull = fs.createWriteStream('/dev/null');
  const testConsole = new ConsoleLogger(LOG_LEVEL.INFO, devNull, devNull);

  function emit(log) {
    log.user(`message=${LOG_LEVEL.USER} logging=${log.loggingLevel}`);
    log.error(`message=${LOG_LEVEL.ERROR} logging=${log.loggingLevel}`);
    log.warn(`message=${LOG_LEVEL.WARN} logging=${log.loggingLevel}`);
    log.info(`message=${LOG_LEVEL.INFO} logging=${log.loggingLevel}`);
    log.verbose(`message=${LOG_LEVEL.VERBOSE} logging=${log.loggingLevel}`);
    log.debug(`message=${LOG_LEVEL.DEBUG} logging=${log.loggingLevel}`);
    log.trace(`message=${LOG_LEVEL.TRACE} logging=${log.loggingLevel}`);
  }

  it ('provides a useful global default', async () => {
    emit(testConsole);
  });

  it ('can be dialed back', async () => {
    testConsole.loggingLevel = LOG_LEVEL.USER;
    emit(testConsole);
  });

  it ('can be dialed up', async () => {
    testConsole.loggingLevel = LOG_LEVEL.EVERYTHING;
    emit(testConsole);
  });

  it ('groups things', async () => {
    testConsole.loggingLevel = LOG_LEVEL.EVERYTHING;
    testConsole.group('Begins');
    emit(testConsole);
    testConsole.groupEnd();
  });

});
