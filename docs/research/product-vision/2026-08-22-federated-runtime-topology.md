# Federated runtime topology: one contract, plural runtimes

- **Status:** selected vision direction; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for the boundary; moderate for the first personal-node
  storage choice

## 1. Decision

llame will share one versioned, capability-negotiated **Node Protocol** across
first-party surfaces and nodes. It will not require every node to run one
framework, database, tenancy model, or deployment stack.

The practical topology is:

- the hosted multi-user hub keeps NestJS, PostgreSQL, RLS, and pg-boss;
- a desktop or CLI-hosted personal node is a lightweight single-owner runtime
  with an embedded transactional store, with SQLite the default candidate;
- Android hosts a native, capability-limited personal-node implementation with
  its own embedded store and local inference/device integrations;
- a CLI, desktop app, web app, or Android UI is a **Surface** that calls the Node
  Protocol, even when Surface and Node are packaged in one process; and
- a Claude Code, Codex App Server, ACP, or similar integration is an executor
  adapter behind `execution.*`, not a second Chat or synchronization system.

Shared code is deliberately narrower than the protocol:

- normative schemas and semantic rules;
- stable identifiers, error vocabulary, and capability negotiation;
- generated clients where a target language supports them; and
- cross-implementation conformance fixtures and test vectors.

Storage repositories, relational schemas, queue mechanics, dependency injection,
and tenancy enforcement remain implementation-owned. Pure reconciliation or
identity algorithms move into shared code only after two real implementations
need the same algorithm.

This is the missing interpretation of “same API.” It means one observable
contract, not one universal server binary.

## 2. Why this needs an explicit decision

The dangerous interpretation of a common API is that llame must make its current
hosted stack portable to every surface. That would force multi-user tenancy,
PostgreSQL, RLS, pg-boss, and NestJS lifecycle concerns into a single-owner laptop
daemon and, indirectly, into Android. It would also make offline use depend on a
server architecture designed for a different trust boundary.

The opposite failure is equally expensive: let the CLI call an in-process agent,
let desktop call a daemon, let web call the hosted REST API, and let Android grow
a fourth path. The user-visible capabilities then diverge because every feature
must be integrated repeatedly.

The architecture therefore needs one seam between surfaces and nodes while
allowing materially different node implementations behind that seam.

## 3. Alternatives considered

### A. One universal server runtime

Run the current NestJS service and PostgreSQL-oriented domain layer everywhere;
make CLI, desktop, and Android clients of that runtime.

**Upside:** maximum apparent code reuse and one operational model.

**Failure:** the reuse is mostly false. A single-owner offline node does not need
tenant RLS, a distributed queue, pooled PostgreSQL, or server-side session auth.
Android cannot reasonably host the same deployment. The universal runtime turns
the heaviest installation into the minimum product.

**Decision:** rejected.

### B. One universal domain kernel with storage adapters

Extract most NestJS services into shared packages, define repositories for every
resource, then provide PostgreSQL and SQLite implementations.

**Upside:** more behavior can be reused than with contract-only sharing.

**Failure:** doing this before a second runtime exists creates abstractions from
guesses. Hub tenancy and queues, desktop OS integration, Android lifecycle, and
executor recovery are not interchangeable persistence details. A universal
repository layer would either expose the lowest common denominator or leak each
runtime's special cases through the abstraction.

**Decision:** rejected as the starting architecture. Small pure modules may be
extracted later when demonstrated reuse makes their boundary concrete.

### C. One protocol and conformance suite, plural runtimes

Define the observable domain and execution behavior once. Let the hub, personal
node, Android node, and executor adapters implement only the modules and
capabilities appropriate to their role.

**Upside:** every Surface sees one product contract without forcing one runtime
onto incompatible environments. Implementations retain the security and storage
mechanics their trust boundary requires.

**Cost:** conformance is real work. Semantic drift cannot be prevented by shared
TypeScript types alone, especially on Android; it needs executable fixtures and
cross-language tests.

**Decision:** selected.

## 4. Logical roles and packaging

The roles remain distinct even when one executable combines them:

| Role           | Owns                                                                                          | Does not imply                                             |
| -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Surface        | Human interaction, presentation, local drafts, and connection selection                       | Durable Realm authority or execution authority             |
| Node           | Local identity, durable state, configuration, capability advertisement, and protocol dispatch | A hosted server or an always-on process                    |
| Executor       | One active Run's model/tool loop and recoverable execution state                              | Ownership of every Chat or Realm replica                   |
| Workspace host | User-registered directories and approved derived views                                        | Automatic cloning or synchronization of Workspace contents |
| Hub            | Multi-user authority, optional replicas, rendezvous, and remote routing                       | The canonical home for every personal resource             |

A distribution may combine roles without collapsing their contracts:

- `llame` launched inside a repository may start or attach to a personal node and
  use a local executor in the same distribution;
- a desktop app may embed or supervise the same personal-node service;
- Android may host its limited node inside the application process; and
- the hosted deployment may co-locate HTTP, workers, and protocol dispatch while
  scaling them as separate processes.

There must still be one durable owner for each responsibility. A CLI process does
not create a second session database merely because it presents the session. An
embedded Surface does not bypass the Node Protocol and grow a private integration
path.

The node does not have to be permanently running. A local Surface may start it on
demand. Background availability becomes necessary only for remote steering,
unattended execution, or synchronization while no local Surface is open.

## 5. Shared contract boundary

The existing module split remains the protocol shape:

- `core.*`: handshake, identity binding, versions, capabilities, request
  lifecycle, common errors, cancellation, and deadlines;
- `realm.*`: durable Chats, branches, messages, Knowledge Spaces, Agent Profiles,
  settings, mounts, and placement preferences;
- `execution.*`: placements, Runs, snapshots, subscriptions, Workspace entry,
  approval, steering, cancellation, and recovery;
- `sync.*`: Personal Realm frontiers, semantic change batches, snapshots,
  acknowledgements, coverage, and schema compatibility; and
- `admin.*`: enrollment, link and unlink, Workspace registration, providers,
  sandbox configuration, diagnostics, backup, and maintenance.

The protocol defines semantic operations, not database tables or process calls.
For example, `execution.*` can require a complete current Run snapshot and an
idempotent epoch-targeted cancellation command without exposing a pg-boss job,
SQLite row, subprocess handle, or provider abort controller.

Each implementation advertises only what it supports. An Android node can expose
`core.*`, personal `realm.*`, `sync.*`, and a limited `execution.*` without a
Workspace capability. An executor-only adapter can expose `core.*` and
`execution.*` without pretending to be a Realm replica.

The shared artifact should eventually include:

1. machine-readable operation and event schemas;
2. capability and version negotiation rules;
3. canonical serialization and stable-ID rules where signatures or hashes depend
   on bytes;
4. valid and invalid request/response fixtures;
5. state-transition and idempotency vectors for synchronization and execution;
6. generated TypeScript clients for first-party Node/web/CLI consumers; and
7. language-neutral fixtures for Android and third-party implementations.

The likely repository home is a focused protocol package, but its package name
and implementation should wait for the first cross-runtime vertical slice. An
empty framework package now would only fossilize guesses.

## 6. Transport is replaceable; semantics are not

One Node client contract may dispatch through:

- an in-process handler for a combined application;
- local IPC or loopback for a supervised daemon;
- authenticated direct HTTP/WebSocket transport;
- an authenticated reverse tunnel through a hub; or
- a test transport used by conformance fixtures.

Changing transport must not change operation names, authorization meaning,
idempotency, revisions, errors, or recovery behavior. A combined CLI does not get
a privileged alternate agent loop; it gets a cheaper transport to the same
logical handler.

Remote live control uses tunnelling plus current-state recovery. The hub may
provide rendezvous, presence, authorization, and connection-generation fencing,
but it does not need to mirror an executor's queue or process state. After a
disconnect, a Surface reads a complete current snapshot from the authority,
replaces its stale projection, then subscribes after that snapshot's revision.

Durable Realm synchronization is separate from live execution transport. Chat and
Run history can reconcile between replicas while the current executor remains the
only authority allowed to advance the live Run.

## 7. Authentication and isolation vary by channel

The request shape is common; the trusted principal source is deployment-specific:

- a local personal node authenticates a local profile through an OS-protected
  channel and node-owned credential; owner scope is implicit because that
  profile's store has no tenant selector;
- a remote node link authenticates enrolled node keys and scoped delegations;
- the hosted hub derives the user from its authenticated session and engages
  PostgreSQL RLS with that trusted identity; and
- an executor adapter accepts only the placement- and epoch-scoped authority
  granted by its hosting node.

No protocol operation accepts a caller-selected `user_id` as authorization
identity. `admin.*` is local or explicitly stronger-authorized and is not exposed
through ordinary remote tunnels by default. Secrets, raw host paths, provider
credentials, and node-local configuration are not capability-discovery payloads.

Node identity is not user identity. Enrollment associates one node profile with a
remote account or authority for a link; it does not add a mutable local `user_id`
that chooses which owner's rows a request may access. Unlinking revokes that
cryptographic association while the standalone local profile and its data remain
operable.

A personal-node profile is single-owner, not OS-multi-user isolated. Multiple
llame profiles may run under one OS account, but each uses a separate node
identity, store, configuration root, endpoints, and enrollment. Any process with
the same OS account's filesystem authority may still be able to read those
profiles; this topology must not be advertised as protection from that OS user.

The hosted hub remains different: multi-tenant isolation is datastore-enforced,
not merely a path convention or trusted application filter. Reusing one protocol
does not weaken that invariant.

## 8. Persistence boundaries

The protocol resource model is portable; an implementation's relational layout
is not.

### Hosted hub

The existing NestJS/PostgreSQL runtime remains appropriate:

- PostgreSQL is the operational system of record;
- RLS enforces tenant isolation;
- pg-boss coordinates durable Runs and maintenance jobs; and
- HTTP and no-HTTP worker entrypoints remain deployment roles inside one hub
  installation.

The hub implements or adapts Node Protocol modules at its application boundary.
It does not make PostgreSQL rows, queue jobs, or NestJS providers part of the
portable contract.

### Desktop and CLI personal node

Use an embedded transactional store; SQLite is the leading default because it
supports atomic local domain changes, journals, indexes, and backup without an
operator-managed service. This choice is moderate-confidence and remains an
implementation decision until a concrete slice validates it.

The node is single-owner, so it does not copy the hub's RLS model or add a
request-selectable tenant column. It still needs transactional integrity,
separate profile roots, authenticated endpoints, and negative tests against
cross-profile routing.

### Android personal node

Use the platform's embedded database and lifecycle primitives. Android shares
schemas, semantic fixtures, and protocol behavior, not the Node.js runtime. Its
capability set is intentionally smaller and honestly advertised.

### Knowledge and episodic state

Knowledge Spaces retain Git-compatible history and provider adapters for raw Git,
GitHub pull requests, GitLab merge requests, and Forgejo workflows. Episodic Chat
and Run state remains database-native and synchronizes through `sync.*`. Neither
PostgreSQL logical replication nor SQLite file copying is federation.

Executor-local `run_events`, queue records, leases, process handles, and live tool
state are recovery mechanics, not the Realm replication journal.

## 9. Concrete scenarios

### CLI started inside a repository

1. `llame` discovers, starts, or attaches to one selected personal-node profile.
2. The CLI advertises only its current directory as the initial Workspace
   candidate.
3. The Surface creates or continues the Chat through the local Node Protocol
   transport.
4. The node owns durable Chat and Run state; the CLI does not maintain a second
   replica or call a separate in-process agent API.
5. Workspace entry still passes through `EnterWorkspace` authorization. Nothing
   is cloned onto the machine automatically.
6. The same Run works unlinked and offline when its selected model and tools are
   local.

### Android offline question

1. The Android Surface calls its in-app personal node.
2. The node reads its local Realm replica and uses local inference.
3. It advertises no generic shell, repository, container, or worktree capability.
4. The Chat later reconciles through the ordinary `sync.*` function after a link
   becomes available; there is no special “initial import” path.

### Phone steering a desktop Workspace Run

1. The phone resolves the placement's current authority through an optional hub.
2. Its Node client reaches the desktop's `execution.*` endpoint through the
   reverse tunnel.
3. It reads the current snapshot, subscribes, and sends idempotent approval,
   cancellation, or follow-up commands directly to that authority.
4. If the desktop disappears, the Surface offers the configured wait, temporary
   fallback, exit, or ask behavior.
5. Realm history synchronization and executor reconnection proceed independently;
   the hub does not impersonate a still-running desktop executor.

### Web question handled entirely by the hub

The web Surface calls the hub's implementation of the same contract. A normal
question can remain on the hub executor. If later exploration reveals that a
registered local Workspace is required, `EnterWorkspace` authorization may move
the placement to an eligible node at a safe boundary.

### External coding-agent executor

A Codex App Server, Claude Code, ACP, or similar adapter implements the required
`execution.*` capability behind a node. llame keeps canonical Chat, branch, Run,
approval, and placement identity. The external executor does not become a second
federation authority merely because it owns process-local recovery state.

## 10. Implications for the current repository

This decision does not authorize an immediate runtime split or package scaffold.
It changes the direction of later work:

1. keep `apps/api` as the NestJS/PostgreSQL hub instead of refactoring it into a
   universal local runtime;
2. do not freeze today's REST/OpenAPI surface as the Node Protocol merely because
   it already exists;
3. when the first local vertical slice is selected, define the smallest protocol
   module it needs and adapt the hub to that same semantic contract;
4. ensure first-party surfaces use one generated client/dispatcher contract rather
   than direct service access plus HTTP as parallel feature paths;
5. add conformance fixtures before claiming two implementations support the same
   module; and
6. extract shared pure logic only when the second implementation demonstrates the
   shared boundary.

This is an architectural dependency order, not a commitment to current ROADMAP
sequencing.

## 11. Evidence from reference products

Goose is moving away from exactly the duplicate-path failure: its CLI called the
agent in-process while desktop used a REST/SSE daemon, forcing every feature to be
wired twice. Goose 2.0 is consolidating clients onto one ACP server and protocol.
That supports one client contract, though ACP itself does not cover llame's Realm
replication or multi-authority model.

Source: [Goose 2.0 architecture note](https://github.com/aaif-goose/goose/blob/8d844eecbdfd65626a881c9e8784ae8dc6093f1d/documentation/blog/2026-04-08-goose-acp-and-new-tui/index.md)

OpenCode demonstrates the useful implementation pattern: its TUI can dispatch
requests into the same application handler through a worker transport, start the
handler as a real server when network exposure is requested, or attach to an
existing server. This supports transport substitution behind one contract. It
does not prove OpenCode's single-user storage or security model is suitable for
llame's hosted hub.

Sources:

- [OpenCode TUI transport selection](https://github.com/anomalyco/opencode/blob/3a4c253969870e42d166fe6754133e848acbd81b/packages/opencode/src/cli/cmd/tui.ts)
- [OpenCode worker dispatch](https://github.com/anomalyco/opencode/blob/3a4c253969870e42d166fe6754133e848acbd81b/packages/opencode/src/cli/tui/worker.ts)
- [OpenCode shared server handler](https://github.com/anomalyco/opencode/blob/3a4c253969870e42d166fe6754133e848acbd81b/packages/opencode/src/server/server.ts)
- [OpenCode `serve`](https://github.com/anomalyco/opencode/blob/3a4c253969870e42d166fe6754133e848acbd81b/packages/opencode/src/cli/cmd/serve.ts)
- [OpenCode `attach`](https://github.com/anomalyco/opencode/blob/3a4c253969870e42d166fe6754133e848acbd81b/packages/opencode/src/cli/cmd/attach.ts)

Buzz remains a negative topology reference. Its signed events and formal
multi-tenant checks are useful, but one authoritative relay is explicitly its
source of truth. That does not solve multiple independently operable Personal
Realm replicas.

## 12. Deliberate deferrals

This decision does not yet choose:

- concrete Node Protocol endpoints, encodings, or version numbers;
- the local daemon executable or package name;
- the Android language, database library, or background-service mechanism;
- whether a desktop distribution uses in-process dispatch, local IPC, or both;
- the exact portable episodic resource schema;
- node enrollment, recovery, and key-rotation mechanics; or
- execution placement and synchronization state machines.

Those are separate decisions. Pulling them into this note would recreate the
unbounded exploration this successor note is meant to replace.

## 13. Next architectural decisions

Resolve these in dependency order, one focused successor decision at a time:

1. **Portable resource identity and envelope.** Define what identifies a Realm,
   resource, replica-authored change, causal base, authority, and schema version
   independently of PostgreSQL or SQLite rows.
2. **Personal-node profile and lifecycle.** Define how a Surface discovers,
   starts, selects, and authenticates one single-owner node without turning CLI
   startup into a second store or agent path.
3. **Enrollment and channel authentication.** Bind local channels, enrolled node
   keys, hub sessions, revocation, and scoped delegations to the common principal
   model.
4. **Execution placement authority.** Specify epochs, snapshots, commands,
   fallback, recovery, and handoff without exposing executor internals.
5. **Realm reconciliation.** Specify semantic batches, snapshots, frontiers,
   completeness, forks, and resource-specific deletion after identity is stable.

The first item has the highest leverage: every sync, mount, fork, and authority
decision depends on portable identity, while no storage engine should dictate it.

## 14. Promotion boundary

This note records alternatives, evidence, examples, and deferrals. `VISION.md`
owns the durable direction. `SPEC.md`, OpenSpec, and ROADMAP remain unchanged
until a concrete capability is selected and shipped through their respective
workflows.
