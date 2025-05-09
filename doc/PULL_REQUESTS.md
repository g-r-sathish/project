# rFlow Pull Requests

## Overview

When a pull request (PR) is generated, _rFlow_ curates both the source and destination branches to provide a review of 
unapproved code changes in your changeset.  

Unapproved code changes do not include code brought in via `pull` or a `merge` of an _approved_ changeset, however it 
does include:
 * A `merge` of an _unapproved_ changeset 
 * Any conflict resolutions that vary from _'theirs'_ 

<b>Note:</b> In the context of merging, _approval_ of a changeset is a binary state -- if there are any outstanding 
commits not approved, the entire changeset is considered _unapproved_.

_rFlow_ tracks approvals and merges in the changeset yaml, so the review branches are ephemeral in nature and removed 
once their purpose has been served. 

<b>Note:</b> While _rFlow_ can create PRs, it does not have the ability to read them, it only has access to the review 
branches via _Git_.  Therefore, <b>commits are only treated as _approved_ once the corresponding PR has been 
_merged_.</b>  The commits from an _approved_ yet _unmerged_ PR are _unapproved_ in _rFlow_.

## Synchronization

Since the changeset branch does not directly participate in the pull request, synchronization is required.  This process 
updates the review source branch with any new changeset commits, and also looks at the review target branch to determine 
if there are any newly approved commits.  Finally, it will remove review branches when they are deemed no longer 
necessary, i.e. when all changeset commits have been approved.   

The `refresh-pr` goal was introduced to manually trigger this synchronization.  

Here is the complete list of goals that perform this operation: `build`, `extend`, `merge`, `patch-rc`, `pull`, `push`,
`refresh-pr`, `show-info`, `shrink`, `start-rc`, `submit-pr`.

## Following the commits (an example)

Here we have some basic changeset activity, with commit IDs and (2nd) parents for merge commits.

| changeset `<-d543` |                                        |  
| :----:             | :---                                   | 
| `4c35`             | Changeset started                      | 
| `efc3`             | 1st changeset code change              | 
| `6f09<-a54e`       | Merged incompletely reviewed changeset |   
| `1e84`             | 2nd changeset code change              |
| `e7e3<-dc3f`       | Pulled                                 |

Project metadata:

    approved_merge_parents:
      - dc3f

Merges from reviewed changesets and pulls (released code) are considered _approved merges_.

`submit-pr` is run, and now we have:

| changeset `<-d543` | review/source `<-e7e3` | review/target `<-43c5` | 
| :----:             | :---:                  | :----:                 | 
| `4c35`             | --                     | --                     | 
| `efc3`             | --                     |                        |
| `6f09<-a54e`       | --                     |                        |
| `1e84`             | --                     |                        |
| `e7e3<-dc3f`       | --                     | `03a1<-dc3f`*          |
|                    | `50fd<-03a1`**         |                        |
<sup>_* --strategy-option==theirs_  
_** --strategy=ours_</sup>

Project metadata:

    approved_to: 4c35
    approved_merge_parents:
      - dc3f


What just happened?
* `43c5` was determined to be a _system commit_ and `approved_to` was advanced to that.
* Review target branch is created from the `approved_to`.
* Approved merge `dc3f` is merged to review target, with `--strategy-options==theirs`
* Unapproved merge `a54e` was not merged to review target.
* Review source branch is created from the HEAD of the changeset branch.
* Merge commit `03a1` is merged to review source with `--stategy=ours`.

The PR will now show the the changes from `efc3`, `6f09` (which brings in everything from `a54e`), `18e4`, and any merge 
conflict resolution changes made in `e7e3`.

Some feedback is provided during the PR, which is addressed and committed on the changeset branch.  At this point the 
changeset and review sources branches are not aligned, and requires a synchronization via `refresh-pr`.   

Once the PR is subsequently approved and merged in Stash: 

| changeset `<-d543` | review/source `<-e7e3` | review/target `<-43c5` | 
| :----:             | :---:                  | :----:                 | 
| `4c35`             | --                     | --                     | 
| `efc3`             | --                     |                        |
| `6f09<-a54e`       | --                     |                        |
| `1e84`             | --                     |                        |
| `e7e3<-dc3f`       | --                     | `03a1<-dc3f`*          |
|                    | `50fd<-03a1`**         |                        |
| `9ba9`             |                        |                        |
|                    | `ee69<-9ba9`           |                        |
|                    |                        | `6fb8<-ee69`           |

Project metadata:

    approved_to: 4c35
    approved_merge_parents:
      - dc3f

`refresh-pr` merged the `HEAD` of the changeset to the review source.  Stash merged the `HEAD` of the review source to 
the review target.  rFlow doesn't know the PR was merged, and once again `refresh-pr` is run to synchronize. Afterward 
we have:

| changeset `<-d543` | 
| :----:             | 
| `4c35`             |
| `efc3`             | 
| `6f09<-a54e`       | 
| `1e84`             | 
| `e7e3<-dc3f`       |
| `9ba9`             | 

Project metadata:

    approved_to: 9ba9
    approved_merge_parents:
      - dc3f

What happened?
* rFlow is looking for evidence on the review target of changeset commits.
    * `*` commits are also excluded from this process as they exist to bring in the 'theirs' side of an approved merge.
    * That leaves `6fb8<-ee69` in the review target, and if we follow the path `6fb8 <- ee69 <-9ba9` we end up at the 
    `HEAD` commit of the changeset branch, and that becomes our new `approved_to`.
    * There is also logic to validate that all outside merge parents on the review target (in this case `43c5`) have 
    corresponding merge commits in the changeset. This is helpful to identify situations where a `merge` or `pull` 
    operation did not have a corresponding `push`.  
* Now that `approvedTo` is the same as the changeset `HEAD`, we no longer need the review branches and they are deleted.