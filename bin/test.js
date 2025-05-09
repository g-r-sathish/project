#!/usr/bin/env rbuild-node-env
'use strict';

const spawnSync = require('child_process').spawnSync;

let argv = [];
let clParams = process.argv.slice(2);
if (clParams && clParams[0]) {
    argv.push(clParams);
}

process.exit(spawnSync('mocha', argv, {cwd: process.env.NODE_BASE_DIRECTORY, stdio: 'inherit'}).status);
