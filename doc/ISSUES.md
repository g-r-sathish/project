### Release pipe channel is missing notifications

[9:09 AM] Peloquin, Aaron
    start-rc.js line 168
​[9:11 AM] Peloquin, Aaron
    You don't have channel: config.releasePipeChannel for notifyOnStartedRC and notifyOnAbandonedRC

### Hide "NODE_TLS_REJECT_UNAUTHORIZED" warning

First relevant Google match leads to:
https://github.com/cypress-io/cypress/pull/5256/files/b08835018e814562e2f6cea8a6f8e8e45d1cf3e8
(which I tried and abandoned because the overridden method didn't hit)

### While migrating to teams

It appears rflow is sending the first notification too early, in so far as the changeset file has
not yet been read from disk. `ChangesetFile.getValueSafe()` was introduced as a work around.

Attempting to:

    rflow -c foo:TEST-12345 start -i all --dry-run

Would produce

    Fatal error
    EXIT status not okay; status=128, args=[]
    fatal: no upstream configured for branch 'changeset/TEST-12300'

Hence the git call in `GitRepository.prototype.hasLocalCommits` was wrapped in a try/catch so to
suppress this error only with `--dry-run`.

### Manual PR needed:

```
    MacBook-Pro giesr 16:55:32 ~/src/agilysys
    $ rflow -c ui:VCTRS-62064 pull
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files

    Fatal error
    BuildError: Changeset ui:VCTRS-62064 does not exist 
    MacBook-Pro giesr 16:56:54 ~/src/agilysys
    $ rflow -c ui:VCTRS-62046 pull
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files
    ● rgui ▶ On branch changeset/VCTRS-62046 in /Users/giesr/src/agilysys/pms/rgui
    Verifying status
    ● rgui ▶ OK to proceed
    Initializing secondary
    ● rgui ▶ On branch master in /Users/giesr/.rflow/repos/pms/rgui
    Switching to review branch
    ● rgui ▶ On branch review/VCTRS-62046 in /Users/giesr/.rflow/repos/pms/rgui
    Merging to changeset branch from tag release-ui-74.409
    ● rgui ▶ Conflicts
    Merging to review branch from tag release-ui-74.409
    ● rgui ▶ Conflicts
    Updating changeset POM dependencies
    Updating project versions from bundle 74.409
    ● contentpackage ▶ No change
    ● stay-befe ▶ No change
    Updating source control for changeset branches
    ● rgui ▶ Uncommitted
    Updating source control for review branches
    ● rgui ▶ Uncommitted
    Updating source control
    ● versions-files ▶ Committed & pushed
    Checkout other projects if relevant
    ● contentpackage ▶ Ignored ▶ Other origin
    ● stay-befe ▶ Ignored ▶ Other origin
    ● deployment ▶ Ignored ▶ Other origin
    ● inventory ▶ Ignored ▶ Other origin
    ● rackspace-inventory ▶ Ignored ▶ Other origin
    ● azure-inventory ▶ Ignored ▶ Other origin
    ● databasescripts ▶ Ignored ▶ Other origin
    Checking local status
    ● rgui ▶ Merge conflicts
    Resolution required
    ● rgui ▶                                Ours                                                    Theirs
    Merge version 
    Skipping (inherited value) 

    Merge parent 
    rgui                          *74.306-VCTRS-62046-SNAPSHOT                             74.409.1-SNAPSHOT

    Merge dependencies 

    Saving POM files 
    .merge_file_3KT633 
    .merge_file_gzeBhT 

                                   Ours                                                    Theirs
    Merge version 
    Skipping (inherited value) 

    Merge parent 
    rgui                          *74.306-VCTRS-62046-SNAPSHOT                             74.409.1-SNAPSHOT

    Merge dependencies 

    Saving POM files 
    .merge_file_ODS3db 
    .merge_file_g8ZU1J 

                                   Ours                                                    Theirs
    Merge version 
    rgui                          *74.306-VCTRS-62046-SNAPSHOT                             74.409.1-SNAPSHOT

    Merge parent 
    root-pom                       74.0.0                                                  74.0.0

    Merge dependencies 
    ui-interface                   ${project.version}                                      ${project.version}
    pms-common                     74.593.0                                                74.593.0
    pms-common                     74.593.0                                                74.593.0

    Saving POM files 
    .merge_file_ptP5j0 
    .merge_file_OoyZSU 

    Auto-merging ng-ui/xl8.data.json
    Auto-merging ng-ui/test/spec/mocks/mock-profile-service.js
    CONFLICT (content): Merge conflict in ng-ui/test/spec/mocks/mock-profile-service.js
    Auto-merging ng-ui/grunt/connect.js
    Auto-merging ng-ui/app/scripts/services/api/profile-service.js
    Auto-merging ng-ui/app/scripts/config/constants.js
    CONFLICT (content): Merge conflict in ng-ui/app/scripts/config/constants.js
    Auto-merging ng-ui/app/index.html
    Auto-merging ng-ui/app/data/translation/en-US.json
    CONFLICT (content): Merge conflict in ng-ui/app/data/translation/en-US.json
    Automatic merge failed; fix conflicts and then commit the result.

    MacBook-Pro giesr 16:58:53 ~/src/agilysys
    $ rflow -c ui:VCTRS-62046 pull
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files
    ● rgui ▶ On branch changeset/VCTRS-62046 in /Users/giesr/src/agilysys/pms/rgui
    Verifying status
    ● rgui ▶ Merge in progress

    Fatal error
    BuildError: Pull cannot proceed; local repositories need attention before you can proceed 
    MacBook-Pro giesr 17:27:25 ~/src/agilysys
    $ rflow -c ui:VCTRS-62046 pull
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files
    ● rgui ▶ On branch changeset/VCTRS-62046 in /Users/giesr/src/agilysys/pms/rgui
    Verifying status
    ● rgui ▶ OK to proceed
    Initializing secondary
    ● rgui ▶ On branch master in /Users/giesr/.rflow/repos/pms/rgui
    Switching to review branch
    ● rgui ▶ On branch review/VCTRS-62046 in /Users/giesr/.rflow/repos/pms/rgui
    Merging to changeset branch from tag release-ui-74.410
    ● rgui ▶ No conflicts
    Merging to review branch from tag release-ui-74.410
    ● rgui ▶ Conflicts
    Updating changeset POM dependencies
    Updating project versions from bundle 74.410
    ● contentpackage ▶ No change
    ● stay-befe ▶ No change
    Updating source control for changeset branches
    ● rgui ▶ Committed
    Updating source control for review branches
    ● rgui ▶ Uncommitted
    Updating source control
    ● versions-files ▶ Committed & pushed
    Checkout other projects if relevant
    ● contentpackage ▶ Ignored ▶ Other origin
    ● stay-befe ▶ Ignored ▶ Other origin
    ● deployment ▶ Ignored ▶ Other origin
    ● inventory ▶ Ignored ▶ Other origin
    ● rackspace-inventory ▶ Ignored ▶ Other origin
    ● azure-inventory ▶ Ignored ▶ Other origin
    ● databasescripts ▶ Ignored ▶ Other origin
    Checking local status
    ● rgui ▶ Unpushed commits
    Noteworthy
    A pull is not a push; you now have local commits that have not been pushed 
    MacBook-Pro giesr 18:02:04 ~/src/agilysys
    $ rflow -c ui:VCTRS-62046 push
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files
    ● rgui ▶ On branch changeset/VCTRS-62046 in /Users/giesr/src/agilysys/pms/rgui
    Scanning projects
    ● rgui ▶ Local commits
    Pushing projects
    ● rgui ▶ Pushed
    Triggering orchestrated build
    ● Jenkins URL ▶ http://jenkins.bellevue.agilysys.com/job/STAY_orchestrated_build
    ● Slack Channel ▶ #stay-jenkins-builds
    MacBook-Pro giesr 18:03:46 ~/src/agilysys
    $ rflow -c ui:VCTRS-62046 submit-pr
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files
    ● rgui ▶ On branch changeset/VCTRS-62046 in /Users/giesr/.rflow/repos/pms/rgui
    Switching to review branch
    ● rgui ▶ On branch review/VCTRS-62046 in /Users/giesr/.rflow/repos/pms/rgui
    Checking for unmerged commits
    ● rgui ▶ Current
    Noteworthy
    Your changeset has no unmerged commits, PRs are not needed 
    MacBook-Pro giesr 18:18:55 ~/src/agilysys
    $ rflow -c ui:VCTRS-62046 submit-pr
    Initializing
    ● versions-files ▶ On branch master in /Users/giesr/.rflow/repos/cfg/versions-files
    ● rgui ▶ On branch changeset/VCTRS-62046 in /Users/giesr/.rflow/repos/pms/rgui
    Switching to review branch
    ● rgui ▶ On branch review/VCTRS-62046 in /Users/giesr/.rflow/repos/pms/rgui
    Checking for unmerged commits
    ● rgui ▶ Current
    Noteworthy
    Your changeset has no unmerged commits, PRs are not needed 
```
