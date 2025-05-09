const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

const config = require('../common/config');
const Errors = require('./Errors');
const util = require('../common/util');

class CommitGraph {
  static create(project, fromRef, toRef, approvedTo, invocation) {
    const graph = new CommitGraph();
    graph.approvedTo = approvedTo;

    graph.commitMap = {};
    graph.commitList = [];
    graph.commitIndex = {};

    graph.parentsMap = {};
    graph.childrenMap = {};

    graph.headId = undefined;
    graph.tailId = undefined;

    graph.approved = {};
    graph.unapproved = {};

    graph.fromRefId = project.repo.gitCapture('log', fromRef, '-1', '--no-decorate', '--pretty=format:%h',
      '--abbrev=' + config.gitCommitHashSize);

    let stdout = project.repo.gitCapture('log', `${graph.fromRefId}..${toRef}`, '--no-decorate',
      '--pretty=format:%h|%p|%cn|%cr|%s',
      '--abbrev=' + config.gitCommitHashSize);
    let entries = util.textToLines(stdout);

    let changesetId = config.changesetId;
    let messageTags = [sprintf('[%s:%s]', changesetId.bundleName, changesetId.trackingId)];
    if (changesetId.qualifier === config.qualifiers.default) {
      messageTags.push(sprintf('[%s:%s]', changesetId.bundleName, changesetId.qualifierId));
    }

    let prefix = invocation.getCommitPrefix();

    _.each(entries, (entry, index) => {
      let fields = entry.split('|', 5);
      let commit = {
        id: fields[0],
        parents: fields[1].split(' '),
        committer: fields[2],
        when: fields[3],
        message: fields[4].replace('%', '')
      };
      if (commit.message.startsWith(prefix)) {
        let ours = _.some(messageTags, messageTag => commit.message.includes(messageTag));
        commit.system = {ours: ours};
      }

      graph.commitMap[commit.id] = commit;
      graph.commitList.push(commit);
      graph.commitIndex[commit.id] = index;

      graph.parentsMap[commit.id] = commit.parents;
      _.each(commit.parents, parent => {
        let children = graph.childrenMap[parent] || [];
        children.push(commit.id);
        graph.childrenMap[parent] = children;
      });
      if (commit.parents.length > 1) {
        commit.parent = commit.parents[1];
      }
    });

    graph._identifyCandidateCommits();
    graph._identifyChangesetCommits();
    return graph;
  }

  static fromJsonObject(object) {
    if (!object) return undefined;
    const graph = new CommitGraph();
    _.extend(graph, object);
    return graph;
  }

  getCommits() {
    return _.filter(this.commitList, commit => commit.in).reverse();
  }

  getApprovedCommits() {
    return _.filter(this.commitList, commit => commit.in && commit.approved).reverse();
  }

  getUnapprovedCommits() {
    return _.filter(this.commitList, commit => commit.in && !commit.approved).reverse();
  }

  isCommitIdApproved(id) {
    return !!this.approved[id];
  }

  updatedApprovedTo(approvedTo) {
    this.approvedTo = approvedTo;
    this.approved = {};
    this.unapproved = {};
    this._identifyChangesetCommits();
  }

  _determineCandidateValue(context, commit) {
    if (context.ours && commit.system && !commit.system.ours) context.ours = false;
    if (!context.ours && commit.system && commit.system.ours) context.ours = true;
    return {ours: context.ours};
  }

  _identifyCandidateCommits() {
    let context = {ours: true};
    _.each(this.commitList, (commit, index) => {
      if (index === 0) {
        this.headId = commit.id;
        commit.candidate = this._determineCandidateValue(context, commit);
      }
      if (commit.candidate) {
        let parents = this.parentsMap[commit.id];
        let firstParent = parents[0];
        let firstParentCommit = this.commitMap[firstParent];
        if (firstParentCommit) {
          firstParentCommit.candidate = this._determineCandidateValue(context, firstParentCommit);
        }
        if (!firstParent ||
          (firstParent === this.fromRefId && commit.candidate.ours &&
            (!this.tailId || this.commitIndex[this.tailId] < this.commitIndex[commit.id]))) {
          this.tailId = commit.id;
        }
      }
    });

    let nModified;
    let iteration = 0;
    do {
      util.narratef('Iteration %d %s\n', ++iteration,
        JSON.stringify(_.pluck(_.filter(this.commitList, commit => commit.candidate), 'id')));

      nModified = 0;
      _.each(this.commitList, commit => {
        if (!commit.candidate) {
          let context = {ours: _.some(this.childrenMap[commit.id], child => child.candidate && child.candidate.ours)};
          _.each(this.parentsMap[commit.id], (parent, index, parents) => {
            let parentCommit = this.commitMap[parent];
            if (parent === this.fromRefId && index === 0 &&
              (!this.tailId || this.commitIndex[this.tailId] < this.commitIndex[commit.id])) {
              commit.candidate = this._determineCandidateValue(context, commit);
              nModified++;
              if (commit.candidate.ours) {
                this.tailId = commit.id;
              }
            } else if (parentCommit && parentCommit.candidate) {
              commit.candidate = this._determineCandidateValue(context, commit);
              nModified += this._traverseForCandidateCommits(context, commit, 1);
            }
          });
        }
      }, this);
    } while (nModified);
  };

  _identifyChangesetCommits() {
    let trail = [];

    if (this.tailId) {
      this._traverseForChangesetCommits(this.commitMap[this.tailId], trail);
    }

    let approvedIds = Object.keys(this.approved);
    let unapprovedIds = Object.keys(this.unapproved);
    util.narratef('Approved commits: %s\n', JSON.stringify(approvedIds));
    util.narratef('Unapproved commits: %s\n', JSON.stringify(unapprovedIds));
    _.each(approvedIds, id => {
      let commit = this.commitMap[id];
      if (commit.candidate.ours) {
        commit.in = true;
        commit.approved = true;
      }
    });
    _.each(unapprovedIds, id => {
      let commit = this.commitMap[id];
      if (commit.candidate.ours) {
        commit.in = true;
      }
    });
  }

  _traverseForCandidateCommits(context, commit, nModified) {
    let children = this.childrenMap[commit.id];
    if (!children || !children.length) {
      return nModified;
    }
    let child = children[0];
    let childCommit = this.commitMap[child];
    if (childCommit.candidate) {
      return nModified;
    }
    childCommit.candidate = this._determineCandidateValue(context, childCommit);
    return this._traverseForCandidateCommits(context, childCommit, nModified + 1);
  }

  _traverseForChangesetCommits(commit, trail) {
    if (_.contains(trail, commit.id)) {
      throw new Errors.CommitGraphError(sprintf('Infinite loop detected with commit %s', commit.id));
    }

    trail.push(commit.id);
    try {

      if (this.approved[commit.id]) {
        _.each(trail, id => {
          this.approved[id] = true;
          delete this.unapproved[id];
        });
        return;
      }

      if (this.unapproved[commit.id]) {
        _.each(trail, id => {
          if (!this.approved[id]) {
            this.unapproved[id] = true;
          }
        });
        return;
      }

      if (this.approvedTo && this.approvedTo === commit.id) {
        _.each(trail, id => {
          this.approved[id] = true;
          delete this.unapproved[id];
        });
      }

      if (commit.id === this.headId) {
        _.each(trail, id => {
          if (!this.approved[id]) {
            this.unapproved[id] = true;
          }
        });
        return;
      }

      let children = _.filter(this.childrenMap[commit.id], id => this.commitMap[id].candidate);
      _.each(children, child => {
        this._traverseForChangesetCommits(this.commitMap[child], trail);
      });
    } finally {
      trail.pop();
    }
  }
}

module.exports = CommitGraph;
