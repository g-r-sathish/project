const BuildError = require('./BuildError')
const sprintf = require('sprintf-js').sprintf;

/**
 * @class
 * @param {string} message
 * @param proc The child process where the error originated from.
 */
function ExecError(message, proc) {
  if (!(this instanceof ExecError)) {
    return new ExecError(message);
  }

  try {
    throw new Error(message);
  }
  catch (err) {
    this.message = message;
    this.stack = err.stack;
  }

  this.message = message || '';
  this.status = proc.status;
  this.args = proc.args;
  if (proc.stdout) {
    this.stdout = proc.stdout.toString();
  }
  if (proc.stderr) {
    this.stderr = proc.stderr.toString();
  }
}

ExecError.prototype = new BuildError();
ExecError.prototype.constructor = ExecError;
ExecError.prototype.toString = function() {
  let args = this.args || [];
  return sprintf('%s; status=%d, args=[%s]', this.message || 'ExecError', this.status, args.join(' '));
};

module.exports = ExecError;
