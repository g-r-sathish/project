const GitBackedYAMLFile = require('../GitBackedYAMLFile');
const YAMLFile = require('../YAMLFile');

class ApplicationConfigFile extends GitBackedYAMLFile {

  constructor(repo, path, required=false) {
    super(repo, path, required);
  }

  setDeploymentVersion (version) {
    try {
      this.data.deployment.version = version;
    } catch (ex) {
      throw new YAMLFile.FileStructureError(ex);
    }
  }

  setTestpool (enabled) {
    try {
      delete this.data.TEST_POOL; // deprecated in AKS (was for compose-stack only)
      this.data.testPool = !!enabled;
    } catch (ex) {
      throw new YAMLFile.FileStructureError(ex);
    }
  }
}

module.exports = ApplicationConfigFile;
