#!/usr/bin/env node
'use strict';

const spawnSync = require('child_process').spawnSync;
const path = require('path');

let execPath = process.argv.shift(); // node
let invokedAs = process.argv.shift(); // /usr/local/bin/script for example
let baseDirectory = path.join(__dirname, '..'); // this script lives in bin

process.env.NODE_BASE_DIRECTORY = baseDirectory;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
process.env.NODE_NO_WARNINGS = 1;

if (process.argv.length) {
	if (process.argv[1] === '-d' || process.argv[1] === '--debug') {
		process.argv.splice(1, 1);
		process.argv.unshift('--inspect-brk');
	}
} else {
  process.exit(255);
}

if (false) {
  process.stdout.write("baseDirectory:  " + baseDirectory + "\n");
  process.stdout.write("invokedAs:  		" + invokedAs + "\n");
  process.stdout.write("arguments:  		" + process.argv.join(' ') + "\n");
  process.stdout.write("execPath:   		" + execPath + "\n");
}

process.exit(spawnSync(execPath, process.argv, {stdio: 'inherit'}).status);
