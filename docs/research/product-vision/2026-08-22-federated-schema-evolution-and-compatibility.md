# Federated schema evolution and compatibility

- **Status:** selected vision direction; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for layered negotiation, authority-fenced writers, and
  fail-closed semantic handling; moderate for the eventual compatibility window

## 1. Decision

Federated llame nodes upgrade independently. Compatibility is therefore
negotiated per protocol layer and capability, not inferred from one application
version and not promised forever.

A connection handshake establishes which operations two nodes can exchange. It
does not grant either node permission to write. The governing authority separately
publishes the minimum reader and writer capability accepted for each portable
resource scope. A new semantic writer activates only after the authority fences
writers that cannot preserve the new meaning.

An unsupported optional presentation field may be retained or omitted where its
schema explicitly permits that behavior. An unknown resource mutation,
authorization rule, policy label, control operation, or model-context instruction
is not optional. A replica cannot skip it and advance its applied frontier as if
the state were complete.

Incompatibility degrades honestly. A node may keep supported modules operational,
become read-only for an affected resource, request a compatible snapshot, or
require an update. It must not claim to be a full mirror of state it cannot apply.

Compatibility has a finite support window. The product will not accumulate
permanent legacy readers, a universal migration DSL, or a generic CRDT/event
framework before concrete resource semantics justify them.

## 2. Why one version number is insufficient

The system contains several independently evolving boundaries:

- the Node Protocol connection and framing contract;
- modules such as Realm enrollment, synchronization, execution, and
  administration;
- portable resource schemas and their semantic operations;
- ChangeBatch envelope and causal metadata;
- snapshots and the resource/frontier coverage they claim;
- policy, provenance, and information-flow labels;
- executor handoff, checkpoint, observation, and recovery capabilities; and
- local storage schemas, indexes, caches, and other rebuildable projections.

Two nodes may be compatible for Chat synchronization but not Workspace execution,
or capable of observing a Run without being able to resume its executor
checkpoint. Treating the entire product as compatible or incompatible would
either disable useful work or silently overstate what a node can preserve.

The negotiated unit should remain coarse enough to test. Initial versions use an
exact supported set per module or resource family, not arbitrary feature flags for
every field.

## 3. Alternatives considered

### A. Lockstep upgrades

Require every personal mirror, hub, mobile app, and executor to run the same
release before synchronization or remote control continues.

**Strength:** simple reasoning inside one deployment.

**Failure:** offline phones and laptops cannot participate in a coordinated
cutover. Foreign authorities do not share a deployment clock. One abandoned
device would block the Realm or force the server to accept unsafe old writes.

**Decision:** rejected beyond a single installation's tightly coordinated
API/worker rollout.

### B. Ignore unknown fields and operations

Require additive schemas and let older nodes skip anything they do not recognize.

**Strength:** easy rolling upgrades for cosmetic additions.

**Failure:** omission is not compatibility when the unknown value changes access,
deletion, context, conflict resolution, or durable meaning. A node that skips one
operation but advances its frontier can permanently report a false complete
mirror and build later writes on nonexistent state.

**Decision:** allowed only for fields explicitly classified as optional and
semantically ignorable by that schema version; rejected as a general rule.

### C. Layered negotiation with authority-fenced writer activation

Negotiate connection/module capability, let the governing authority set accepted
reader/writer floors at an exact control epoch, and degrade unsupported resource
scopes without lying about completeness.

**Strength:** supports independent upgrades, partial devices, offline work, and
security-sensitive changes while preserving one testable contract.

**Cost:** authorities must track writer eligibility and replicas must expose
coverage separately from possession of some records.

**Decision:** selected.

### D. Universal self-describing events or CRDT schema

Represent every future change through a generic operation language that old nodes
can store, merge, and replay without understanding it.

**Strength:** appears to remove coordinated evolution.

**Failure:** syntax can be self-describing while semantics are not. An old node
still cannot safely authorize, merge, summarize, compact, or edit state whose new
meaning it does not understand. A universal layer would move domain conflicts
into an opaque framework rather than solve them.

**Decision:** rejected. Resource-specific operations and reconciliation remain
explicit.

## 4. Negotiation is not authorization

On an authenticated connection, each side advertises supported protocol,
module, resource, snapshot, policy, and executor capability versions. The result
answers what the peers can technically exchange.

Authority state answers what they may exchange and author. A node that supports a
writer version has no writer authority unless its current Writer Grant and the
resource's Authority Binding admit that version and operation. A caller cannot
request an older version to evade a newer policy requirement.

Negotiated state is bound to the authenticated channel, peer identity, governing
authority, and relevant control epoch. Reconnection renegotiates. Resumption may
reuse a cached result only while its lease and authority epoch remain valid.

The initial contract does not need a constraint solver. Each module advertises a
small set of exact supported versions and stable capabilities. No common safe
version means that module is unavailable, not that the peers guess.

## 5. Reader and writer floors

For each governed resource family, the authority may publish:

- the earliest reader capability that can interpret current semantic state;
- the accepted writer capability set;
- the control epoch and applied frontier at which that requirement starts; and
- the snapshot versions available for compatible recovery.

Reader and writer eligibility are separate. An old node may still render and
export a stable subset while being barred from creating mutations. A display-only
client does not need execution or writer capability merely to observe a Run.

Writer activation follows this order:

1. compatible readers and recovery paths exist;
2. the authority records a new minimum at an exact epoch/frontier;
3. incompatible Writer Grants are fenced from authoring accepted batches; and
4. new semantic writers begin.

This generalizes the current repository's coordinated API/worker cutover rule to
offline federation. It does not require every replica to be online. It requires
the authority to stop accepting semantically obsolete writes once the cutover is
active.

An offline old writer may retain its local candidate work. On reconnect, the
authority rejects it as an accepted continuation when it cannot be represented
safely. The UI may offer an update, read-only export, resource-specific
translation, or explicit fork. It does not silently reinterpret the batch.

## 6. Applying batches and advancing frontiers

A ChangeBatch is atomic with respect to the semantic operations and causal
dependencies it declares. A replica advances its applied frontier only after it
understands and applies the complete batch under an accepted resource version.

If a batch contains an unknown required operation, the replica:

- retains its last valid applied frontier;
- marks the affected resource scope incomplete or unavailable;
- requests compatible missing data, a snapshot, or an update path; and
- continues unrelated compatible resource scopes when their dependencies permit.

It must not drop the operation, apply the rest, and acknowledge the batch. It must
not use receipt of opaque bytes as proof of semantic application.

The north star may distinguish an **opaque retained frontier** from the **applied
frontier**, allowing a relay to forward bytes it cannot interpret. That is not a
first implementation requirement. Initially, an incompatible receiver can leave
the authoritative copy at the sender and report update-required.

## 7. Optional data versus semantic data

Forward compatibility depends on explicit schema classification, not naming
convention.

An optional field is safe to ignore only when its defining schema guarantees that
omission does not alter:

- authorization or identity;
- causality, conflict, deletion, or completeness;
- information-flow restrictions;
- model-visible instructions or tool behavior;
- durable resource meaning; or
- a required recovery or audit invariant.

Examples likely safe under an explicit rule include an unknown UI hint or a new
human-readable annotation. Examples never silently ignorable include a deletion
record, Writer Grant revocation, new provenance restriction, a context item that
controls model behavior, or a new checkpoint settlement state.

Unknown authorization, policy, enrollment, coordinator, and control operations
fail closed. Security-sensitive schemas do not use permissive “best effort”
decoding.

## 8. Snapshots and recovery

A snapshot declares:

- governing authority and resource scope;
- snapshot schema and required semantic capabilities;
- exact applied frontier and causal coverage;
- policy/provenance requirements needed to use it; and
- integrity evidence appropriate to its transport.

Installation is atomic. A node verifies identity, integrity, authority, schema,
coverage, and local support before replacing prior valid state. An unsupported or
partial snapshot is rejected without walking the local applied frontier forward.

Snapshots accelerate convergence; they do not establish authority and do not
erase missing history by assertion. A peer that cannot validate the advertised
coverage requests another source or stays incomplete.

## 9. Portable migrations and local migrations

Portable semantic migration and local storage migration are different operations.

A portable migration changes the meaning or representation of shared resource
state. It is authored or accepted by the governing authority at an exact
frontier/epoch. Replicas apply the same authoritative result. They do not each
invent independently migrated records and then attempt to reconcile the
differences.

A local migration changes an implementation's database tables, indexes, caches,
or projections without changing portable semantics. Each runtime owns it. A
search chunker version, for example, can invalidate and rebuild derived rows from
portable Chat state without becoming a federated resource operation.

This separation keeps PostgreSQL migrations, embedded-store migrations, Android
indexes, and executor caches out of the Node Protocol unless they alter portable
meaning.

## 10. Execution compatibility

Execution negotiation is capability-specific. An executor may support starting a
Run but not resuming a checkpoint produced by another adapter. It may proxy live
observation but not reconstruct a lost coding-agent session. It may enter a
Workspace but lack the Sandbox or egress policy required by that branch.

Before transfer, the coordinator matches the Run's required checkpoint,
Workspace, tool, policy, and observation capabilities against the target. A
missing required capability prevents handoff or selects the previously agreed
fallback behavior. It does not downgrade the Run receipt or pretend continuity.

Live tunnel compatibility and durable recovery compatibility remain separate. A
new Surface can control an old executor through a stable proxied protocol even if
the hub cannot recreate that executor's private process state after loss.

## 11. Scenario checks

### Old Android node reconnects to a newer hub

The node negotiates supported Chat/resource versions. If current Chat state still
uses a compatible reader version, it synchronizes and remains a full mirror for
that scope. If a new required operation exists, Android keeps its last applied
frontier, reports the scope incomplete, and asks for update or a compatible
snapshot. Q&A and other supported local modules continue.

### Old CLI wrote offline after a writer cutover

The local batches remain attributable to the CLI's Writer Grant and old control
epoch. The hub does not accept them into the new authoritative stream merely
because their UUIDs do not collide. A resource-specific translator may later
propose a compatible batch; otherwise the user retains/export/forks the candidate
work.

### New UI metadata reaches an old desktop

If the schema classifies the field as optional presentation data, the desktop may
omit it while applying the resource. If the field affects a model prompt,
authorization, or conflict behavior, it is not presentation data and blocks
application without compatible handling.

### Foreign authority introduces a new policy label

The local node cannot evaluate the label, so it denies the affected flow and does
not expose the source to a model, tool, replica, or destination. User approval
cannot reinterpret the foreign policy.

### Snapshot uses an unsupported semantic version

The receiver rejects it atomically and retains its prior valid state and frontier.
It may ask another compatible replica or require an update. It does not import the
known fields and claim snapshot coverage.

### Hub rolls back after activating a new writer floor

Rollback cannot simply launch old writers. The authority first stops incompatible
new authoring, settles accepted work, and restores a control state whose readers
and writers can preserve every already accepted semantic operation. If that is
impossible, the old release remains read-only or unavailable.

## 12. Security invariants

- Version negotiation is authenticated and downgrade-resistant.
- Technical capability never substitutes for a Writer Grant or Authority
  Binding.
- Unknown authorization, policy, identity, provenance, and control semantics deny
  the affected operation.
- A fenced writer cannot regain authority by reconnecting with an older protocol.
- A replica never claims full coverage beyond its applied frontier.
- Unsupported snapshots and batches do not partially replace valid state.
- Compatibility fallback never removes information-flow restrictions from
  derived or relayed data.

## 13. Simple-first implementation boundary

The first synchronization slice should support:

- one Node Protocol major;
- a small exact capability set;
- one portable Chat/Run resource schema family;
- authority-coordinated writer cutover through the linked hub;
- explicit compatible, read-only, incomplete, and update-required states; and
- shared conformance fixtures for every supported semantic version.

It should not build:

- a generic migration language;
- opaque relay storage;
- arbitrary per-field capability negotiation;
- peer-elected schema coordination;
- a universal CRDT/event framework; or
- indefinite compatibility with every released node.

The conformance suite shares schemas, example batches, snapshots, negotiation
transcripts, and expected state. It does not share ORM repositories, queues, or
storage migrations across runtimes.

## 14. Implications for the current repository

This direction does not change the current single-installation runtime, OpenSpec,
schema, roadmap, or deployment procedure.

The existing producer-first deployment and quiesce/drain rules remain correct for
the co-deployed API and workers. Existing tolerance for an unknown context
producer is a narrow compatibility behavior: it records an auditable omission but
does not prove that arbitrary unknown semantic data is safe. Existing versioned
search projections demonstrate the opposite category: rebuildable local state
may be discarded and regenerated without a portable migration.

When a first portable synchronization slice is selected, its acceptance tests
must include old-reader, fenced-old-writer, unsupported-snapshot, downgrade, and
partial-capability cases. “Both versions parse the JSON” is not a compatibility
test.

## 15. Deliberate deferrals

This decision does not choose:

- exact wire schemas or version-number syntax;
- release duration or number of supported versions;
- resource-specific translation rules;
- snapshot signing and discovery transport;
- update distribution or mobile-store release policy;
- coordinator recovery keys and authority succession; or
- replica retention, pruning, and garbage-collection mechanics.

Those are separate decisions. The compatibility contract prevents them from
being hidden inside permissive decoding.

## 16. Next architectural decision

The next federation dependency is **recovery authority and key lifecycle**. Full
personal mirrors remove dependence on one data host but do not remove dependence
on cryptographic enrollment, Writer Grants, or the Realm control head. The system
needs an explicit answer for device loss, key rotation, backup, coordinator
recovery, and revocation without turning any one physical replica into a secret
canonical home.

## 17. Promotion boundary

This note records a vision architecture decision. `VISION.md` owns the durable
principles. `SPEC.md`, OpenSpec, ROADMAP, and the shipped runtime remain unchanged
until a focused capability is selected.
