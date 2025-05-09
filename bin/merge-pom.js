#!/usr/bin/env rbuild-node-env
const _ = require('underscore');
const colors = require('colors');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const config = require('../lib/common/config');
const mergePom = require('../lib/common/merge-pom');
const {POM} = require('../lib/classes/POM');
const util = require('../lib/common/util');

// '-d|--debug' is reserved as a first-arg to invoke the debugger
const optionList = [
  { name: 'ours',                   type: String,   description: 'Our POM' },
  { name: 'theirs',                 type: String,   description: 'Their POM' },
  { name: 'base',                   type: String,   description: 'Base POM' },
  { name: 'commit',                 type: Boolean,  description: 'Write out POM changes' },
  { name: 'help',       alias: 'h', type: Boolean },
  { name: 'verbose',    alias: 'v', type: Boolean },
  { name: 'no-color',               type: Boolean,  description: 'Disable color console output' },
  { name: 'no-cache',               type: Boolean,  description: 'Disable use of cached POM files downloaded from artifactory' }
];

_.extend(config, commandLineArgs(optionList));

// Bail if requirements are not met
if (!config.ours || !config.theirs || !config.base) {
  config.help = true;
}

if (config.help) {
  util.println(commandLineUsage([
    {
      header: 'rGuest Stay POM merge tool',
      content: 'Preserve correct versions when merging POM files'
    },
    {
      header: 'Synopsis',
      content: [
        '$ merge-pom {bold --ours} {underline pom1.xml} {bold --base} {underline pom2.xml} {bold --theirs}' +
        ' {underline pom3.xml}',
        '$ merge-pom {bold -h|--help}'
      ]
    },
    {
      header: 'Options',
      optionList: optionList
    }
  ]));
  return;
}

const ourPom = POM.create(config.ours, {detached: true});
const basePom = POM.create(config.base, {detached: true});
const theirPom = POM.create(config.theirs, {detached: true});

ourPom.readDependencies();
basePom.readDependencies();
theirPom.readDependencies();
let ourTrunkName = process.env.MERGE_POM_OUR_TRUNK_NAME;

util.printf("%-31s%-55s %s\n", '+', 'Ours'.underline, 'Theirs'.underline);

mergePom.mergeVersion(ourPom, basePom, theirPom, {ourTrunkName: ourTrunkName});
util.println();

mergePom.mergeParent(ourPom, basePom, theirPom, {ourTrunkName: ourTrunkName});
util.println();

mergePom.mergeDependencies(ourPom, basePom, theirPom, {ourTrunkName: ourTrunkName});
util.println();

if (config.commit) {
  util.println("Saving POM files".underline);
  util.println(ourPom.save());
  util.println(basePom.save());
  util.println(theirPom.save());
  util.println();
}
