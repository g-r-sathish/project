#!/bin/bash
# ------------------------------------------------------------------------------
# Copyright (C) Agilysys, Inc. All rights reserved.
# ------------------------------------------------------------------------------
#
# This is a git merge driver which handles passing parameters along to the
# merge-pom script, then invoking the merge.
#
# The merge driver is set up in ~/.gitconfig:
#
#   [merge "rbuildmergepom"]
#     name = Handle version conflicts according to rGuest Stay workflow
#     driver = /usr/local/src/agilysys/pms/rtools/build/git-merge-pom.sh %O %A %B
#
# And each project needs to have its own .gitattributes with this line:
#
#   pom.xml merge=rbuildmergepom
#
# Expected parameters: %O %A %B %L %P
#
# ------------------------------------------------------------------------------

base=$1
ours=$2
theirs=$3
marker_size=$4
result_path=$5

merge-pom --ours "$ours" --base "$base" --theirs "$theirs" --commit
git merge-file -L ours -L base -L theirs $ours $base $theirs
exit $?
