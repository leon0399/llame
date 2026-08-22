# Local Nodes, Workspaces, and Distributed Execution

Recorded 2026-08-21. Noncanonical discussion checkpoint — this document preserves
the direction explored with Leo before it is promoted into `VISION.md`, capability
specifications, or the roadmap. It distinguishes agreed product direction from
candidate implementation mechanisms and unresolved decisions.

Updated later on 2026-08-21 with the subsequent decisions on Run authority,
Workspace affinity and outage recovery, node enrollment, and the permanent
single-owner-personal-node versus multi-user-hub boundary. A later update records
the deliberately minimal unlink and relink contract. The adjacent
[multi-authority federation research](2026-08-21-multi-authority-federation-models.md)
preserves the subsequent alternatives, scenario analysis, and accepted staged
direction. A further update records the storage boundary between Git-backed
knowledge and database-native episodic history, provider-aware publication
workflows for Git-backed changes, and the explicit replica-completeness boundary
with candidate-only fallback under uncertainty.
Updates on 2026-08-22 record semantic replication change batches, the separate
single-authority protocol for remotely observing and controlling active execution,
the three-layer durability boundary between live execution, executor-local
recovery, portable Realm checkpoints, simple-first planning, fenced handoff, and
disposable node enrollment.

A later 2026-08-22 prioritization pass retains this document as north-star design
but narrows the immediate product cut to Git-backed profile files and personal
knowledge in the existing Run loop, followed by a standalone personal Node and
CLI, personal synchronization, and only then Workspace-aware distributed
execution. Child agents and external-harness adapters are deliberately postponed.
llame supports user-configured inference providers but does not bundle or manage a
local model runtime.

## 1. Why this checkpoint exists

The discussion started from a desired first-party CLI experience similar to
`codex` or `claude`, then expanded into a broader model: llame should be a
local-capable, multi-surface system whose Runs can use isolated execution
environments and user-selected project directories across machines without making
the central server mandatory.

This is not one feature. It affects product topology, offline behavior, sync,
identity, permissions, execution placement, workspace isolation, reproducible
sandboxes, inference routing, and knowledge ownership. Treating it as a single
"remote worker" milestone would conceal the hard boundaries and produce an unsafe
distributed shell.

The purpose of this note is therefore to preserve:

- Leo's original product vision, in structured form;
- terminology corrections made during the discussion;
- decisions that have already converged;
- mechanisms that remain hypotheses rather than commitments;
- conflicts or extensions relative to current llame documentation; and
- the next decisions to resolve, in dependency order.

## 2. Original vision, faithfully structured

Leo's starting vision was:

1. llame should eventually have its own CLI. Running `llame` should open a new or
   resumed Chat in the terminal, and the current directory should define the
   filesystem context available to it by default.
2. Workspace-aware execution must not be hidden behind the CLI. A Run initiated
   from the web, Android, or another surface should be able to discover that it
   needs a particular project Workspace, select an eligible executor, and ask for
   permission when policy requires it.
3. Remote execution should have a self-managed, reproducible system environment
   in which an agent can scaffold projects, keep scratch material, install tools,
   and evolve its configuration without permanently bricking the environment.
4. Project Workspaces should remain isolated from one another. A configuration or
   dependency change made for one task must not silently change another running
   task.
5. A host daemon should be able to expose explicitly configured local directories
   to remotely initiated Runs. This would enable a request sent from a phone or
   web UI to continue on a user's machine, similar in outcome to starting a coding
   agent remotely in a chosen directory.
6. llame should support Git worktrees as derived Workspace views. A Run that starts
   from a main checkout should later be able to enter an isolated worktree and
   continue there transparently, leaving the original checkout untouched.
7. Each surface should remain useful by itself. In particular, an Android system
   assistant should support local inference and personal context while offline,
   while also being able to create or steer a Run executing elsewhere.
8. A locally configured CLI, daemon, or Android app should be able to operate
   without a llame account or remote server. If the user later links it to an
   account, it should synchronize its existing personal state with the upstream
   installation.
9. Personal knowledge, history, and configuration should feel distributed across
   the user's trusted nodes rather than trapped inside a central service. Git is a
   promising reconciliation substrate for knowledge and environment definitions;
   the current Postgres-backed operational state needs a separate solution.
10. The central server's provider credentials must never be copied to local
    daemons or sandboxes. Local nodes may define their own providers, and remote
    inference may be brokered without disclosing the provider secret.

The motivating experience is coherent continuity across surfaces: ask locally,
continue remotely when needed, steer from another device, return later, and retain
the same personal history and knowledge. The implementation must keep authority,
data movement, and execution placement explicit even when the UX makes those
transitions feel natural.

## 3. Structured product thesis

llame is a local-capable, multi-surface agent system. A trusted node can operate
indefinitely on its own, with local identity, storage, inference configuration,
and available tools. Linking a node to an optional upstream account adds
bidirectional synchronization and coordination; it does not turn the node into a
thin client.

The synchronization topology should initially be hub-and-spoke, not arbitrary
peer-to-peer replication:

```text
                    optional multi-user hub service
                   /            |              \
        personal node     another host     Android node
        CLI + daemon + UI   daemon + CLI     assistant + UI
             |                    |
     registered Workspaces   registered Workspaces
             |                    |
       sandbox instances     sandbox instances
```

Surfaces interact with nodes. Nodes store and coordinate durable state. Executors
offer capabilities. Workspaces contain user-selected project files. Sandboxes
provide reproducible execution environments. These are separate concepts even
when a single desktop process initially implements several of them.

Personal nodes and the hub are not symmetric deployments. A personal node is an
implicitly single-owner local store. The hub is the existing authenticated,
multi-user, tenant-isolated service and holds one isolated personal replica per
account. They share portable resource and synchronization contracts, not
necessarily a database schema or runtime framework.

The differentiator is not "agents on many devices." It is late-bound,
capability-aware execution with durable conversational continuity: a Run can begin
where the user asks, remain there for ordinary reasoning, and acquire or transfer
to a more capable execution context only when the task requires it.

## 4. Vocabulary and boundaries

| Term                              | Meaning                                                                                                                                             | Not the same as                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Surface**                       | A user interaction surface such as CLI, web, desktop, or Android system assistant.                                                                  | Node, executor, or storage authority.                                            |
| **Host**                          | A physical device or OS environment that may run one or more llame node instances.                                                                  | Node identity or user identity.                                                  |
| **Node**                          | An independently operable llame installation with local identity, durable state, configuration, and zero or more executors.                         | A UI surface or a single Run.                                                    |
| **Personal node**                 | A single-owner local node with no internal user tenancy. It may remain unlinked or link to one hub account.                                         | Multi-user service or physical host.                                             |
| **Personal Realm**                | One person's logical ownership and reconciliation boundary for portable personal state, held by its trusted replica set.                            | A node, hub account, foreign authority, or unified view.                         |
| **Replica**                       | An authorized retained copy of a Realm or resource's portable state on a node, governed by that resource's reconciliation and retention rules.      | Node identity, governing authority, cache, or mount.                             |
| **Replica coverage**              | An operation-scoped verdict that a replica's relevant authority state is verified complete, known partial, or of unknown completeness.              | Git ancestry, node availability, or absence of conflicts.                        |
| **Hub service**                   | The optional account-linked, multi-user synchronization and coordination service. It may also execute Runs.                                         | Mandatory control plane for local operation.                                     |
| **Governing authority**           | The policy boundary that decides membership, accepted revisions, retention, replication, and information flow for a shared resource.                | The node currently caching or executing against it.                              |
| **Authority Connection**          | A binding from a local profile to an authority-local subject, with its own brokered credentials and resource access.                                | A global identity merge or Personal Realm enrollment.                            |
| **Mount**                         | A discoverable access path from a profile to a foreign resource under that resource's governing authority.                                          | Ownership transfer, absorption, or automatic replication.                        |
| **Executor / worker**             | A capability endpoint able to perform some execution, such as inference, tools, shell work, or sandboxed code work.                                 | Node identity or Workspace.                                                      |
| **Agent Profile**                 | Prompt, model preferences, Skills, tool defaults, and optional memory behavior.                                                                     | User identity, machine identity, Workspace, or sandbox.                          |
| **Chat**                          | The durable continuity container for messages, Runs, lineage, and current contextual bindings.                                                      | One process or one model call.                                                   |
| **Execution placement / session** | A durable active-branch binding to one authoritative executor, sandbox, optional Workspace, and recovery policy across Runs.                        | The Chat itself, one Run, or a queue job.                                        |
| **Run**                           | One durable user turn and its resulting agent activity.                                                                                             | One executor process.                                                            |
| **Execution segment**             | An immutable portion of a Run pinned to a node, model, tool set, Workspace binding, and context receipt. A Run may have multiple segments.          | Live-process migration.                                                          |
| **Node Protocol**                 | The common modular API contract shared by local and hosted nodes, with one core and separately versioned, authorized capability modules.            | One implementation, deployment stack, storage engine, or flat privilege surface. |
| **Execution module**              | The `execution.*` Node Protocol module for reconnectable Run, placement, Workspace, approval, and steering operations.                              | The Realm replication protocol or a hub-owned Run queue.                         |
| **Run snapshot**                  | The authoritative executor's current semantic view of a session or Run: placement, state, permissions, availability, progress, and revision.        | A replicated event log, raw queue, process, or UI cache.                         |
| **Tunnel relay**                  | An authenticated rendezvous and byte-routing service that connects a surface to a node's protocol endpoint without becoming execution authority.    | A Run-state mirror, durable command mailbox, or home node.                       |
| **Executor recovery journal**     | Executor-local durable state used to reconstruct a Run after a surface disconnect or supported same-node process restart.                           | A portable Realm record, replication journal, or wire API.                       |
| **Run semantic checkpoint**       | A normalized portable record of stable Run progress committed at an externally meaningful boundary.                                                 | A raw token delta, provider transcript, or finalized Chat message.               |
| **Change batch**                  | An immutable semantic replication unit committed atomically with one or more related portable domain mutations.                                     | A table-row diff, WAL record, `run_event`, or delivery attempt.                  |
| **Replication journal**           | The retained set of change batches used for incremental replay and forwarding between replicas.                                                     | Canonical domain state or a per-link outbox.                                     |
| **Synchronization session**       | One reconciliation operation that compares replica frontiers and uses a snapshot, change batches, or both to converge the supported portable scope. | A special first-link import, database replacement, or execution tunnel.          |
| **Workspace**                     | A user-selected project directory, Git repository, codebase, or collection of files.                                                                | Sandbox environment, Home, or Knowledge Space.                                   |
| **Workspace view**                | A derived worktree, copy-on-write checkout, or overlay used for isolated execution.                                                                 | Synchronization replica.                                                         |
| **Sandbox definition**            | A versioned, reproducible description of system tools, packages, managed dotfiles, and permitted runtime configuration.                             | A project Workspace.                                                             |
| **Sandbox instance**              | A container, VM, or process-level realization of a sandbox definition, with explicit Workspace mounts and scratch storage.                          | The durable definition or Workspace itself.                                      |
| **Home**                          | User-owned durable context and artifacts that are not ordinary project files.                                                                       | Arbitrary host filesystem access.                                                |
| **Knowledge Space**               | A separately identified, Git-backed body of knowledge with its own history and governance.                                                          | Chat history or a project checkout.                                              |
| **Candidate revision**            | Proposed resource state anchored to an exact accepted base and retained until the governing authority accepts, rejects, or supersedes it.           | Accepted state or permission to advance an accepted ref.                         |
| **Knowledge publication adapter** | A provider-aware workflow that publishes Git-backed candidate revisions and observes their disposition through direct refs or forge review.         | Git storage, Git transport, or governing authority.                              |

The earlier phrase "the assistant's self-managed workspace" was misleading. The
self-managed system environment is the **sandbox**. A Workspace is a specific
directory or repository mounted into it.

Only **Personal Realm** is currently a selected Realm type. Work, family, school,
and public resources remain Spaces governed by their own authorities; "Realm" is
not a generic synonym for an installation, authority, account, or resource view.

## 5. Decisions reached

### 5.1 Surfaces and local nodes

**Agreed direction — high confidence**

- A locally configured CLI and an offline-capable Android app follow the same
  logical local-node contract: they can operate unlinked, maintain local personal
  state, use locally configured inference, and later link and synchronize.
- Their capabilities differ. A desktop node may expose shells, Workspaces,
  sandboxes, and worktrees. Android is limited to local inference, personal
  context, bounded device integrations, and Run steering.
- Multiple surfaces on one host should normally share a node and durable store.
  They should not each create independent full replicas merely because they are
  different UIs.
- A host or even one OS user may deliberately run multiple node instances for
  separate llame profiles or accounts. Each instance has its own node identity,
  store, configuration, credentials, sockets, Workspace registry, sandbox state,
  caches, and logs.
- The upstream installation is optional for local operation. Linking adds sync,
  remote coordination, and access to capabilities available elsewhere.

### 5.2 Full personal mirror

**Agreed direction — moderate confidence; resource reconciliation protocol unresolved**

Every trusted, linked personal node should receive a full personal mirror of
portable llame state, subject to explicit exclusions. This is the simplest product
contract for offline continuity, although it is not the simplest implementation.

The intended personal mirror includes:

- personal Knowledge Spaces and their Git histories;
- Chats, Runs, messages, lineage, and episodic history;
- personal memory and personalization state;
- Agent Profiles, Skills, and portable user configuration; and
- portable artifacts intentionally stored in llame-managed state.

It does not automatically include:

- inference-provider secrets owned by another node;
- node-local provider configuration or device-specific overrides;
- host paths, Workspace permissions, or local capability grants;
- Workspace file contents;
- sandbox instances, caches, or ephemeral scratch state; or
- organization/shared data unless its governing policy permits replication.

Device enrollment therefore copies a substantial personal corpus. Encryption,
revocation, device loss, remote erasure semantics, and auditability are product
requirements, not operational polish.

### 5.3 Linking an existing standalone node

**Agreed direction — high confidence**

When a node with existing local state links to an account that already has remote
state:

1. llame asks for explicit confirmation;
2. the node exports its portable personal state to the upstream node;
3. it imports the upstream personal state;
4. both sides reconcile replicas of the same resource identities; and
5. distinct resources remain distinct rather than being merged by name.

This is full bidirectional synchronization, not "remote overwrites local" or
"local becomes a client." The exact transaction, resumability, and rollback model
remain open.

The personal node is single-owner and stores no local `user_id`. Its portable
records retain globally stable resource IDs, revisions, payloads, and originating
node IDs but do not assert authoritative upstream ownership. During sync, the hub
derives `owner_user_id` from the authenticated enrolled-node relationship and
stamps it server-side. On download, the hub scopes records through its normal
tenant isolation and the personal node stores the authorized result without an
owner column.

### 5.4 Workspace registration and discovery

**Agreed direction — high confidence**

- llame never clones, discovers, or imports project directories onto a user's
  machine merely because an upstream Run requested a Workspace.
- A host daemon exposes only Workspaces manually registered by the user.
- The upstream node receives a safe Workspace handle, label, owning node,
  availability, and declared capabilities. It should not receive an arbitrary host
  path unless the user explicitly chooses to expose it.
- When the CLI starts inside a directory, only that current directory is
  advertised to the Chat/Run as its Workspace candidate, even if the daemon has
  other registered Workspaces.
- Android may receive Workspace metadata for selection and steering. It does not
  receive the repository contents merely because it can see the handle.
- A trusted daemon resolves a Workspace handle to an allowlisted local path and
  mount mode. The model never supplies a raw host path or Docker bind directly.

### 5.5 Workspace entry and permission policy

**Agreed direction — high confidence**

The model sees a narrow operation such as:

```text
EnterWorkspace(workspace_id, access_mode?)
```

The harness permission engine resolves the handle and evaluates the authenticated
principal, Chat, owning node, current Workspace state, requested access mode, and
policy. The policy result is `allow`, `ask`, or `deny`.

Example:

- Workspace A has `auto-approve`: `EnterWorkspace(A)` succeeds without a prompt.
- Workspace B has `ask`: `EnterWorkspace(B)` pauses at the standard permission
  prompt and resumes only after approval.

The permission mechanism is opaque to the model; the resulting execution context
is not. A successful tool result must disclose the effective Workspace, executor,
working directory or logical root, access mode, and relevant capabilities.

A successful entry durably binds the active Chat branch through its execution
placement/session to that Workspace. Follow-up Runs on that branch reattach
automatically and do not ask merely because a new turn began. Each Run still
silently reauthorizes the binding against current policy and availability.
Revocation, policy narrowing, node removal, or lost capability fails closed.
Continuity is not authority.

Entering a different Workspace, exiting and later re-entering, starting a new
Chat, or establishing a placement for another branch causes a new policy
evaluation. A one-time "Yes" approves only the pending call. A separate "Yes, and
allow in future" action both approves it and persists a revocable rule normalized
around principal, stable Workspace identity, tool, access mode, and scope. It must
not store a brittle allow rule keyed only by raw tool-call JSON.

Workspace entry grants the mount and requested access mode. It does not grant
network egress, secret access, publishing, destructive shell operations, or other
unrelated capabilities. Those remain separately permissioned.

### 5.6 Run placement happens incrementally

**Agreed direction — high confidence**

Placement cannot always happen before useful execution. A user may say "fix the
problem in this issue" and provide only a URL. The Run may first need to retrieve
and interpret the issue before it can identify the relevant Workspace.

The placement invariant is:

> A Run begins wherever it can, remains there while that placement is sufficient,
> and acquires or transfers to another execution context only when a required or
> materially better capability justifies it.

Therefore a Run may:

- answer a question or perform research entirely on the initiating node;
- use a Workspace already available on that same node;
- begin with Workspace-independent retrieval and later enter a Workspace;
- continue as a new execution segment on another eligible node; or
- delegate genuinely independent work to a child Run.

Cross-node continuation is not live process migration. llame transfers durable
state: transcript references, plan and goal state, approvals, budgets, tool
results, selected context, and a context receipt. Each execution segment remains
immutable and records its node, model, tools, Workspace, and context. Reusing an
opaque provider session may be an adapter optimization, never the correctness
contract.

Each active Run branch has exactly one authoritative node. The initiating node
owns it initially.

#### Simple-first handoff

**Agreed initial direction — high confidence; exact schemas unresolved**

The first cross-node implementation requires a reachable linked hub to act as the
fencing authority for that execution placement. It uses an orchestrated state
machine, not a cross-node distributed transaction:

1. the target prepares the exact portable checkpoint, context receipt, sandbox,
   and optional Workspace but does not execute;
2. the source stops new model and tool dispatch, durably records a final checkpoint
   and handoff barrier, and makes that checkpoint available to the target;
3. the hub compares the placement's expected source node and authority epoch and,
   if they still match, atomically advances the placement to the target and next
   epoch; and
4. the target acknowledges the committed epoch and begins a new execution segment.

The compare-and-swap is the sole authority commit point. Before it succeeds, only
the source may advance the Run; after it succeeds, only the target may advance it.
An ambiguous disconnect is resolved by reading the placement register and command
disposition, never by guessing. If preparation fails before the compare-and-swap,
the source may cancel the handoff and resume. Failure after the compare-and-swap is
a new outage of the target, not permission for the source to resume.

When the source is unavailable, the hub may perform a forced epoch advance only
after the configured recovery policy or user decision authorizes fallback. The
target starts from the last portable semantic checkpoint, creates a new execution
segment, and preserves any later source-side work or side effect as
`outcome_unknown`. If no fencing authority is reachable, the system may wait,
exit the Workspace, or create a visibly linked fork; it must not claim same-branch
continuation.

#### Handoff north star and later follow-ups

The hub is the initial fencing service, not the permanent home or execution
authority. The north star retains a singular, compare-and-swap-fenced placement
register while allowing its coordination role to live on another trusted Personal
Realm peer. Later follow-ups may add:

- direct source-sealed graceful transfer when no hub is present;
- migration and recovery of the per-placement fencing service;
- capability-scoped coordination by another enrolled Realm peer; and
- automated lease or failure-detector policies, provided they cannot bypass the
  same epoch fence or conceal uncertain side effects.

Those follow-ups must preserve the same checkpoint, barrier, fencing, and
`outcome_unknown` semantics. They are not prerequisites for the first hub-backed
handoff.

If an authoritative executor disappears after beginning work, another node cannot
silently seize the same branch: the executor may still be advancing offline or
may have performed side effects. Recovery therefore requires a successful fenced
epoch advance, waits for the original executor, exits the Workspace, or creates a
visible fork from the last confirmed checkpoint with the interrupted segment
marked `outcome_unknown`.

### 5.7 Android execution boundary

**Agreed direction — high confidence**

Android can:

- answer with local inference while offline;
- use synchronized personal knowledge, memory, and Chat history;
- use explicitly bounded Android/device integrations;
- originate Runs; and
- steer Runs executing on other nodes, regardless of where those Runs originated.

Android cannot locally provide a generic project filesystem Workspace, arbitrary
shell, container sandbox, or Git worktree. A Workspace-dependent Android-originated
Run must continue on an eligible executor. If none is available, the Run waits,
asks for another choice, or gives a deliberately limited answer.

### 5.8 Git worktrees are derived Workspace views

**Agreed later requirement — moderate confidence**

For a registered Git Workspace, the daemon should eventually support creating an
isolated branch and worktree, mounting that path into the sandbox, changing the
Run's effective working directory, and continuing transparently. The original
checkout remains untouched.

The worktree is a derived Workspace view, not a synchronized copy and not a new
Knowledge Space. Creation, naming, concurrent use, publishing, retention, and
cleanup policy remain open.

### 5.9 Versioned sandbox environments

**Agreed direction — moderate confidence; runtime choice unresolved**

Sandbox definitions should be Git-backed and reproducible. Agent-initiated changes
follow a revision workflow analogous to knowledge maintenance:

```text
candidate commit
  -> policy validation
  -> reproducible build
  -> smoke and security checks
  -> automatic landing or human review/PR
  -> accepted revision
  -> activation for future sandbox instances
  -> rollback when necessary
```

"PR" is one review UX, not a dependency on GitHub. A standalone node can maintain
local candidate and accepted refs.

Runs pin an exact sandbox-definition revision. Accepting a change affects future
instances unless a restart or new execution segment is explicit. An agent may
change configuration within capabilities already granted to it; editing config
must never allow it to self-grant network, mounts, privilege, secrets, or device
access. Ordinary package changes and capability expansion need different risk
policies even if they share the same revision lifecycle.

### 5.10 Concurrent Chat reconciliation

**Agreed direction — moderate confidence; detailed sync protocol unresolved**

If the same Chat is continued independently on two offline nodes, reconciliation
automatically forks rather than choosing a winner or silently interleaving turns.

Required lineage properties:

- message, Run, and event IDs are globally stable and generated before sync;
- every continuation records the exact parent anchor visible when it began;
- the common prefix is referenced, not copied under replacement identities;
- the divergence anchor and source Chat remain recoverable;
- forks of forks retain their complete lineage; and
- the representation permits multiple-parent lineage if explicit future merges
  turn the tree into a DAG.

Reconciliation rules:

- if the parent is the current head, append;
- if the parent is a known ancestor but no longer the current head, create a linked
  fork;
- if the parent is unknown or unauthorized, fail closed.

Fork summaries are derived, versioned, regenerable artifacts anchored to exact
Chat, branch, Run, and message references. A later model may receive a system
reminder explaining that the conversation forked and summarizing what happened on
another branch, but sibling context is never silently merged. The exact injected
summary belongs in the context receipt.

Chats remain database-native episodic state rather than Git repositories. A full
Personal Realm mirror means logical fidelity, not a byte-for-byte database clone.
Its portable state includes Chat and branch identities, Runs, messages and parts,
lineage, durable approval decisions, audit records, compaction checkpoints,
context receipts, finalized execution receipts, and deletion records.
Accepted historical records retain stable identities and provenance; corrections
or withdrawals become explicit revisions or records rather than
identity-rewriting synchronization. The exact contents and retention of a
finalized execution receipt remain to be specified.

Raw token chunking, queue rows, worker leases, process handles, heartbeat
implementation, live stream cursors, and Run snapshots are not canonical personal
state. Active execution is nevertheless remotely observable and controllable
through the Node Protocol's `execution.*` module described in section 5.14. Live
events traverse its direct or tunneled transport; reconnect repairs gaps by reading
a fresh snapshot from the authoritative executor rather than replaying a hub-owned
Run journal. The existing `run_events` table may back part of the hosted
executor's local recovery implementation, but its schema is neither the Node
Protocol wire contract nor the cross-node replication journal or federation
cursor.

#### Active Run durability has three layers

**Agreed direction — high confidence; exact checkpoint schema unresolved**

Active execution uses three deliberately different durability layers:

1. the authoritative executor's live snapshot and delta stream, exposed through
   `execution.*` for current observation and control;
2. an executor-local recovery journal, which may retain high-frequency,
   adapter-specific state needed to rebuild that snapshot after a supported
   same-node process restart; and
3. normalized Run semantic checkpoints in canonical Realm state, synchronized as
   semantic change batches for cross-node continuity and historical fidelity.

The executor must durably journal product-visible output before delivering it to
a surface. That rule protects reattachment and same-node recovery without making
upstream availability a prerequisite for local or offline execution. The local
journal is not portable merely because it is durable, and it never legitimizes
capturing hidden model reasoning. Native Claude Code or Codex session storage and
llame's current `run_events` implementation are possible adapter-specific journal
backends; no consumer may depend on their raw schemas.

Portable checkpoints contain stable semantic facts rather than the executor's
transcript mechanics. They include, as applicable:

- Run acceptance with the user message, exact Chat branch and parent anchor,
  placement authority epoch, and recovery policy;
- permission requests and their exact decisions;
- a stable tool invocation intent before dispatch of a side-effecting operation,
  followed by a normalized success, failure, denial, or `outcome_unknown` record
  before the model advances;
- completed assistant semantic blocks and context, compaction, pause, handoff, or
  execution-segment boundaries; and
- terminal settlement with the final assistant message, Run status, usage,
  artifact references, and finalized execution receipts.

Raw token or reasoning deltas, streaming command output, transient progress,
heartbeats, leases, PIDs, sockets, provider-internal events, and retry timers stay
executor-local. Tool inputs and outputs carried into portable records remain
bounded, redacted, and subject to the destination Realm's information-flow
policy; large or restricted details use authorized artifact references rather
than being copied indiscriminately.

A surface disconnect recovers from a fresh executor snapshot. A supported process
restart on the same node recovers from the local journal. Temporary node loss uses
the configured wait, fallback, exit, or ask policy. Permanent node loss preserves
only checkpoints that reached another replica; any later side effect is explicitly
`outcome_unknown`, and any incomplete assistant block is lost or marked
unconfirmed rather than invented. Full Personal Realm mirroring is eventual
replication, not quorum durability: an offline node destroyed before synchronization
can lose locally journaled or locally committed progress.

#### Authorship ships as a strict subset of the north star

**Agreed direction — high confidence north star; initial linked-sync policy unresolved**

Initial delivery should use the simplest authoring model that its shipped topology
requires rather than implementing general distributed capabilities in advance. It
may have one mutation authority for a Personal Realm or omit concurrent writable
mirrors entirely. That is a delivery-stage restriction, not the permanent domain
model.

The north star is capability-scoped authorship. Full-mirror enrollment grants
retention of portable Realm state; it does not let every replica originate every
kind of truth. Eventually:

- enrolled personal replicas may originate additive personal history such as new
  Chats, user messages, and parent-anchored branches while offline;
- only the current fenced executor may originate assistant, tool, and execution
  checkpoints for its Run epoch;
- personal control records such as durable permission policy, deletion,
  enrollment, and revocation use separately defined authoring and reconciliation
  rules; and
- mounted foreign resources remain writable only through their governing
  authority or an explicitly permitted candidate workflow.

Forwarding a record never re-authors it. Stable record identities, parent anchors,
origin provenance, and executor epochs must therefore survive even the simple
model. The initial implementation need not build generic capability chains,
multi-writer settings merge, or distributed control-record consensus. It must only
avoid schemas and APIs that equate storage of a full copy with authority to author
all records. The exact first-delivery linked writer policy remains a later delivery
decision.

Personal nodes and the hub synchronize episodic state automatically through a
llame application protocol, not Git, PostgreSQL physical or logical replication,
or user-managed export. The selected design has three layers:

1. canonical domain state in the node's transactional store;
2. an immutable semantic `ChangeBatch` in a replication journal; and
3. local per-link delivery state such as outboxes, acknowledgements, retry state,
   cursors, and deduplication records.

A local portable mutation commits its domain changes and one atomic change batch
in the same transaction. A receiver authenticates and validates the batch, applies
its complete semantic mutation idempotently, records the original batch identity,
and makes it available for onward forwarding without manufacturing an echo
mutation. A batch carries a stable identity, Personal Realm and origin-node
identity, protocol version, affected resource identities, causal dependencies or
expected revisions, and typed operations. Hub-local `user_id` values and generated
database sequence numbers are projection details, not portable identity or order.

Every synchronization uses one reconciliation function and one set of validation,
authorization, idempotency, conflict, and coverage semantics. A session exchanges
the supported resource scope and each replica's known frontier, determines the
missing portable state, transfers a snapshot, change batches, or both, and returns
the resulting frontier and coverage verdict. A newly enrolled replica differs
only because it has no accepted frontier; it does not enter a separate import or
merge mode. Linking and its user confirmation authorize the relationship but do
not change synchronization semantics.

A consistent portable snapshot at frontier `F` is a compact representation of the
same canonical state produced by applying the replication journal through `F`.
It is not a privileged overwrite. The receiver applies the same domain invariants
and then consumes change batches after `F`. If retained incremental history no
longer covers any replica—not only a new one—the same reconciliation function may
select a fresh snapshot rather than infer continuity. The design deliberately
rejects both row/WAL replication and wholesale event sourcing. The hub remains
Postgres-backed, while the personal-node embedded store remains an implementation
decision, with SQLite as the leading candidate rather than a contract.

#### First delivery synchronizes the resumable episodic core

**Agreed direction — high confidence; exact schemas and retention unresolved**

The first synchronization capability does not attempt to mirror every mutable
Personal Realm resource. Its supported portable scope is the minimum normalized
state required to render, audit, fork, and safely resume a Chat from a semantic
checkpoint. Every first-contact and later reconciliation session supports the
same record classes:

- Chats, branches, messages and semantic parts, stable parent anchors, and full
  fork lineage;
- Runs plus the execution-segment, placement-epoch, and settlement metadata
  required to interpret their history and resume them safely;
- portable Run semantic checkpoints, compaction checkpoints, and context
  receipts;
- the frozen Run-effective Agent Profile and instruction snapshot or exact
  revision captured by the context receipt, without synchronizing mutable
  profile editing;
- Run-scoped one-time approval requests and decisions;
- normalized tool and side-effect intent/outcome receipts needed for recovery,
  including explicit `outcome_unknown`; and
- artifact manifests, references, hashes, provenance, and policy labels needed
  to render or resume the Run. Artifact payload transfer remains a separate,
  policy-controlled mechanism.

Mutable Agent Profile heads and edit history, general settings, persistent
permission policies, and deletion semantics stay outside the first-delivery
scope. They may become portable only after each resource has explicit authorship,
conflict, retention, and authorization rules; they are not generic last-write-wins
records.

Knowledge Space content continues to synchronize through Git and its publication
adapters rather than this journal. Provider credentials and other secrets,
node-local provider configuration, Workspace paths and registry state, and local
Sandbox configuration or installed packages never enter generic Personal Realm
synchronization. Neither do raw `run_events`, token or reasoning deltas, stdout or
progress chunks, queue rows, leases, process handles, live snapshots, or
rebuildable indexes and previews.

#### First delivery backfills causal dependencies at the sender

**Agreed direction — high confidence**

The first linked node-to-hub synchronization contract does not persist
out-of-order batches at the receiver. A sender retains every unacknowledged
`ChangeBatch` and transmits batches in causal order. The receiver validates the
envelope and authority, then either applies the complete batch atomically or
applies none of it.

When otherwise-authorized causal dependencies are absent, the receiver returns
their identities without recording the batch as accepted or partially mutating
domain state. The sender backfills those dependencies and retries the original
batch. If retained incremental history cannot supply them, the same
reconciliation function may select a consistent snapshot at a proven frontier
and continue from there. A missing dependency therefore means “not yet
applicable,” not “invalid.” An unauthorized parent or dependency is rejected.

Re-delivery of the same batch identity and payload is idempotent. Reuse of one
batch identity for a different payload is an integrity failure and fails closed.
A valid continuation whose parent is already known but has another child remains
valid: it creates explicit divergence and an automatic fork rather than entering
last-write-wins conflict resolution. Stable lineage and fork identity must not
depend on arrival order; the exact representation belongs to the focused
synchronization specification, not this vision discussion.

Durable out-of-order staging remains a north-star follow-up for multi-peer or
multi-hop delivery where the original sender may be unavailable. Its promotion
trigger is evidence that sender backfill or snapshot recovery cannot support a
shipped topology—not speculative protocol completeness.

#### Replica completeness is not revision ancestry

**Agreed direction — high confidence**

Every bootstrap, resume, and reconciliation operation carries a coverage verdict:

- `verified-complete`: the protocol can prove that the view contains all
  authority state required for this operation at a named snapshot, frontier, or
  fence;
- `partial`: some required state is known to be absent; or
- `unknown`: the replica cannot prove either completeness or a specific gap.

`verified-complete` is scoped to a resource, authority observation, and operation;
it is not a permanent property of a node. For a revisioned resource, the relation
between the candidate or local head and the governing authority's accepted head
is a separate axis: current, fast-forwardable, behind, diverged, or unknown.
The subject of that relation must be named. `current` means its OID equals the
observed accepted head; `fast-forwardable` means the accepted head is its ancestor;
`behind` means it is an ancestor of the accepted head; `diverged` means neither is
an ancestor of the other; and `unknown` means the required head or object graph
was not established. The relation is classified only from a validated authority
observation. A clean worktree, no observed merge conflict, a successful local
write, or globally unique record IDs do not prove completeness. UUIDs prevent
identity collisions; they do not reveal omitted records or concurrent ref
movement.

A partial or unknown replica may retain and ingest otherwise-valid additive,
identity-stable records and locally anchored candidate branches. It must not treat
absence from that view as evidence for deletion, deletion-record garbage collection,
canonical replacement, destructive compaction, a "fully absorbed" claim, or
completed reconciliation. The safe terminal state is explicit incompleteness,
never invented convergence.

This does not revoke the separately settled right to explicitly delete a Knowledge
Space. A policy-authorized manual deletion is a new authoritative action with its
own durable deletion record; it is not a conclusion inferred from an
incomplete replica.

Summaries do not form another knowledge store:

- a compaction checkpoint is synchronized episodic state because it determines
  later model context while leaving source messages canonical;
- a fork summary is regenerable until used, after which the exact injected text
  is preserved in the consuming Run's context receipt;
- a UI synopsis or search preview is a rebuildable local projection; and
- durable knowledge extracted from a Chat enters a Knowledge Space only through
  an explicit promotion and publication workflow.

### 5.11 Knowledge Spaces and absorption

**Agreed direction — high confidence**

- A Knowledge Space has a stable identity. Two spaces with the same name are not
  automatically the same resource.
- If local Knowledge Space A and remote Knowledge Space B have different IDs, both
  survive account linking and become independently synchronized personal spaces.
- Replicas of the same Knowledge Space ID use Git reconciliation.
- A Run that edits a Knowledge Space starts from an exact accepted commit and uses
  an isolated Git branch/worktree or jj workspace for its candidate changes.
- Semantic consolidation is an explicit agent workflow, potentially a Skill:
  "absorb A into B" reads both spaces, computes additions and conflicts, creates a
  candidate revision on B, and validates or reviews it before landing.
- Absorption never deletes or archives A. Deletion is an independent, manual UI
  action. The user may delete any Knowledge Space whether or not it was absorbed.

The UI may show a non-authoritative "fully absorbed" helper. An illustrative
heuristic discussed was:

```ts
records.every(
  (article) =>
    article.frontmatter.absorbed_at !== undefined &&
    article.frontmatter.absorbed_at !== null &&
    article.frontmatter.absorbed_at >= article.metadata.updated_at,
);
```

This is only an advisory signal. An empty collection makes `every` true;
timestamps require normalization; the destination space and revision should
probably be recorded; and attachments, links, or non-article records may make the
signal incomplete. It must never authorize deletion.

Copying knowledge across personal, shared, or organization-governed spaces also
requires information-flow authorization. Permission to read both sources does not
necessarily imply permission to copy one into the other.

Git-compatible commits, trees, and refs are the portable history and interchange
substrate. Publication is a separate, provider-aware workflow. A pull or merge
request still uses Git transport underneath; it is not a transport alternative.
The architecture therefore separates:

1. repository operations and transport: commit, branch, fetch, and push; and
2. a Knowledge publication adapter that submits, observes, updates, withdraws, or
   accepts a candidate revision when policy and permission allow.

Initial publication modes are:

| Mode             | Candidate publication and acceptance                                   |
| ---------------- | ---------------------------------------------------------------------- |
| Local-only       | Keep commits and the accepted ref local.                               |
| Raw Git direct   | Advance the configured accepted ref directly when policy permits.      |
| Raw Git proposal | Push a candidate branch for explicit external or llame-mediated merge. |
| GitHub           | Push the branch and use the provider's pull-request workflow.          |
| GitLab           | Push the branch and use the provider's merge-request workflow.         |
| Forgejo          | Push the branch and use the provider's pull-request workflow.          |

Adapters normalize the durable lifecycle—local draft, published, under review,
changes requested, accepted, rejected, withdrawn, or conflicted—while reporting
provider capabilities and retaining provider-specific metadata. They must not
pretend that review requirements, CI, merge queues, protected refs, or acceptance
permissions are identical. The governing authority, not the adapter or whichever
replica synchronized first, decides which revision becomes accepted.

#### Git reconciliation and the safe fallback

An offline or incomplete replica may create candidate commits and may publish a
collision-safe candidate branch or provider proposal when policy permits. Every
candidate records the exact accepted base OID from which it was derived.
Publishing that candidate is not acceptance, even when its branch push succeeds.
Until the actor performing acceptance has a current, fenced authority view,
incompleteness blocks accepted-ref mutation and destructive reconciliation; it
does not block authority-side review of a safely preserved candidate.

Advancing the accepted ref remains an authority-side operation. The governing
authority revalidates current membership and policy, fetches or otherwise observes
the current accepted head, classifies its relation to the candidate, validates the
candidate history, and fences the update against the exact old ref it observed by
compare-and-swap or an equivalent protected-ref mechanism. A lost race produces a
conflict for renewed reconciliation; it must not become a blind overwrite.

For a Personal Knowledge Space, "authority-side" does not select a permanent
canonical node. The governing authority is the Personal Realm; the coordination
mechanism that permits one enrolled replica or configured remote to act on its
current accepted ref remains an operational-replication decision.

`git pull` is therefore not one atomic synchronization primitive. The logical
sequence is fetch, establish the available coverage evidence, classify head
relation, and then fast-forward, merge, rebase, propose, reject, or ask for
reconciliation according to authority and policy.

When completeness or the accepted-head relation cannot be established, the
fallback is to preserve the candidate and its base, queue or publish it
explicitly as a proposal when allowed, and revalidate after authority access
returns. If the base is then behind or diverged, both histories survive into an
explicit merge/rebase/fork/review path. The replica must not silently advance
accepted state, infer deletions, prune or compact history from an incomplete view,
or claim that synchronization or absorption completed.

This fallback is lineage-preserving rather than self-healing. The retained
candidate keeps its exact base revision and any proposal identity already issued,
so later reconciliation compares concrete histories instead of reconstructing
intent from a partially observed replica.

### 5.12 Personal-first knowledge replication

**Agreed prioritization — high confidence**

Personal Knowledge Spaces come first. Shared and organization-governed spaces are
later. Their governing authority may select `online-only`, `offline-read`, or
`offline-propose`; `full-replica` remains initially reserved for Personal Realm
data until a shared data type has explicit reconciliation and revocation
semantics. Organization requirements must not inflate the personal synchronization
MVP.

### 5.13 Inference and Workspace egress policy

**Agreed direction — high confidence**

A local sandbox may use inference provided by the upstream node without receiving
the upstream provider credential. The local node sends the prompt and explicitly
scoped observations to an upstream inference broker; the upstream node calls the
provider and returns model output. Provider secrets never enter the daemon,
sandbox, model-visible context, or synchronization stream.

Keeping the credential secret does not keep Workspace data local. Prompt content,
file excerpts, and tool observations may leave the machine. Each Workspace should
therefore support these modes:

- `local-only`;
- `allow-upstream-models`;
- `ask-before-upstream-egress`; and
- an optional destination allowlist for providers or models.

Node-local providers and credentials remain supported. The unresolved routing
policy decides which eligible model is selected within the Workspace's allowed
destinations and the Run's requirements.

### 5.14 Sticky Workspace affinity and transparent recovery

**Agreed direction — high confidence**

Entering a Workspace makes its executor the active Chat branch/session's preferred
placement for future Runs. Most follow-ups should route directly back to that node
without a preliminary hub model call. This is sticky affinity, not permanent
authority or a hard availability dependency: every active Run still has exactly
one authority and reauthorizes current Workspace policy.

The execution placement/session durably retains the branch's active Workspace and
preferred executor across Runs. The current Run separately records its effective
Workspace and executor. Temporary loss of access detaches only the effective Run
context; it does not perform a durable `ExitWorkspace` or discard the session's
preference. Different branches of one Chat may hold different placements and run
against different Workspaces without turning placement into a Chat-global scalar.

Availability changes are part of the transparency contract. When a Workspace or
its node becomes unavailable, the model receives a recorded context transition
that names the previous Workspace, explains that its filesystem and tools are no
longer available, identifies the fallback context, and prohibits assumptions
about current Workspace state. The UI presents the same transition and choices.
When access returns, the model and UI receive a corresponding availability delta;
the notice is emitted once per transition or context-rebaseline boundary rather
than repeated unchanged on every call.

The outage UI exposes three actions:

1. **Wait for the original environment.** Keep the Run durably pending and resume
   automatic attachment attempts when the executor returns. No execution command
   is accepted while the authoritative `execution.*` endpoint is unreachable.
2. **Run temporarily with automatic recovery.** Continue on an eligible fallback
   without Workspace access, preserve the Chat binding, and transfer back at the
   next safe model/tool boundary after the original environment recovers.
3. **Exit Workspace completely.** Perform durable `ExitWorkspace`, clear the Chat
   binding and executor affinity, and do not return automatically.

`ExitWorkspace` is distinct from a future `ExitWorktree`: leaving a derived
worktree may return to its parent checkout without leaving the Workspace.

#### Remote observation and control

**Agreed direction — high confidence; detailed protocol unresolved**

An execution placement/session outlives one Run and is the routing handle that
lets another surface continue controlling the active branch. It records the
current authority node and fencing epoch, logical sandbox and Workspace handles,
recovery policy, and current Run. It must not expose a raw host path to surfaces
that are not authorized to see it.

##### Common Node Protocol boundary

**Agreed direction — high confidence; module schemas unresolved**

llame uses one versioned **Node Protocol** contract rather than requiring one
runtime stack. The protocol shares one endpoint shape, handshake, authenticated
principal binding, request and error envelope, cancellation and deadline model,
subscription conventions, and generated client surface. Direct local, direct
remote, and reverse-tunnel transports preserve the same request and response
semantics.

The contract is a capability-negotiated protocol family, not one flat API. Its
modules are independently versioned and authorized:

- `core.*` is mandatory and owns protocol negotiation, authenticated connection
  identity, node identity and roles, capability discovery, request lifecycle, and
  common errors;
- `realm.*` owns user-facing durable domain operations for Chats, branches,
  messages, Knowledge Spaces, Agent Profiles, settings, mounts, and durable
  placement or recovery preferences;
- `execution.*` owns live placements, executor and sandbox capabilities,
  Workspace discovery and entry, Run snapshots and subscriptions, approvals,
  steering, cancellation, and command disposition;
- `sync.*` owns replica-to-replica Personal Realm snapshots, frontiers, semantic
  change batches, coverage, acknowledgements, and schema compatibility; and
- `admin.*` owns enrollment, link and unlink, Workspace registration, provider and
  sandbox configuration, diagnostics, backup, and maintenance. It is unavailable
  through ordinary tunnels by default and requires a local or explicitly
  stronger-authorized channel.

Nodes advertise only supported module versions and capabilities. The hosted
NestJS/Postgres service, a single-owner daemon with an embedded store, Android's
limited local runtime, and a Claude Code or Codex adapter may implement the same
wire schemas without sharing storage, tenancy, framework, or complete capability
sets. An executor-only adapter can expose `core.*` and `execution.*`; a personal
replica normally also exposes `realm.*` and `sync.*`. Provider credentials remain
local and are never returned through capability discovery.

Caller identity comes from the authenticated channel, never a caller-selected
`user_id`. A hosted implementation maps that principal into tenant and RLS scope;
a personal node maps it to its sole owner. Model-facing tools remain a separate
contract: the model may call `EnterWorkspace`, while the trusted harness validates,
authorizes, and translates that request into internal execution operations. The
model never receives generic Node Protocol or `admin.*` access.

##### Execution transport and recovery

Local and hosted executors expose the same stateful, reconnectable
`execution.*` module. A local surface connects directly over a loopback or local
IPC transport; a remote surface reaches that exact module through an authenticated
reverse tunnel. The optional hub normally provides rendezvous, node presence,
routing, tunnel authorization, and connection-generation fencing. It does not
interpret or mirror the executor's active queue, live event history, tool state,
or process state.

The API must at minimum support reading the complete current Run snapshot,
attaching to a live Run, subscribing after a snapshot revision, submitting an
idempotent control command, and querying that command's disposition after an
ambiguous disconnect. Snapshots use stable semantic item identities and contain
states such as running, waiting for approval, cancellation pending, interrupted,
and terminal. A reconnect opens a new direct or tunneled connection, reads a fresh
snapshot, replaces the surface's stale projection, then subscribes after the
snapshot revision. A new snapshot repairs missing live deltas, so central durable
delta replay is not required.

Any authorized surface can send commands such as cancel or stop, approve or deny
an exact permission request, send a follow-up, or request `ExitWorkspace`. Every
command has a stable command id and targets the exact session, Run, and authority
epoch. The executor reauthorizes and deduplicates it and is the only component that
may advance execution. Changing executors advances the fencing epoch so a recovered
former authority cannot append stale results.

For the initial design, the tunnel relay is not a durable command mailbox. When the
executor is unreachable, `execution.*` rejects the command as unavailable; a
surface may retain an unsent local draft, but neither the UI nor model may call it
accepted, pending at the executor, cancelled, or approved. After reconnect it must
first read current state, because the attempted operation or an external side
effect may be `outcome_unknown`. Durable delayed delivery would be a later,
explicit outbox feature with different semantics, not an accidental property of
tunnelling.

This differs from Claude Code Remote Control's observed implementation, which
uploads ordered frontend events, worker metadata, delivery state, and separate
transcript events to its service. That design demonstrates the need for stable
identities, reconnect cursors, worker epochs, and idempotency, but llame need not
copy its server-side Run mirror because every llame surface can speak the same Node
Protocol execution contract. Codex App Server's thread read, running-thread rejoin,
and disk-backed resume behavior are closer adapter precedents. Neither precedent
can restore an arbitrary in-flight OS process after executor loss; adapters must
report an honest interrupted or unknown state.

State replication, session control, and authority handoff are separate protocols:
replication converges durable personal state; session control routes commands and
live observations to the current authority; handoff explicitly changes that
authority. A synchronized `RunCreated` fact never authorizes another replica to
enqueue or re-execute the Run.

### 5.15 Workspace outage policy

**Agreed direction — high confidence**

The persistent per-Workspace policy uses the same vocabulary as the incident UI:

```yaml
on_workspace_unavailable: ask | wait | fallback | exit
```

- `ask` pauses and presents the three incident actions.
- `wait` automatically retries attachment until the original environment
  recovers; it does not enqueue an offline execution command.
- `fallback` automatically starts the temporary detached execution and returns
  when the original environment recovers.
- `exit` automatically performs durable `ExitWorkspace` and continues unbound.

Every automatic action remains visible to the user and model and may be overridden
for the current incident. "Remember this choice" changes the Workspace policy.
There is no hidden timeout or hidden fallback while waiting.

Recovery preference cannot override other authority. A fallback executor must
satisfy Workspace permissions and inference-egress policy. If no eligible
fallback exists, including when Workspace egress policy prohibits it, `fallback`
degrades to `wait` and discloses why. If side effects from a lost authoritative
segment may be in flight, automatic fallback or exit creates an explicit
`outcome_unknown` fork rather than pretending to continue the same branch; the
harness may still require incident-specific confirmation for operations that
cannot safely be duplicated.

### 5.16 Node enrollment and deployment roles

**Agreed direction — high confidence**

Node identity is distinct from user identity. Each node instance generates a
stable cryptographic `node_id` and keypair. OAuth authenticates the user only to
authorize enrollment; the hub registers the public key and issues a narrow,
renewable synchronization and coordination credential bound to that node. The
daemon never stores the user's general hub session or the hub's provider secrets.

Enrollment is revocable and shown in account UI with the node's name,
capabilities, synchronization state, and enrollment time. Revocation prevents
future synchronization, inference brokering, and Run routing but cannot retract
data already mirrored to the device. Re-enrollment is a new trust decision.

#### Simple-first enrollment identity

**Agreed initial direction — high confidence; storage backend unresolved**

The first enrollment lifecycle uses disposable cryptographic node identities:

1. a node generates a fresh keypair and `node_id` locally;
2. an OAuth or device-link flow authenticates the user and authorizes the hub to
   enroll that public identity for one account;
3. subsequent synchronization, tunnel, and coordination credentials are narrow,
   renewable, and bound to proof of that node key; and
4. unlink or remote revocation permanently invalidates that enrolled identity.

A revoked identity is never reactivated. Linking the same local profile again
generates a new keypair and `node_id` and performs an ordinary new enrollment. The
old identity remains a revoked historical principal for provenance and audit. The
initial design has no private-key export, identity recovery, or key rotation that
preserves the old `node_id`.

Remote revocation prevents future hub-mediated sync, tunnels, inference brokering,
and Run routing. It cannot erase already mirrored data, stop the node operating as
a standalone local installation, or prove that a physically lost device destroyed
its key. The UI must state those limits rather than describing revocation as remote
wipe.

Local key storage must be permission-restricted and excluded from synchronized
state and backups unless an explicit secret-backup design exists. The exact use of
an OS credential store, hardware-backed key, encrypted file, or other backend is an
implementation decision for the target platform.

#### Enrollment north star and later follow-ups

Later work may add non-disruptive key rotation, hardware-backed keys, encrypted
recovery, revocation propagation among multiple coordination peers, hub-loss
re-homing, and a verifiable cutoff for records authored by an offline node around
revocation. Those mechanisms require an explicit threat model and recovery proof;
none is silently approximated by copying the initial private key between nodes.

The deployment split is permanent rather than a planned migration:

- a **personal node** is an implicitly single-owner local store with no user table
  or per-record `user_id`;
- the **hub service** is the current multi-user stack with authentication,
  explicit ownership, RLS, memberships, and policy; and
- an **executor** is an independently described capability that may belong to a
  personal node or be managed by a hub.

One personal-node instance is unlinked or linked to one hub account. Multiple
instances may run under one OS user for different llame users or profiles. That is
application isolation, not a security boundary: processes under the same OS user
can potentially read one another's files and credentials. Mutually untrusted
people require separate OS users, containers/VMs, or the multi-user hub.

Registering the same writable Workspace with multiple daemon instances should be
rejected or strongly warned by default because concurrent agents can corrupt the
checkout. A deliberately shared arrangement needs explicit isolation such as
separate worktrees or read-only access.

### 5.17 Unlink and relink boundaries

**Agreed direction — high confidence**

Unlinking is a two-sided trust operation, not a local preference toggle. It revokes
the node's currently enrolled cryptographic identity and credentials at the hub,
then removes the local enrollment credential. It stops future synchronization,
inference brokering, and Run routing but deletes no local or hub data.

If the hub is unreachable, the node cannot truthfully report completed
cryptographic revocation. The user must retry when online or revoke the enrollment
from another authenticated hub surface. A merely local disconnect remains visibly
incomplete until the hub has revoked the enrollment.

The first version deliberately avoids identity resurrection and cross-account
corpus transfer:

- a populated profile may link again to the same hub account under a newly
  generated node identity and then perform normal bidirectional reconciliation;
- an empty profile may link to another account through the ordinary first-link
  flow; and
- a populated profile previously linked to another account cannot use ordinary
  linking. The user creates another profile or explicitly erases/exports the old
  one.

The node retains enough non-secret previous-link metadata to distinguish those
cases without adding per-record local `user_id`. No revoked identity is reused,
and no cross-account migration, identity-rewriting, or confirmation maze is
designed until real demand exists.

### 5.18 Multi-authority resource federation

**Agreed direction — high confidence; operational protocols unresolved**

A **Personal Realm** is one logical ownership and reconciliation boundary with
many trusted physical replicas. CLI, Android, desktop, other personal nodes, and
an optionally linked hub account may all originate personal changes; none is
inherently the one canonical physical home. Personal replica enrollment remains
distinct from access to foreign authorities.

A local profile may connect to any number of work, family, school, community, or
other authorities. Each connection binds the profile to an authority-local
subject; it does not assert a globally trusted identity merge. Every shared Space
has one governing authority for membership, accepted revisions, retention,
replication permission, and information-flow policy. Its durable identity is
authority-qualified rather than an installation-local id treated as globally
sufficient.

Foreign resources are **mounted** into the user's view and are never silently
absorbed into the Personal Realm. Every Chat or Run branch has a destination
authority. A source may contribute content only when its policy permits flow to
that destination, executor, and inference provider; otherwise the system must
offer an appropriately scoped branch or exclude the source. Long-lived foreign
credentials stay with their connection broker, while executors receive proxied
operations or narrow, short-lived delegation.

The selected delivery sequence is:

1. **Phase A — closed installations with explicit exchange:** standalone and hub
   products, explicit import/export, and pinned read-only Git sources with
   explicit forks and provenance;
2. **Phase B — live multi-authority connections:** online mounts whose reads and
   writes remain authorized by their governing authority, without mandatory
   persistent copies; and
3. **Phase C — policy-controlled shared replication:** `online-only`,
   `offline-read`, and `offline-propose` modes, with explicit migration and fork
   lineage.

Phase A remains a supported disconnected mode after later phases ship. Mandatory
full mirroring of every connected upstream, one universal llame identity/data
authority, ownerless shared ACL state, and automatic hub-to-hub federation are not
the selected direction. The complete option set and decision rationale remain in
the
[multi-authority federation research](2026-08-21-multi-authority-federation-models.md).

## 6. Candidate mechanisms, not product commitments

The following mechanism remains promising:

```text
Git repository
  -> pinned Nix environment and managed dotfiles
  -> validated build
  -> OCI/runtime artifact
  -> Docker sandbox with explicit Workspace mounts
```

Its strengths are reproducible dependency resolution, reviewable configuration,
rebuildability, and revision pinning. The boundary should have one source of
truth: avoid making a full NixOS configuration and a Dockerfile two competing
package-management systems. If Docker is used, its Dockerfile should probably be
a thin bootstrap around the pinned environment.

This mechanism is not yet selected. Full NixOS may be unnecessary if a Nix
development environment plus OCI image provides the required reproducibility.
Docker also does not by itself provide an adequate hostile multi-tenant security
boundary. The threat model must determine whether containers, stronger VMs, or
multiple backends are required.

Environment definitions may synchronize to all personal nodes, but only
execution-capable nodes realize them. Android can retain the definition metadata
without pretending it can build or run the environment.

The source-of-record split is selected even though the personal-node storage
engine remains undecided. Git-compatible repositories hold mergeable knowledge
and selected non-secret configuration histories, published through configured
raw Git or forge-aware workflows. Database-native episodic state synchronizes
through the llame application protocol. Git does not solve ordered Chat state,
grants, audit records, queue ownership, or transactional account linking, and
PostgreSQL replication is not the cross-node protocol. Whether a personal node
uses SQLite, an append-only log, or another embedded store must follow that
contract rather than precede it. The hub retains its multi-user Postgres ownership
and RLS responsibilities. NestJS may remain its API and worker framework without
becoming the portable protocol or domain model.

## 7. Important corrections and rejected conflations

These corrections are durable constraints on further design:

- **Surface is not node.** A CLI and desktop UI can share one local node.
- **Host is not node.** One host or OS user may run multiple independently
  identified personal-node instances.
- **Node is not user.** Enrollment associates a cryptographic node identity with
  a hub account; it does not make the machine the person.
- **Personal node is not multi-user hub.** Personal nodes use an implicit local
  owner; the hub derives explicit ownership at its authenticated boundary.
- **Workspace is not sandbox.** Project files are mounted into an execution
  environment; they are not the environment definition.
- **Workspace contents are not personal-state synchronization.** Registration and
  remote execution do not authorize cloning repositories between machines.
- **Agent Profile is not identity or placement.** It describes agent behavior, not
  the user, host, Workspace, or sandbox.
- **Run continuity is not live-process migration.** Cross-node continuation uses
  durable execution segments.
- **Personal Realm is not node, account, or unified view.** It is the logical
  ownership and reconciliation boundary for portable personal state.
- **Git is not the complete sync protocol.** It fits knowledge and selected
  versioned resources, not episodic or operational state.
- **A pull or merge request is not Git transport.** Forge review workflows layer
  policy and acceptance over Git commits, refs, fetch, and push.
- **No observed Git conflict is not proof of replica completeness.** Revision
  ancestry and coverage of authority state are independent facts.
- **Candidate publication is not acceptance.** A pushed branch or opened proposal
  remains tentative until the governing authority fences and accepts it.
- **A generated summary is not knowledge.** It remains derived Chat state unless
  explicitly promoted into a Knowledge Space.
- **Nix reproducibility is not sandbox security.** It makes an environment
  rebuildable, not safely isolated.
- **A Docker bind is not permission semantics.** The daemon and permission engine
  decide what may be mounted; the model cannot directly request host paths.
- **A full personal mirror is a simpler product promise, not a simpler system.** It
  expands enrollment, encryption, revocation, conflict, and storage obligations.
- **Credential secrecy is not data locality.** Upstream inference still creates an
  egress decision for Workspace content.
- **Absorption is not deletion.** Consolidating knowledge and destroying the
  source are separate actions.
- **Automatic placement is not mandatory placement.** Many questions should stay
  on the initiating executor.
- **Workspace binding is not current Workspace availability.** A Run may be
  transparently detached while the Chat retains its preferred Workspace.
- **Revocation is not remote erasure.** A hub can stop trusting a node but cannot
  guarantee deletion of data already mirrored to it.
- **Unlink is not local logout.** It includes hub-side cryptographic enrollment
  revocation and deletes no mirrored data.
- **The hub service is a synchronization hub, not a prerequisite for local
  agency.**

## 8. Relationship to current llame direction

This direction is consistent with several existing commitments:

- [`VISION.md`](../../../VISION.md) already describes multi-machine access,
  portable data, isolated execution, Agent Profiles, workers/sandboxes, and
  versioned runtime configuration.
- The earlier
  [product-vision synthesis](2026-07-15-working-synthesis/report.md) already
  explores resource boundaries, Chat Workspaces, worktree or copy-on-write
  execution, enrolled Workers, external harnesses, and versioned
  self-improvement.
- [`SPEC.md`](../../../SPEC.md) correctly states that current shipped llame does
  not yet provide the project-filesystem Workspace described here and that its
  operational state remains Postgres-backed.

This discussion materially extends the earlier direction in nineteen areas:

1. a linked machine is not only a remotely controlled Worker; it can be an
   autonomous personal node with a full personal mirror;
2. CLI and Android are local-capable surfaces over the same logical node contract,
   with intentionally different executor capabilities;
3. one Run may contain durable execution segments placed on different nodes;
4. account linking and offline reconciliation become first-class product
   contracts rather than deployment details;
5. Run advancement uses transferable single-node authority rather than permanent
   hub ownership;
6. Workspace affinity, loss, fallback, and recovery become explicit model-visible
   and UI-visible state transitions;
7. single-owner personal nodes and the multi-user hub become permanent deployment
   roles connected by a portable sync protocol;
8. one Personal Realm may present mounted resources from many independently
   governed authorities without merging identities, ownership, or replication
   policy;
9. Git-backed knowledge publication composes portable Git history with raw Git or
   forge-aware change-workflow adapters; and
10. database-native episodic history synchronizes through an application protocol
    without making Git or PostgreSQL replication the universal substrate;
11. episodic mutations use atomic semantic change batches rather than table
    replication or wholesale event sourcing; and
12. local and hosted nodes share one modular, capability-negotiated Node Protocol
    contract without sharing an implementation stack; its stateful `execution.*`
    module is reached directly or through an authenticated tunnel so remote
    surfaces retain control without a hub-owned Run-state or queue mirror; and
13. active Runs separate live executor state, an executor-local recovery journal,
    and portable Realm semantic checkpoints; raw execution deltas never become
    the federation contract merely because one implementation persists them; and
14. delivery may begin with a single-authority authoring subset, while the durable
    north star keeps record authorship capability-scoped and distinct from replica
    retention; and
15. execution handoff initially uses the linked hub as a per-placement fencing
    service, while later coordination topologies must preserve the same singular
    authority epoch and honest failure semantics; and
16. initial enrollment uses disposable node identities: revocation is permanent,
    relinking creates a new principal, and identity-preserving rotation or recovery
    remains later work; and
17. a replica's first contact and every later synchronization use one
    reconciliation function; snapshots compact journal prefixes without creating
    separate import or overwrite semantics; and
18. first delivery synchronizes a deliberately bounded resumable Chat/Run core,
    while mutable policy/configuration resources, Knowledge Space transport,
    artifact payloads, secrets, and executor-local mechanics retain separate
    contracts; and
19. first delivery handles missing causal dependencies through atomic rejection,
    sender backfill, and retry rather than a receiver-side out-of-order store;
    automatic forks preserve valid concurrent continuations without
    last-write-wins reconciliation.

There is also a real tension with a simple "central control plane plus workers"
model. Once personal nodes can originate durable state while unlinked, the
upstream database is no longer the sole temporal authority for that personal
state. That conflict must be resolved explicitly in the synchronization and
identity design; relabeling nodes as workers will not solve it.

No current shipped contract changes merely because this research note exists.

## 9. Vision closure

This product-direction exploration is closed for now. It is not blocked on
protocol completeness. The discussion has established the product boundary,
surface and node model, Workspace and Sandbox distinction, authority and failure
semantics, storage-class boundaries, federation direction, first-delivery
simplifications, north-star invariants, and staged shipping model.

### 9.1 Closure rule

Reopen the vision only when new evidence invalidates a settled product invariant
or a prioritized delivery cannot fit the model. Exact schemas, APIs, state
machines, storage engines, cryptographic mechanisms, retry algorithms, and
conformance cases are capability-design work. They belong in focused artifacts
when that capability is selected for delivery, not in an ever-growing list of
questions that must be answered before the vision can finish.

“Simple first” retains four constraints: preserve stable identity and provenance,
keep authority and failure semantics explicit, record north-star follow-ups, and
promote a follow-up only when a shipped topology or measured limitation requires
it. It does not require predesigning every follow-up.

### 9.2 Deferred specification backlog

The remaining work is intentionally grouped by capability and does not block
vision closure:

1. **Personal Realm synchronization:** exact schemas, frontiers, retention,
   authorship, fork representation, later mutable resources, deletion, and
   artifact transfer.
2. **Node enrollment and execution:** credentials, revocation delivery, Node
   Protocol schemas, tunnelling, recovery guarantees, handoff state machines, and
   conformance tests.
3. **Workspace execution:** registry privacy, binding lifecycle, permissions,
   Sandbox layering and isolation, and Git worktree lifecycle.
4. **Knowledge and foreign authorities:** publication adapters, absorption,
   coverage proof, shared replication policy, revocation, and cross-boundary
   information flow.
5. **Surfaces and inference:** CLI and Android contracts, provider routing,
   credential brokering, model continuity, and degraded operation.
6. **Delivery planning:** decompose only the next chosen product slice into an
   OpenSpec change and actionable roadmap work. Personal Knowledge Spaces remain
   the nearer-term priority; full Realm replication and distributed execution are
   not one deliverable.

New implementation questions go into the relevant focused artifact. They should
not grow this research note or reopen the entire product direction by default.

## 10. Recommended next action

Stop hardening the federation protocol in the abstract. In a separate decision,
choose whether to distill the stable product direction into `VISION.md` now or
leave these notes as provenance until the next concrete product slice is chosen.
Do not start another chain of low-level synchronization questions here.

## 11. Promotion boundary

This note is evidence and decision provenance, not a shipped promise. Promotion
should happen in stages:

1. distill the durable north-star and principles into `VISION.md`;
2. create focused OpenSpec changes for specific capability contracts;
3. keep `SPEC.md` limited to shipped cross-cutting invariants; and
4. add only sequenced, actionable work to `ROADMAP.md`.

Until that promotion occurs, disagreements should be resolved here or in a
successor research note rather than silently encoded in implementation.
