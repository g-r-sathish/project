# rBuild Development

[TOC]

## Install dependencies

When running locally, the command `rbuild-node-env` needs to be in your PATH.
So, linking this package is a good approach. However, before doing so, you
should not have this package installed globally. If you have, you uninstall
with one of these commands (depending on how you installed):

    npm uninstall -g .
    npm uninstall -g @agilysys-stay/stay-rbuild

Then to link this package:

    npm link
    
And install dependencies locally

    npm install
    
To run the tests, you need Mocha installed globally:

    npm install -g mocha
    
## Coding

We have a specialized convention around `require`, which does not require (ha ha) you to use relative
paths. See the section "A word on `rbuild-node-env`" below. The price for this convenience is that one
must run the script via its wrapper - something to keep in mind.

## Running

For a sandbox setup (so you aren't creating real changesets), use modified configurations for: 

`~/.rboss/config.json`
`~/.rdeploy/config.json`
`~/.rflow/config.json`

```json
{
  "debug": {
    "notify_during_dry_run": true,
    "skip_jira_interaction": true
  },
  "teams": {
    "channels_enabled": true
  },
  "versions_files": {
    "repo_path": "~stash_username/versions-files"
  }
}
```

Legacy Slack debug configs:

```json
{
  "releaseModeratorsSlackChannel": "@slack_member_id",
  "releasePipeChannel": "@slack_member_id",
  "jenkinsSlackChannel": "@slack_member_id",
  "slack": {
    "channels_enabled": true,
    "message_defaults": {
        "channel": "@slack_member_id"
    }
  }
}
```

> Turn off `channels_enabled` if things are too chatty for you (the above routes slack messages to your slack account).

The above indicates you need a private copy of the `versions-files` repository. Start with making your own stash repositories
that just like these:

    ssh://git@stash.agilysys.local:7999/~giesr/versions-files.git
    ssh://git@stash.agilysys.local:7999/~giesr/workspace.git
    
Update the `versions-files/stay/foo/config.json` so that it points to your own project (not `~giesr/workspace`).

Once that's all setup then you can start your own workflow:

    rflow -c foo:TEST-001 start -i workspace
    rflow -c foo:TEST-001 submit-pr
    rflow -c foo:TEST-001 start-rc
    rflow -c foo:TEST-001 promote-rc
    
And you can control your own release pipe:
    
    rboss status -i foo
    rboss update -i foo -c moderated
    
> The `-i foo` is required here because ui,svc,naag are hard-coded defaults :frowny_face:

## IntelliJ run configuration:

##### Interactive NodeJS debugging

In order to handle standard input from the debugger console, you need to enable:

    nodejs.console.use.terminal
    
> When answering prompts on my Mac, the `<Enter>` key does not work, but pressing `<Ctrl-m>` does...

Change via the IntelliJ "Registry" dialog in IDE:

* Help > Find Action > type "registry" > click "Registry..."
* Scroll to find `nodejs.console.use.terminal` and enable
* No need to restart the IDE

See also:
https://youtrack.jetbrains.com/issue/WEB-13727#focus=streamItem-27-2835917.0-0

##### Run/Debug Configuration

Here is my Run/Debug Configuration for `rflow`. For `rdeploy` or `rboss`, etc.
It works for running and debugging presuming you have the NodeJS plugin.

```
Node interpreter:           /usr/local/bin/node
Node parameters:            --inspect
Node directory:             $HOME/src/agilysys
JavaScript file:            rtools/stay-rbuild/bin/rflow.js
Application parameters:     --help
Environment variables:
    NODE_PATH:              $HOME/src/agilysys/rtools/stay-rbuild/lib:$HOME/src/agilysys/rtools/stay-rbuild/lib/classes:$HOME/src/agilysys/rtools/stay-rbuild/node_modules
    NODE_BASE_DIRECTORY:    $HOME/src/agilysys/rtools/stay-rbuild
```

## Chrome debugging

To start debugging run rbuild with the -d argument

    rbuild -d

Which will emit a line like:

    Debugger listening on ws://127.0.0.1:9229/34ac955c-f6b5-4db6-85dd-b81a2f937e26

Take the part after `ws://`, append it the below and open it in Chrome:

    chrome-devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=

See also:

* https://nodejs.org/api/debugger.html
  
## Publishing

Artifacts are published to our Azure DevOps Artifacts Feed:
https://dev.azure.com/agilysys/Stay/_packaging?_a=feed&feed=PMS

To authenticate, follow the **user .npmrc** portion of the NPM instructions under **Connect to feed** from
[the PMS feed](https://dev.azure.com/agilysys/Stay/_packaging?_a=feed&feed=PMS).

Associate the `@agilysys-stay` scope to this feed:
```
npm config set @agilysys-stay:registry https://pkgs.dev.azure.com/agilysys/Stay/_packaging/PMS/npm/registry/ 
```

Then, to publish a new release

    npm version patch
    npm publish

> Please ensure you commit your [version] change to `package.json`.

## Scripts

Scripts are located in the `bin` subdirectory. Primary entry points are:

| Path                         | When installed      | Description                                                             | 
| ----                         | ----                | ----                                                                    | 
| ./bin/rflow.js               | rflow               | Orchestrates git, maven, and jenkins into a unified workflow            |
| ./bin/rdeploy.js             | rdeploy             | Orchestrates git and ansible-playbook for deployments                   |
| ./bin/rboss.js               | rboss               | Manages the release pipe                                                | 

Ancillary scripts are:

| Path                         | When installed      | Description                                                             | 
| ----                         | ----                | ----                                                                    | 
| ./bin/git-merge-pom-setup.sh | git-merge-pom-setup | Config the users `~/.gitconfig` with the merge driver                   | 
| ./bin/git-merge-pom.sh       | git-merge-pom       | The merge driver                                                        | 
| ./bin/merge-pom.js           | merge-pom           | Underlying merge implementation for the driver                          | 
| ./bin/rbuild-node-env.js     | rbuild-node-env     | Launch script which resolves NODE_PATH and other environmental concerns | 
| ./bin/rbuild.js              | rbuild              | The OG (deprecated)                                                     | 
| ./bin/merge-pom-demo.sh      |                     | Run `merge-pom` in a variety of ways                                    | 
| ./bin/test.js                |                     | Run `npm test` with our environment setup                               | 

## A word on `rbuild-node-env`

The scripts `rbuild.js` and `merge-pom.js` use a shebang line which references
`rbuild-node-env` (see Install dependencies). The reasons for this extra layer are:

* Using relative paths in require statements is cumbersome and error-prone
* Our scripts are not stored at the root of the package (rather in the bin subdir)
* When installed, NPM creates symlinks to the scripts and `readlink -f` doesn't exist (natively) on OS X.

See also:

* https://gist.github.com/branneman/8048520
* https://gist.github.com/branneman/8775568
