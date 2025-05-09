# Noteworthy changes

## [Unreleased]

> New changes go here.

## 0.0.75

### Standalone deployments can specify image tags

Standalone deployments are ones that are not part of a versioned subset, rather they exist under the 'prod' subset.
Traditionally they always provide `--subset prod` option.

Example for deploying two services, each with the specific image tag `1.0.0`:

```bash
kappctl deploy svc-a:1.0.0 svc-b:1.0.0
```

This accommodates deploying services at different versions. However in the above
example, where the tag is the same across all services, the `--image-tag 1.0.0` can be used instead:

```bash
kappctl deploy --image-tag 1.0.0 svc-a svc-b
```

### Standalone deployments do not require `--subset prod`

If all services being deployed are standalone, the `--subset prod` option is presumed, and not required.

### New context variable `RUN_ID` available

The context will provide `RUN_ID` to templates, which is a random 8 character alphanumeric string. Although the existing
`BUILD_BUILDNUMER` (provided by Azure DevOps) is available, it contains dots and is not always suitable (like a service
name, where it can confuse routing).

### New maintenance command to sync docker image tags back to config-repo

This command will ensure that config-repo is up-to-date with the current image tags in the cluster.

```bash
kappctl maintenance --ensure-standalone-versions
```

### Kubernetes contexts are now case-insensitive

The context name provided in the environments YAML configuration (`k8s.context`), will now match both exactly and with
the lowercased version of itself. This accommodates how clusters added in Rancher are lowercased, which is how they appear in the downloaded Kubeconfig file.
