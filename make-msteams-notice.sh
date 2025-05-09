#!/bin/bash

opt_mandatory=false
npm_repo_url='https://dev.azure.com/agilysys/Stay/_packaging?_a=package&feed=PMS&package=%40agilysys-stay%2Fstay-rbuild&protocolType=Npm'
release_notes_url='https://dev.azure.com/agilysys/Stay/_git/stay-rbuild?path=%2Fdoc%2FRELEASE_NOTES.md&version=GBmaster&_a=preview'
name=$(jq -r .name package-lock.json) # @agilysys-stay/stay-rbuild
version=$(jq -r .version package-lock.json) # 0.2.28

if $opt_mandatory; then
  update_requirement='**This is a mandatory update.**'
else
  update_requirement='*This is an optional update.*'
fi

echo "*$name* version [${version}](${npm_repo_url}&version=${version}) has been published ([Release notes](${release_notes_url})). ${update_requirement}"
