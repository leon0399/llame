---
type: Research
title: "Knowledge and agent work synchronization"
description: "Evaluates jj-musubi and alternatives for Knowledge Spaces and distributed agent work, separating replication, working-copy updates, approval, and durable export."
tags: [replication, knowledge, workspaces, jujutsu, git]
status: draft
generated:
  by: "llame/system:codex:gpt-6-astra"
  at: "2026-11-22"
observed:
  date: "2026-11-21"
  revision: "0dbed28362e1d6f6b804b15c2f540749d62af695"
  knowledge_follow_up: "2026-11-22"
  search_revision: "90a00babb2fabbcb67c38a4b3e193ab121309bf5"
sources:
  - id: evidence
    resource: "./2026-11-21-knowledge-and-agent-work-sync.evidence.json"
  - id: musubi
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/docs/how-it-works.md"
  - id: protocol
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/docs/internals/protocol.md"
  - id: hub
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/crates/musubi-core/src/hub.rs"
  - id: snapshot
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/crates/musubi/src/snapshot.rs"
  - id: workspaces
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/crates/musubi-jj/src/workspaces.rs"
  - id: safety
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/docs/safety.md"
  - id: changelog
    resource: "https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/CHANGELOG.md"
  - id: knowledge
    resource: "https://github.com/leon0399/llame/blob/0dbed28362e1d6f6b804b15c2f540749d62af695/openspec/specs/knowledge-spaces/spec.md"
  - id: search
    resource: "https://github.com/leon0399/llame/blob/90a00babb2fabbcb67c38a4b3e193ab121309bf5/apps/api/src/knowledge/knowledge-filesystem.ts#L319-L345"
  - id: repositories
    resource: "https://github.com/leon0399/llame/blob/0dbed28362e1d6f6b804b15c2f540749d62af695/openspec/specs/repositories/spec.md"
  - id: mesh
    resource: "https://github.com/baptiste0928/jj-mesh/blob/eb271cb63dd57e8125fa6debd1b63c26d997dbe1/README.md"
  - id: mesh-workspace
    resource: "https://github.com/baptiste0928/jj-mesh/blob/eb271cb63dd57e8125fa6debd1b63c26d997dbe1/src/daemon/repos/workspace.rs"
  - id: syncthing
    resource: "https://github.com/syncthing/docs/blob/a86f6a1c2c6bf73e2817e3f045d292d9f26b840b/users/syncing.rst"
  - id: livesync
    resource: "https://github.com/vrtmrz/obsidian-livesync/blob/2eb38f9e37c67c5df75db01aa6b6cbe964193a1e/README.md"
  - id: executor-map
    resource: "https://github.com/leon0399/llame/issues/1778"
  - id: locality
    resource: "https://github.com/leon0399/llame/issues/1792"
  - id: lifecycle
    resource: "https://github.com/leon0399/llame/issues/1794"
  - id: acquisition
    resource: "https://github.com/leon0399/llame/issues/1797"
  - id: children
    resource: "https://github.com/leon0399/llame/issues/1727"
  - id: reconciliation
    resource: "https://github.com/leon0399/llame/issues/757"
  - id: sharing
    resource: "https://github.com/leon0399/llame/issues/760"
  - id: information-flow
    resource: "https://github.com/leon0399/llame/issues/761"
---

# Knowledge and agent work synchronization

## Recommendation

Use staged Git object and ref transfer as the first design to test for
provisioned agent Machines. Give each agent an independent checkout. Accept an
exact returned revision through a separate owner-controlled action.

Treat jj-musubi as an optional experiment for trusted personal Machines that
already use jj. It replicates jj history without making every receiving working
copy current. It does not replace approval, publication, or durable export.[^musubi][^safety]

For Knowledge, first establish upstream visibility and a safe working-copy
update policy. Preserve the existing owner-approved `master` workflow and its
unapproved tracks. The inspection did not establish that approved work was
missing from Forgejo.[^evidence]

This study authorizes no implementation or deployment. Its recommendations are
architectural judgments, not measured comparisons.

## Four separate operations

A synchronization design must answer four different questions:

1. Capture turns live files into a defined revision. It needs rules for ignored
   files, concurrent writers, and incomplete edits.
2. Replication transfers history and the objects required to interpret it.
3. Materialization updates the files that readers, builds, and agents consume.
4. Acceptance and publication advance approved state or send it to a forge.

A replicated revision can remain absent from the receiving working copy. A
materialized revision can remain unapproved. An acknowledged upload can still
lack the durability required before destroying its source Machine.

For example, a Knowledge edit can reach another jj repository while llame still
reads older Markdown files there. A remote agent can return a commit without
receiving authority to merge it into the owner's branch.

## Knowledge observations

The inspection found two owner-visible Knowledge Spaces. An older vault had 161
inventoried Markdown files and no `.git` or `.jj`. The active vault had 292
Markdown files outside VCS metadata and both metadata directories.[^evidence]

The active vault uses a Git remote named `forgejo`, not `origin`. Local
`master` is three commits behind live Forgejo `master`, with no local-only
commits. Cached `forgejo/master` matches the live remote. All three remote
commits already exist locally, so the comparison required no fetch.[^evidence]

This establishes local branch lag, not necessarily stale working-copy files.
The shared jj merge working copy can contain changes beyond `master`.
The ref comparison and file inventory are separate observations, not an atomic
snapshot of the repository.[^evidence]

Git reported 30 status entries. The staged diff covered 25 files with 846
insertions and 9 deletions. The unstaged diff covered four files with 415
insertions. These are Git observations, not counts of unapproved jj tracks.[^evidence]

The vault's documented workflow uses separate tracks and a merge working copy
`@`. Advancing `master` represents owner approval. Pushing requires approval.
The `jj` executable was unavailable, so the live track graph and snapshot state
were not inspected.[^evidence]

The live remote-ref query succeeded with SSH host verification enabled after
the operator trusted the host. The inspection changed no trust configuration,
refs, history, or working-copy files. Its result establishes remote state only
at the recorded observation time.[^evidence]

### Search and identity are separate problems

Knowledge reads and searches consume live file bytes. The Knowledge Space
contract does not require Git or initialize commits. A stable Knowledge Space
identifier does not transfer installation-local authority or filesystem
bindings.[^knowledge]

The active vault's root listing succeeds, but scoped Knowledge search fails
with `knowledge_path_invalid`. A metadata-only inventory found 13 directory
symlinks in a hidden skill directory and no invalid path names.[^evidence]

`processSearchEntry` throws on a symlink before testing the Markdown suffix.
The filesystem walk identified the first symlink this traversal would reject.
This explains the observed error without attributing it to `.git` or `.jj`.
The diagnosis combines a reproduced tool error with filesystem and source
inspection, not an instrumented trace of the deployed worker.[^search][^evidence]

Search should skip symlinks without following them rather than require removal
of valid skill links. This recommendation preserves the filesystem boundary.
No traversal fix or KB mutation was performed.

Repository identity currently derives its canonical remote from `origin`.
A clone with only `forgejo` therefore lacks a canonical remote under that
contract. This is distinct from transport reachability or Git correctness.
The Worktree contract describes Git worktrees and branches. A jj workspace
cannot silently substitute for it.[^repositories]

## What jj-musubi provides

### Replicated history, local working copies

Musubi uses a hub, machine daemons, and hives to replicate jj operations,
commits, bookmarks, tags, remote bookmarks, and workspace references.
Checked-out files, untracked files, Git remote configuration, and jj
configuration remain local. Incoming history does not automatically update
working-copy files. Ordinary synchronization does not fetch Git remotes.[^musubi]

Replicating remote bookmarks therefore does not establish forge freshness.
Capturing a new file in a jj snapshot also differs from transferring arbitrary
untracked bytes.

The inspected changelog places opt-in `musubi.auto-snapshot = true` under
`Unreleased`. The release query returned v0.47.1 and v0.47.0. Do not attribute
source-level auto-snapshot behavior to an installed release without checking
that release.[^changelog][^evidence]

### Protocol and source mechanisms

The hub protocol uses expected-head compare-and-swap, dependency closure,
staging and realization, and idempotent acceptance. Callers must serialize
operations for each hive. These mechanisms address concurrent history updates,
not application approval or owner isolation.[^protocol][^hub]

Workspace references use machine-qualified names and random suffixes. This
reduces naming collisions but does not authenticate a llame owner.[^workspaces]

The snapshot implementation checks workspace and repository identity and locks
working-copy mutation. It defers for stale working copies or multiple operation
heads. It follows jj tracking and ignore rules and rechecks before publication.[^snapshot]

Those checks do not establish application-consistent capture across arbitrary
concurrent writers. An editor or generator can leave a logically incomplete set
of files even when each filesystem operation succeeds.

### Trust and durability limits

Anyone who can reach a musubi hub can read and write every hive it serves.
Hive names are not authorization boundaries. Do not connect a less-trusted
guest to a hub containing personal Knowledge or unrelated repositories.[^safety]

The safety guide describes Lean models, oracle comparisons, fault injection,
fuzzing, and generated real-repository tests. It does not prove the entire
implementation. Convergence assumes eventual successful synchronization and
cessation of changes and failures. Combined safety for every abandonment and
synchronization sequence remains incomplete.[^safety]

Hub storage does not promise power-loss durability. Membership leases are not
Machine lifecycle leases or durable export receipts. A hub acknowledgment is
insufficient evidence for safe VM teardown.[^safety]

## Applicability to llame

### Knowledge on trusted personal Machines

Musubi is attractive when preserving jj operation history and concurrent tracks
matters more than immediate file visibility. A Knowledge integration would still
need to define:

- Which revision llame reads and when it updates that working copy.
- Whether external editors can write during an update.
- How conflicts and stale working copies become visible to the owner.
- Which action advances approved `master`, and which separate action pushes it.
- How a failed search or inaccessible forge differs from replication lag.

Do not infer approval from a snapshot, an arriving bookmark, or a clean status.
An experiment should use a disposable copy without private Knowledge.

### Provisioned agent Machines

The proposed baseline transfers a chosen base revision into an independent
checkout. The agent produces a result revision. A trusted receiver imports the
required objects into a staging namespace and verifies the expected lineage.
The owner accepts that exact revision separately from its transfer.

This design does not require handing the guest personal forge credentials.
It avoids a live shared working copy changing underneath builds. Credential
delegation and llame-served repository transfer remain separate choices.[^acquisition]

The receiver must treat returned content as untrusted. Importing objects does
not authorize hooks, dependency installation, or execution of returned code.
Tests need the same isolation as other untrusted execution.

Before teardown, a trusted destination should record the exact exported revision,
required object closure, and storage durability outcome. A partition or incomplete
receipt must preserve recoverable work. This is a proposed acceptance condition,
not an implemented guarantee.

## Alternatives and trade-offs

### jj-mesh

jj-mesh uses iroh peer replication and automatic snapshots. The inspected
settings default `update_stale` to `true`. Its workspace task invokes
`jj workspace update-stale`, offering more automatic file freshness than
musubi's receiving behavior.[^mesh][^mesh-workspace]

Automatic updates need coordination or disabling around builds and active
writers. Every paired peer has read/write access to every repository and can
pair other peers. It is not a boundary for untrusted guests.[^mesh]

### Syncthing

Syncthing replicates file blocks and materializes files, with conflict copies
for concurrent edits. This addresses file availability for a plain Markdown
vault, but not owner approval or jj operation semantics.[^syncthing]

Avoid live file-level replication of `.git` and `.jj` as a repository protocol.
This recommendation follows from multi-file VCS consistency requirements.
This study did not reproduce corruption or benchmark Syncthing with VCS metadata.

### Obsidian LiveSync

The inspected README describes CouchDB synchronization, object-storage journal
synchronization, WebRTC, simple-conflict merging, and encryption. It warns
against another synchronization solution on the same vault.[^livesync]

Its Obsidian focus makes it relevant to editor-centered Knowledge workflows,
not general agent repository transport. This was a README-only evaluation.
No CRDT or implementation-safety claim was established.

### Git transfer

Staged Git transfer preserves explicit revisions and fits llame's existing
Git Worktree model. It requires a capture policy for dirty files, untracked
files, and data outside Git. It does not preserve full jj operation history or
provide continuous editor synchronization.

These limitations make it a narrower baseline for agent result delivery,
not a universal replacement for personal Knowledge synchronization.

## Related issue boundaries

The executor and Sandbox map in #1778 identifies related work. It does not
prove that the described behavior has shipped.[^executor-map]

- #1792 covers Workspace data locality, copy or mount choices, publish-back, and
  unsynchronized work. Transfer and working-copy states need separate reporting.[^locality]
- #1794 covers provisioned Machine lifecycle and teardown. Destructive cleanup
  needs recovery evidence.[^lifecycle]
- #1797 separates repository acquisition and credentials from llame-served
  transfer.[^acquisition]
- #1727 covers child Workspace binding and base lineage. Its scope excludes
  automatic merge, deletion, and reset.[^children]
- #757 separates Profile and Knowledge Git reconciliation from application-event
  synchronization. It excludes Workspace contents, credentials, host paths,
  runtime leases, and derived indexes.[^reconciliation]
- #760 and #761 address shared Knowledge and foreign-authority information flow.
  Replication must not bypass those authority decisions.[^sharing][^information-flow]

## Prototype acceptance criteria

A separate approved experiment should establish these outcomes:

1. Concurrent writers do not silently discard each other's results. The owner
   can inspect conflicts or divergence.
2. Replication does not change approved refs or publish to a forge.
3. A receiving working copy updates only at an explicit safe boundary.
4. Readers can distinguish captured, transferred, materialized, and approved
   revisions. Stale working copies cannot be reported as current.
5. Ignored and untracked files follow a declared capture policy. Secrets remain
   outside transfer scope unless separately authorized.
6. A guest cannot discover or modify another owner's repositories or Knowledge.
7. A partition preserves recoverable work and blocks unsafe teardown.
8. A restarted receiver can verify the exported revision and required objects
   without trusting only the source Machine's acknowledgment.
9. A rejected result remains inspectable without merging, resetting, or deleting
   the owner's Worktree.
10. Tests cover Git worktrees and any explicitly supported jj workflow separately.

Record capture time, transfer time, materialization time, conflict rate, and
recovery outcome separately. No values for these measures were collected here.

## Method and limitations

This study combines pinned source inspection, primary documentation, public
issue bodies, and read-only observations of one Knowledge installation.
The adjacent evidence file records sanitized aggregates and source pins.
It omits private content, space identifiers, private repository hashes,
filesystem bindings, and connection details.[^evidence]

The issue-map endpoint returned 24 children. The synchronization issue search
was bounded to 100 results and was not exhaustive. Issue bodies and unversioned
web documentation can change after inspection.[^evidence]

No synchronization daemon was installed or started. No upstream tests, formal
proofs, benchmarks, or multi-Machine experiments were executed. No independent
reviewer validated this study. Source inspection supports mechanism claims,
not operational reliability or performance claims.

The jj track graph, working-copy freshness relative to the live remote, and
power-loss recovery remain unresolved. A local branch lag does not establish
which files llame reads. The evidence does not establish that musubi permits
safe VM teardown.

## Sources

[^evidence]: [Sanitized inspection evidence](./2026-11-21-knowledge-and-agent-work-sync.evidence.json).

[^musubi]: [Musubi mechanics](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/docs/how-it-works.md).

[^protocol]: [Musubi protocol](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/docs/internals/protocol.md).

[^hub]: [Hub implementation](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/crates/musubi-core/src/hub.rs).

[^snapshot]: [Snapshot implementation](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/crates/musubi/src/snapshot.rs).

[^workspaces]: [Workspace naming](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/crates/musubi-jj/src/workspaces.rs).

[^safety]: [Musubi safety and limits](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/docs/safety.md).

[^changelog]: [Musubi changelog](https://github.com/bos/jj-musubi/blob/6e415cb46c8580c93ba2e9b73ddb326c4a51694b/CHANGELOG.md).

[^knowledge]: [Knowledge Space contract](https://github.com/leon0399/llame/blob/0dbed28362e1d6f6b804b15c2f540749d62af695/openspec/specs/knowledge-spaces/spec.md).

[^search]: [Knowledge search traversal](https://github.com/leon0399/llame/blob/90a00babb2fabbcb67c38a4b3e193ab121309bf5/apps/api/src/knowledge/knowledge-filesystem.ts#L319-L345), inspected 2026-11-22.

[^repositories]: [Repository contract](https://github.com/leon0399/llame/blob/0dbed28362e1d6f6b804b15c2f540749d62af695/openspec/specs/repositories/spec.md).

[^mesh]: [jj-mesh README](https://github.com/baptiste0928/jj-mesh/blob/eb271cb63dd57e8125fa6debd1b63c26d997dbe1/README.md) and [settings](https://github.com/baptiste0928/jj-mesh/blob/eb271cb63dd57e8125fa6debd1b63c26d997dbe1/src/config/settings.rs).

[^mesh-workspace]: [jj-mesh workspace task](https://github.com/baptiste0928/jj-mesh/blob/eb271cb63dd57e8125fa6debd1b63c26d997dbe1/src/daemon/repos/workspace.rs).

[^syncthing]: [Syncthing synchronization documentation](https://github.com/syncthing/docs/blob/a86f6a1c2c6bf73e2817e3f045d292d9f26b840b/users/syncing.rst), inspected 2026-11-21 at docs.syncthing.net/users/syncing.html.

[^livesync]: [Obsidian LiveSync README](https://github.com/vrtmrz/obsidian-livesync/blob/2eb38f9e37c67c5df75db01aa6b6cbe964193a1e/README.md).

[^executor-map]: [Executor and Sandbox map, #1778](https://github.com/leon0399/llame/issues/1778), inspected 2026-11-21.

[^locality]: [Workspace data locality, #1792](https://github.com/leon0399/llame/issues/1792), inspected 2026-11-21.

[^lifecycle]: [Provisioned Machine lifecycle, #1794](https://github.com/leon0399/llame/issues/1794), inspected 2026-11-21.

[^acquisition]: [Repository acquisition, #1797](https://github.com/leon0399/llame/issues/1797), inspected 2026-11-21.

[^children]: [Child Workspace binding, #1727](https://github.com/leon0399/llame/issues/1727), inspected 2026-11-21.

[^reconciliation]: [Knowledge reconciliation, #757](https://github.com/leon0399/llame/issues/757), inspected 2026-11-21.

[^sharing]: [Shared Knowledge, #760](https://github.com/leon0399/llame/issues/760), inspected 2026-11-21.

[^information-flow]: [Information flow, #761](https://github.com/leon0399/llame/issues/761), inspected 2026-11-21.
