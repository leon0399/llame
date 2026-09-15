# Personal Realm control and replication topology

- **Status:** selected vision direction; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for separating replicated data from serialized control;
  moderate for permanent-controller-loss recovery

## 1. Decision

A Personal Realm has no canonical physical home. Its portable data may be retained
by several full replicas, synchronized directly or through relays, and authored
offline by explicitly granted writer streams.

It nevertheless has one current **Realm Control Coordinator** at a time. The
coordinator is a transferable role that serializes security- and
authority-sensitive control records for the logical Personal Realm authority. A
monotonic control epoch fences its predecessors. It is not the Realm's data home,
the only synchronization peer, the user's identity, the accepted head of every
personal resource, or the executor for every Run.

The first linked topology uses the multi-user hub as control coordinator. An
unlinked personal node coordinates its own standalone Realm. Later implementations
may transfer that role to another trusted personal node or a replicated
coordination service, but they must preserve one accepted control head and the
same epoch-fencing semantics.

Database-native personal records and Realm control records use the same semantic
ChangeBatch envelope and application synchronization transport. They differ in
authorization and conflict rules, not in whether one is “real sync.” Control
batches form a single accepted chain; eligible personal data types may have
concurrent causal branches and typed reconciliation.

Knowledge Space content remains Git-compatible history exchanged through raw Git
or forge-aware adapters. Control or episodic batches may reference exact Git OIDs;
they do not wrap Git's object database in a second universal replication format.

## 2. Why the planes differ

“Every personal node is a home” is a data-availability statement. Treating it as
“every replica may independently rewrite governance” creates split-brain
authority.

| Plane            | Examples                                                                                                                                                    | Availability rule                                                                | Acceptance rule                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Personal data    | Chat messages and branches, personal notes, Knowledge Space commits and policy-permitted ref moves, preferences allowed offline                             | Enrolled replicas may read and author within retained coverage and Writer Grants | Typed semantic reconciliation preserves concurrent valid work                          |
| Realm control    | Replica enrollment and revocation, Writer Grant changes, Authority Binding transfers, protected-acceptance policy, destructive retention or purge decisions | Requires the current coordinator or a later equivalent fenced authority          | One expected control head and epoch; stale or concurrent control writes fail closed    |
| Active execution | Run advancement, tool dispatch, approvals, cancellation, Workspace entry, handoff                                                                           | Requires the current placement executor                                          | Separate placement epoch and checkpoint barrier; sync never grants execution authority |

The control plane stays small. It does not serialize every message, note, or local
draft through the hub. The data plane stays available. It does not infer that an
offline replica may enroll another device, revoke a peer, broaden who may advance
a protected ref, or purge history.

## 3. Alternatives considered

### A. One permanent hub or “personal home”

All personal nodes mirror a canonical hosted database, and only that installation
can decide or accept any state.

**Strength:** simple authority, revocation, backup, and conflict behavior.

**Failure:** standalone operation becomes a second-class cache, hub loss strands
the corpus, and “full personal mirror” becomes false. It also confuses physical
storage with logical authority.

**Decision:** rejected as the product model. A hub is the initial linked control
coordinator, not the permanent data home.

### B. Every replica is an equal offline control authority

Enrollment, revocation, grants, protected-acceptance policy, and retention policy
merge like ordinary replicated documents.

**Strength:** maximal partition availability and no distinguished coordinator.

**Failure:** concurrent enrollment and revocation have no safe generic merge;
revoked replicas can regrant themselves; incompatible grant or purge heads can
both claim authority; and destructive retention can race an unseen record. A
deterministic winner hides security loss rather than resolving it.

**Decision:** rejected.

### C. Transferable single control head plus grant-scoped data writers

One coordinator epoch orders the small governance plane. Replicas independently
retain, exchange, and author allowed portable data without consulting it for every
operation.

**Strength:** honest offline use, no canonical physical data home, bounded
split-brain protection, and a simple initial hub-linked topology. The role can
move later without changing resource identities or data synchronization.

**Cost:** control operations become unavailable while the coordinator is
unreachable. Permanent loss needs an explicit recovery authority or a visible
Realm fork; availability cannot be manufactured safely.

**Decision:** selected.

## 4. Full personal mirror means logical fidelity

A full Personal Realm replica retains all portable personal records and control
history permitted for that node through a declared frontier. It can reconstruct
the same logical personal state without consulting one canonical database.

The default portable core includes:

- Chat, branch, message, and semantic Run history;
- stable lineage, approvals, audit records, context receipts, compaction
  checkpoints, and explicit deletion records;
- personal Knowledge Space Git history, ref history, and base/candidate
  provenance;
- non-secret Skills, prompts, preferences, and runtime configuration selected for
  synchronization;
- Personal Realm namespace, Authority Binding, enrollment, Writer Grant, and
  control-transition history; and
- non-secret foreign mount and connection descriptors when their authority
  permits synchronization.

Full does not mean byte-for-byte process or secret replication. It excludes:

- node private keys, OAuth refresh tokens, provider credentials, and reusable
  delegations;
- Workspace contents, derived worktrees, Sandbox filesystems, package caches, and
  container images;
- live Run deltas, raw queue rows, executor journals, process handles, and tool
  state;
- rebuildable indexes and UI caches; and
- foreign resource bodies or artifact payloads whose governing policy does not
  permit personal retention.

Large personal artifacts may use content-addressed references with independently
reported payload coverage. A replica may be logically complete for the portable
core while an optional artifact payload is unavailable. The UI and model must see
that distinction; a missing payload is not an absent resource.

A constrained client that retains only a cache is not advertised as a full
replica. Android remains a north-star full replica for the portable personal core,
even though it is not a Workspace executor and may omit local-only or
policy-restricted payloads.

## 5. Realm control records

The accepted Realm control history is a narrow totally ordered stream. Each
control batch identifies at least:

```text
realm_id
control_epoch
previous_control_head
coordinator principal
typed control operations
causal and authority references
batch identity and integrity evidence
```

The exact wire fields and signature format remain implementation decisions. The
semantic rule is fixed: a receiver accepts a new control batch only when the
authenticated coordinator is authorized for the current epoch and the expected
head matches. It never resolves competing control heads by timestamp, replica ID,
or last writer.

Control operations include:

- enroll, constrain, suspend, or revoke a Personal Realm replica;
- issue, revise, or retire a Writer Grant;
- transfer an Authority Binding or join Personal Realms;
- change the Realm control coordinator and advance its epoch;
- change who may advance or accept protected resources;
- authorize a schema or policy transition that changes future validation; and
- authorize destructive retention, deletion-record compaction, or physical purge.

An ordinary personal Knowledge Space ref move is not Realm control merely because
it selects a locally accepted head. When its Writer Grant permits offline ref
movement, concurrent heads remain data-plane branches and reconcile through Git
ancestry, merge, review, or explicit selection. The coordinator controls the
grant and protection policy, not every commit. A foreign or shared authority may
choose a stricter online-only accepted-ref rule for its own resource.

User-facing data deletion may create an ordinary explicit deletion record when
policy permits. Erasing the record that proves the deletion, compacting its
history, or purging unseen payloads is a separate control operation.

## 6. Bootstrap, link, transfer, and unlink

### Standalone bootstrap

A new unlinked personal profile creates a Personal Realm and locally holds its
first coordinator epoch. It can enroll no remote replica until an authenticated
link establishes a secure channel. Its initial writer stream receives only the
standalone grants the product actually supports.

### Link to the initial hub topology

Realm identity is reconciled before ordinary synchronization, as defined by the
authority-connection decision:

- an empty side adopts the populated Realm;
- matching Realm identities proceed directly; and
- two populated different Realms require an explicit Realm join.

For the initial linked product, the hub becomes control coordinator through a
separate fenced control transition. The same ordinary reconciliation function
then exchanges control and data batches. Calling this transition “link” in the UI
does not make it an implicit database import or identity rewrite.

The hub default is an operational simplification: it is normally reachable by
several devices and already provides authenticated multi-tenant control storage.
It is not evidence that personal data belongs only there.

### Coordinator transfer

A graceful transfer follows one authority boundary:

1. the target authenticates and proves the required coordinator capability;
2. the current coordinator freezes new control decisions at an exact head while
   ordinary data authoring may continue under existing grants;
3. the current coordinator commits a transition naming the target and next
   control epoch;
4. the target acknowledges the accepted head before authoring control records;
   and
5. replicas reject control records from the prior epoch.

This is a small control-plane compare-and-swap, not process migration or a global
pause of personal work.

### Unlink while the hub coordinates

Unlink cannot revoke the hub relationship first and improvise control ownership
later. The user selects an eligible remaining node, the coordinator transfer
commits, and only then are hub enrollment credentials and access revoked. If no
eligible target is available, unlink may disconnect local credentials but cannot
claim that the same Realm has a functioning control authority.

## 7. Replication topology

Any mutually authenticated enrolled replicas may exchange valid application
snapshots and ChangeBatches through the Node Protocol. A hub may provide
store-and-forward, rendezvous, or direct peer routing. Forwarding a batch never
makes the relay its author or governing authority. Git-backed Knowledge Spaces
exchange their own commits and refs through configured Git or forge adapters
under the same ResourceRef, Writer Grant, and information-flow boundaries.

The current coordinator does not sit on the hot path for data operations already
allowed by a Writer Grant. A disconnected replica can therefore:

- read its retained personal state;
- append permitted personal records;
- create explicit Chat branches and Knowledge Space candidates;
- run local inference and tools allowed by local policy; and
- later reconcile those batches with any eligible peer.

It cannot while disconnected:

- enroll or revoke replicas;
- broaden or resurrect a Writer Grant;
- broaden who may advance a protected Git ref;
- transfer resource or Realm authority;
- compact deletion evidence or perform authoritative purge; or
- seize an active Run placement.

For ChangeBatch-backed state, first and later synchronization remain one
operation. A new replica starts with no accepted frontier; a stale replica starts
with an older one. Both negotiate coverage, use semantic snapshots or batches,
validate the same authority and schema rules, and continue until their supported
portable scope converges. Git synchronization separately retains ordinary
fetch/merge/ref semantics instead of impersonating that journal.

## 8. Availability, revocation, and loss

### Temporary coordinator outage

Existing replicas retain readable state and continue only the ordinary data
authoring their observed grants permit. New governance decisions wait. The UI
must distinguish “control unavailable” from “Realm unavailable” and must not
silently appoint another coordinator.

### Revoked replica was offline

Other replicas reject its future synchronization credential and control access.
Previously accepted history remains. Batches created around an unseen revocation
cutoff are accepted only when the governing rules prove them valid; otherwise
they remain visible candidates or a fork. UUID uniqueness does not establish
authorization.

### Recovered former coordinator

Its old control epoch cannot advance governance. It may synchronize records it
is still permitted to retain or forward, but it cannot resume the role based on
local state or wall-clock recency.

### Permanent coordinator loss

The initial design does not pretend to recover the same authority from possession
of replicated data alone. Without a previously configured recovery credential,
trusted quorum, or accepted successor transition, replicas can preserve and
export the corpus but cannot forge a new control head for the same Realm.

The honest fallback is a visible recovered Realm or fork with preserved source
provenance and new authority. A later recovery design may retain the Realm ID only
if it can prove a single successor epoch and fence the lost coordinator. This is
the main cost of avoiding both a permanent central home and equal-writer
governance.

## 9. Scenario checks

### Standalone CLI later links to a web account

The CLI Realm is already complete and locally coordinated. The link establishes
the shared Realm identity, transfers control to the hub in the initial topology,
enrolls the CLI node, and runs ordinary reconciliation. The CLI keeps a full
portable mirror and continues granted personal authoring offline.

### Hub, desktop, CLI, and Android are all online

All four may hold the portable personal core. They exchange batches through the
hub or direct eligible paths. The hub orders enrollment, revocation, grants, and
protected-acceptance policy; it does not execute every Run, mediate every read, or
approve every personal Git commit.

### Hub is temporarily offline

Each node keeps its local corpus. Offline-capable nodes continue permitted Chat,
Knowledge Space branch/ref, and inference work. Enrolling a new phone, revoking a
lost laptop, broadening protected-ref authority, or purging history waits.

### User wants to leave the hub permanently

While the hub is reachable, the user transfers Realm control to an eligible
personal node and then unlinks. If the hub disappeared permanently before any
recovery path existed, the initial design preserves the data but requires a
visibly new recovered authority rather than claiming an unfenced takeover.

### Family knowledge is mounted by several people

Each person's Personal Realm remains independently controlled. The family
Knowledge Space is governed by the family authority through an Authority
Connection; it does not enter any member's Personal Realm control stream merely
because cached or displayed there.

## 10. Security invariants

- A hosted coordinator derives the acting tenant and user from the authenticated
  principal and enforces isolation through PostgreSQL RLS or an equivalent
  datastore boundary.
- A personal coordinator maps an authenticated channel to its sole owner and
  enrolled node principals; caller-supplied user, Realm, node, grant, or epoch
  values never establish authority.
- A control write requires both current coordinator authorization and the exact
  expected control head and epoch.
- Replica retention, Writer Grants, control coordination, active execution, and
  foreign Authority Connections remain independent capabilities.
- Synchronizing a control record propagates an already authorized decision. It
  does not let the receiver mint a different one.
- Loss of connectivity reduces available authority. It never expands it.

## 11. Implications for the current repository

This direction causes no immediate database, auth, queue, API, OpenSpec, or
roadmap change:

- the current installation remains a hub-shaped single authority for its shipped
  data;
- PostgreSQL and RLS remain the hosted source of tenant isolation;
- pg-boss remains the current Run execution queue and is not a Realm control log;
- no generic consensus layer, peer discovery mesh, control-log table, embedded
  node store, or sync framework is scaffolded; and
- a first personal-node experiment may keep the hub as the only linked
  coordinator while proving one portable data class end to end.

The decision is a constraint on later capability design: do not make ordinary
personal data depend synchronously on the coordinator, and do not make governance
multi-writer merely because data replication is.

## 12. Deliberate deferrals

This decision does not choose:

- exact control-batch fields, canonical encoding, signatures, or key custody;
- coordinator discovery, endpoint migration, or protocol version negotiation;
- a quorum, escrow, social recovery, or hardware-backed permanent-loss mechanism;
- automatic election or failure detection;
- exact full-replica resource and artifact size limits;
- per-resource offline conflict and acceptance rules;
- snapshot, frontier, backfill, and journal-compaction schemas; or
- control-coordinator implementation outside the initial hub topology.

Automatic election is specifically not assumed. A failure detector can report
absence; it cannot prove that an old coordinator has lost the ability to author.

## 13. Next architectural decision

The next high-leverage federation boundary is **cross-authority information flow
and derived-data ownership**. Multi-link mounts are unsafe unless every retrieval,
model call, tool result, summary, artifact, and write has a clear destination
authority and permitted sinks. This should be settled before designing a generic
multi-authority context router.

## 14. Promotion boundary

This note records a vision architecture decision. `VISION.md` owns the durable
principles. `SPEC.md`, OpenSpec, ROADMAP, and the shipped runtime remain unchanged
until a focused capability is selected.
