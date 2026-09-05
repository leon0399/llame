# llame vision

llame is a self-hosted context-and-action system. It builds an inspectable model
of a user's world, then uses agents to answer and act across approved tools,
services, channels, and machines.

This document describes the destination. [README.md](README.md) describes what
runs now, [ROADMAP.md](ROADMAP.md) sequences committed work, and
[SPEC.md](SPEC.md) records current architecture and invariants. Research remains
noncanonical until a decision is promoted here.

## Who it is for

llame is personal-first, not personal-only.

A person's knowledge and history should be useful across their own projects
without requiring constant filing. Projects organize context and work; they are
not automatically ownership or security boundaries. A user may still isolate a
project or knowledge area when needed.

The same core should support households, teams, and organizations. Shared and
organization-managed knowledge must stay separately governed rather than being
folded into a person's private store. The exact shared-domain policy model is not
part of the current release sequence.

## The compounding loop

The product converges on one loop:

1. The user asks from an ordinary Chat.
2. llame retrieves relevant knowledge and prior episodes that the Run may access.
3. The agent uses tools to fill gaps and verify volatile claims.
4. It works through a durable, inspectable Run.
5. It answers with sources and records what happened.
6. When useful, it proposes or lands a recoverable knowledge change.
7. A later Run starts with better context.

This is a destination, not one implementation milestone. Each release must add a
useful, runnable part of the loop.

## Durable principles

### Useful capability before platform machinery

External tools are the first missing reason to use llame daily. The runtime is
protocol-neutral; MCP is the first integration adapter, not the internal domain
model. Web search is an end-to-end evaluation, not a special-case product limit.

### Human-readable knowledge is canonical

Knowledge is primarily Markdown in filesystem directories that remain
Git-compatible. Current files are authoritative for reads, including changes
not yet committed. Git history becomes the recoverable change and
synchronization record when that layer is enabled; it is not a prerequisite for
reading. Indexes and embeddings are rebuildable projections.

The agent is expected to create, extend, correct, and reorganize knowledge when
asked. Those changes must be visible, attributable, and recoverable. A research
task should be able to improve the relevant notes instead of ending as a
disposable answer.

Freshness stays empirical. Notes may carry lightweight source and verification
metadata, but llame should verify material volatile claims before relying on
them. File age alone does not prove that a claim is stale or current.

### Memory has distinct stores

- Knowledge is curated, user- and agent-maintained Markdown.
- Episodic memory is the database record of Chats, Runs, messages, events, and
  provenance.
- Semantic facts may later provide small derived records for preferences,
  relationships, or recurring constraints.
- Search and vector indexes are derived state, never another source of truth.

Semantic facts are optional. They must not replace whole documents or silently
override their sources. Automatic extraction and injection remain deferred.

### The harness owns execution

The model proposes tool calls. llame resolves the available tool set, validates
arguments, executes through the trusted runtime, records results, and enforces
limits. Identity, credentials, authorization, approvals, and audit do not live in
prompts or model-controlled sandboxes.

Current releases retain authenticated identity, RLS, and the static
`tools.allowed` gate. Fine-grained per-tool grants and approval flows are later
work; their absence must not be confused with removing the isolation that already
ships.

### Context changes are narrated, not silent

The harness routinely changes what the assistant is and can see: the model it
runs as, the tools it may call, the history that was compacted away, the standing
context it was given. Every such change is stated in-band as server-authored,
explicitly framed data — never applied silently. An assistant reasoning from
stale beliefs about its own capabilities is a correctness failure, not a cosmetic
one, and a mutation the assistant cannot perceive is one it cannot report.

The same changes are visible to the owner. Every Run binds an immutable receipt of
the context it executed against, so "what did the assistant see on that turn" has a
durable answer long afterwards. That receipt is **not yet complete**: it carries
the effective prompt, the advertised tool contract, and the availability manifest,
but does not enumerate the trusted parts injected into the message rail, which are
disclosed only by living in the owner's own messages. Closing that is committed
work, not an acknowledged permanent limit.

These are one mechanism serving two audiences, and that pairing is the point: narrating only to the model produces an
assistant nobody can audit, and logging only for operators produces a system whose
users cannot find out why it knew something.

This constrains future work rather than describing it. Any surface that injects,
withdraws, summarizes, or reorders context must be able to say so, and must be
disclosable to the owner — through the receipt where it already reaches, and
otherwise through a surface the owner can actually inspect. A context surface whose
content the owner has no way to see is not shipped. As Skills, Agent Profiles,
knowledge changes, enrolled Workers, and agent-editable configuration arrive, each
is the same shape and inherits the same rule.

### Runs are the unit of execution

A Chat is the persistent place where work continues. A Run is one durable
agentic turn, including model calls, tool calls, pauses, observations, and final
output.

An Agent Profile may later package a prompt, model defaults, Skills, tool
defaults, and optional memory. Invoking it creates a Run. A subagent uses the
same architecture: an inspectable child Chat containing child Runs, not a second
session system. Parent Runs may dispatch bounded children, and authorized users
may inspect or steer them directly. Nesting, delegation, and budget details stay
open until this slice is planned. Child-agent orchestration is deliberately
behind the single-agent personal context and knowledge loop; it is not a
prerequisite for that loop or for a first-party local Node.

External coding agents and protocols such as ACP, A2A, Codex App Server, or
OpenCode remain executor adapters. llame should keep ownership of Chat and Run
identity, lifecycle, provenance, cancellation, and published results. Those
adapters remain north-star compatibility work rather than part of the immediate
product cut.

### Portable data, isolated execution

The long-term Home model keeps user-controlled Projects, Knowledge, Artifacts,
Skills, and agent configuration in inspectable, exportable forms. Sandboxes do
not receive the whole Home tree. They receive only selected project or artifact
working copies and scratch space, with controlled publication back to durable
state.

Artifacts start small. A single Markdown, text, or code file should not require a
repository-scale workflow. Larger coding artifacts may use Git when versioning
and collaboration justify it.

### Local capability is not a thin client

llame should eventually present one coherent personal system through first-party
web, CLI, desktop, and Android surfaces. A Surface is only an interaction point. A Node is an
independently operable installation with local identity, durable state,
configuration, and available executors; several surfaces may share one Node.

A personal Node is single-owner and remains useful without an account or network
connection. It may store personal context, use locally configured inference
providers and tools, and originate Chats and Runs while unlinked. llame defines
the provider boundary but does not bundle, download, update, or operate a local
model runtime. Offline inference is available only when the user or platform has
configured a provider that works offline. An optional multi-user hub adds
synchronization, remote coordination, and capabilities available elsewhere; it
is not a prerequisite for local agency and does not turn the Node into a thin
client.

Home is the user-facing collection of durable personal context and artifacts. The
Personal Realm is its logical ownership and reconciliation boundary for portable
personal state. It may have replicas on desktop personal Nodes used through CLI
or desktop surfaces, Android personal Nodes, other trusted Nodes, and an
optionally linked hub account; no physical replica is inherently the one
canonical home. The intended personal contract is a full
mirror of each supported portable resource, with resource-specific reconciliation
and explicit exclusions for secrets, device configuration, host paths, Workspace
contents, sandbox instances, caches, and policy-restricted shared data.

Linking an existing standalone Node is explicit and bidirectional. Local and
remote resources synchronize by stable identity; distinct resources remain
distinct rather than being merged by name. Unlinking revokes that cryptographic
enrollment but neither logs the local owner out nor promises remote erasure of
already retained copies.

### Execution follows intent and capability

Surface, Node, executor, Workspace, and Sandbox remain separate boundaries. A
Workspace is a user-selected project directory, repository, or file collection. A
Workspace view may be attached to an explicitly trusted native executor or mounted
into an isolated, reproducible Sandbox. A Run may answer on its initiating
executor, enter a Workspace only after the task reveals that need, or transfer at
a safe checkpoint to an eligible executor.

Workspace entry is requested by the model but authorized and performed by the
trusted harness. A CLI Run advertises only the directory in which it was started.
Starting the CLI there may create an explicit native-placement grant for that
Workspace and its derived views. That grant is trusted harness provenance, not a
claim the model can supply, and it grants no later model-selected Workspace.

A host daemon exposes only directories the user registered explicitly. A
model-requested entry, remote routing, or cross-node transfer defaults to a
Sandbox unless policy asks for or explicitly permits a different executor. The
model never chooses native execution. Native execution must be disclosed as host
user authority rather than misrepresented as confinement to the working
directory. Sandbox failure never silently downgrades to native execution.

llame does not clone repositories or copy Workspace contents onto a user's
machine merely because a Run wants them. Git worktrees or other copy-on-write
checkouts are derived Workspace views, not synchronized replicas.

After entry, a Chat branch normally retains affinity to that Workspace and
executor across follow-up Runs. Placement changes, Workspace loss, fallback, and
recovery are narrated to both model and user. The user can wait, run temporarily
without the Workspace and recover automatically, or exit it. At every instant one
executor has authority to advance an active Run; synchronization or observation
does not grant another replica permission to execute it.

Android follows the same local-node contract with fewer capabilities: configured
platform or local-provider inference when available, synchronized personal
context, bounded device integrations, and remote Run steering. llame does not
ship an Android model runtime. Android does not pretend to provide a generic
project filesystem, container Sandbox, shell, or Git worktree.
Workspace-dependent work transfers to an eligible executor or waits honestly.

### Authority and synchronization are resource-scoped

No universal transport owns every kind of state. Knowledge Spaces use
human-readable files and Git-compatible history, with raw Git or forge-aware
publication adapters. Chats and Runs remain database-native episodic state and
synchronize through an application protocol. Live execution streams, executor
recovery journals, and portable semantic checkpoints are separate layers rather
than one replicated process log.

A Personal Realm may present resources from work, family, school, community, or
other authorities without merging their accounts, ownership, or policy. Foreign
resources are mounted into the user's view; each retains one governing authority
for membership, accepted revisions, retention, replication, and information flow.
Offline shared writes remain proposals unless that authority defines a stronger
merge contract.

Long-lived foreign and inference-provider credentials stay at their owning Node
or broker. An executor receives a proxied operation or narrow delegation, not the
reusable upstream secret. Credential secrecy does not imply data locality:
Workspace policy must separately decide whether context may reach an upstream
model and whether that requires approval.

Decision provenance and rejected alternatives remain in the
[local-node and distributed-execution research](docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md)
and the
[multi-authority federation research](docs/research/product-vision/2026-08-21-multi-authority-federation-models.md).

## Staged horizons

### Shipped foundation: external tool connectivity

Instance-managed MCP tools already reach the durable tool loop. They remain the
research and verification substrate for the next product cut rather than an
independent platform objective.

### Immediate cut: file-native personal intelligence

The next sequence first lets an authenticated owner self-service one personal
Markdown Knowledge Space beneath an operator-configured root and gives the
existing hosted Run loop bounded reads over its live files. The next layer adds
recoverable Git-backed agent writes and proves cross-Chat recall. That Git change
path then backs one Profile Space containing `USER.md`, `SOUL.md`, and
`AGENTS.md`, whose exact revision is bound into inspectable Run context. Only
after that replacement works does llame retire the duplicated database-authored
personalization surface.

Profile files are edited as files by the user or an authorized agent. The
immediate cut does not require a profile editor UI, multiple Agent Profiles,
automatic prompt-derived permissions, or arbitrary filesystem paths supplied to
the hosted service. Agent edits use the same bounded Git change path established
for knowledge; they do not presuppose a personal Sandbox or local Node.
Activation, egress, tool authorization, and linked-resource ownership remain
control-plane state outside those files.

### Next: standalone personal operation

The initial CLI slice now separates a thin Surface from an automatically launched
personal Node, with optional persistent Unix-socket service, local episodic recall
and live read-only Markdown Knowledge. See [SPEC §1.2](SPEC.md#12-thin-terminal-and-independently-operable-personal-node).
This does not yet establish Profile binding, full hosted/local protocol parity or
Personal Realm replication; the broader contract below remains the direction.

A first-party CLI and lightweight single-owner personal Node reuse the same Chat,
Run, Profile Space, and Knowledge Space contracts. They work without a llame
account using user-configured inference providers. The first useful CLI cut may
execute natively in its explicitly advertised current directory, retaining that
placement across follow-up Runs and disclosing its host authority. It does not yet
require a daemon Workspace registry, model-directed entry into other directories,
Personal Realm synchronization, an external coding harness, or a bundled local
model.

### Then: local isolated Workspace execution

Add an opt-in local Sandbox executor before remote Workspace routing. Begin with
one managed environment and explicit Workspace or worktree mounts; then reuse
instances and non-secret caches, and finally accept Git-backed reproducible
environment revisions proposed by an agent and validated by the Node. Native
local execution remains available by explicit policy rather than becoming a
temporary migration mode.

### Then: personal continuity across nodes

Optional linking synchronizes portable personal resources between a standalone
Node and one personal upstream. Git reconciles Profile and Knowledge Spaces;
the application protocol reconciles Chats, branches, messages, compactions, and
finalized receipts. Initial and later synchronization use the same path, and
concurrent offline Chat continuation preserves both branches.

### Later, ordered by dependency

1. Registered Workspace routing across enrolled user machines, including explicit
   directory registration, `EnterWorkspace`, sandbox-by-default inferred entry,
   sticky executor affinity, remote observation and steering, and transparent
   outage recovery without silent native fallback.
2. An Android system-assistant surface using configured platform inference when
   available and steering remote Runs when Workspace work belongs elsewhere.
3. Shared family, team, school, and organization knowledge with explicit
   information-flow rules.
4. Live foreign-authority mounts and policy-controlled shared replication, with
   offline shared writes last.
5. Versioned Skills and agent-editable runtime configuration, installed Apps and
   workflows, self-maintenance, multiple Agent Profiles, child-agent
   orchestration, and external harness adapters as independently justified
   capabilities rather than prerequisites for the personal system.

Each earlier mode remains supported rather than becoming a temporary migration
stage. [ROADMAP.md](ROADMAP.md) owns the concrete cut and exit criteria; the
distributed and federation research retains the fuller destination and rejected
alternatives.

## Explicit deferrals

The current release sequence does not include:

- a full RBAC or allow/ask/deny tool-permission interface;
- user-managed provider credentials or managed OAuth connector onboarding;
- automatic knowledge routing across projects or shared knowledge domains;
- semantic fact extraction, automatic memory injection, or a knowledge graph;
- arbitrary write-capable MCP tools, on either transport;
- model-directed shell execution or a production sandbox fabric;
- bundled, downloaded, or llame-managed local inference runtimes;
- a first-party CLI, standalone personal Nodes, Personal Realm synchronization,
  remote Workspace dispatch, or cross-node execution handoff in the immediate
  file-native cut;
- child-agent orchestration, persistent per-agent machines, or external coding
  harness dispatch;
- multi-authority mounts or offline replication of shared resources;
- workflow builders, autonomous email/calendar actions, multi-channel bots, or
  Home Assistant control; and
- automatic merge or deployment of self-authored changes.

Deferral is not rejection. These features stay out of committed scope until the
smaller loop proves their value and the required trust boundaries are designed.
