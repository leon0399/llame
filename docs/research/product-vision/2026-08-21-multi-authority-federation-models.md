# Multi-Authority Federation Models

Recorded 2026-08-21. Active, noncanonical research adjacent to
[`2026-08-21-local-nodes-workspaces-and-distributed-execution.md`](2026-08-21-local-nodes-workspaces-and-distributed-execution.md).
This note preserves the alternatives, evidence, scenario analysis, and resulting
decision. The adjacent checkpoint carries only the accepted contract and remaining
open questions.

## 1. The actual question

The motivating experience is broader than synchronizing one person's devices:

- Leo should be able to use his personal knowledge together with resources from
  a work installation, a family installation, and a public llame knowledge base.
- Leo's wife should be able to use her own personal and work resources together
  with the same family resources.
- A child should be able to use their own personal resources together with family
  and school resources, without that membership silently exposing their personal
  history to parents, school, or either institution.
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

A single protocol does not need to solve all nine. Trying to do so now would turn
llame into an identity federation, distributed database, authorization system,
and sync platform before its knowledge system exists.

**Initial hypothesis tested below:** the examples require a multi-authority
product model. They do not yet prove a need for arbitrary server-to-server
federation.

## 2. Constraints inherited from the prior discussion

Any viable model must preserve these already recorded boundaries:

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

The current external-identity contract is also narrower than this problem. It
maps a provider subject into one user of one llame installation. It is an ingress
identity primitive, not a grant to resources governed by another installation.
Reusing that table for foreign authority connections would conflate account
deduplication with cross-authority access.

## 3. Authority is per concern, not per machine

"Which node is authoritative?" is too coarse. A useful authority map asks a
different question for each concern:

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

An installation may perform several roles, but the roles must not collapse into
one ambient trust relationship.

## 4. Evidence from existing systems

These systems are reference points, not implementation prescriptions.

### 4.1 AT Protocol: one authoritative host, verifiable redistribution

AT Protocol gives every account a signed, content-addressed repository and names
one Personal Data Server as its current authoritative location. Other services
can redistribute verifiable copies; account migration changes the authoritative
PDS rather than creating simultaneous write homes. This is a strong precedent for
stable identity plus movable singular authority, but its repositories are public,
which does not solve llame's private and differently governed data.

Sources:

- [AT Protocol repository specification](https://atproto.com/specs/repository)
- [AT Protocol account hosting and migration](https://atproto.com/specs/account)
- [AT Protocol synchronization](https://atproto.com/specs/sync)

### 4.2 Matrix: room-scoped, ownerless federation

Matrix replicates a room's event graph to every participating homeserver. No
single server owns the room; signed events, authorization rules, and state
resolution let replicas converge after partitions. This provides powerful
multi-server continuity, but deliberately prefers availability and partition
tolerance over consistency. The resulting room versions, event authorization,
state resolution, partial-state joins, history rules, and abuse controls are a
warning about the true cost of ownerless shared state.

Sources:

- [Matrix architecture](https://spec.matrix.org/latest/#architecture)
- [Matrix rooms and local copies](https://www.matrix.org/docs/matrix-concepts/rooms_and_events/)
- [Matrix server-server API](https://spec.matrix.org/latest/server-server-api/)

### 4.3 Solid: one client, resources across many storage authorities

Solid separates applications from storage. A client can access resources across
multiple pods, while each resource server applies its own access-control policy.
This resembles the desired aggregated experience more closely than a universal
mirror does. It does not by itself define llame's shared history, offline conflict
semantics, or execution policy.

Source: [Solid Protocol](https://solidproject.org/TR/protocol)

### 4.4 ActivityPub: delivery federation is not authorization federation

ActivityPub separates client-server publication from server-server delivery and
gives actors inbox and outbox endpoints. Its standardization explicitly left
authentication and authorization mechanisms largely out of scope. It is useful
evidence that interoperable delivery alone does not solve private resource
governance.

Source: [W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/)

### 4.5 Zanzibar-style relationship authorization: powerful inside one authority

Zanzibar demonstrates a uniform relationship-based model for evaluating access
to many resource types with causal consistency. It is a good conceptual match for
family, team, school, and work membership graphs _inside_ a governing authority.
It does not establish cross-authority trust or make an offline replica safe after
revocation.

Source:
[Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)

### 4.6 Capabilities and UCAN: offline delegation weakens revocation

Capability chains can grant narrow, attenuated, offline-verifiable authority
without consulting a central ACL on every action. UCAN's revocation design is
explicit about the tradeoff: partition tolerance means revocation only becomes
effective after the revocation message arrives. Short expiry and narrow scope
reduce exposure; they do not create immediate revocation while offline.

Source: [UCAN revocation specification](https://ucan.xyz/revocation/)

### 4.7 Local-first CRDTs: convergence is not governance

CRDTs can merge concurrent edits and make every replica locally writable. The
local-first literature itself identifies robust hierarchical access control as a
poor early fit for peer-to-peer replication. A CRDT may help with selected
document types; it cannot answer who was entitled to create an operation, whether
a revoked device may retain data, or whether work data may enter a family model
context.

Sources:

- [Local-first software](https://www.inkandswitch.com/essay/local-first/)
- [PushPin architecture and limits](https://www.inkandswitch.com/pushpin/)

### 4.8 Git: excellent history, unsafe as the whole authorization boundary

Git gives knowledge documents durable history, branchable proposals, review, and
merge. It should remain a candidate content substrate. Its own documentation
warns that ref namespaces do not protect private objects from a malicious peer;
private authorities need repository-level isolation and an authorization layer
outside Git.

Source: [Git namespaces security notes](https://git-scm.com/docs/gitnamespaces.html)

### 4.9 OAuth and OpenID: useful connection mechanics, not a data model

OAuth already has primitives for issuer identification, audience-restricted
tokens, target-resource indicators, and exchanging a user's token for a narrower
delegated token. OpenID Federation can establish multilateral trust chains between
entities, but that solves dynamic trust metadata, not resource ownership or sync.
These standards are candidates for later connection and delegation mechanics; a
custom identity protocol is not justified now.

Sources:

- [OAuth authorization-server issuer identification](https://www.rfc-editor.org/rfc/rfc9207.html)
- [OAuth resource indicators](https://www.rfc-editor.org/rfc/rfc8707.html)
- [OAuth token exchange](https://www.rfc-editor.org/rfc/rfc8693.html)
- [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html)

### 4.10 Nostr and Buzz: portable signatures around relay-governed state

Nostr's base protocol gives every actor a keypair and represents activity as
content-addressed, signed events distributed through one or more relays. This
makes identity and authorship portable across clients and transports. It does not
make every relay authoritative for every event, prove that a relay returned a
complete or current history, define application authorization, or guarantee
deletion. NIP-42 proves control of a key to a relay; the relay still applies its
own access policy. NIP-09 is explicitly a deletion _request_ that cannot guarantee
removal from all relays and clients.

Buzz is directly relevant, but its lesson is subtler than "use Nostr." Buzz uses
NIP-01 as its wire envelope while declaring `buzz-relay` the single source of
truth. It derives the community/tenant boundary from the request host, stores
membership at the relay, and applies relay-side authorization. Its own project
vision calls this a centralized deployment over a decentralized protocol.

NIP-29 groups are close to the proposed shared-Space model: a primary relay
enforces membership and moderation, a secondary relay may preserve history, and
an unavailable primary can be replaced through explicit migration. NIP-29 also
permits a group to fork into different governance while retaining the same group
id. llame should preserve the migration and fork lineage idea but avoid that
identity ambiguity by qualifying every resource id with its governing authority.

Buzz's proposed NIP-OA also separates an agent's signing key from its owner's key
and attaches a verifiable "authorized by" provenance tag without pretending that
the owner authored the event. That distinction maps well to llame Runs and
executors. The current proposal warns that its time condition uses an agent-set
timestamp and can be backdated, so it is not a sufficient permission or
revocation mechanism.

A single global Nostr pubkey for one person across family, school, and work would
also create unwanted cross-domain correlation and difficult key recovery. Portable
signing identities are valuable; automatic global person linkage is not.

Sources:

- [Nostr NIP-01 signed-event and relay protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [Nostr NIP-29 relay-based groups](https://github.com/nostr-protocol/nips/blob/master/29.md)
- [Nostr NIP-42 relay authentication](https://github.com/nostr-protocol/nips/blob/master/42.md)
- [Nostr NIP-09 deletion requests](https://github.com/nostr-protocol/nips/blob/master/09.md)
- [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md)
- [Buzz Nostr integration and relay membership](https://github.com/block/buzz/blob/main/NOSTR.md)
- [Buzz NIP-OA owner-agent provenance](https://github.com/block/buzz/blob/main/docs/nips/NIP-OA.md)

## 5. Materially different product models

### Model A — Omit federation; import and export only

Each installation is a closed world. Users copy files, import bundles, or add a
public Git repository as an external source.

**Strengths:** smallest security surface; no remote authorization or distributed
failure semantics.

**Failure:** does not provide a coherent family/work/school experience and turns
every update into manual duplication. It preserves optionality but does not meet
the stated north star.

### Model B — One universal llame account and service

All people and organizations live in one multi-tenant hub. Existing organization
memberships govern shared resources. Personal nodes mirror only that account.

**Strengths:** current auth, RLS, and organization model remain authoritative;
revocation and writes are straightforward.

**Failure:** incompatible with independent work, school, family, and self-hosted
installations. It makes llame's operator the mandatory global trust root.

### Model C — Home hub imports replicas from every upstream

One home hub is the user's gateway. It links to work, family, and school services,
copies allowed data into the home account, and serves a unified API to surfaces.

**Strengths:** simple clients; centralized search and context building; one place
to reconnect and synchronize.

**Failure:** the home becomes an uncontrolled data exfiltration point, work and
school revocation cannot claw back copied plaintext, and source ACL changes race
cached authorization. A compulsory home-side copy is unacceptable.

### Model D — Multi-account client, like an email client

Every surface independently authenticates to several installations and presents
their resources together. Servers do not federate or copy data.

**Strengths:** foreign authority remains intact; no server-to-server protocol;
good first implementation boundary.

**Failure:** every surface must implement connections, offline behavior is weak,
and a Run transferred to another executor lacks the user's foreign credentials.
The UX is aggregated, but execution continuity is not solved.

### Model E — Home gateway without mandatory replication

The user's home node or hub stores several scoped connections and proxies
operations to foreign authorities. It may cache only when the foreign policy
allows it. Executors receive a mediated operation or short-lived delegated token,
not the long-lived foreign credential.

**Strengths:** coherent surfaces and Runs; singular foreign authority; optional
cache; fits standard OAuth delegation.

**Failure:** the home is a high-value credential broker and an online dependency
for uncached domains. Foreign authorities must explicitly accept it as a client.

### Model F — Space-centric authority with mounted resources

Each shared Knowledge Space has exactly one governing authority. A personal
profile can mount Spaces from many authorities. The authority owns membership,
accepted revisions, retention, replication permission, and egress policy. A mount
is a view and access path, not a transfer of ownership.

**Strengths:** maps policy to the unit users actually share; work can be
online-only while family permits offline replicas; no identity or ACL merge.

**Failure:** cross-Space queries and writes become explicitly distributed. The
system must track provenance and cannot promise an atomic transaction across
authorities.

### Model G — Git remotes are the federation protocol

Every Knowledge Space is a Git repository. Membership maps to fetch/push rights;
offline writes become branches; reconciliation becomes merge or pull request.

**Strengths:** human-auditable; excellent for Markdown; matches the intended
knowledge review model; public Git-backed KBs are natural.

**Failure:** Git does not model Chat history, operational state, fine-grained
authorization, revocation, secrets, inference policy, or safe multi-tenant object
isolation. It is a substrate for some Spaces, not the federation architecture.

### Model H — AT-Protocol-style signed repositories

Give each person or Space a content-addressed signed repository with one current
host. Relays and nodes mirror verifiable records, and authority can migrate by
updating a stable identity document.

**Strengths:** portable authority, verifiable replication, efficient catch-up,
and no trust in an intermediary's content integrity.

**Failure:** private-data key distribution, selective disclosure, shared writers,
deletion, and authorization remain unsolved. Building this before the resource
schema stabilizes is unjustified protocol invention.

### Model I — Matrix-style ownerless Space federation

Every participating hub holds a writable copy of a shared Space. Signed event
DAGs, authorization events, and deterministic state resolution converge after
partitions.

**Strengths:** no hosting authority can unilaterally take a family Space offline;
all participants can continue through partitions.

**Failure:** by far the largest protocol and security burden. Membership and ACL
conflicts become consensus-like state-resolution problems. It is hostile to work
revocation and data-residency expectations. This solves an ideological
decentralization goal not established by the current use cases.

### Model J — Peer-to-peer CRDT mesh

People and devices synchronize shared data directly. Servers are optional relays;
all authorized replicas accept local writes and later converge.

**Strengths:** strongest offline collaboration and user possession.

**Failure:** immediate revocation is impossible, authorization epochs and key
rotation become central anyway, and agent operations do not all have meaningful
automatic merge semantics. Appropriate for narrow personal document types, not
the global control plane.

### Model K — Capability-only mesh

Resources are controlled through signed, delegable capabilities rather than
accounts and server-side membership graphs. A person carries grants from family,
work, and school and presents them wherever execution occurs.

**Strengths:** portable least authority; natural executor delegation; no need for
a global user identity.

**Failure:** discovery, recovery, audit, grant administration, and revocation UX
are substantially harder. Offline validity and immediate revocation are mutually
in tension. Capabilities are useful execution credentials, not a sufficient
product model.

### Model L — Solid-like resource web

Every resource has an HTTP identity and an associated policy at its storage
authority. llame is a client that follows links and operates directly across
resource servers.

**Strengths:** maximum storage independence; avoids centralizing data in the home
account.

**Failure:** weak offline and full-text aggregation without caching; chat/run
semantics and agent delegation remain llame-specific; interoperability is paid
for before another implementation exists.

### Model M — Nostr event fabric with Buzz-style communities

Humans, agents, and perhaps nodes have signing keys. Every action is a signed
event, and a surface connects to several community relays. Each relay authenticates
pubkeys, authorizes its own community, stores accepted events, and can expose
standard event kinds to other clients.

**Strengths:** multi-link presentation is native; event ids, authorship, and agent
provenance survive transport; disconnected clients can create signed candidate
events; public discovery and cross-client interoperability are plausible.

**Failure:** relay sets do not create a coherent private mirror, signed events do
not prove current authorization or completeness, deletion is best-effort, and
mutable application state still needs relay-defined ordering. Root-key recovery
and cross-domain correlation are poor fits for families, children, and managed
work identities. The useful pieces are an event envelope and provenance model,
not wholesale adoption as llame's database.

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

- Personal data benefits from trusted multi-writer mirroring.
- Work and school data often require singular authority and restricted caching.
- Family knowledge may deliberately trade immediate revocation for offline
  availability.
- A public Git source needs neither account federation nor private replication.

## 7. Selected synthesis: one Personal Realm, many replicas and authority connections

The strongest bounded design combines D, E, F, and G without pretending they are
one replication protocol.

### 7.1 The Personal Realm is singular; its physical homes are not

A local profile has exactly one **Personal Realm** as an ownership and
reconciliation boundary. It has no inherently primary physical node. CLI,
Android, desktop, other trusted personal nodes, and an optionally linked hub
account can all hold replicas and originate changes under the previously agreed
full-mirror relationship.

The single linked hub account is one rendezvous and coordination peer, not the
Realm's canonical home. Authority is held by the Personal Realm's trusted replica
set and reconciled using stable lineage. Adding a work or family connection does
not enroll that authority as a personal replica and does not copy personal Chats,
memory, settings, or credentials into that installation.

### 7.2 Foreign accounts are connections, not merged identities

The profile may have zero or more **Authority Connections**. A connection states:

> On authority `A`, this local profile authenticated as foreign subject `S`.

It does not assert a globally trusted `samePerson` relationship. The binding is
local to the profile or its home realm. Each foreign authority continues to
authorize its own subject using its own membership graph.

This preserves the prior one-linked-hub-account rule while supporting many work,
family, school, or community authorities and many personal-device replicas.

### 7.3 Every shared resource has one governing authority

A durable resource identity is at least the pair:

```text
(authority identity, authority-local resource id)
```

The exact URI and cryptographic discovery scheme should remain undecided. The
semantic invariant matters first: resource IDs never become globally meaningful
without their authority, and moving authority is an explicit migration, not an
accidental consequence of copying data.

The governing authority decides:

- membership and roles;
- accepted write ordering and authoritative revision;
- whether replicas or caches are allowed;
- retention and deletion policy;
- permitted execution locations and inference egress;
- whether offline candidate writes are allowed; and
- whether content may be exported into another authority.

### 7.4 Mounted Spaces provide the unified experience

An authority connection exposes one or more resources that the user may **mount**
into their llame view. A mount contributes discoverability and an access route. It
does not change resource ownership.

For example:

```text
Leo's local profile
├── Personal Realm (full mirror across trusted personal replicas)
├── Work / Engineering KB (online-only mount; work authority)
├── Family KB (offline replica allowed; family authority)
└── llame public KB (read-only Git subscription; public source)
```

Leo's wife and children construct different views over the same family authority.
Their personal realms remain private and unrelated. A child's family membership
must never imply parental access to the child's personal Chats or memory;
guardianship, if ever needed, is a separate policy capability.

### 7.5 Replication is an authority policy, not an account property

A mount should eventually declare one of a small number of modes:

| Mode              | Local retention                                    | Offline reads      | Offline writes                   |
| ----------------- | -------------------------------------------------- | ------------------ | -------------------------------- |
| `online-only`     | Metadata and transient response only               | No                 | No                               |
| `cache`           | Bounded, revocable-on-reconnect cache              | Until lease expiry | No                               |
| `offline-read`    | Encrypted or policy-managed replica                | Yes                | No                               |
| `offline-propose` | Replica plus tentative operation log or Git branch | Yes                | Proposals only                   |
| `full-replica`    | Complete accepted history                          | Yes                | Yes, with defined reconciliation |

Names are illustrative. `full-replica` should initially be limited to the Personal
Realm. Shared Spaces need an explicit reason and conflict model before gaining it.

No software can guarantee revocation of plaintext already copied to a machine
controlled by a former member. The enforceable contract is narrower: stop future
access, expire locally enforceable leases, destroy llame-managed encryption keys
or caches where possible, and never claim that remote erasure is cryptographically
proven. Work and school authorities that cannot tolerate this must choose
`online-only`.

### 7.6 Writes remain singular even when reads are distributed

For a foreign Space, a connected replica does not directly advance authoritative
state. It submits one of:

- an online mutation validated and serialized by the governing authority;
- a signed tentative operation that the authority may accept or reject; or
- for Git-backed knowledge, a branch or patch proposed for merge/review.

This avoids multi-master ACL and revision state. "Offline writable" means
"allowed to produce candidates while offline," not "entitled to commit state the
authority must later accept."

The Personal Realm remains the exception: trusted personal replicas may reconcile
as peers under the already chosen fork-and-lineage semantics.

### 7.7 Credentials stay at a broker boundary

A foreign refresh credential should remain with the node or hub holding the
Authority Connection. A transferred executor receives either:

- proxied operations through that broker; or
- a short-lived, audience-bound, resource- and action-scoped delegated token.

It must not receive the durable foreign credential. Delegation must identify both
the user and acting executor, favoring delegation semantics over invisible
impersonation so audit records preserve who actually acted.

### 7.8 Context is a labeled union, not a blended database

Every retrieved item entering model context needs provenance at least equivalent
to:

```text
authority + resource + revision + subject/grant + permitted sinks + freshness
```

When a Run combines several domains, the permitted action is the intersection of
their information-flow policies. If work data forbids upstream-model egress, adding
a public KB does not relax that restriction. If a requested write would carry work
information into the family Space, it is a cross-authority export and requires a
separate authorized operation, not an ordinary save.

Cross-authority operations cannot honestly promise a single atomic commit. The
Run must record per-authority outcomes and surface partial completion.

### 7.9 Public Git knowledge is a source, not an account

A public llame KB should be mountable without an identity link:

- fetch a pinned revision with provenance;
- update explicitly or under a declared subscription policy;
- treat upstream as read-only;
- create a distinct personal or shared fork for local changes; and
- contribute back through the upstream's native patch or pull-request workflow.

Copying or absorbing it creates new content under a different authority and must
preserve source provenance. It does not mutate the public source.

## 8. Scenario stress test

### 8.1 Leo uses work and public llame knowledge together

The Run mounts both sources. Work remains the stricter domain. If work forbids
external inference, the Run must use an allowed work executor/model or exclude
work material. The public source cannot launder the restricted context into a
less trusted sink.

### 8.2 Leo edits family knowledge while offline

If the family authority grants `offline-propose`, Leo's personal node records a
candidate commit or operation with the family Space's identity and base revision.
On reconnect, the family authority revalidates current membership and policy, then
accepts, rejects, or requests reconciliation. The local edit is never silently
represented as already accepted family state.

### 8.3 Leo's wife sees family and her work

Her profile has its own Personal Realm, a connection to her work authority, and a
separate connection to the family authority. The shared family resource has the
same `(authority, resource)` identity in both profiles; their personal data does
not converge merely because both mounted it.

### 8.4 A child uses family and school knowledge

The child is a principal in both authorities. Family membership does not grant the
family authority access to school data, and school membership does not grant the
school access to personal or family history. A cross-domain homework workflow must
declare which source material is copied into which destination. Parent visibility
into school or personal content cannot be inferred from family ownership.

### 8.5 Work revokes Leo while a node is offline

Online access stops immediately at work. The offline node cannot learn the change
until it reconnects or its authorization lease expires. Therefore work must choose
a maximum offline lease it can tolerate or prohibit replicas. llame must not claim
stronger revocation than the topology can deliver.

### 8.6 Family authority disappears

`online-only` mounts become unavailable and trigger the same model/UI transparency
contract as unavailable tools or Workspaces. Permitted replicas remain readable
according to their lease and policy. They do not become the new governing
authority automatically; recovery or migration is a separate action.

### 8.7 Leo asks to absorb one Space into another

The agent needs read/export permission on the source and write permission on the
destination. It creates destination-owned content with source provenance. Source
deletion remains a separate user action, consistent with the earlier Knowledge
Space decision.

## 9. What to omit unless evidence changes

The following would consume disproportionate architecture budget now:

- arbitrary hub-to-hub event federation;
- ownerless or multi-master shared ACL state;
- a llame-specific global person identifier or DID method;
- automatic identity merging across authorities;
- mandatory copying of every connected domain into the Personal Realm;
- universal CRDT conversion of Chat, knowledge, policy, and operational state;
- capability-only administration;
- cross-authority distributed transactions;
- automatic cross-domain information flow; and
- parent/guardian semantics inferred from family membership.

The opportunity cost is direct: every month spent on a federation control plane is
a month not spent proving that llame's personal knowledge loop is valuable. The
architecture should leave federation possible without implementing it as a
precondition for the personal product.

## 10. Architecture invariants across delivery stages

The staged delivery decision below remains viable only if earlier stages preserve
these invariants:

1. Scope durable shared-resource identities by an authority identifier.
2. Keep Personal Realm replica enrollment distinct from foreign Authority
   Connections.
3. Keep authorization at the governing authority; caches never mint access.
4. Carry origin, revision, and information-flow labels through retrieval and Run
   context.
5. Treat offline shared writes as proposals until a specific conflict model says
   otherwise.
6. Model public Git repositories as read-only sources with explicit forks.
7. Use standard OAuth/OIDC connection mechanics before inventing global identity
   or server trust protocols.

Phase A does not require an immediate schema migration merely to prefix every
existing UUID. It does require that no contract start treating an installation's
local id as a globally sufficient identity. The federation-facing identity is the
pair `(authority, authority-local id)`, even if Phase A stores only the local half
internally.

Similarly, an imported resource remains an owned copy with source provenance. It
must not be represented as a synchronized mount or as continued authority over the
source.

These constraints permit live multi-account connections and a mediated gateway
later without retrofitting distributed ownership into APIs that assumed one
installation owned the world.

## 11. Decision checkpoint

Decision recorded 2026-08-21 after reviewing the alternatives and scenario
stress tests.

### 11.1 Selected product model

llame will target **multi-authority resource federation**, not global identity
federation or ownerless database federation:

- One logical Personal Realm is replicated across many trusted personal nodes.
  CLI, Android, desktop, and an optionally linked hub are physical replicas; none
  is inherently the one canonical home.
- A Personal Realm may connect to any number of foreign authorities while
  retaining at most one linked hub account as its personal synchronization and
  coordination peer.
- A foreign connection binds the local profile to an authority-local subject. It
  does not merge those subjects into a globally trusted person identity.
- Every shared Space has one governing authority for membership, accepted
  revisions, retention, replication permission, and information-flow policy.
- Foreign resources are mounted into a user's view and are never silently
  absorbed into the Personal Realm.
- Every Chat or Run branch has a destination authority. A source may contribute
  content only when its policy permits flow to that destination, executor, and
  inference provider. Otherwise the system must offer an appropriately scoped
  branch or exclude the source.
- Long-lived foreign credentials remain at their connection broker. Executors
  receive proxied operations or narrow, short-lived delegation—not reusable
  upstream credentials.

### 11.2 Selected shipping sequence: Phase A → Phase B → Phase C

The phase letters here name the simplified delivery sequence agreed in the
follow-up discussion. They are not the same labels as every exploratory Model
A–M in section 5.

#### Phase A — Closed installations with explicit exchange

Ship independently useful standalone and hub installations first:

- no cross-authority account connections;
- explicit import and export;
- public Git-backed knowledge as a pinned read-only source with explicit updates,
  forks, and upstream contribution;
- personal full mirroring only within the Personal Realm when that capability
  arrives; and
- source provenance retained for every copy or absorption.

Phase A remains a supported disconnected mode after later phases ship. It is not
a disposable prototype.

#### Phase B — Live multi-authority connections

Add authority-local account connections and online mounts:

- standard OAuth/OIDC or authority-native authentication;
- live reads and writes evaluated by the governing authority;
- merged presentation and retrieval across mounted authorities;
- no automatic persistent copy of foreign content;
- connection metadata may synchronize, while credentials remain at an explicitly
  enrolled broker; and
- unavailable authorities are disclosed to the model and user rather than
  silently treated as empty.

This phase proves that family, work, school, and community resources can coexist
in one experience without first solving shared offline replication.

#### Phase C — Policy-controlled shared replication

Add replication modes per mounted Space:

- `online-only` for authorities requiring strong online revocation;
- `offline-read` for permitted retained copies;
- `offline-propose` for tentative operations or Git branches that the authority
  revalidates before acceptance; and
- `full-replica` initially reserved for Personal Realm data unless a shared data
  type receives an explicit reconciliation and revocation design.

Authority migration and forks remain explicit, preserve lineage, and never occur
merely because a replica was reachable when the governing authority was not.

### 11.3 Rejected or deferred directions

- **Reject:** mandatory full mirroring of every connected upstream into every
  personal replica.
- **Reject:** one universal llame service as the required global identity and data
  authority.
- **Defer:** arbitrary hub-to-hub event federation, Matrix-style ownerless state,
  and peer-to-peer shared ACLs.
- **Use selectively, not wholesale:** Git for knowledge history and proposals;
  Nostr/Buzz-style signed events for possible actor/delegation provenance;
  capabilities for narrow executor delegation; and CRDTs only for data types with
  an independently justified merge model.

### 11.4 Why this sequence was selected

Phase A validates the personal and explicit-exchange product without distributed
authorization. Phase B validates multi-authority identity binding, policy, and
connected UX without offline conflict semantics. Phase C adds offline behavior
only after each authority can state what may be retained and how candidate writes
become accepted state.

The sequence reduces simultaneous unknowns while preserving the north star. Its
main failure mode is allowing Phase A's closed-world assumptions to leak into
durable identities, import semantics, or Chat persistence. Section 10's invariants
are therefore part of the decision, not optional cleanup for Phase B.

Confidence: **high** in the authority model and A → B → C sequence; **moderate**
in signed event envelopes as a later provenance mechanism; **low** that llame
needs Nostr wire compatibility or arbitrary server federation without evidence
from independent deployments.
