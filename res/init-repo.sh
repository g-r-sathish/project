#!/bin/bash
set -e
shopt -s expand_aliases

repo_url=$1                 # Git URL
repo_path=$2                # Repository path
branch=$3                   # Checkout this branch
flags=$4                    # Optional flags

#
# flags:
#
#   M   Automatically merge master into branch (will not push)
#

alias git_current_branch='git rev-parse --abbrev-ref HEAD'
alias git_checkout='git checkout'
alias git_pull='git pull'
alias git_clone='git clone'
#alias git_shallow_clone='git clone --depth 1 --no-single-branch'
alias git_merge_from_master='git merge --no-commit --no-ff origin/master'
#alias git_merge_abort='git merge --abort'
#alias git_diff_cached='git diff --cached --quiet'
#alias git_diff_staged='git diff --staged --quiet'
#alias git_diff_files='git diff-files --quiet'

alias rsync_mirror='rsync -a --delete'

repo_cache_dir='{{config.repoCacheDir}}'
repo_root_dir='{{config.workDir}}'
cached_clone="${repo_cache_dir}/${repo_path}"
working_clone="${repo_root_dir}/${repo_path}"

cat <<__ENDINFO
------------------------------------------------------------
repo_url:         ${repo_url}
repo_path:        ${repo_path}
branch:           ${branch}
repo_cache_dir:   ${repo_cache_dir}
repo_root_dir:    ${repo_root_dir}
cached_clone:     ${cached_clone}
working_clone:    ${working_clone}
------------------------------------------------------------
__ENDINFO

# Update cache
if [[ -d "${cached_clone}" ]]; then
    cd "${cached_clone}"
    git_pull
else
    git_clone "$repo_url" "$cached_clone"
fi

# Syncronize cache to working copy
mkdir -p "${working_clone}"
rsync_mirror "${cached_clone}/" "${working_clone}/"

# Checkout requested branch
if [[ -n "${branch}" ]] && [[ "$(git_current_branch)" != "${branch}" ]]; then
  cd "${working_clone}"
  git_checkout "${branch}"

  # Auto-merge master (if requested)
  if [[ $flags =~ 'M' ]]; then
    git_merge_from_master
  fi
fi
