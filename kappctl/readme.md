[About this project](./docs/about.md)

## Context and configuration

Context is loaded from these locations:

1. Path provided via the `KAPPCONTEXT` environment variable
2. `.kappctl.yml` in the current directory
3. User's `~/.kappctl/context.yml`

## Kubernetes contexts

Following this standard works just fine for independent clusters:

```bash
export KUBECONFIG=~/.kube/lab-stay-giesr-scrubber.yaml
```

Azure Kubernetes Service (AKS) contexts can be merged for your user with:

```shell
az login
az account set --subscription {subscription-of-aks-resource}
az aks get-credentials --resource-group {aks-resource-group} --name {aks-resource-name}
```

## Running from source

It is expected that dependent repositories have been cloned locally, and you probably want to run
this beforehand:

```
git -C ../environments pull
git -C ../config-repo pull
```

## Test pool environments

Rolling forward or backward will invoke a monitor call on config-service (which in turn signals
each service to switch RMQ vhosts) and needs credentials to do so:

```bash
export spring_cloud_config_username=user # Not needed as code defaults to "user"
export spring_cloud_config_password=Agile1
```

## Self-signed certs

Pass the `-k|--insecure` flag to `kappctl`.

This was needed when setting up TSIB (Trade Show In a Box) and is used by `kubectl`:

```
export GODEBUG=x509ignoreCN=0
```

> TODO make this happen automatically as part of the `-k|--insecure` switch.

## TODO

* Repository handling
  * Self-managed config/env - ability to clone (into dot dir)
  * Restore to original branch when finished (less important with self-managed branches)
  * Ability to use raw folders (not git repos) for config/env
* Standalone apps
  * Logical default shouldn't be test pool
* Generic usage
  * Move lingering assumptions (like "/config-server") to config
* Better
  * Managed branches should attempt to pull and only recreate when there is a conflict. However, keep the test pool changes.

## Environment setup

The `test-environment.yml` in the [environments](https://dev.azure.com/agilysys/Stay/_git/environments) repository is the highest level configuration for an environment.

```yaml
---
k8s:
  context: test-environment 			// Must match config-repo folder name
approvals:
  enabled: false            			// Only used with production environments
pools:
  enabled: false									// Enables the test-pool rollout workflow
  prod: v1												// Subset of services that receive traffic
  test: v2												// Subset of services that receive test-pool traffic (when enabled)
options:
  kappctl:
    config: kappctl/config.yml 		// Metadata about the SaaS (Stay) that kappctl is going to deploy
  config-repo:
    branch:
      source: labs								// Used for standalone deployments and as the upstream for runtime branches
      managed: true								// Enables runtime branches
```
