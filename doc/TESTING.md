
Update ~/.rflow/config.json
Scenario
  rflow start
  make_change
  commit_upstream


versions-files/
  stay/
    test/
      config.json

jira-server
  * https://www.atlassian.com/software/jira/free
  * some mock
  * static test project in our existing
  * punt on jira, focus on azdo

azdo-server
  * free account outside agys
  * test project under agys
  

stash-server (https://github.com/jkarlosb/git-server-docker)

describe('NewRepository', function () {

  Stash
  Jira
  AzureDevops.Project.Boards

  versions-files/
    stay/
      test/
        config.json

  let repo = GitRepository.create(...);

  let vfSnapshot = new VersionsFile(mockData.vfSnapshot);
  let vfAsExpected = new VersionsFile(mockData.vfAsExpected);

  it('should honor the project dir', function () {

    gitServer.createRepository('nuevo');
    bundleYaml = new Bundle('test');
    bundleYaml.addProject('nuevo')
    'test:


    assert.equal(vfHouse.getPath(), 'house/sprint-68/68.0.0.yml');
  });


