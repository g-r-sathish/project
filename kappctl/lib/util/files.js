//  Copyright (C) Agilysys, Inc. All rights reserved.

const assert = require("assert").strict;
const fs = require("fs");
const {log} = require("./ConsoleLogger");
const Path = require("path");

function pathExists(path) {
  try {
    return fs.statSync(path);
  } catch (ex) {
    return false;
  }
}

module.exports.pathExists = pathExists;

function fileExists(path) {
  try {
    return fs.statSync(path).isFile();
  } catch (ex) {
    return false;
  }
}

module.exports.fileExists = fileExists;

function directoryExists(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch (ex) {
    return false;
  }
}

module.exports.directoryExists = directoryExists;

function removeFile(path) {
  if (fileExists(path)) {
    fs.unlinkSync(path);
  }
}

module.exports.removeFile = removeFile;

function mkdirs(absPathSpec) {
  assert.ok(absPathSpec.substr(0, 1) === '/');
  let dirList = absPathSpec.split('/');
  let path = '/';
  for (const dir of dirList) {
    path = Path.join(path, dir);
    try {
      fs.mkdirSync(path);
      log.verbose('mkdir: %s', path);
    } catch (ex) {
      if (!/EISDIR|EEXIST/.test(ex)) throw ex
    }
  }
}

module.exports.mkdirs = mkdirs;

function copyFile(fromFilePath, toFilePath, options) {
  options = Object.assign({overwrite: false}, options);
  if (!options.overwrite && fs.existsSync(toFilePath)) {
    throw new Error('File exists: ' + toFilePath);
  }
  fs.writeFileSync(toFilePath, fs.readFileSync(fromFilePath));
}

module.exports.copyFile = copyFile;

function readFile(path, options) {
  options = Object.assign({encoding: 'utf8'}, options);
  return fs.readFileSync(path, 'utf8'); // When encoding is specified returns a string
}
module.exports.readFile = readFile;

function writeFile(path, content, options) {
  options = Object.assign({encoding: 'utf8'}, options);
  mkdirs(Path.dirname(path));
  return fs.writeFileSync(path, content, options);
}
module.exports.writeFile = writeFile;