# Merge POM

## Design (form AaronP)

    merge                               ours (before)                  theirs (before)                ours (after)                   theirs (after)                   result

    [ARTIFACT VERSION]
    feature/ from dev/                  69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0.5-SNAPSHOT              69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0-VCTRS-xxxxx-SNAPSHOT      no conflict
    dev/ from feature/                  69.0.0.5-SNAPSHOT              69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0.5-SNAPSHOT              69.0.0.5-SNAPSHOT                no conflict
    dev/(greater) from dev/(lesser)     69.1.0.1-SNAPSHOT              69.0.0.10-SNAPSHOT             69.1.0.1-SNAPSHOT              69.1.0.1-SNAPSHOT                no conflict
    dev/(lesser) from dev/(greater)     69.0.0.10-SNAPSHOT             69.1.0.1-SNAPSHOT              69.1.0.1-SNAPSHOT              69.1.0.1-SNAPSHOT                no conflict
    same branch (pull)                  69.0.0.10-SNAPSHOT             69.0.0.12-SNAPSHOT             69.0.0.12-SNAPSHOT             69.0.0.12-SNAPSHOT               no conflict
    feature/1 from feature/2            69.0.0-VCTRS-00001-SNAPSHOT    69.0.0-VCTRS-00002-SNAPSHOT    69.0.0-VCTRS-00001-SNAPSHOT    69.0.0-VCTRS-00001-SNAPSHOT      no conflict

    [PARENT VERSION - PARENT POM or VICTORS ROOT]
    feature/ from dev/ (w/victors)      69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0.3                       69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0-VCTRS-xxxxx-SNAPSHOT      no conflict
    feature/ from dev/ (w/o victors)    69.0.0.4                       69.0.0.3                       69.0.0.4                       69.0.0.3                         normal resolution
                                        69.0.0.3                       69.0.0.4                       69.0.0.3                       69.0.0.4                         normal resolution
    dev/ from feature/ (w/victors)      69.0.0.3                       69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0.3                       69.0.0.3 (?)                     ??no conflict?? -- this is messy, if victors in feature it should be merged to dev first and updated version # applied here
    dev/ from feature/ (w/o victors)                                                                                                                                  normal resolution
    dev/ from dev/                                                                                                                                                    normal resolution
    same branch (pull)                                                                                                                                                normal resolution

    [DEPENDENCY VERSION (com.agilysys.pms ONLY)]
    feature/ from dev/ (not part)       ${stay.dependency.version}     ${stay.dependency.version}     ${stay.dependency.version}     ${stay.dependency.version}       normal resolution
    feature/ from dev/ (part)           69.0.0-VCTRS-xxxxx-SNAPSHOT    ${stay.dependency.version}     69.0.0-VCTRS-xxxxx-SNAPSHOT    69.0.0-VCTRS-xxxxx-SNAPSHOT      no conflict
    dev/ from feature/ (not part)       ${stay.dependency.version}     ${stay.dependency.version}     ${stay.dependency.version}     ${stay.dependency.version}       normal resolution
    dev/ from feature/ (part)           ${stay.dependency.version}     69.0.0-VCTRS-xxxxx-SNAPSHOT    ${stay.dependency.version}     ${stay.dependency.version}       no conflict
    everything else                                                                                                                                                   normal resolution



    [ARTIFACT VERSION]
      if (ours == theirs)
        // nothing
      else if (ours == x.x.x-VCTRS-xxxxx-SNAPSHOT || theirs == x.x.x-VCTRS-xxxxx-SNAPSHOT)
        theirs = ours
      else if (ours.numeric > theirs.numeric)
        theirs = ours
      else if (ours.numeric < theirs.numeric)
        ours = theirs

    [PARENT VERSION]
      if (ours == theirs)
        // nothing
      else if (ours == x.x.x-VCTRS-xxxxx-SNAPSHOT)
        theirs = ours
        
    [DEPENDENCY VERSION (com.agilysys.pms ONLY)]
      if (ours == theirs)
        // nothing
      else if (ours == x.x.x-VCTRS-xxxxx-SNAPSHOT || theirs == x.x.x-VCTRS-xxxxx-SNAPSHOT)
        theirs = ours

## Sample merge-pom script

    #!/bin/bash

    echo current branch: `git rev-parse --abbrev-ref HEAD`

    # MERGE_HEAD doesn't exist until after these merges our, and only if there is a conflict

    echo Base:   $1: `cat $1 | wc -c` chars
    echo Mine:   $2: `cat $2 | wc -c` chars
    echo Theirs: $3: `cat $3 | wc -c` chars

    # Modify mine/theirs according to rules prior to normal file merge

    echo ==============================================================
    merged=`git merge-file -p -L mine -L base -L theirs $2 $1 $3`

    printf "$merged" > $2

    # if merge conflicts
    # exit 1

    # if no merge conflicts
    exit 0
