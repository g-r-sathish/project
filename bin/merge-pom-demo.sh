#!/bin/bash
# ------------------------------------------------------------------------------
# Copyright (C) Agilysys, Inc. All rights reserved.
# ------------------------------------------------------------------------------
script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

function my_merge () {
cat <<__end
-----------------------------------------------------------------------------------------------------------------------------

  ours   -----o--- $1
             /
  theirs ---'      $2

-----------------------------------------------------------------------------------------------------------------------------
__end
	$script_dir/merge-pom.js  --ours "$1" --theirs "$2" --verbose --no-cache
}

cat <<__end

=============================================================================================================================
Feature branch being merged back to dev
=============================================================================================================================

__end

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceImplementation/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceImplementation/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceTest/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceTest/pom.xml

cat <<__end

=============================================================================================================================
Feature branch merging upstream changes from dev
=============================================================================================================================

__end

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceImplementation/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceImplementation/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceTest/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceTest/pom.xml

cat <<__end

=============================================================================================================================
Feature to feature
=============================================================================================================================

__end

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-99999/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceImplementation/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-99999/ServiceImplementation/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceTest/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-99999/ServiceTest/pom.xml

cat <<__end

=============================================================================================================================
Feature to feature #2
=============================================================================================================================

__end

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-99999/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-99999/ServiceImplementation/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceImplementation/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/VCTRS-99999/ServiceTest/pom.xml \
  ../test/fixtures/poms/reservationservice/VCTRS-49984/ServiceTest/pom.xml

cat <<__end

=============================================================================================================================
MR to Dev
=============================================================================================================================

__end

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.1.0/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceImplementation/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.1.0/ServiceImplementation/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceTest/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.1.0/ServiceTest/pom.xml

cat <<__end

=============================================================================================================================
Dev to MR
=============================================================================================================================

__end

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.1.0/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.1.0/ServiceImplementation/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceImplementation/pom.xml

my_merge \
  ../test/fixtures/poms/reservationservice/dev-69.1.0/ServiceTest/pom.xml \
  ../test/fixtures/poms/reservationservice/dev-69.0.0/ServiceTest/pom.xml
