#!/bin/bash
npm_prefix="$HOME/npm-local"
rc_file="$HOME/.bashrc"
[[ ! -d "$npm_prefix" ]] && mkdir "$npm_prefix"
npm config set prefix "$npm_prefix"
touch $rc_file
echo "export PATH=$npm_prefix/bin:\$PATH" >> $rc_file
source $rc_file
npm link
echo "re-login or run 'source $rc_file' to pick up your new PATH"
