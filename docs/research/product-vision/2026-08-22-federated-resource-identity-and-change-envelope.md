# Federated resource identity and change envelope

- **Status:** selected vision direction; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for identity boundaries and semantic batches; moderate for
  writer-stream sequencing details

## 1. Decision

Portable llame resources use a stable namespace-scoped identity:

```text
ResourceRef = (namespace_id, resource_kind, resource_id)
```

- `namespace_id` identifies the authenticated namespace in which the resource was
  created, not its current host or governing authority;
- `resource_kind` is a stable protocol kind, not a table or class name; and
- `resource_id` is an opaque namespace-local identifier. llame-owned resources
  use offline-generated random UUIDs.

Every portable resource also has a versioned **Authority Binding** naming its
current governing `authority_id`. The binding is separate so an authenticated
authority transfer or Personal Realm join can change governance without changing
Chat, message, branch, or Run identity. A Personal Realm's `realm_id` is both its
initial namespace and its initial governing authority; after an explicit join it
may govern retained predecessor namespaces.

Portable episodic mutations are immutable, atomic semantic `ChangeBatch` records.
A batch is authored through an authority-scoped writer stream and has a stable
identity derived from that stream plus a contiguous sequence. It carries causal
dependencies, typed operations, affected resource references, schema version, and
an integrity digest. Database rows, generated sequences, URLs, timestamps, queue
events, and transport messages are not the batch.

Every resource kind defines its own mutation and conflict semantics. There is no
generic row patch, upsert, wall-clock last-write-wins rule, or universal CRDT. A
concurrent Chat continuation becomes an explicit branch; an explicit deletion
creates a retained deletion record; absence never means deletion.

## 2. UUIDs solve only one part

Random UUIDs make independently created Chats, messages, Runs, and batches
extremely unlikely to collide. That is necessary for offline creation, but it
does not answer:

- which authority governs a resource;
- whether two references from different authorities name the same thing;
- whether a mutable write was based on the current revision;
- whether a deletion or sibling continuation is missing;
- whether the sender may author that record kind;
- how replicas prove causal completeness; or
- how concurrent continuations become the same branch DAG regardless of delivery
  order.

The statement “UUIDs mean conflicts should not happen” is therefore false for
mutable state. The narrower statement is correct: UUIDs make independent creates
mergeable without a central ID allocator.

## 3. Identity domains remain separate

| Identity           | Scope and lifetime                                                                 | Must not be treated as                                                          |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `namespace_id`     | Stable origin namespace retained through authority transfer                        | Current authority, endpoint, account, or credential                             |
| `authority_id`     | Current logical governance identity; bound to resources by a revision              | URL, server installation, user, or resource identity                            |
| `resource_id`      | Stable inside one namespace and kind; generated before synchronization when needed | Display name, database sequence, provider locator, or global identity by itself |
| `author_stream_id` | Authority-scoped ordered stream granted some authorship capabilities               | Node, replica, user, or proof of permission by itself                           |
| `node_id`          | Cryptographic connection and enrollment principal                                  | User identity, Realm identity, resource owner, or permanent author stream       |
| connection ID      | Local route, credentials, and subject binding for one foreign authority            | Portable resource identity                                                      |
| provider locator   | Git remote, forge project ID, URL, or adapter metadata                             | Governing authority or durable llame identity                                   |

This separation is load-bearing:

- a hub node stores isolated replicas for many Personal Realms, so one physical
  hub `node_id` cannot be their common author stream;
- one personal node may mount resources from several authorities, so its node
  identity cannot namespace every mounted resource;
- an authority transfer must fence future writes without rewriting every
  reference to the transferred resource;
- node enrollment identities are intentionally disposable, while resource
  identities and accepted history must survive unlink and relink; and
- retaining a replica does not automatically grant authorship, so replica identity
  cannot substitute for a writer grant.

## 4. Alternatives considered

### A. Globally meaningful naked UUIDs

Use one UUID for every resource and batch, assume collision resistance makes the
ID universally sufficient.

**Strength:** minimal representation; existing PostgreSQL IDs appear immediately
portable.

**Failure:** the ID says nothing about provenance, governance, authorization,
migration, or which namespace can resolve it. A malicious or buggy foreign
authority can deliberately reuse a UUID; an aggregator must keep that resource
distinct rather than turning hostile input into an integrity collision. A work
Chat and an imported personal copy also need an explicit copy relationship rather
than accidental identity reuse. Collision resistance is not an authority model.

**Decision:** rejected. Existing UUIDs remain useful as the namespace-local
component.

### B. URL-, key-, or content-addressed identity

Use a dereferenceable URL, public-key fingerprint, or content hash as the resource
identity.

**Strength:** URLs provide discovery, keys provide self-authentication, and hashes
provide immutable-content integrity.

**Failure:** each couples identity to another concern. URLs bind identity to
routing and hosting. Keys turn ordinary rotation or recovery into identity
migration. Hashes identify immutable versions, not a mutable Chat, Knowledge
Space, branch, or accepted head. All three make authority migration unnecessarily
destructive.

**Decision:** rejected as the primary identity. Connections may resolve endpoints
and keys; immutable payloads may carry hashes; neither replaces `ResourceRef`.

### C. Stable namespace identity, explicit authority binding, and causal batches

Keep resource identity stable and boring. Authenticate current governance and
routing through versioned authority bindings and separate connection records.
Represent portable mutation as typed batches with explicit authorship, causality,
and preconditions.

**Strength:** supports offline creation, multiple authorities, endpoint/key
rotation, explicit authority transfer without identity rewrite,
storage-independent synchronization, and per-resource conflict policy.

**Cost:** a resource reference is a tuple, and conformance requires semantic
validation rather than generic row replication.

**Decision:** selected.

## 5. Namespace, authority, and resolution

A `namespace_id` is an opaque random identifier assigned when a resource namespace
is created. It is permanent provenance, not proof of current control. An
`authority_id` is an opaque identity for the logical authority currently allowed
to govern one or more namespaces or resources. Possession of either ID proves
nothing.

A versioned Authority Binding states which authority currently governs a namespace
or an explicitly transferred resource. Every accepted mutation targets an exact
binding revision or epoch. An old authority, stale replica, or copied credential
cannot keep advancing the same resource after an authenticated transfer moves the
binding.

A node trusts a namespace and its Authority Binding only through its own Personal
Realm bootstrap, an authenticated Authority Connection, or a verified authority
migration record.

An Authority Connection binds:

```text
local profile -> authenticated authority_id -> authority-local subject + routes
```

Endpoints, public keys, OAuth subjects, certificates, and provider locators are
connection metadata. They may rotate without changing the authority ID when the
existing authority authenticates the transition. An unproven endpoint that merely
claims an existing ID is rejected.

Moving a resource to a different governing authority advances its Authority
Binding and preserves its `ResourceRef`. Moving the hosting or keys of the same
logical authority preserves both identifiers through an authenticated metadata
transition. Joining Personal Realms may transfer a source namespace into the
destination Realm authority while retaining every resource reference and an
explicit predecessor-Authority Binding chain.

A copy, export, or absorption is not an authority transfer. It creates a new
destination resource identity with source provenance. A governance fork likewise
creates a new namespace or resource lineage because two independent authorities
cannot both claim the same current binding.

Names are projections. Two resources with the same title remain distinct. One
resource reached through two routes remains one resource only when both routes
resolve to the same authenticated `ResourceRef`.

## 6. Resource identifiers and references

For llame-owned namespaces and resources, random UUIDv4 identifiers are sufficient
and already match the current schema's resource-generation model. UUIDv7 is not
required: time sorting is not causal ordering, and embedding creation time in
identity buys nothing this design needs.

Every portable trust boundary uses the full `ResourceRef` plus the Authority
Binding revision relevant to an operation. An implementation may store only
`resource_id` in a table whose namespace and kind are fixed by context, but it
must reconstruct the full reference before federation. The protocol never infers
namespace, current authority, or resource kind from the receiving account or the
shape of an untrusted payload.

Parentage is data, not identity. Moving a Chat into a Project, renaming a
Knowledge Space, or changing a branch head does not change its resource ID.
Converting or absorbing content into a different resource creates a new identity
with provenance; it does not silently reuse the source identity.

Provider objects need an adapter-owned mapping. A Git remote URL may change, a
GitHub repository may be transferred, and two forges may use identical numeric
IDs. Provider locators and immutable Git OIDs remain metadata under an
authenticated namespace and Authority Binding, not naked llame resource IDs.

## 7. Writer streams are not nodes or replicas

Each authority grants an **author stream** permission to append specific portable
record kinds. A stream has an opaque random `author_stream_id` and a contiguous
monotonic sequence committed atomically with its batches.

A new Personal Realm bootstraps its first local stream as part of Realm creation;
it does not need an upstream service to allocate one. Foreign authorities and
later replica enrollment grant their streams through their own authenticated
policy.

Conceptually:

```text
BatchRef = (granting_authority_id, author_stream_id, author_sequence)
```

The stream model serves three purposes:

1. globally unique, compact batch identity without a central allocator;
2. gap detection and compact causal frontiers per authority; and
3. authorship capability separate from data retention and transport identity.

A read-only replica has no author stream. A node may hold streams for several
authorities. A multi-user hub uses isolated per-authority or per-Realm streams,
not one global sequence that leaks cross-tenant activity. A current `node_id`
authenticates the channel allowed to use a stream; it is not the stream's portable
identity.

An authority transfer does not rewrite historical batches. The predecessor
authority's batches remain immutable provenance; new operations use streams
granted by the successor authority and target the new Authority Binding revision.

The exact stream lifecycle across revocation, key loss, profile copy, and
re-enrollment belongs to the enrollment design. The invariant is already fixed:
revoking a node does not rewrite historical batch authorship, and issuing a new
node credential does not let callers select an arbitrary existing stream.

## 8. ChangeBatch boundary

The following is an information model, not a proposed JSON schema:

```text
ChangeBatch
  batch_ref
  schema_version
  causal_dependencies
  authority_binding_revisions
  affected_resource_refs
  typed_operations
  authorship_and_cause_provenance
  observed_time
  payload_digest
```

Required semantics:

- a local transaction commits domain state and the exact immutable batch
  atomically;
- the next batch in one stream has exactly the next sequence;
- the batch depends on its prior stream batch and every observed cross-stream
  batch or resource revision required by its operations;
- delivery and forwarding preserve the original batch identity and payload;
- a receiver authenticates the sender's right to deliver and the author stream's
  right to perform every operation;
- every operation targets the Authority Binding revision under which that stream
  is allowed to act;
- a receiver applies one causally complete batch atomically or applies nothing;
- missing authorized dependencies are returned for backfill;
- the same `BatchRef` and digest is an idempotent replay;
- the same `BatchRef` with a different payload is an integrity failure; and
- timestamps are audit metadata, never causal or conflict order.

The payload digest detects corruption and identity reuse. End-to-end batch
signatures are a later requirement if untrusted multi-hop forwarding needs origin
proof; the first linked node-to-hub topology may rely on authenticated transport,
stored enrollment evidence, and exact-payload retention. Signed envelopes still
would not replace authorization or resource-specific conflict rules.

The generic envelope deliberately does not carry database table names, SQL
columns, PostgreSQL sequence values, SQLite rowids, pg-boss jobs, raw Run events,
or generated projections.

## 9. Typed operations and conflict semantics

The envelope transports domain operations. Each operation names its resource
kind, references stable resources, and supplies the precondition that makes the
mutation meaningful.

Minimum common rules:

- **Create:** a new `ResourceRef` is accepted once. Replaying the same creation is
  idempotent; reusing the reference with a different creation payload is an
  integrity failure.
- **Append:** identifies its causal parent or exact expected head. Sibling appends
  are retained rather than overwritten.
- **Revise:** targets an exact accepted resource revision. A stale or concurrent
  revision invokes that resource kind's explicit conflict rule.
- **Delete:** creates an explicit deletion record against an exact revision and
  authorization state. Missing data is never interpreted as deletion.
- **Resolve:** names the conflicting revisions it supersedes. It does not erase
  the fact that the conflict existed.

There is no generic “apply this JSON patch to the latest row.” Such a patch cannot
express authority, semantic validation, branch creation, or safe deletion. There
is also no default wall-clock last-write-wins policy. A deterministic projection
may choose one value to display while preserving all unresolved candidates, but
that is a per-resource decision.

The initially synchronized episodic core should remain mostly additive. Mutable
Agent Profile heads, global settings, persistent permissions, and other resources
stay out until their operation and conflict rules exist.

## 10. Chat lineage and automatic forks

Within one Personal Realm authority, a Chat's portable content is a DAG:

- every message has a stable `ResourceRef` and retains it on every replica;
- a message or execution segment names its exact causal parent;
- a branch is a stable named pointer to a DAG head, not a copied transcript; and
- a continuation attempts to advance one branch from an exact expected head.

If two valid continuations share the same expected head, reconciliation retains
both child histories. One keeps the existing branch pointer and the other receives
a deterministic derived branch identity; the choice and derived identity must be
independent of delivery order. No message is renumbered or copied, and shared
ancestry keeps its original message IDs. The same rule works for forks of forks.

Which pointer retains the original branch label is a presentation-level
deterministic tie-break over immutable batch identities, not a claim that the
other continuation lost. Follow-up summaries of changes since divergence are
derived artifacts; they reference the branch lineage but are not part of identity.

This synchronization fork differs from an export, absorption, or user-created
copy into another namespace. Copies receive new destination resource identities
and retain source provenance. An explicit authority transfer instead preserves
the original `ResourceRef` and advances its Authority Binding.

## 11. Deletion, snapshots, and completeness

Deletion is a mutation with history, not an absent row. A deletion record carries
the resource reference, exact predecessor revision, author stream, causal batch,
and policy-relevant time. It synchronizes like any other supported semantic
change.

Physical purge and deletion-record compaction require the governing authority's
retention policy plus proven replica coverage. An incomplete replica cannot infer
deletion from absence, compact deletion history, or claim a full reconciliation.

A snapshot at frontier `F` contains normalized resources and deletion records with
the same `ResourceRef` values produced by replay through `F`. It does not mint new
IDs, change authority, or bypass operation invariants. Snapshot coverage and causal
frontier are explicit; “this is every row I currently have” is not a completeness
proof.

## 12. Scenario checks

### Two offline devices create Chats

Both devices generate UUIDs inside the same Personal Realm namespace and append
batches through different author streams. The creates commute because their full
resource references differ. No server allocates IDs and no name-based merge runs.

### Two devices continue the same branch

Both continuations name the same expected head. Their messages have distinct UUIDs
and their batches have distinct stream identities. Reconciliation sees sibling
causal children and creates the same visible fork on every replica, independent of
arrival order.

### A node unlinks and later relinks

The node enrollment principal changes according to the selected disposable-key
policy. Existing `ResourceRef` values and historical `BatchRef` values do not. The
new credential may use only writer streams explicitly authorized by the relink
workflow; relinking does not rewrite resource ownership or impersonate the old
node principal.

### Two populated Personal Realms join

The user explicitly selects one destination Realm authority. Source resource
namespaces and every `ResourceRef` remain stable; an authenticated migration
advances their Authority Bindings to the destination and retires source writer
grants. Historical source batches remain provenance. After that identity step,
the ordinary reconciliation function synchronizes both replicas; it does not
enter a special overwrite or first-import mode.

### Work and family resources share a title

The UI may display both as “Plans.” Their distinct namespace IDs prevent
accidental identity collision, while separate Authority Bindings retain their
different policy. A local mount stores the connection route separately from each
resource reference.

### A replica is missing a deletion

Its UUID set looks conflict-free but its frontier and coverage are incomplete. It
may preserve new work from an exact base as a candidate or fork, but it cannot
claim canonical replacement or infer that the deleted resource still exists at
the authority.

## 13. Implications for the current repository

No schema migration or protocol package is justified by this vision decision.
When a concrete synchronization slice begins:

1. existing random UUID Chat, message, Run, and compaction IDs may become the
   namespace-local `resource_id` values;
2. federation-facing DTOs must add explicit namespace, resource-kind, and
   Authority Binding context instead of treating a local database UUID as
   globally sufficient;
3. `messages.seq`, generated identity columns, timestamps, and `run_events.seq`
   remain local projection or recovery order, never portable causality;
4. the current unique `messages.in_reply_to` and copy-based fork model must not be
   mistaken for the north-star multi-head Chat DAG;
5. the hub derives local `owner_user_id` from authenticated enrollment and RLS
   scope; a personal node still stores no selectable local user ID; and
6. writer-stream, journal, and branch-schema changes land only with the focused
   capability that exercises them end to end.

This is architecture direction, not current ROADMAP sequencing and not a change to
the shipped SPEC.

## 14. Evidence and limits from reference models

CloudEvents establishes the useful narrow pattern that event uniqueness is scoped
by `source + id`, and that event format is separate from transport binding. It does
not define causality, authorization, atomic domain application, or conflict
resolution, so llame should not adopt it as the synchronization protocol.

Source: [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)

Automerge demonstrates an actor ID plus contiguous sequence, dependency hashes,
immutable changes, causal heads, and transport-independent synchronization. Those
are useful envelope lessons. Its general CRDT document model and deterministic
winner for concurrent scalar writes are not llame's universal resource semantics;
Chats, permissions, accepted Git revisions, and execution authority need typed
rules.

Sources:

- [Automerge binary format](https://automerge.org/automerge-binary-format-spec/)
- [Automerge conflicts](https://automerge.org/docs/reference/documents/conflicts/)

Nostr-style content-addressed signed events are useful integrity records but do
not supply llame's mutable resource identity, governing-authority policy, or typed
conflict behavior. Git similarly keeps immutable object IDs separate from mutable
refs; llame needs both stable resources and immutable revisions rather than
choosing one as the other.

## 15. Deliberate deferrals

This decision does not yet choose:

- the wire encoding or concrete field names;
- canonical hashing and signature algorithms;
- authority discovery documents or endpoint migration proof;
- writer-stream grant, revocation, cutoff, rotation, or recovery mechanics;
- frontier compaction across retired writer streams;
- branch-ID derivation and visible-label tie-break encoding;
- per-resource conflict rules beyond the common invariants; or
- physical purge and deletion-record compaction policy.

These details belong to authority enrollment, synchronization, or the affected
resource capability. They do not weaken the identity boundary selected here.

## 16. Next architectural decision

The next dependency is the **Authority Connection and writer-grant model**: how a
local profile authenticates a Personal Realm replica or foreign authority,
resolves `authority_id`, binds a current node credential to allowed writer streams,
revokes that grant, and keeps multi-link work/family/school credentials separate.

That should be decided before exact synchronization messages. Otherwise the wire
format will accidentally invent its own identity and authorization model.

## 17. Promotion boundary

This note holds alternatives, rationale, scenarios, and deferred mechanics.
`VISION.md` owns the durable identity direction. `SPEC.md`, OpenSpec, and ROADMAP
remain unchanged until a focused capability is selected and shipped.
