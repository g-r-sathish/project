'use strict';

let mockData = {};

/* eslint-disable camelcase */
mockData.buildFile = {
   bundle_name: 'Stay',
   bundle_version: '69.0.0',
   root_project: 'com.agilysys.pms:root-pom',
   dependencies_property: 'stay.dependencies.version',
   versions_files: { repo_path: 'cfg/versions-files', mainline: 'master' },
   projects: [ { mainline: 'test/dustin', repo_path: 'pms/victorsrootpom' } ] 
  };


  mockData.vfHouse = {
    buildFile: {
      bundle_name: 'House',
      bundle_version: '68.0.0',
      versions_files: {
      }
    }
  };

  mockData.vfSnapshot = {
    buildFile: {
      bundle_name: 'STAY',
      bundle_version: '68.0.0-SNAPSHOT',
      versions_files: {
      }
    }
  };

  mockData.vfAsExpected = {
    buildFile: {
      bundle_name: 'Stay',
      bundle_version: '68.0.0',
      versions_files: {
      }
    }
  };


/* eslint-enable camelcase */


module.exports = mockData;
