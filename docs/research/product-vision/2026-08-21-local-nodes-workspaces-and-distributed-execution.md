# Local Nodes, Workspaces, and Distributed Execution

Recorded 2026-08-21. Noncanonical discussion checkpoint — this document preserves
the direction explored with Leo before it is promoted into `VISION.md`, capability
specifications, or the roadmap. It distinguishes agreed product direction from
candidate implementation mechanisms and unresolved decisions.

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
                    optional upstream llame node
                   /            |              \
          desktop node     another host     Android node
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

The differentiator is not "agents on many devices." It is late-bound,
capability-aware execution with durable conversational continuity: a Run can begin
where the user asks, remain there for ordinary reasoning, and acquire or transfer
to a more capable execution context only when the task requires it.

## 4. Vocabulary and boundaries

| Term                   | Meaning                                                                                                                                    | Not the same as                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Surface**            | A user interaction surface such as CLI, web, desktop, or Android system assistant.                                                         | Node, executor, or storage authority.                   |
| **Node**               | An independently operable llame installation with local identity, durable state, configuration, and zero or more executors.                | A UI surface or a single Run.                           |
| **Upstream node**      | The optional account-linked synchronization and coordination hub. It may also execute Runs.                                                | Mandatory control plane for local operation.            |
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
4. both sides reconcile replicas of the same identities; and
5. distinct resources remain distinct rather than being merged by name.

This is full bidirectional synchronization, not "remote overwrites local" or
"local becomes a client." The exact transaction, resumability, and rollback model
remain open.

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
later. Their eventual governing policy should choose among full mirror, read-only
cache, and online-only access. Organization requirements must not inflate the
personal synchronization MVP.

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

Storage and framework choices are intentionally not decided here. Git is suitable
for mergeable knowledge and configuration histories; it does not solve ordered
Chat events, grants, audit records, queue ownership, or transactional account
linking. Whether a local node uses SQLite, Postgres, an append-only log, or another
store must follow the replication contract rather than precede it. Likewise,
NestJS may remain the API and worker framework without becoming the protocol or
domain model.

## 7. Important corrections and rejected conflations

These corrections are durable constraints on further design:

- **Surface is not node.** A CLI and desktop UI can share one local node.
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
- **The upstream node is a synchronization hub, not a prerequisite for local
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

This discussion materially extends the earlier direction in four areas:

1. a linked machine is not only a remotely controlled Worker; it can be an
   autonomous personal node with a full personal mirror;
2. CLI and Android are local-capable surfaces over the same logical node contract,
   with intentionally different executor capabilities;
3. one Run may contain durable execution segments placed on different nodes; and
4. account linking and offline reconciliation become first-class product
   contracts rather than deployment details.

There is also a real tension with a simple "central control plane plus workers"
model. Once personal nodes can originate durable state while unlinked, the
upstream database is no longer the sole temporal authority for that personal
state. That conflict must be resolved explicitly in the synchronization and
identity design; relabeling nodes as workers will not solve it.

No current shipped contract changes merely because this research note exists.

## 9. Decisions still required

Resolve these roughly in dependency order. Premature framework selection would
create false constraints.

1. **Run ownership and coordination.** Define who owns a Run before, during, and
   after a cross-node execution segment; which node may advance it; how leases,
   retries, cancellation, and outcome uncertainty work; and whether the upstream
   node is coordinator, replica, or both.
2. **Node identity and enrollment.** Define local identity before linking, account
   mapping, device keys, trust establishment, explicit confirmation, revocation,
   loss, encryption at rest, remote erasure semantics, and recovery.
3. **Operational replication protocol.** Specify the portable event model for
   Chats, Runs, messages, approvals, audits, compaction, context receipts, stable
   IDs, ordering, resumability, fork reconciliation, and schema evolution.
4. **Workspace binding lifecycle.** Specify Chat binding, `ExitWorkspace`, switching,
   archival, access-mode changes, reauthorization, retention, and the difference
   between same-node entry and cross-node continuation.
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
12. **Shared and organization knowledge.** Later, define governance-controlled
    full mirror, read-only cache, online-only modes, and cross-boundary information
    flow.
13. **CLI contract.** Define new versus resumed Chats, cwd-only advertisement,
    daemon discovery, shared local store, local provider configuration, link and
    unlink behavior, and degraded operation.
14. **Android contract.** Define offline model support, Android assistant
    integration, bounded device tools, local storage, remote Run steering,
    handoff, waiting, and user-visible executor state.
15. **Framework and storage decomposition.** Only after the protocols exist,
    decide what remains in NestJS, which domain types belong in shared TypeScript
    packages, and what local and upstream persistence engines implement the
    contract.
16. **Roadmap decomposition.** Split the direction into independently valuable
    horizons. Personal Knowledge Spaces remain the nearer-term priority; full
    node replication and distributed execution should not be disguised as one
    deliverable.

## 10. Recommended next discussion

Start with **Run ownership and cross-node execution segments**. It is the highest
leverage unresolved contract because it constrains permissions, event replication,
offline behavior, executor placement, cancellation, retries, and the meaning of a
Chat that continues across nodes.

The first concrete question should be:

> When an upstream-originated Run continues on a local daemon, which node is
> authoritative for advancing the Run, and what durable handoff record prevents
> both nodes from executing the same segment concurrently?

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
