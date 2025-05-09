#!/bin/bash
# ------------------------------------------------------------------------------
# Copyright (C) Agilysys, Inc. All rights reserved.
# ------------------------------------------------------------------------------
section_name="rbuildmergepom"
driver_name="Handle version conflicts according to rGuest Stay workflow"
driver_script="git-merge-pom"
git_config="$HOME/.gitconfig"

if [[ ! -f "$(which $driver_script)" ]]; then
  echo "Missing driver: $driver_script"
  echo "Perhaps you need to: npm install @agilysys-stay/stay-rbuild"
  exit 1
fi

if [[ ! -f "$git_config" ]]; then
  echo "Missing git config: $git_config"
  exit 1
fi

# Rewrite section if it exists
current_driver=$(git config --global --get "merge.$section_name.driver")
if [[ -n "$current_driver" ]]; then
  git config --global --remove-section "merge.$section_name"
fi

git config --global --add "merge.$section_name.name" "$driver_name"
git config --global --add "merge.$section_name.driver" "/usr/bin/env $driver_script %O %A %B %L %P"
echo "Driver '$section_name' added/updated in '$git_config'."

cat <<__end
To use this driver, the project should have this in its .gitattributes:

  pom.xml merge=$section_name

__end

exit 0
