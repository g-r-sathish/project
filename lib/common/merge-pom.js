const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;
const util = require('./util');

const BuildError = require('../classes/BuildError');
const {POM} = require('../classes/POM');
const {Trunks} = require('../classes/Constants');
const {VersionEx} = require('../classes/VersionEx');

function println(text, options) {
  if (options && options.writeToLog) {
    util.narrateln(text);
  } else {
    util.println(text);
  }
}

function printMergeInfo(id, left, opr, right, options) {
  if (opr === '=') {
    left = " " + left.dim;
    right = " " + right.dim;
  } else if (opr === '?') {
    left = " " + left.red;
    right = " " + right.red;
  } else if (opr === '>') {
    left = "*" + left.bold;
    right = " " + right.black;
  } else if (opr === '<') {
    left = " " + left.black;
    right = "*" + right.bold;
  }
  println(sprintf("%-30s%-55s %s", id, left, right), options);
}

function isAProperty(versionText) {
  return versionText.startsWith('${') && versionText.endsWith('}')
}

function isARange(versionText) {
  return (versionText.startsWith('(') || versionText.startsWith('[')) && (versionText.endsWith(')') || versionText.endsWith(']'));
}

function applyDefaults(options) {
  return _.extend({
    writeToLog: false,
    updateOurs: true,
    updateTheirs: true,
    ourTrunkName: undefined
  }, options);
}

function mergeNode(ourVersion, ourNode, baseNode, theirVersion, theirNode, options) {
  let opr = '?';

  if (ourVersion.toString() === theirVersion.toString()) {
    // Nothing to do
    opr = '=';
  } else {
    opr = '>';

    let sameTrunk = ourVersion.getTrunkName() === theirVersion.getTrunkName();
    sameTrunk = sameTrunk || (!ourVersion.hasTrunk() && theirVersion.getTrunkName() === options.ourTrunkName);

    if (sameTrunk && !ourVersion.hasTrackingId() && !theirVersion.hasTrackingId() &&
      ourVersion.compareTo(theirVersion) < 0) {
      opr = '<';
    }
  }
  switch (opr) {
    case '>':
      if (options.updateTheirs) {
        theirNode.setVersion(ourVersion.toString());
      }
      if (baseNode) {
        baseNode.setVersion(ourVersion.toString());
      }
      break;
    case '<':
      if (options.updateOurs) {
        ourNode.setVersion(theirVersion.toString());
      }
      if (baseNode) {
        baseNode.setVersion(theirVersion.toString());
      }
      break;
  }
  return opr;
}


/**
 * POM Version
 */

function mergeVersion(ourPom, basePom, theirPom, options) {
  options = applyDefaults(options);

  println(sprintf("Merge version (%s)".underline, options.ourTrunkName || Trunks.MASTER), options);

  let ourVersion = ourPom.getOwnVersion();
  let theirVersion = theirPom.getOwnVersion();
  if (!ourVersion || !theirVersion) {
    println("Skipping (inherited value)".yellow.italic, options);
    return;
  }
  ourVersion = new VersionEx(ourVersion);
  theirVersion = new VersionEx(theirVersion);

  let opr = mergeNode(ourVersion, ourPom, basePom, theirVersion, theirPom, options);
  printMergeInfo(theirPom.getArtifactId(), ourVersion.toString(), opr, theirVersion.toString(), options);
}

/**
 * Parent POM
 *
 * We do not handle Victors Root (that needs to be done manually).
 */

function mergeParent (ourPom, basePom, theirPom, options) {
  options = applyDefaults(options);

  println(sprintf("Merge parent (%s)".underline, options.ourTrunkName || Trunks.MASTER), options);
  let ourParent;
  let theirParent;
  let baseParent;
  try {
    ourParent = ourPom.getParent();
    baseParent = basePom ? basePom.getParent() : undefined;
    theirParent = theirPom.getParent();
  } catch (ex) {
    if (ex instanceof BuildError) return;
    throw ex;
  }

  if (!ourParent || !theirParent) {
    return; // No parent to merge
  }

  if (ourParent.getCanonicalArtifactId() !== theirParent.getCanonicalArtifactId()) {
    return; // Apples and oranges
  }

  let ourVersion = new VersionEx(ourParent.getVersion());
  let theirVersion = new VersionEx(theirParent.getVersion());

  let opr = mergeNode(ourVersion, ourParent, baseParent, theirVersion, theirParent, options);
  printMergeInfo(theirParent.getArtifactId(), ourVersion.toString(), opr, theirVersion.toString(), options);
}

/**
 * PMS Dependencies
 */

function mergeDependencies (ourPom, basePom, theirPom, options) {
  options = applyDefaults(options);

  println(sprintf("Merge dependencies (%s)".underline, options.ourTrunkName || Trunks.MASTER), options);
  let pmsDependencies = theirPom.getFilteredDependencies(dep => {
    if (!dep.getVersion()) return false;
    if (dep.location === POM.Location.PARENT) return false;
    if (dep.getCanonicalArtifactId() === 'com.agilysys.pms:root-pom') return false;
    if (dep.getCanonicalArtifactId() === 'com.agilysys.pms:stay-root-pom') return false;
    return /^com\.agilysys(\.pms|\.qa|:waper|\.peloquina|\.giesr)/.test(dep.toString());
  });
  _.each(pmsDependencies, function (theirDependency) {
    let theirVersionText = theirDependency.getVersion();
    let ourVersionText = undefined;
    let ourDependency = undefined;
    let baseDependency = undefined;

    try {
      ourDependency = ourPom.getFullyQualifiedDependency(theirDependency.getFullyQualifiedName());
      baseDependency =
        basePom ? basePom.getFullyQualifiedDependency(theirDependency.getFullyQualifiedName()) : undefined;
      if (ourDependency) {
        ourVersionText = ourDependency.getVersion();
      } else {
        return;
      }
    } catch (ex) {
      if (!(ex instanceof BuildError)) throw ex;
    }

    let opr = '?';
    if (ourVersionText === theirVersionText || !ourVersionText || !theirVersionText) {
      // Do nothing
      opr = '=';
      ourVersionText = ourVersionText || 'absent';
      theirVersionText = theirVersionText || 'absent';
    } else {
      opr = '>';

      let ourVersionIsNumeric = !isAProperty(ourVersionText) && !isARange(ourVersionText);
      let theirVersionIsNumeric = !isAProperty(theirVersionText) && !isARange(theirVersionText);

      if (ourVersionIsNumeric && theirVersionIsNumeric) {
        let ourVersion = new VersionEx(ourVersionText);
        let theirVersion = new VersionEx(theirVersionText);
        let sameTrunk = ourVersion.getTrunkName() === theirVersion.getTrunkName();
        sameTrunk = sameTrunk || (!ourVersion.hasTrunk() && theirVersion.getTrunkName() === options.ourTrunkName);

        if (sameTrunk && !ourVersion.hasTrackingId() && !theirVersion.hasTrackingId() &&
          ourVersion.compareTo(theirVersion) < 0) {
          opr = '<';
        }
      }
    }

    switch (opr) {
      case '>':
        if (options.updateTheirs) {
          theirDependency.setVersion(ourVersionText);
        }
        if (baseDependency) {
          baseDependency.setVersion(ourVersionText);
        }
        break;
      case '<':
        if (options.updateOurs) {
          ourDependency.setVersion(theirVersionText);
        }
        if (baseDependency) {
          baseDependency.setVersion(theirVersionText);
        }
        break;
    }

    printMergeInfo(theirDependency.getArtifactId(), ourVersionText, opr, theirVersionText, options);
  });
}

module.exports.mergeVersion = mergeVersion;
module.exports.mergeParent = mergeParent;
module.exports.mergeDependencies = mergeDependencies;
