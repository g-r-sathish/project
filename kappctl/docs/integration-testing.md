Create an empty mock config-repo

```
mkdir -p config/upstream
mkdir -p config/repo
git -C config/upstream init --bare
git -C config/repo init
cd config/repo
git remote add origin ../upstream
```

Do the same for environments repo

Copy test data and push

Run the k3d stuff to make cluster

Run kappctl stuff to make it usable

Run tests