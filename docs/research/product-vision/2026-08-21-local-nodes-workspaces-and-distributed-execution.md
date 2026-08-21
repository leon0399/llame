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
direction.

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

| Term                   | Meaning                                                                                                                                    | Not the same as                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Surface**            | A user interaction surface such as CLI, web, desktop, or Android system assistant.                                                         | Node, executor, or storage authority.                   |
| **Host**               | A physical device or OS environment that may run one or more llame node instances.                                                         | Node identity or user identity.                         |
| **Node**               | An independently operable llame installation with local identity, durable state, configuration, and zero or more executors.                | A UI surface or a single Run.                           |
| **Personal node**      | A single-owner local node with no internal user tenancy. It may remain unlinked or link to one hub account.                                | Multi-user service or physical host.                    |
| **Hub service**        | The optional account-linked, multi-user synchronization and coordination service. It may also execute Runs.                                | Mandatory control plane for local operation.            |
| **Executor / worker**  | A capability endpoint able to perform some execution, such as inference, tools, shell work, or sandboxed code work.                        | Node identity or Workspace.                             |
| **Agent Profile**      | Prompt, model preferences, Skills, tool defaults, and optional memory behavior.                                                            | User identity, machine identity, Workspace, or sandbox. |
| **Chat**               | The durable continuity container for messages, Runs, lineage, and current contextual bindings.                                             | One process or one model call.                          |
| **Run**                | One durable user turn and its resulting agent activity.                                                                                    | One executor process.                                   |
| **Execution segment**  | An immutable portion of a Run pinned to a node, model, tool set, Workspace binding, and context receipt. A Run may have multiple segments. | Live-process migration.                                 |
| **Workspace**          | A user-selected project directory, Git repository, codebase, or collection of files.                                                       | Sandbox environment, Home, or Knowledge Space.          |
| **Workspace view**     | A derived worktree, copy-on-write checkout, or overlay used for isolated execution.                                                        | Synchronization replica.                                |
| **Sandbox definition** | A versioned, reproducible description of system tools, packages, managed dotfiles, and permitted runtime configuration.                    | A project Workspace.                                    |
| **Sandbox instance**   | A container, VM, or process-level realization of a sandbox definition, with explicit Workspace mounts and scratch storage.                 | The durable definition or Workspace itself.             |
| **Home**               | User-owned durable context and artifacts that are not ordinary project files.                                                              | Arbitrary host filesystem access.                       |
| **Knowledge Space**    | A separately identified, Git-backed body of knowledge with its own history and governance.                                                 | Chat history or a project checkout.                     |

The earlier phrase "the assistant's self-managed workspace" was misleading. The
self-managed system environment is the **sandbox**. A Workspace is a specific
directory or repository mounted into it.

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

**Agreed direction — moderate confidence; protocol unresolved**

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

A successful entry durably binds the Chat to that Workspace. Follow-up Runs
reattach automatically and do not ask merely because a new turn began. Each Run
still silently reauthorizes the binding against current policy and availability.
Revocation, policy narrowing, node removal, or lost capability fails closed.
Continuity is not authority.

Entering a different Workspace, exiting and later re-entering, or starting a new
Chat causes a new policy evaluation. A one-time "Yes" approves only the pending
call. A separate "Yes, and allow in future" action both approves it and persists a
revocable rule normalized around principal, stable Workspace identity, tool,
access mode, and scope. It must not store a brittle allow rule keyed only by raw
tool-call JSON.

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
owns it initially. A cross-node continuation durably freezes the source at a
known event, records the target and a newer authority epoch through the hub, and
allows only the acknowledged target to append further events. Authority transfers
to the target executor rather than remaining permanently at the hub. It remains
there until the Run terminates or another explicit handoff occurs; the hub acts as
handoff arbiter, transport, and replica.

If an authoritative executor disappears after beginning work, another node cannot
silently seize the same branch: the executor may still be advancing offline or
may have performed side effects. Recovery waits for it or creates a visible fork
from the last confirmed event with the interrupted segment marked
`outcome_unknown`.

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

**Agreed direction — moderate confidence; storage protocol unresolved**

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

### 5.11 Knowledge Spaces and absorption

**Agreed direction — high confidence**

- A Knowledge Space has a stable identity. Two spaces with the same name are not
  automatically the same resource.
- If local Knowledge Space A and remote Knowledge Space B have different IDs, both
  survive account linking and become independently synchronized personal spaces.
- Replicas of the same Knowledge Space ID use Git reconciliation.
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

Entering a Workspace makes its executor the Chat's preferred placement for future
Runs. Most follow-ups should route directly back to that node without a
preliminary hub model call. This is sticky affinity, not permanent authority or a
hard availability dependency: every new Run receives its own authority and still
reauthorizes current Workspace policy.

The Chat durably retains its active Workspace and preferred executor. The current
Run separately records its effective Workspace and executor. Temporary loss of
access detaches only the effective Run context; it does not perform a durable
`ExitWorkspace` or discard the Chat's preference.

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
   automatically when the executor returns.
2. **Run temporarily with automatic recovery.** Continue on an eligible fallback
   without Workspace access, preserve the Chat binding, and transfer back at the
   next safe model/tool boundary after the original environment recovers.
3. **Exit Workspace completely.** Perform durable `ExitWorkspace`, clear the Chat
   binding and executor affinity, and do not return automatically.

`ExitWorkspace` is distinct from a future `ExitWorktree`: leaving a derived
worktree may return to its parent checkout without leaving the Workspace.

### 5.15 Workspace outage policy

**Agreed direction — high confidence**

The persistent per-Workspace policy uses the same vocabulary as the incident UI:

```yaml
on_workspace_unavailable: ask | wait | fallback | exit
```

- `ask` pauses and presents the three incident actions.
- `wait` automatically queues until the original environment recovers.
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

The first version deliberately avoids cross-account corpus transfer:

- a populated profile may re-enroll with the same hub account and perform normal
  bidirectional reconciliation;
- an empty profile may link to another account through the ordinary first-link
  flow; and
- a populated profile previously linked to another account cannot use ordinary
  linking. The user creates another profile or explicitly erases/exports the old
  one.

The node retains enough non-secret previous-link metadata to distinguish those
cases without adding per-record local `user_id`. No cross-account migration,
identity-rewriting, or confirmation maze is designed until real demand exists.

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

Storage engines remain intentionally undecided. Git is suitable for mergeable
knowledge and configuration histories; it does not solve ordered Chat events,
grants, audit records, queue ownership, or transactional account linking. Whether
a personal node uses SQLite, an append-only log, or another embedded store must
follow the replication contract rather than precede it. The hub retains its
multi-user Postgres ownership and RLS responsibilities. NestJS may remain its API
and worker framework without becoming the portable protocol or domain model.

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
- **Git is not the complete sync protocol.** It fits some resources but not all
  operational state.
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

This discussion materially extends the earlier direction in eight areas:

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
   and UI-visible state transitions; and
7. single-owner personal nodes and the multi-user hub become permanent deployment
   roles connected by a portable sync protocol; and
8. one Personal Realm may present mounted resources from many independently
   governed authorities without merging identities, ownership, or replication
   policy.

There is also a real tension with a simple "central control plane plus workers"
model. Once personal nodes can originate durable state while unlinked, the
upstream database is no longer the sole temporal authority for that personal
state. That conflict must be resolved explicitly in the synchronization and
identity design; relabeling nodes as workers will not solve it.

No current shipped contract changes merely because this research note exists.

## 9. Decisions still required

Resolve these roughly in dependency order. Premature framework selection would
create false constraints.

1. **Authority-handoff mechanics.** Specify epochs or fencing, the durable handoff
   record, source freeze and target acknowledgement, retry and cancellation,
   reconnect behavior, and classification of uncertain side effects. The
   ownership direction is settled; the protocol is not.
2. **Enrollment and device-loss mechanics.** Specify key storage and rotation,
   enrollment confirmation, revocation delivery, encryption at rest, backup, and
   recovery. Node/user separation, OAuth-authorized enrollment, cryptographic
   unlink, and the deliberately restricted relink behavior are settled.
3. **Personal Realm operational replication.** The authority map is settled at
   the product level: trusted Personal Realm replicas may originate personal
   state, every shared Space retains one governing authority, every Chat or Run
   branch has a destination authority, and active Run execution remains
   single-authority. Specify the portable event model for Chats, Runs, messages,
   approvals, audits, compaction, context receipts, stable IDs, ordering,
   resumability, per-resource merge/fork/proposal/rejection, and schema evolution.
4. **Workspace binding details.** Specify switching, archival, access-mode
   changes, reauthorization, retention, availability detection and debounce, and
   the exact recovery behavior for active versus not-yet-started Runs. Sticky
   affinity and the four outage modes are settled.
5. **Workspace registry privacy and liveness.** Define handle creation, path
   redaction, labels, capability advertisement, online/offline state, stale
   registrations, and what metadata each surface may see.
6. **General permission model.** Extend `EnterWorkspace` into reusable scoped
   `allow`/`ask`/`deny` rules, persistent approvals, revocation, audit, prompt
   lifecycle, and separation among mount, filesystem, network, secret, device,
   publish, and destructive-operation authority.
7. **Sandbox-definition layering.** Decide which environment settings are global,
   per user, per Agent Profile, per node, or per project; how candidate changes are
   validated; and how accepted revisions, activation, rollback, and garbage
   collection work.
8. **Sandbox threat model and backend.** Define trusted versus hostile workloads,
   network policy, CPU/memory limits, host interfaces, secret access, filesystem
   isolation, and whether containers are sufficient or VM isolation is required.
9. **Worktree lifecycle.** Define branch naming, base revision, concurrent Runs,
   uncommitted source changes, publish/merge behavior, retention, cleanup, and
   recovery after daemon failure.
10. **Inference routing and broker protocol.** Define destination selection,
    Workspace egress enforcement, context minimization, streaming, accounting,
    provider failures, node-local credentials, and model continuity across
    segments.
11. **Knowledge synchronization and absorption.** Specify same-ID Git conflict
    handling, repository transport, revision authenticity, the absorption Skill,
    provenance, and the optional UI advisory signal.
12. **Shared and organization knowledge policy mechanics.** The directional modes
    are selected: `online-only`, `offline-read`, and `offline-propose`, while
    `full-replica` is initially personal-only. Later define authorization leases,
    retained-copy handling, revalidation, candidate acceptance, revocation,
    migration, and cross-boundary information flow.
13. **CLI contract.** Define new versus resumed Chats, cwd-only advertisement,
    daemon discovery, shared local store, local provider configuration, link and
    unlink behavior, and degraded operation.
14. **Android contract.** Define offline model support, Android assistant
    integration, bounded device tools, local storage, remote Run steering,
    handoff, waiting, and user-visible executor state.
15. **Protocol and storage decomposition.** Define the portable schemas and
    conformance boundary shared by personal nodes and the hub, then decide which
    domain types belong in shared TypeScript packages and which embedded store
    implements the personal-node side. The hub remains the multi-user service
    boundary; its current implementation is NestJS/Postgres.
16. **Roadmap decomposition.** Split the direction into independently valuable
    horizons. Personal Knowledge Spaces remain the nearer-term priority; full
    node replication and distributed execution should not be disguised as one
    deliverable.

## 10. Recommended next discussion

Start with the **Personal Realm operational replication model**. The
multi-authority boundary is settled at the product level: personal state may be
originated by trusted Personal Realm replicas, while mounted shared Spaces retain
one governing authority. The next dependency is the per-resource reconciliation
contract, not another topology comparison.

The first concrete question should be:

> For each Personal Realm resource type—Knowledge Space, Chat branch, Run record,
> message, approval, memory, configuration, and artifact—which enrolled replicas
> may author it while disconnected, and does reconnection merge, fork, propose,
> reject, or require explicit user reconciliation?

Do not choose Postgres versus SQLite, NixOS versus a Nix-built OCI image, or NestJS
module boundaries before answering that question. Those are implementation
choices downstream of the execution and replication contracts.

## 11. Promotion boundary

This note is evidence and decision provenance, not a shipped promise. Promotion
should happen in stages:

1. distill the durable north-star and principles into `VISION.md`;
2. create focused OpenSpec changes for specific capability contracts;
3. keep `SPEC.md` limited to shipped cross-cutting invariants; and
4. add only sequenced, actionable work to `ROADMAP.md`.

Until that promotion occurs, disagreements should be resolved here or in a
successor research note rather than silently encoded in implementation.
