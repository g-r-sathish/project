const _ = require('underscore');
const cliCursor = require('cli-cursor');
const colors = require('colors');
const execFile = require('child_process').execFile;
const execSync = require('child_process').execSync;
const fs = require('fs');
const fsExtra = require('fs-extra');
const mustache = require('mustache');
const Path = require('path');
const promptSync = require('prompt-sync')({});
const spawnSync = require('child_process').spawnSync;
const sprintf = require('sprintf-js').sprintf;
const tmp = require('tmp');
const xmlbuilder2 = require('xmlbuilder2');
const yaml = require('js-yaml');

const config = require('./config');
const ConfigError = require('../classes/ConfigError');
const constants = require('./constants');
const ExecError = require('../classes/ExecError');
const {Projects} = require('../classes/Constants');

const util = require('util');

// override escape function to disable HTML escaping
mustache.escape = (value) => value;

constants.define('VERBOSITY_NORMAL', 0);
constants.define('VERBOSITY_VERBOSE', 1);

let hasSetTmpCleanupPolicy = false;
function _setTmpCleanupPolicy() {
  if (!hasSetTmpCleanupPolicy) {
    if (!config.debug.keep_temp) {
      tmp.setGracefulCleanup();
    }
    hasSetTmpCleanupPolicy = true;
  }
}

function isPresent (unknown) {
  return !util.isNull(unknown) && !util.isUndefined(unknown);
}

function isNotEmpty (unknown) {
  return isPresent(unknown) && !_.isEmpty(unknown);
}

function isEmpty (unknown) {
  return !isPresent(unknown) || _.isEmpty(unknown);
}

function asArray (x) {
  x = x || [];
  return _.isArguments(x)
    ? Array.prototype.slice.call(x)
    : _.isArray(x)
      ? x
      : [x];
}

function getUserHome () {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
}

function pathExists (path) {
  try {
    return fs.statSync(path);
  } catch (ex) {
    return false;
  }
}

function fileExists (path) {
  try {
    return fs.statSync(path).isFile();
  } catch (ex) {
    return false;
  }
}

function directoryExists (path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch (ex) {
    return false;
  }
}

function removeDirectory (path) {
  if (directoryExists(path) && config.dotDir && path.startsWith(config.dotDir)) {
    let cmd = sprintf('rm -r %s', path);
    narrateln('EXEC', cmd);
    execSync(cmd);
  }
}

function removeFile (path) {
  if (fileExists(path) && config.dotDir && path.startsWith(config.dotDir)) {
    fs.unlinkSync(path);
  }
}

function removeFileRecklessly (path) {
  if (fileExists(path)) {
    fs.unlinkSync(path);
  }
}

function mkfiledir (pathspec) {
  let path = '/'; // absolute paths only
  let dirList = pathspec.split('/'); //Path.sep(pathspec);
  dirList.pop(); // remove filename
  _.each(dirList, function (dir) {
    path = Path.join(path, dir);
    try {
      fs.mkdirSync(path);
      narrateln('MKDIR', path);
    } catch (ex) {
      if (!/EISDIR|EEXIST/.test(ex)) throw ex
    }
  });
}

function mkdirs (pathspec) {
  let path = pathspec.substr(0, 1) === '/'
    ? '/'
    : sprintf('%s/', cwd()); // absolute paths only
  let dirList = pathspec.split('/'); //Path.sep(pathspec);
  _.each(dirList, function (dir) {
    path = Path.join(path, dir);
    try {
      fs.mkdirSync(path);
      narrateln('MKDIR:', path);
    } catch (ex) {
      if (!/EISDIR|EEXIST/.test(ex)) throw ex
    }
  });
}

function copyFile (fromFilePath, toFilePath, options) {
  options = _.extend({overwrite: false}, options);
  if (!options.overwrite && fs.existsSync(toFilePath)) {
    throw new Exception('File exists: ' + toFilePath);
  }
  fs.writeFileSync(toFilePath, fs.readFileSync(fromFilePath));
}

function copyFileOrDirectory (fromPath, toPath, options) {
  options = _.extend({
    overwrite: false
  }, options);
  if (!!options.overwrite) {
    options.errorOnExist = true;
  }
  narratef('Copying from %s to %s with options %s\n', fromPath, toPath, JSON.stringify(options));
  fsExtra.copySync(fromPath, toPath, options)
}

function writeTempFile (contents, options) {
  _setTmpCleanupPolicy();
  options = _.extend({
    tmpdir: config.tmpdir,
    mode: 0o644,
    prefix: 'tmp-',
    postfix: '.txt',
    discardDescriptor: true
  }, options);
  const tmpobj = tmp.fileSync(options);
  let filename = tmpobj.name;
  writeFile(filename, contents);
  return filename;
}

function createTempWriteStream (filename) {
  _setTmpCleanupPolicy();
  let dir = tmp.dirSync({tmpdir: config.tmpdir});
  let path = Path.join(dir.name, filename);
  let file = fs.createWriteStream(path);
  return {
    path: path,
    stream: file
  };
}

function createTempDir () {
  _setTmpCleanupPolicy();
  let dir = tmp.dirSync({tmpdir: config.tmpdir});
  return dir.name;
}

function printColumns (lval, rval) {
  if (util.isUndefined(rval) || util.isNull(rval)) {
    console.log(lval);
  } else {
    console.log(sprintf('%-110s%s', lval, rval));
  }
}

function _flatten () {
  let flatlist = [];
  _.each(arguments, function (arg) {
    flatlist = flatlist.concat(asArray(arg));
  });
  return _.invoke(flatlist, 'toString').join(' ');
}

function _write (level, stream, content) {
  if (level <= config.consoleVerbosityLevel) {
    stream.write(content);
  }
  if (config.logger) {
    config.logger.write(content);
    if (!/[\r\n]$/.test(content)) {
      config.logger.write("\n");
    }
  }
}

function print () {
  _write(constants.VERBOSITY_NORMAL, process.stdout, _flatten(arguments));
}

function printf () {
  _write(constants.VERBOSITY_NORMAL, process.stdout, sprintf.apply(this, arguments));
}

function println () {
  print.apply(this, asArray(arguments).concat('\n'));
}

function announce (text) {
  printf('%s\n'.inverse, text);
}

function subAnnounce (text) {
  printf('%s\n'.bold, text);
}

function startBullet (text, color, options) {
  options = _.extend({console: true}, options);
  const output = sprintf('%s %s ', config.display.bulletChar[color || 'plain'], text);
  options.console ? printf(output) : narrateln(output);
  return output;
}

function startSubBullet (text, indent) {
  printf('%s%s %s ', ' '.repeat((indent || 1) * 2), config.display.bulletChar.trivial, text);
}

function continueBullet (text, options) {
  options = _.extend({console: true}, options);
  let output = sprintf('%s %s ', config.display.arrowChar.plain, text);
  options.console ? printf(output) : narrateln(output);
  return output;
}

function endBullet (text, options) {
  options = _.extend({console: true}, options);
  let output;
  if (text) {
    output = sprintf('%s %s\n', config.display.arrowChar.plain, text);
  } else {
    output = '\n';
  }
  options.console ? printf(output) : narrateln(output);
  return output;
}

function bulletRow () {
  let args = asArray(arguments);
  startBullet(args.shift());
  if (args.length) {
    continueToEndBullet(args);
  } else {
    printf('\n');
  }
}

function continueToEndBullet (textArray) {
  for (let i = 0; i < textArray.length; i++) {
    if (i + 1 === textArray.length) {
      endBullet(textArray[i]);
    } else {
      continueBullet(textArray[i]);
    }
  }
}

function clearWaitCursor (text) {
  process.stdout.cursorTo(0);
  process.stdout.clearScreenDown();
}

function updateWaitCursor (text) {
  text = text || new Date().toLocaleTimeString()
  process.stdout.cursorTo(0);
  process.stdout.write(text);
  process.stdout.clearScreenDown();
}

function elapsedTime (startDate) {
  return new Date(new Date() - startDate).toISOString().substr(11, 8);
}

function warn () {
  _write(constants.VERBOSITY_NORMAL, process.stderr, _flatten(arguments, '\n').warn);
}

function narrateln () {
  _write(constants.VERBOSITY_VERBOSE, process.stdout, _flatten(arguments, '\n'));
}

function narratef () {
  _write(constants.VERBOSITY_VERBOSE, process.stdout, sprintf.apply(this, arguments));
}

function narrateJSON (obj) {
  if (!obj) return;
  let jsonString = JSON.stringify(obj, null, 2);
  _write(constants.VERBOSITY_VERBOSE, process.stdout, jsonString + '\n');
}

function readJSON (path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeJSON (path, obj) {
  mkfiledir(path);
  fs.writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

function readXML (path) {
  let contents = fs.readFileSync(path, 'utf8');
  return xmlbuilder2.create(contents).end({
    format: 'object',
    noDoubleEncoding: true
  });
}

function writeXML (path, obj) {
  const content = xmlbuilder2.create({
    encoding: 'utf-8'
  }, obj).end({
    format: 'xml',
    prettyPrint: true,
    indent: '    ',
    noDoubleEncoding: true
  });
  fs.writeFileSync(path, content, 'utf8');
}

function readYAML (path) {
  return yaml.load(fs.readFileSync(path, 'utf8'));
}

function writeYAML (path, data) {
  return writeFile(path, "---\n" + yaml.dump(data, { lineWidth: 200 }), 'utf8');
}

function readFile (path) {
  return fs.readFileSync(path, 'utf8');
}

function writeFile (path, content) {
  mkfiledir(path);
  return fs.writeFileSync(path, content);
}

function appendFile (path, content) {
  mkfiledir(path);
  return fs.appendFileSync(path, content);
}

function readSubdirectories (path) {
  return directoryExists(path) ? fs.readdirSync(path).filter(function (file) {
    fs.lstatSync(Path.join(path, file)).isDirectory()
  }) : undefined;
}

function removeFilesFromDirectory (path, regex) {
  _.each( fs.readdirSync(path), function (file) {
    if (file.match(regex)) {
      fs.unlinkSync(Path.join(path, file));
    }
  });
}

function exec (cmd, args, dir, options) {
  options = _.extend({
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 100 * 1024 * 1024
  }, options);
  args = Array.prototype.slice.call(args);
  let cmdLine = args && args.length ? [cmd].concat(args).join(' ') : cmd;
  narrateln('EXEC', cmdLine, sprintf('(dir=%s)', dir));
  let proc = spawnSync(cmd, args, options);
  if (proc.error) {
    narrateln('Could not spawn the command (perhaps $PATH or options.cwd is to blame...)');
    narrateln(`PATH=${process.env.PATH}`);
    throw new ExecError(proc.error, proc);
  }
  if (!options.noLogs && proc.stdout) {
    let stdout = proc.stdout.toString().trim();
    narrateln(stdout);
  }
  if (!options.noLogs && proc.stderr) {
    let stderr = proc.stderr.toString().trim();
    narrateln(stderr);
  }
  if (options.errorByStatus && options.errorByStatus[proc.status]) {
    throw new ExecError(options.errorByStatus[proc.status], proc);
  }
  if (proc.status && !options.okToFail) {
    throw new ExecError('EXIT status not okay', proc);
  }
  return proc;
}

function execFileAsync (file, args, dir, options) {
  options = _.extend({
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024
  }, options);
  args = Array.prototype.slice.call(args);
  let cmdLine = args && args.length ? [file].concat(args).join(' ') : file;
  narrateln('EXEC>ASYNC>', cmdLine, sprintf('(dir=%s)', dir));

  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (stderr) {
        narrateln('EXEC>ASYNC>STDERR>', stderr);
      }
      if (stdout) {
        narrateln('EXEC>ASYNC>STDOUT', stdout);
      }
      if (error) {
        narrateln(error);
        reject(stdout.trim());
      }
      resolve(stdout.trim());
    });
  });
}

function repoStatusText (label, workDir, clonePath) {
  let text;
  if (label === Projects.GitTarget.NO_OP) {
    text = 'Cloned'.trivial;
  } else if (label.startsWith(Projects.GitTarget.TAG_PREFIX)) {
    text = sprintf('At tag %s'.trivial, label.substring(Projects.GitTarget.TAG_PREFIX.length).useful)
  } else if (label.startsWith(Projects.GitTarget.COMMIT_PREFIX)) {
    text = sprintf('At commit %s'.trivial, label.substring(Projects.GitTarget.COMMIT_PREFIX.length).useful)
  } else {
    text = sprintf('On branch %s'.trivial, label.useful);
  }
  let isLocal = (workDir !== config.workDir);
  text += sprintf(' in %s'.trivial, isLocal ? workDir.useful : workDir.trivial);
  if (clonePath) {
    text += (isLocal ? '/'.useful + clonePath.useful : '/'.trivial + clonePath.trivial);
  }
  return text;
}

function gitTargetFriendlyName (label) {
  if (label === Projects.GitTarget.NO_OP) {
    return undefined;
  } if (label.startsWith(Projects.GitTarget.TAG_PREFIX)) {
    return sprintf('tag %s', label.substring(Projects.GitTarget.TAG_PREFIX.length));
  } else if (label.startsWith(Projects.GitTarget.COMMIT_PREFIX)) {
    return sprintf('commit %s', label.substring(Projects.GitTarget.COMMIT_PREFIX.length))
  } else {
    return sprintf('branch %s', label);
  }
}

function cwd() {
  return config.personal_settings.rflow_workdir && !config._all['use-cwd'] ? config.personal_settings.rflow_workdir :
    process.cwd();
}

function extractOptions(optionList, args, exclusionList) {
  let optionInfo = {};
  _.each(optionList, function (option) {
    if (!!option.defaultOption) return;
    if (!!option.required) return;
    if (_.contains(exclusionList, option.name)) return;
    optionInfo[option.name] = option;
  });

  let options = _.clone(config._all);
  let optionsArray = [];
  for (var option in options) {
    if (options.hasOwnProperty(option)) {
      if (optionInfo[option]) {
        let alias = sprintf('-%s', optionInfo[option].alias);
        if (_.contains(args, alias)) {
          optionsArray.push(alias);
        } else {
          optionsArray.push(sprintf('--%s', option));
        }
        if (options[option] !== true) {
          optionsArray = optionsArray.concat(asArray(options[option]));
        }
      }
    }
  }

  return optionsArray;
}

function textToLines(text) {
  if (!text) {
    return [];
  }
  return _.filter(text.trim().split(/[\r\n]+/), function (line) {
    return line && line.length > 0
  });
}

function renderTemplate (filename, context) {
  let content = readFile(Path.join(process.env.NODE_BASE_DIRECTORY, 'res', filename));
  return renderText(content, context);
}

function renderText (content, context) {
  let view = _.extend({config: config}, context);
  let result = mustache.render(content, view);
  return result;
}

function generateScript (filename, context) {
  let content = renderTemplate(filename, context);
  let path = writeTempFile(content, {mode: 0o755, postfix: '.sh'});
  return path;
}

/**
 * @function overlay
 * Recursively copy members of one object to another by key.
 *
 *  var dest = {a:1};
 *  overlay(dest, {b:2}, {c:3});
 *  // dest is now {a:1, b:2, c:3}
 */
function overlay (/* arguments */) {
  let args = Array.prototype.slice.call(arguments);
  let dest = args.shift();
  if (typeof(dest) !== 'object') throw new Error('invalid argument');
  for (let i = 0; i < args.length; i++) {
    let src = args[i];
    if (typeof(src) === 'undefined') continue;
    if (typeof(dest) !== typeof(src)) throw new Error('type mismatch');
    if (dest === src) continue;
    for (let k in src) {
      if (src.hasOwnProperty(k)) {
        if (typeof(dest[k]) === 'function') {
          dest[k] = src[k];
        } else if (typeof(dest[k]) === 'object') {
          overlay(dest[k], src[k]);
        } else {
          dest[k] = src[k];
        }
      }
    }
  }
  return dest;
}

function prompt (ask, value, opts) {
  cliCursor.show();
  let response = promptSync(ask.toString(), value, opts);
  cliCursor.hide();
  return response;
}

function promptHidden (ask, value, opts) {
  cliCursor.show();
  let response = promptSync.hide(ask.toString(), value, opts);
  cliCursor.hide();
  return response;
}

function plural(value, suffix) {
  suffix = suffix || 's';
  return value > 1 ? suffix : ''
}

function applyTheme() {
  const name = config.theme || 'light';
  const theme = config.defaultThemes[name];
  if (!theme) {
    _applyEmptyTheme();
    throw new ConfigError(sprintf('Invalid theme %s', name));
  }
  const overrides = config.themeOverrides;
  if (overrides) {
    Object.keys(overrides).forEach(key => {
      theme[key] = overrides[key];
    })
  }
  colors.setTheme({
    plain: theme.plain,
    useful: theme.useful,
    trivial: theme.trivial,
    good: theme.good,
    warn: theme.warn,
    bad: theme.bad
  });

  try {
    const text = 'text';
    text.plain;
    text.useful;
    text.trivial;
    text.good;
    text.warn;
    text.bad;
  } catch (err) {
    _applyEmptyTheme();
    throw new ConfigError('Theme contains invalid value');
  }
  if (!theme.bulletChar || theme.bulletChar.length !== 1) {
    throw new ConfigError('bulletChar must be a single character');
  }
  if (!theme.arrowChar || theme.arrowChar.length !== 1) {
    throw new ConfigError('arrowChar must be a single character');
  }
  if (!theme.spinner || !Array.isArray(theme.spinner) || !theme.spinner.length ||
    theme.spinner.length > 14) {
    throw new ConfigError('spinner must be an array of 1 to 14 characters')
  }
  theme.spinner.forEach(char => {
    if (!char || char.length !== 1) {
      throw new ConfigError('spinner elements must each be a single character');
    }
  });
  config.display = {
    bulletChar: theme.bulletChar,
    arrowChar: theme.arrowChar,
    spinner: theme.spinner
  };
}

function _applyEmptyTheme() {
  colors.setTheme({
    plain: [],
    useful: [],
    trivia: [],
    good: [],
    warn: [],
    bad: []
  });
}

module.exports = {
  isPresent                : isPresent,
  isNotEmpty               : isNotEmpty,
  isEmpty                  : isEmpty,
  asArray                  : asArray,
  getUserHome              : getUserHome,
  pathExists               : pathExists,
  fileExists               : fileExists,
  directoryExists          : directoryExists,
  readSubdirectories       : readSubdirectories,
  removeDirectory          : removeDirectory,
  removeFile               : removeFile,
  removeFileRecklessly     : removeFileRecklessly,
  removeFilesFromDirectory : removeFilesFromDirectory,
  copyFile                 : copyFile,
  copyFileOrDirectory      : copyFileOrDirectory,
  mkfiledir                : mkfiledir,
  mkdirs                   : mkdirs,
  printColumns             : printColumns,
  print                    : print,
  printf                   : printf,
  println                  : println,
  announce                 : announce,
  subAnnounce              : subAnnounce,
  startBullet              : startBullet,
  startSubBullet           : startSubBullet,
  continueBullet           : continueBullet,
  clearWaitCursor          : clearWaitCursor,
  updateWaitCursor         : updateWaitCursor,
  elapsedTime              : elapsedTime,
  endBullet                : endBullet,
  bulletRow                : bulletRow,
  continueToEndBullet      : continueToEndBullet,
  narrateln                : narrateln,
  narratef                 : narratef,
  narrateJSON              : narrateJSON,
  readYAML                 : readYAML,
  writeYAML                : writeYAML,
  warn                     : warn,
  readJSON                 : readJSON,
  writeJSON                : writeJSON,
  readXML                  : readXML,
  writeXML                 : writeXML,
  readFile                 : readFile,
  writeFile                : writeFile,
  appendFile               : appendFile,
  exec                     : exec,
  execFileAsync            : execFileAsync,
  repoStatusText           : repoStatusText,
  gitTargetFriendlyName    : gitTargetFriendlyName,
  cwd                      : cwd,
  extractOptions           : extractOptions,
  textToLines              : textToLines,
  renderText               : renderText,
  renderTemplate           : renderTemplate,
  writeTempFile            : writeTempFile,
  createTempWriteStream    : createTempWriteStream,
  generateScript           : generateScript,
  createTempDir            : createTempDir,
  overlay                  : overlay,
  prompt                   : prompt,
  promptHidden             : promptHidden,
  plural                   : plural,
  applyTheme               : applyTheme
};
