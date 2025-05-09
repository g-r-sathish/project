The `kappctl` project aims to provide deployment lifecycle actions for SaaS applications running under Kubernetes. The relevant deployment lifecycle considered here is:

* Initializing and updating cluster resources that services depend upon
* Rolling out new resources
* Updating existing resources
* Cleaning up obsoleted resources

This is achieved by

* Compiling Kubernetes CRDs from templates and configuration
* Managing CRDs using `kubectl` and direct API calls
* Reading real-time state from Kubernetes
* Ensuring state before and after lifecycle actions
* Unwinding when a failure invalidates prior completions

For config-repo and other places where YAML is used - the emergence of schema and linting is
maturing, a good example comes from mkdocs-material:

  * https://squidfunk.github.io/mkdocs-material/creating-your-site/#minimal-configuration
  * https://squidfunk.github.io/mkdocs-material/schema.json
