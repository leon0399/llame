---
type: Research
title: "Multi-Authority Federation Models"
description: "Compares multi-authority resource federation with global identity and ownerless database federation, and selects one replicated Personal Realm that links to foreign authorities, one governing authority per shared Space."
tags:
  [
    product-vision,
    federation,
    multi-authority,
    personal-realm,
    replication,
    offline-sync,
  ]
status: stable
---

# Multi-Authority Federation Models

Recorded 2026-08-21. Active, noncanonical research adjacent to
[`2026-08-21-local-nodes-workspaces-and-distributed-execution.md`](2026-08-21-local-nodes-workspaces-and-distributed-execution.md).
It preserves the alternatives, evidence, scenario analysis, and resulting
decision; the adjacent checkpoint carries only the accepted contract and remaining
open questions.

Later 2026-08-21 updates recorded the boundary between Git-backed knowledge
publication and database-native episodic synchronization, then the
replica-completeness boundary and candidate-only fallback under uncertainty.
Updates on 2026-08-22 added semantic replication change batches, the separate
single-authority control protocol for active execution, simple-first planning,
fenced handoff, and disposable node enrollment. A 2026-08-22 prioritization pass
left these options and the north star intact while moving their implementation
behind bounded Git-backed personal knowledge, profile files on the same repository
service, a standalone personal Node and CLI, personal synchronization, and
Workspace-aware execution. The note informs later design, not the immediate
implementation plan.

## 1. The actual question

The motivating experience is broader than synchronizing one person's devices:

- Leo uses his personal knowledge together with resources from a work
  installation, a family installation, and a public llame knowledge base.
- Leo's wife uses her own personal and work resources with the same family
  resources.
- A child uses their own personal resources with family and school resources,
  without that membership silently exposing their personal history to parents,
  school, or either institution.
- Each installation may be independently operated, intermittently reachable, and
  unwilling to let its data be copied or sent to arbitrary executors or inference
  providers.

Calling all of this "federation" hides at least nine independent problems:

1. **Presentation aggregation:** which resources appear together in one surface?
2. **Identity binding:** which foreign principal is the local person using?
3. **Authentication:** how does that person prove control of the foreign account?
4. **Authorization:** which authority decides whether the principal may act?
5. **Resource naming:** how does an object retain identity across installations?
6. **Write authority:** who accepts and orders authoritative mutations?
7. **Replication:** which nodes may retain which data, for how long, and with what
   offline behavior?
8. **Execution and egress:** where may data be processed or sent for inference?
9. **Trust discovery:** how do previously unknown installations decide to trust
   one another?

One protocol need not solve all nine, and solving them now would turn llame into
an identity federation, distributed database, authorization system, and sync
platform before its knowledge system exists.

**Initial hypothesis tested below:** the examples require a multi-authority
product model. They do not yet prove a need for arbitrary server-to-server
federation.

## 2. Constraints inherited from the prior discussion

Any viable model must preserve these recorded boundaries:

- A personal node is an implicitly single-owner system, not a small multi-user
  hub.
- A personal profile may link to at most one **hub account** used as a
  coordination and synchronization peer for its personal full mirror. The hub is
  not the one physical home or primary copy: CLI, Android, desktop, and other
  trusted personal nodes remain peer replicas of the Personal Realm.
- A multi-user hub owns authenticated tenant and organization boundaries.
- Node, user, surface, executor, Workspace, and sandbox are distinct concepts.
- Personal full-mirror scope does not automatically include organization-managed
  data, Workspace contents, host grants, or upstream secrets.
- An active Run branch has one execution authority at a time.
- Workspace placement, availability, recovery, and egress remain transparent to
  both the model and user.
- Distinct Knowledge Spaces coexist. Copying or absorbing content does not imply
  deletion of the source.

The current external-identity contract is narrower still: it maps a provider
subject into one user of one llame installation. That is an ingress identity
primitive, not a grant to resources governed by another installation, and reusing
that table for foreign authority connections would conflate account
deduplication with cross-authority access.

## 3. Authority is per concern, not per machine

"Which node is authoritative?" is too coarse. The authority map asks a different
question for each concern:

| Concern                     | Required authority                   | Initial safe default                                          |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Personal identity and state | The person's Personal Realm          | One authority boundary with many trusted full-mirror replicas |
| Foreign principal identity  | The foreign installation             | Locally stored binding; no global identity merge              |
| Shared-space membership     | The space's governing authority      | Online validation or a short-lived offline lease              |
| Shared resource contents    | The resource's governing authority   | One accepted revision history; replicas are secondary         |
| Offline candidate changes   | The replica that authored them       | Tentative until accepted by the governing authority           |
| Current Run execution       | The current executor                 | Exactly one authority per active Run branch                   |
| Workspace files             | The executor exposing the Workspace  | Never inferred from account or data authority                 |
| Egress and inference        | The strictest applicable data policy | Deny a sink unless every contributing domain permits it       |
| UI aggregation              | The active surface or its backend    | A view, never a transfer of ownership                         |

An installation may perform several roles, but they must not collapse into one
ambient trust relationship.

## 4. Evidence from existing systems

These systems are reference points, not implementation prescriptions.

### 4.1 AT Protocol: one authoritative host, verifiable redistribution

Every account gets a signed, content-addressed repository and names one Personal
Data Server as its current authoritative location; other services redistribute
verifiable copies, and migration changes the authoritative PDS rather than
creating simultaneous write homes. Good precedent for stable identity plus movable
singular authority, but its repositories are public, which does not solve llame's
private and differently governed data.

Sources:

- [AT Protocol repository specification](https://atproto.com/specs/repository)
- [AT Protocol account hosting and migration](https://atproto.com/specs/account)
- [AT Protocol synchronization](https://atproto.com/specs/sync)

### 4.2 Matrix: room-scoped, ownerless federation

Matrix replicates a room's event graph to every participating homeserver; no
single server owns the room, and signed events, authorization rules, and state
resolution let replicas converge after partitions. That buys multi-server
continuity, but Matrix deliberately prefers availability and partition tolerance
over consistency, and the resulting room versions, event authorization, state
resolution, partial-state joins, history rules, and abuse controls are a warning
about the true cost of ownerless shared state.

Sources:

- [Matrix architecture](https://spec.matrix.org/latest/#architecture)
- [Matrix rooms and local copies](https://www.matrix.org/docs/matrix-concepts/rooms_and_events/)
- [Matrix server-server API](https://spec.matrix.org/latest/server-server-api/)

### 4.3 Solid: one client, resources across many storage authorities

Solid separates applications from storage: a client reaches resources across
multiple pods while each resource server applies its own access-control policy.
That resembles the desired aggregated experience more closely than a universal
mirror does, and it does not define llame's shared history, offline conflict
semantics, or execution policy.

Source: [Solid Protocol](https://solidproject.org/TR/protocol)

### 4.4 ActivityPub: delivery federation is not authorization federation

ActivityPub separates client-server publication from server-server delivery and
gives actors inbox and outbox endpoints, and its standardization explicitly left
authentication and authorization mechanisms largely out of scope. That is
evidence that interoperable delivery alone does not solve private resource
governance.

Source: [W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/)

### 4.5 Zanzibar-style relationship authorization: powerful inside one authority

Zanzibar evaluates access to many resource types with causal consistency under one
uniform relationship model, a good conceptual match for family, team, school, and
work membership graphs _inside_ a governing authority. It does not establish
cross-authority trust or make an offline replica safe after revocation.

Source:
[Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)

### 4.6 Capabilities and UCAN: offline delegation weakens revocation

Capability chains grant narrow, attenuated, offline-verifiable authority without
a central ACL lookup on every action. UCAN's revocation design is explicit about
the tradeoff: partition tolerance means revocation only takes effect once the
revocation message arrives, and short expiry plus narrow scope reduces exposure
without creating immediate revocation while offline.

Source: [UCAN revocation specification](https://ucan.xyz/revocation/)

### 4.7 Local-first CRDTs: convergence is not governance

CRDTs merge concurrent edits and make every replica locally writable, and the
local-first literature itself names robust hierarchical access control a poor
early fit for peer-to-peer replication. A CRDT may help selected document types;
it cannot say who was entitled to create an operation, whether a revoked device
may retain data, or whether work data may enter a family model context.

Sources:

- [Local-first software](https://www.inkandswitch.com/essay/local-first/)
- [PushPin architecture and limits](https://www.inkandswitch.com/pushpin/)

### 4.8 Git: excellent history, unsafe as the whole authorization boundary

Git gives knowledge documents durable history, branchable proposals, review, and
merge, so it stays a candidate content substrate. Its own documentation warns
that ref namespaces do not protect private objects from a malicious peer; private
authorities need repository-level isolation and an authorization layer outside
Git.

Source: [Git namespaces security notes](https://git-scm.com/docs/gitnamespaces.html)

### 4.9 OAuth and OpenID: useful connection mechanics, not a data model

OAuth already has primitives for issuer identification, audience-restricted
tokens, target-resource indicators, and exchanging a user's token for a narrower
delegated token, and OpenID Federation can establish multilateral trust chains
between entities. That solves dynamic trust metadata, not resource ownership or
sync, so both are candidates for later connection and delegation mechanics and a
custom identity protocol is not justified now.

Sources:

- [OAuth authorization-server issuer identification](https://www.rfc-editor.org/rfc/rfc9207.html)
- [OAuth resource indicators](https://www.rfc-editor.org/rfc/rfc8707.html)
- [OAuth token exchange](https://www.rfc-editor.org/rfc/rfc8693.html)
- [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html)

### 4.10 Nostr and Buzz: portable signatures around relay-governed state

Nostr gives every actor a keypair and represents activity as content-addressed,
signed events distributed through one or more relays, which makes identity and
authorship portable across clients and transports. It does not make every relay
authoritative for every event, prove a relay returned a complete or current
history, define application authorization, or guarantee deletion. NIP-42 proves
control of a key to a relay while the relay still applies its own access policy,
and NIP-09 is explicitly a deletion _request_ that cannot guarantee removal from
all relays and clients. Buzz is directly relevant, but its lesson is subtler than
"use Nostr": it uses NIP-01 as its wire envelope while declaring `buzz-relay` the
single source of truth, derives the community/tenant boundary from the request
host, stores membership at the relay, and applies relay-side authorization, which
its own project vision calls a centralized deployment over a decentralized
protocol.

NIP-29 groups are close to the proposed shared-Space model: a primary relay
enforces membership and moderation, a secondary relay may preserve history, an
unavailable primary can be replaced through explicit migration, and a group may
fork into different governance while retaining the same group:id. llame should
keep the migration and fork lineage idea but avoid that identity ambiguity by
qualifying every resource id with its governing authority. Buzz's proposed NIP-OA
separates an agent's signing key from its owner's key and attaches a verifiable
"authorized by" provenance tag without pretending the owner authored the event,
which maps well to llame Runs and executors, but its agent-set timestamp can be
backdated, so it is not a sufficient permission or revocation mechanism.

Two later Buzz specifications add safety boundaries without making Buzz a
replication architecture for llame. NIP-RS makes a full-state load terminate as
either _complete_ or _cannot prove complete_; incomplete state may still merge
monotonic additions but cannot authorize canonicalization, coordinate deletion,
compact deletion records, purge physically, or make a successful destructive
claim, and the algorithm is specialized to read-state registers and relay
behavior, so llame should borrow the completeness boundary rather than copy the
protocol. Buzz's Git-on-object-storage design makes immutable content-addressed
objects visible through one authoritative manifest pointer advanced by
compare-and-swap, with relay events as derived notifications rather than the
commit point; llame does not need that storage layout, but should keep the generic
rule that accepted state moves only through an authority-side update fenced to
the exact state used to validate the candidate. A single global Nostr pubkey per
person across family, school, and work would also create unwanted cross-domain
correlation and difficult key recovery, so portable signing identities are
valuable while automatic global person linkage is not.

Sources:

- [Nostr NIP-01 signed-event and relay protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [Nostr NIP-29 relay-based groups](https://github.com/nostr-protocol/nips/blob/master/29.md)
- [Nostr NIP-42 relay authentication](https://github.com/nostr-protocol/nips/blob/master/42.md)
- [Nostr NIP-09 deletion requests](https://github.com/nostr-protocol/nips/blob/master/09.md)
- [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md)
- [Buzz Nostr integration and relay membership](https://github.com/block/buzz/blob/main/NOSTR.md)
- [Buzz NIP-OA owner-agent provenance](https://github.com/block/buzz/blob/main/docs/nips/NIP-OA.md)
- [Buzz NIP-RS completeness boundary](https://github.com/block/buzz/blob/aeb741fd31044ec560d953b0986dec2e7e93e2c6/docs/nips/NIP-RS.md)
- [Buzz Git refs over object storage](https://github.com/block/buzz/blob/aeb741fd31044ec560d953b0986dec2e7e93e2c6/docs/git-on-object-storage.md)

## 5. Materially different product models

### Model A — Omit federation; import and export only

Each installation is a closed world: users copy files, import bundles, or add a
public Git repository as an external source. **Strengths:** smallest security
surface, no remote authorization or distributed failure semantics. **Failure:**
no coherent family/work/school experience, every update manual. Preserves
optionality but misses the stated north star.

### Model B — One universal llame account and service

All people and organizations live in one multi-tenant hub, existing organization
memberships govern shared resources, and personal nodes mirror only that account.
**Strengths:** current auth, RLS, and organization model stay authoritative, and
revocation and writes are straightforward. **Failure:** incompatible with
independent work, school, family, and self-hosted installations, and it makes
llame's operator the mandatory global trust root.

### Model C — Home hub imports replicas from every upstream

One home hub links to work, family, and school services, copies allowed data into
the home account, and serves a unified API to surfaces. **Strengths:** simple
clients, centralized search and context building, one place to reconnect.
**Failure:** the home becomes an uncontrolled exfiltration point, work and school
revocation cannot claw back copied plaintext, and source ACL changes race cached
authorization. A compulsory home-side copy is unacceptable.

### Model D — Multi-account client, like an email client

Every surface authenticates to several installations and presents their resources
together; servers never federate or copy data. **Strengths:** foreign authority
stays intact, no server-to-server protocol, good first implementation boundary.
**Failure:** every surface must implement connections, offline behavior is weak,
and a Run transferred to another executor lacks the user's foreign credentials.
The UX is aggregated, execution continuity is not.

### Model E — Home gateway without mandatory replication

The home node or hub proxies operations over scoped connections, caching only
when foreign policy allows it, and executors receive a mediated operation or
short-lived delegated token rather than the long-lived foreign credential.
**Strengths:** coherent surfaces and Runs, singular foreign authority, optional
cache, fits standard OAuth delegation. **Failure:** a high-value credential broker
and an online dependency for uncached domains, and foreign authorities must
explicitly accept it as a client.

### Model F — Space-centric authority with mounted resources

Each shared Knowledge Space has exactly one governing authority that owns
membership, accepted revisions, retention, replication permission, and egress
policy, a personal profile mounts Spaces from many authorities, and a mount stays
a view and access path rather than a transfer of ownership. **Strengths:** maps
policy to the unit users actually share, so work can be online-only while family
permits offline replicas, with no identity or ACL merge. **Failure:** cross-Space
queries and writes become explicitly distributed, provenance must be tracked, and
no atomic transaction across authorities can be promised.

### Model G — Git remotes are the federation protocol

Every Knowledge Space is a Git repository, membership maps to fetch/push rights,
offline writes become branches, and reconciliation becomes merge or a
provider-native proposal such as a pull or merge request. **Strengths:**
human-auditable, excellent for Markdown, matches the intended knowledge review
model, public Git-backed KBs are natural. **Failure:** Git models neither Chat
history, operational state, fine-grained authorization, revocation, secrets,
inference policy, safe multi-tenant object isolation, nor forge review semantics.
It is a substrate for some Spaces, not the federation architecture or the
complete publication workflow.

### Model H — AT-Protocol-style signed repositories

A content-addressed signed repository with one current host per person or Space
(4.1); relays and nodes mirror verifiable records, and authority migrates by
updating a stable identity document. **Strengths:** portable authority, verifiable
replication, efficient catch-up, no trust in an intermediary's content integrity.
**Failure:** private-data key distribution, selective disclosure, shared writers,
deletion, and authorization remain unsolved, which makes building this before the
resource schema stabilizes unjustified protocol invention.

### Model I — Matrix-style ownerless Space federation

Every participating hub holds a writable copy of a shared Space; signed event
DAGs, authorization events, and deterministic state resolution converge after
partitions (4.2). **Strengths:** no hosting authority can unilaterally take a
family Space offline and all participants continue through partitions.
**Failure:** by far the largest protocol and security burden, with membership and
ACL conflicts as consensus-like state-resolution problems, hostility to work
revocation and data-residency expectations, and an ideological decentralization
goal the current use cases do not establish.

### Model J — Peer-to-peer CRDT mesh

People and devices synchronize shared data directly, servers are optional relays,
and all authorized replicas accept local writes and later converge (4.7).
**Strengths:** strongest offline collaboration and user possession. **Failure:**
immediate revocation is impossible, authorization epochs and key rotation become
central anyway, and agent operations lack meaningful automatic merge semantics.
Appropriate for narrow personal document types, not the global control plane.

### Model K — Capability-only mesh

Signed delegable capabilities replace accounts and server-side membership graphs,
and a person carries grants from family, work, and school to present wherever
execution occurs (4.6). **Strengths:** portable least authority, natural executor
delegation, no global user identity needed. **Failure:** discovery, recovery,
audit, grant administration, and revocation UX are much harder, and offline
validity and immediate revocation are mutually in tension. Capabilities are
execution credentials, not a sufficient product model.

### Model L — Solid-like resource web

Every resource has an HTTP identity and a policy at its storage authority, and
llame is a client that follows links and operates directly across resource
servers (4.3). **Strengths:** maximum storage independence, no data centralized in
the home account. **Failure:** weak offline and full-text aggregation without
caching, chat/run semantics and agent delegation stay llame-specific, and
interoperability is paid for before another implementation exists.

### Model M — Nostr event fabric with Buzz-style communities

Humans, agents, and perhaps nodes have signing keys, every action is a signed
event, and a surface connects to several community relays that authenticate
pubkeys, authorize their own community, store accepted events, and expose standard
event kinds to other clients (4.10). **Strengths:** multi-link presentation is
native, event ids, authorship, and agent provenance survive transport, and
disconnected clients can create signed candidate events. **Failure:** relay sets
do not create a coherent private mirror, signed events do not prove current
authorization or completeness, deletion is best-effort, mutable application state
still needs relay-defined ordering, and root-key recovery plus cross-domain
correlation suit families, children, and managed work identities poorly. The
useful pieces are an event envelope and provenance model, not adoption as llame's
database.

## 6. Evaluation

| Model                      | Use-case fit            | Offline          | Revocation                      | Isolation                   | Complexity  | Verdict                    |
| -------------------------- | ----------------------- | ---------------- | ------------------------------- | --------------------------- | ----------- | -------------------------- |
| A. Import/export           | Low                     | High after copy  | High at source, none for copies | High                        | Low         | Deliberate fallback only   |
| B. Universal hub           | Medium                  | Medium           | High                            | High                        | Medium      | Reject as product topology |
| C. Copy-everything home    | High UX, low policy fit | High             | Low                             | Low                         | Medium      | Reject                     |
| D. Multi-account client    | High for reads          | Low              | High                            | High                        | Medium      | Useful first slice         |
| E. Mediating home gateway  | High                    | Policy-dependent | High online                     | Medium-high                 | Medium-high | Useful mechanism           |
| F. Space-centric authority | High                    | Policy-dependent | High online                     | High                        | Medium      | Best domain model          |
| G. Git remotes             | High for KB only        | High             | Medium                          | Repository-dependent        | Low-medium  | KB substrate only          |
| H. Signed repositories     | Medium-high             | High             | Medium                          | Undesigned for private data | High        | Possible later transport   |
| I. Ownerless event DAG     | High                    | High             | Low-medium                      | Complex                     | Extreme     | Omit                       |
| J. CRDT mesh               | Medium                  | Very high        | Low                             | Medium                      | High        | Narrow data-type option    |
| K. Capability mesh         | Medium-high             | High             | Low-medium                      | High if correct             | Very high   | Later credential mechanism |
| L. Resource web            | Medium-high             | Low-medium       | High online                     | High                        | High        | Architectural reference    |
| M. Nostr/Buzz event fabric | High presentation fit   | Medium-high      | Low-medium                      | Relay-dependent             | High        | Selective patterns only    |

No single model wins because the resource classes have incompatible governance:
personal data benefits from trusted multi-writer mirroring, work and school data
often require singular authority and restricted caching, family knowledge may
deliberately trade immediate revocation for offline availability, and a public Git
source needs neither account federation nor private replication.

## 7. Selected synthesis: one Personal Realm, many replicas and authority connections

The strongest bounded design combines D, E, F, and G without pretending they are
one replication protocol. This section holds the full statement of each decision;
sections 10 and 11 are checklists of it.

### 7.1 The Personal Realm is singular; its physical homes are not

A local profile has exactly one **Personal Realm** as an ownership and
reconciliation boundary, with no inherently primary physical node: CLI, Android,
desktop, other trusted personal nodes, and an optionally linked hub account can
all hold replicas and originate changes under the previously agreed full-mirror
relationship. The linked hub is one rendezvous and coordination peer, not the
Realm's canonical home; authority is held by the trusted replica set and
reconciled using stable lineage. Adding a work or family connection neither
enrolls that authority as a personal replica nor copies personal Chats, memory,
settings, or credentials into that installation.

### 7.2 Foreign accounts are connections, not merged identities

The profile may have zero or more **Authority Connections**. A connection states:

> On authority `A`, this local profile authenticated as foreign subject `S`.

It does not assert a globally trusted `samePerson` relationship. The binding is
local to the profile or its Personal Realm, and each foreign authority keeps
authorizing its own subject through its own membership graph, which preserves the
one-linked-hub-account rule while supporting many work, family, school, or
community authorities and many personal-device replicas.

### 7.3 Every shared resource has one governing authority

A durable resource identity is at least the pair:

```text
(authority identity, authority-local resource id)
```

The exact URI and cryptographic discovery scheme should remain undecided. The
semantic invariant matters first: resource IDs never become globally meaningful
without their authority, and moving authority is an explicit migration, not an
accidental consequence of copying data. The governing authority decides membership
and roles, accepted write ordering and authoritative revision, whether replicas or
caches are allowed, retention and deletion policy, permitted execution locations
and inference egress, whether offline candidate writes are allowed, and whether
content may be exported into another authority.

### 7.4 Mounted Spaces provide the unified experience

An authority connection exposes one or more resources that the user may **mount**
into their llame view. A mount contributes discoverability and an access route; it
does not change resource ownership.

```text
Leo's local profile
├── Personal Realm (full mirror across trusted personal replicas)
├── Work / Engineering KB (online-only mount; work authority)
├── Family KB (offline replica allowed; family authority)
└── llame public KB (read-only Git subscription; public source)
```

Leo's wife and children build different views over the same family authority
while their personal realms stay private and unrelated. A child's family
membership must never imply parental access to the child's personal Chats or
memory; guardianship, if ever needed, is a separate policy capability.

### 7.5 Replication is an authority policy, not an account property

A mount should eventually declare one of a small number of modes:

| Mode              | Local retention                                    | Offline reads      | Offline writes                   |
| ----------------- | -------------------------------------------------- | ------------------ | -------------------------------- |
| `online-only`     | Metadata and transient response only               | No                 | No                               |
| `cache`           | Bounded, revocable-on-reconnect cache              | Until lease expiry | No                               |
| `offline-read`    | Encrypted or policy-managed replica                | Yes                | No                               |
| `offline-propose` | Replica plus tentative operation log or Git branch | Yes                | Proposals only                   |
| `full-replica`    | Complete accepted history                          | Yes                | Yes, with defined reconciliation |

Names are illustrative, and `full-replica` should initially be limited to the
Personal Realm; shared Spaces need an explicit reason and conflict model before
gaining it. No software can guarantee revocation of plaintext already copied to a
machine controlled by a former member. The enforceable contract is narrower: stop
future access, expire locally enforceable leases, destroy llame-managed encryption
keys or caches where possible, and never claim that remote erasure is
cryptographically proven. Authorities that cannot tolerate this must choose
`online-only`.

### 7.6 Writes remain singular even when reads are distributed

For a foreign Space, a connected replica does not directly advance authoritative
state. It submits an online mutation validated and serialized by the governing
authority, a signed tentative operation the authority may accept or reject, or,
for Git-backed knowledge, a branch or patch published through that Space's
configured direct-Git or forge review workflow. That avoids multi-master ACL and
revision state, and "offline writable" means "allowed to produce candidates while
offline," not "entitled to commit state the authority must later accept." The
Personal Realm remains the exception: trusted personal replicas reconcile as peers
under the already chosen fork-and-lineage semantics.

### 7.7 Credentials stay at a broker boundary

A foreign refresh credential stays with the node or hub holding the Authority
Connection. A transferred executor receives either proxied operations through
that broker or a short-lived, audience-bound, resource- and action-scoped
delegated token, never the durable foreign credential. Delegation must identify
both the user and acting executor, favoring delegation semantics over invisible
impersonation so audit records preserve who actually acted.

### 7.8 Context is a labeled union, not a blended database

Every retrieved item entering model context needs provenance at least equivalent
to:

```text
authority + resource + revision + subject/grant + permitted sinks + freshness
```

When a Run combines several domains, the permitted action is the intersection of
their information-flow policies: if work data forbids upstream-model egress,
adding a public KB does not relax that restriction. If a requested write would
carry work information into the family Space, it is a cross-authority export
requiring a separate authorized operation, not an ordinary save. Cross-authority
operations cannot promise a single atomic commit, so the Run must record
per-authority outcomes and surface partial completion.

### 7.9 Public Git knowledge is a source, not an account

A public llame KB should be mountable without an identity link: fetch a pinned
revision with provenance, update explicitly or under a declared subscription
policy, treat upstream as read-only, create a distinct personal or shared fork for
local changes, and contribute back through the upstream's configured patch,
pull-request, or merge-request workflow. Copying or absorbing it creates new
content under a different authority and must preserve source provenance; it does
not mutate the public source.

### 7.10 Git history and publication workflows are separate layers

Every Git-backed Knowledge Space has a Git-compatible accepted history. A Run
starts from an exact accepted commit and authors candidate commits in an isolated
branch/worktree or jj workspace, and cross-node and cross-provider interchange uses
Git-compatible commits and refs even when jj supplies the local authoring UX.
Publishing those commits composes two responsibilities:

1. repository operations and transport: commit, branch, fetch, and push; and
2. a provider-aware change-workflow adapter that submits, observes, updates,
   withdraws, or accepts a candidate when policy and permission allow.

Initial modes include local-only history, raw Git direct updates, raw Git branch
proposals, GitHub pull requests, GitLab merge requests, and Forgejo pull requests.
A pull or merge request is not an alternative to Git transport; it layers review,
checks, policy, and acceptance over Git objects and refs. Adapters normalize a
durable proposal lifecycle while reporting provider capabilities and retaining
provider-specific metadata, and they must not flatten different review
requirements, protected-ref rules, CI, merge queues, or acceptance permissions
into false equivalence. The governing authority decides which revision becomes
accepted.

#### Completeness, head relation, and candidate fallback

Git ancestry and replica completeness answer different questions:

| Axis                     | States                                                  | Question answered                                                  |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Replica coverage         | verified complete, partial, or unknown                  | Has all authority state required for this operation been observed? |
| Subject-to-accepted head | current, fast-forwardable, behind, diverged, or unknown | How does a named local or candidate revision relate to that head?  |

For the second axis, `current` means the subject OID equals the observed accepted
head; `fast-forwardable` means the accepted head is an ancestor of the subject;
`behind` means the subject is an ancestor of the accepted head; `diverged` means
neither is an ancestor of the other; and `unknown` means the required head or
object graph was not established. A client that has not fetched the current
authority head can observe no local conflict while still having unknown coverage
and an unknown head relation, and stable UUIDs avoid identity collisions without
proving that no event, deletion record, ref movement, or concurrent candidate is
missing.

An incomplete replica may author commits from an exact accepted base and publish
them as a branch or provider proposal when policy permits, which is safe because
it preserves work without claiming canonical state. Direct accepted-ref mutation,
deletion inferred from absence, pruning, deletion-record compaction, physical
purge, canonical replacement, and completed-reconciliation claims remain blocked
until the actor has a current, fenced authority view. That does not block the
governing authority from evaluating the preserved candidate from a fresh
authoritative observation, nor a separately authorized explicit resource deletion
that records a new authoritative deletion.

The governing authority performs acceptance from a fresh authoritative
observation: it revalidates permission and policy, checks the candidate's exact
base OID and history against the current accepted head, and advances the accepted
ref only through an expected-old-ref compare-and-swap or equivalent
protected-ref fence. A lost race or stale/diverged base preserves the candidate
for explicit fast-forward, merge, rebase, fork, review, rejection, or user
reconciliation. For Personal Knowledge Spaces the governing authority is the
Personal Realm rather than a permanent canonical node; which enrolled replica or
configured remote may act for its current accepted ref, and how it proves that
view current, remains an operational-replication decision. Accordingly, `pull`
decomposes into fetch, coverage establishment, head-relation classification, and a
selected reconciliation action, and when authority access is unavailable the
honest fallback is to retain the base-anchored candidate, queue or publish it as
tentative when allowed, and retry validation later rather than infer convergence
from silence.

### 7.11 Personal episodic history synchronizes outside Git

Chats, branches, Runs, messages, lineage, durable approval and audit records,
compaction checkpoints, context receipts, and deletion records remain
database-native episodic state. The hub keeps its multi-tenant Postgres and RLS
boundary, and a personal node uses an embedded transactional store with the exact
engine still open and SQLite the leading candidate. Personal replicas exchange
that state automatically through a portable llame application protocol, not Git,
PostgreSQL replication, or user-managed export.

Stable IDs and causal anchors make changes idempotent and let concurrent
continuations become explicit forks. Each local mutation atomically commits
canonical domain state and an immutable semantic `ChangeBatch`; receivers
authenticate, validate, apply, and retain that original batch idempotently. A
replication journal supports incremental replay and forwarding, while per-link
outboxes, acknowledgements, retries, cursors, and deduplication remain local
delivery state.

One reconciliation function covers a replica's first contact and every later
synchronization. It negotiates supported scope and known frontiers, then uses a
snapshot, change batches, or both under identical validation, authorization,
conflict, idempotency, and coverage rules, and a new replica merely has no
accepted frontier. A snapshot at frontier `F` compactly represents the same state
produced by the journal through `F`, and any replica whose retained journal gap
cannot be filled may use that path. That rejects row/WAL replication without
making every internal table event-sourced, and the existing `run_events` table is
neither the replication journal nor a cross-node cursor.

Generated summaries remain derived episodic artifacts. Compaction checkpoints
synchronize because they affect later model context. A fork summary may be
regenerated until used, but its exact injected form is then preserved in the
consuming Run's context receipt. UI summaries remain rebuildable projections, and
only explicit promotion turns Chat-derived material into Git-backed knowledge.

### 7.12 Active execution control is routed, not multi-writer replicated

Chat history, execution placement, and one Run have different lifetimes. A
durable placement/session binds one active Chat branch to its preferred executor,
sandbox, optional Workspace, recovery policy, and current authority epoch across
multiple Runs, and different branches may use different placements.

The current executor remains the only authority allowed to advance active
execution. Local and hosted nodes share one modular Node Protocol contract rather
than one implementation stack: its mandatory `core.*` module negotiates identity,
versions, roles, and capabilities, and separately versioned and authorized
`realm.*`, `execution.*`, `sync.*`, and `admin.*` modules respectively expose
durable domain operations, live execution, replica synchronization, and privileged
node management. Nodes advertise only the modules and capabilities they implement,
ordinary tunnels do not expose `admin.*` by default, and model-facing tools remain
a separate harness contract rather than generic protocol access. A local surface
calls `execution.*` directly and a remote surface reaches the same module through
an authenticated reverse tunnel, and the tunnel service supplies rendezvous,
presence, routing, authorization, and connection fencing without becoming a Run
state mirror or command authority.

The executor returns a complete current semantic snapshot and a revision, streams
later deltas, and accepts idempotent epoch-targeted commands such as cancellation,
an exact permission decision, a follow-up, or `ExitWorkspace`. Reconnection reads
a fresh snapshot before resubscribing, repairing delta gaps without a hub-owned
event journal. Raw queue jobs, leases, process handles, provider credentials,
abort handles, heartbeat rows, and active tool state remain local to the executor.

The initial tunnel does not accept commands while the executor is unreachable.
Surfaces may retain unsent local drafts, but commands are neither accepted nor
remotely pending until the authoritative API acknowledges them, and delayed
offline delivery would require an explicit later outbox protocol. Uncertain
external side effects remain `outcome_unknown`. Durable state replication, live
session control, and authority handoff remain separate protocols, and observing
or synchronizing a Run record never authorizes a replica to enqueue or re-execute
it.

### 7.13 Active Run durability uses semantic checkpoints, not event mirroring

Three alternatives were considered:

1. **Terminal-only publication:** keep all intermediate state at the executor and
   publish only the final message and Run result. Operationally simple, but it
   loses too much truth when a long-running executor disappears after presenting
   output, receiving approval, or attempting a side effect.
2. **Portable live event sourcing:** replicate every model delta, tool-progress
   event, and stream chunk. Maximizes replay but recreates a central Run mirror,
   couples federation to provider and worker event shapes, raises sync and
   retention cost, and risks treating hidden reasoning as portable product state.
3. **Semantic checkpoints with local recovery:** keep the high-frequency recovery
   journal at the executor while synchronizing normalized facts at externally
   meaningful boundaries. This is the selected direction.

The resulting model has three layers: a live `execution.*` snapshot and delta
stream, an executor-local durable recovery journal, and portable Realm semantic
checkpoints carried by the application synchronization protocol. Product-visible
output is journaled locally before delivery, but remote replication is not a
precondition for offline operation. The journal may use a native Claude Code or
Codex session representation or llame's existing `run_events`, and none of those
raw formats becomes a Node Protocol or federation schema.

Portable facts include Run acceptance and lineage, placement authority epochs,
permission requests and decisions, write-capable tool intent before dispatch,
normalized tool outcome before model continuation, completed assistant semantic
blocks, context and compaction checkpoints, handoff or segment boundaries, and
terminal settlement. Raw tokens, reasoning deltas, stdout chunks, transient
progress, process state, queue leases, and provider internals remain local. That
split preserves useful recovery without claiming more durability than eventual
Personal Realm replication provides: a same-node restart may recover from the
local journal, while a permanently lost node leaves other replicas at their
latest synchronized semantic checkpoint, later side effects become
`outcome_unknown`, and incomplete unsynchronized output is lost or explicitly
unconfirmed. The system does not manufacture completion from a disappeared
executor.

### 7.14 Authorship starts simple but remains capability-scoped

The first delivery need not implement the complete multi-replica authorship
matrix. It may use one Personal Realm mutation authority or defer concurrent
writable mirrors. That is a product-stage simplification, not evidence that one
physical node is the permanent personal home.

The north-star rule is that replica retention and record authorship are separate
capabilities. An enrolled replica may eventually author additive personal history
offline, while Run checkpoints remain attributable only to the current fenced
executor, sensitive personal control records receive separate rules, and foreign
resource mutations remain governed by their own authority. A replica may forward
any valid portable record without becoming its author. This rejects both premature
generic capability infrastructure and an equally premature equal-writer
assumption, and stable identities, causal parents, origin provenance, and executor
epochs are retained from the simple model so the later capability-scoped design
does not require rewriting accepted history. The exact first-delivery linked
writer policy remains intentionally unresolved.

### 7.15 Execution handoff starts with hub-backed fencing

The first cross-node handoff design uses the linked hub as a per-placement
fencing authority. A target prepares without executing; the source freezes new
dispatch and commits a checkpoint plus handoff barrier; the hub atomically
compares and advances the source node and epoch to the target; only then may the
target begin a new execution segment. That compare-and-swap, rather than a
distributed transaction or message-delivery assumption, is the authority commit
point.

A forced fallback may advance the same register from the last portable checkpoint
when the recovery policy permits it, and work or side effects after that
checkpoint remain `outcome_unknown`. Without a reachable fencing authority the
system may wait, exit, or create a visible fork, but it cannot claim same-branch
continuation. The north star keeps the singular fenced placement register while
removing the linked hub as a permanent topology requirement: direct source-sealed
handoff, peer-hosted fencing, coordinator migration, and automated lease or
failure detection are later follow-ups that must preserve the same epoch,
checkpoint, barrier, and uncertain-outcome semantics rather than create a second
execution authority model.

### 7.16 Enrollment starts with disposable node identity

The first linked-node lifecycle uses a locally generated keypair and `node_id`.
OAuth or device linking authorizes the hub to enroll the public identity for one
account, after which narrow renewable credentials remain bound to proof of that
node key. Unlink or remote revocation permanently invalidates the enrollment. The
same local profile may link again, but it generates a new keypair and `node_id`,
and the revoked identity remains historical provenance that is never resurrected.
The initial design does not export private keys, recover an old node identity, or
rotate its key while preserving that identity.

Revocation stops future hub-mediated synchronization, tunnels, inference
brokering, and Run routing. It cannot erase retained local data, disable
standalone offline use, or prove physical key destruction. Identity-preserving
rotation, hardware-backed keys, encrypted recovery, multi-peer revocation
propagation, hub-loss re-homing, and offline-authorship cutoffs are explicit
north-star follow-ups rather than hidden requirements of the first enrollment
flow.

### 7.17 First delivery synchronizes the resumable episodic core

The first linked node-to-hub synchronization capability carries only the
normalized personal state required to render, audit, fork, and safely resume a
Chat: Chats, branches, messages and parts, lineage, Runs and execution-segment
metadata, portable semantic and compaction checkpoints, context receipts,
Run-scoped one-time approvals, normalized tool and side-effect receipts, and the
artifact metadata needed to interpret those records. A context receipt also
preserves the frozen Run-effective Agent Profile and instructions or their exact
revision, which does not make the mutable profile itself part of v1 sync.

Mutable Agent Profile heads and edit history, general settings, persistent
permission policies, and deletion semantics wait for their own authorship,
conflict, retention, and authorization contracts. Knowledge Space content uses
Git publication adapters, and artifact payload transfer is a separate
policy-controlled protocol. Secrets, node-local provider and Sandbox
configuration, Workspace paths or registry state, raw execution events and
deltas, queue or process mechanics, and rebuildable projections never enter the
generic Personal Realm journal. That scope restriction is a delivery boundary,
not different bootstrap semantics: a new replica and an existing replica
reconcile the same supported record classes through the same function.

### 7.18 First delivery uses sender backfill for causal ordering

The first node-to-hub contract requires senders to retain unacknowledged
`ChangeBatch` records and send them in causal order. A receiver applies a
complete batch atomically or not at all. If otherwise-authorized dependencies
are absent, it returns their identities without accepting or partially applying
the batch; the sender backfills them and retries. When incremental history is
unavailable, the same reconciliation function may use a consistent snapshot at a
proven frontier. The same batch identity and payload is idempotent, while the
same identity with a different payload is an integrity failure. Missing
dependencies are temporarily inapplicable and unauthorized dependencies are
rejected, and valid sibling continuations remain explicit forks rather than
last-write-wins conflicts, with lineage independent of delivery order.

The receiver does not need a durable out-of-order quarantine in the first
topology. That becomes a north-star follow-up only when multi-peer or multi-hop
delivery makes the original sender unavailable often enough to justify its
retention, revalidation, migration, and resource-exhaustion complexity.

## 8. Scenario stress test

### 8.1 Leo uses work and public llame knowledge together

The Run mounts both sources and work remains the stricter domain. If work forbids
external inference, the Run must use an allowed work executor/model or exclude
work material, and the public source cannot launder restricted context into a less
trusted sink.

### 8.2 Leo edits family knowledge while offline

If the family authority grants `offline-propose`, Leo's personal node records a
candidate commit or operation with the family Space's identity and base revision.
On reconnect the configured publication adapter maps a Git candidate onto the
family Space's raw Git, GitHub, GitLab, Forgejo, or later provider workflow, and
the family authority revalidates current membership and policy, compares that base
to its current accepted head, and fences any accepted-ref update to the head it
observed, leaving a stale or divergent candidate available for merge, rebase,
review, or rejection. The local edit is never silently represented as already
accepted family state merely because no conflict was visible while offline.

### 8.3 Leo's wife sees family and her work

Her profile has its own Personal Realm, a connection to her work authority, and a
separate connection to the family authority. The shared family resource has the
same `(authority, resource)` identity in both profiles; their personal data does
not converge merely because both mounted it.

### 8.4 A child uses family and school knowledge

The child is a principal in both authorities. Family membership does not grant
the family authority access to school data, and school membership does not grant
the school access to personal or family history. A cross-domain homework workflow
must declare which source material is copied into which destination, and parent
visibility into school or personal content cannot be inferred from family
ownership.

### 8.5 Work revokes Leo while a node is offline

Online access stops immediately at work. The offline node cannot learn the change
until it reconnects or its authorization lease expires, so work must choose a
maximum offline lease it can tolerate or prohibit replicas. llame must not claim
stronger revocation than the topology can deliver.

### 8.6 Family authority disappears

`online-only` mounts become unavailable and trigger the same model/UI transparency
contract as unavailable tools or Workspaces. Permitted replicas stay readable
according to their lease and policy and do not become the new governing authority
automatically; recovery or migration is a separate action, and any base-anchored
candidate or published proposal remains tentative until that authority or an
explicitly migrated successor validates and fences acceptance.

### 8.7 Leo asks to absorb one Space into another

The agent needs read/export permission on the source and write permission on the
destination, and it creates destination-owned content with source provenance.
Source deletion remains a separate user action, consistent with the earlier
Knowledge Space decision. If the destination authority becomes unavailable
mid-flight, the honest fallback is to preserve the destination candidate or
proposal and surface that absorption is pending rather than completed.

## 9. What to omit unless evidence changes

These would consume disproportionate architecture budget now: arbitrary hub-to-hub
event federation; ownerless or multi-master shared ACL state; a llame-specific
global person identifier or DID method; automatic identity merging across
authorities; mandatory copying of every connected domain into the Personal Realm;
universal CRDT conversion of Chat, knowledge, policy, and operational state;
capability-only administration; cross-authority distributed transactions;
automatic cross-domain information flow; and parent/guardian semantics inferred
from family membership.

The opportunity cost is direct: every month spent on a federation control plane is
a month not spent proving that llame's personal knowledge loop is valuable. The
architecture should leave federation possible without making it a precondition
for the personal product.

## 10. Architecture invariants across delivery stages

The staged delivery decision below remains viable only if earlier stages preserve
these invariants. Each restates a decision stated in full in section 7.

1. Scope durable shared-resource identities by an authority identifier (§7.3).
2. Keep replica enrollment distinct from foreign Authority Connections (§7.1).
3. Keep authorization at the governing authority; caches never mint access.
4. Carry origin, revision, and information-flow labels into Run context (§7.8).
5. Treat offline shared writes as proposals until a conflict model says otherwise
   (§7.6).
6. Model public Git repositories as read-only sources with explicit forks (§7.9).
7. Use standard OAuth/OIDC mechanics before inventing global identity (§4.9).
8. Separate Git transport from provider-aware publication and review (§7.10).
9. Keep Chats database-native, synchronized as portable change batches (§7.11).
10. Track replica coverage independently from revision ancestry (§7.10).
11. Let incomplete replicas publish base-anchored candidates, never mutate
    accepted state or reconcile destructively (§7.10).
12. Fence accepted-state changes to the observation that validated them (§7.10).
13. Replicate episodic mutations as atomic semantic change batches, not rows or
    WAL records (§7.11).
14. Use one modular, capability-negotiated Node Protocol; keep execution
    single-authority behind `execution.*` and raw state executor-local (§7.12).
15. Separate the live stream, local recovery journal, and portable semantic
    checkpoints (§7.13).
16. Scope execution placement to a Chat branch/session, not a Chat-global scalar
    (§7.12).
17. Keep replica retention distinct from record authorship (§7.14).
18. Begin cross-node handoff with a linked-hub compare-and-swap fence (§7.15).
19. Treat enrollment identities as disposable; revocation is permanent and
    relinking creates a new principal (§7.16).
20. Use one reconciliation function; a snapshot is a compact journal prefix, not a
    separate import or overwrite (§7.11, §7.17).
21. Limit first-delivery synchronization to the resumable Chat/Run core (§7.17).
22. Apply a causally complete `ChangeBatch` atomically or not at all, with sender
    backfill (§7.18).

Phase A does not require an immediate schema migration merely to prefix every
existing UUID, but it does require that no contract start treating an
installation's local id as a globally sufficient identity. The federation-facing
identity is the pair `(authority, authority-local id)`, even if Phase A stores
only the local half internally. An imported resource likewise remains an owned
copy with source provenance, never represented as a synchronized mount or as
continued authority over the source. These constraints permit live multi-account
connections and a mediated gateway later without retrofitting distributed
ownership into APIs that assumed one installation owned the world.

## 11. Decision checkpoint

Decision recorded 2026-08-21 after reviewing the alternatives and scenario
stress tests.

### 11.1 Selected product model

llame will target **multi-authority resource federation**, not global identity
federation or ownerless database federation. Each decision below is stated in
full in the referenced section.

- One logical Personal Realm across many trusted personal nodes, none inherently
  the canonical home (§7.1).
- Any number of foreign connections, at most one linked hub account as
  synchronization peer (§7.1, §7.2).
- Foreign subjects stay authority-local, never merged into a person identity
  (§7.2).
- One governing authority per shared Space (§7.3).
- Git-compatible history plus publication adapters for raw Git, GitHub, GitLab,
  and Forgejo (§7.10).
- Coverage stays distinct from head relation; only the authority fences
  acceptance (§7.10).
- Personal Chats stay database-native, synchronized as portable change batches
  (§7.11).
- Three Run durability layers, so cross-node recovery stops at the last
  synchronized checkpoint (§7.13).
- One authorship authority in first delivery, capability-scoped north star
  (§7.14).
- Branch-scoped placements, current executor sole Run authority (§7.12).
- Linked-hub compare-and-swap fence; without it, fallback forks (§7.15).
- Disposable enrollment identity; revocation is permanent, not a remote wipe
  (§7.16).
- One reconciliation function for first and later sessions (§7.11, §7.17).
- First delivery syncs the bounded resumable Chat/Run core only (§7.17).
- Causal batch order, sender backfill, no partial application, fail closed
  (§7.18).
- Foreign resources are mounted, never silently absorbed (§7.4, §7.9).
- Every branch has a destination authority (§7.8).
- Credentials stay at the broker; executors get short-lived delegation (§7.7).

### 11.2 Selected shipping sequence: Phase A → Phase B → Phase C

The phase letters name the simplified delivery sequence agreed in the follow-up
discussion. They are not the same labels as every exploratory Model A–M in
section 5.

#### Phase A — Closed installations with explicit exchange

Ship independently useful standalone and hub installations first: no
cross-authority account connections; explicit import and export; public
Git-backed knowledge as a pinned read-only source with explicit updates, forks,
and contribution through its configured publication adapter; personal full
mirroring only within the Personal Realm when that capability arrives; and
source provenance retained for every copy or absorption. Phase A remains a
supported disconnected mode after later phases ship. It is not a disposable
prototype.

#### Phase B — Live multi-authority connections

Add authority-local account connections and online mounts: standard OAuth/OIDC or
authority-native authentication; live reads and writes evaluated by the governing
authority; merged presentation and retrieval across mounted authorities; no
automatic persistent copy of foreign content; connection metadata may synchronize
while credentials remain at an explicitly enrolled broker; and unavailable
authorities are disclosed to the model and user rather than silently treated as
empty. This phase proves that family, work, school, and community resources can
coexist in one experience without first solving shared offline replication.

#### Phase C — Policy-controlled shared replication

Add replication modes per mounted Space: `online-only` for authorities requiring
strong online revocation; `offline-read` for permitted retained copies;
`offline-propose` for tentative operations or Git branches that the authority
revalidates before acceptance; and `full-replica` initially reserved for Personal
Realm data unless a shared data type receives an explicit reconciliation and
revocation design. Authority migration and forks remain explicit, preserve
lineage, and never occur merely because a replica was reachable when the
governing authority was not.

### 11.3 Rejected or deferred directions

- **Reject:** mandatory full mirroring of every connected upstream into every
  personal replica.
- **Reject:** one universal llame service as the required global identity and data
  authority.
- **Defer:** arbitrary hub-to-hub event federation, Matrix-style ownerless state,
  and peer-to-peer shared ACLs.
- **Use selectively, not wholesale:** Git for knowledge history and interchange;
  raw Git or forge-aware adapters for knowledge publication; application-level
  database synchronization for personal episodic history; Buzz's
  complete-or-cannot-prove-complete boundary and authority-side CAS fencing;
  Nostr/Buzz-style signed events for possible actor/delegation provenance;
  capabilities for narrow executor delegation; and CRDTs only for data types with
  an independently justified merge model.

### 11.4 Why this sequence was selected

Phase A validates the personal and explicit-exchange product without distributed
authorization. Phase B validates multi-authority identity binding, policy, and
connected UX without offline conflict semantics. Phase C adds offline behavior
only after each authority can state what may be retained and how candidate writes
become accepted state. The sequence reduces simultaneous unknowns while
preserving the north star, and its main failure mode is allowing Phase A's
closed-world assumptions to leak into durable identities, import semantics, or
Chat persistence, which is why section 10's invariants are part of the decision
rather than optional cleanup for Phase B.

### 11.5 Vision status and promotion discipline

This federation exploration is closed for product direction. Detailed schemas,
algorithms, and conformance behavior are not prerequisites for that closure and
should not be appended as another research checklist; they belong in a focused
capability artifact when a delivery stage makes them actionable.

Simple-first contracts may omit generality, but they may not erase stable
identity, provenance, authority, fencing, or honest failure semantics required by
the north star. Follow-ups remain research until product evidence promotes them;
they are neither speculative Phase A implementation nor unsequenced roadmap
promises.

Confidence: **high** in the authority model and A → B → C sequence; **moderate**
in signed event envelopes as a later provenance mechanism; **low** that llame
needs Nostr wire compatibility or arbitrary server federation without evidence
from independent deployments.
