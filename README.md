Command      |Description
---          |---
rflow        |Manages changeset branches and versions and release workflow
rdeploy      |Orchestrates git and ansible-playbook for deployments
rboss        |Manages the release pipe
rbuild       |Reserved for future use (see also rflow build ...)
git-merge-pom|The POM merge driver (enabled with git-merge-pom-setup)
git-merge-pom-setup|Setup the POM merge driver

## Install

```
npm install -g @agilysys-stay/stay-rbuild
git-merge-pom-setup
```

## Upgrade

```
npm remove -g @agilysys-stay/stay-rbuild && npm install -g @agilysys-stay/stay-rbuild
```

## Setup

##### 1.  Remove any older distribution (version 0.1.153 and older) from your system:

```
npm remove -g stay-rbuild
```

##### 2. Connect to the [PMS feed](https://dev.azure.com/agilysys/Stay/_packaging?_a=feed&feed=PMS) (one-time setup)

From the **Connect to feed** button > NPM > Other tab, follow the **user .npmrc** instructions.

##### 3. Associate the `@agilysys-stay` scope to this feed:

```
npm config set @agilysys-stay:registry https://pkgs.dev.azure.com/agilysys/Stay/_packaging/PMS/npm/registry/ 
```

## Node.js and npm.

(Mac OS X)

    xcode-select --install
    ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
    brew install node

(Linux) From a bare-bones box (docker `fedora:latest` container):

    dnf install -y which make gcc-c++ git python nodejs
