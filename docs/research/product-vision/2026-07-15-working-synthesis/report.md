---
title: "llame product vision: working research synthesis"
status: working
canonical: false
version: 0.32
decision_cutoff: 2026-07-15
---

# llame product vision: working research synthesis

> **Status:** Working research synthesis. This records decisions agreed through
> 2026-07-15 and separates them from recommendations and open questions. It is
> not the canonical product vision, architecture specification, or roadmap.

> **Promotion note (2026-07-15):** This file is retained as noncanonical dated
> evidence and decision provenance. [VISION.md](../../../../VISION.md) now owns
> direction, [SPEC.md](../../../../SPEC.md) the current cross-cutting contract,
> and [ROADMAP.md](../../../../ROADMAP.md) the execution sequence. The initial
> short-term sequence below is historical and superseded by that roadmap plus
> issues #39, #40, and #212–#216.

## Executive summary

The dangerous version of this vision is “one platform that does knowledge,
memory, agents, workflows, apps, local coding, smart homes, family sharing, and
enterprise.” That is not a product scope. It is a decade-sized platform
category, and treating all of it as one milestone would produce abstractions
without a strong user loop.

The coherent long-term product converges on one compounding loop:

1. The user asks from any ordinary chat.
2. llame retrieves relevant, permitted knowledge and episodes.
3. The agent uses tools to fill gaps or verify volatile claims.
4. It works in a governed live workspace.
5. It answers with provenance.
6. It proposes or lands a recoverable knowledge revision.
7. The next run starts from better context.

That loop is the destination, not milestone one. Delivery starts with governed
tool use in ordinary chat, adds a first-party workspace service as a separate
increment, and only then closes the durable knowledge loop.

The agreed product thesis is:

> **llame is a self-hosted context-and-action system that builds a permissioned,
> provenance-rich model of your world, then uses governed agents to answer and
> act across channels, services, and machines.**

It is **personal-first, not personal-only**. A person's private knowledge can be
available across their own projects by default. Shared family, team, and
corporate knowledge remains separately governed. Projects organize work; they
are not the fundamental ownership or security boundary.

The first delivery is tool connectivity in the existing assistant: a
protocol-neutral tool runtime with MCP as its first primary adapter. An isolated
agent workspace and durable, agent-maintained knowledge follow as separate
milestones; neither is a prerequisite for accepting the tool milestone. Tools
provide the immediate reason to use llame, while later knowledge capabilities
make useful interactions compound. Workflow builders, installed apps,
multi-agent orchestration, remote coding harnesses, multi-channel bots, and
persistent per-agent machines remain later layers.

**Confidence**

- Capturing the decisions already made: **high**
- Coherence of the proposed domain boundaries: **high**
- Feasibility of the first vertical slice: **moderate**
- Final sequencing and effort: **unknown** until the current implementation is
  mapped against this model
- Enterprise-grade information-flow enforcement: **low** without a dedicated
  threat model and adversarial prototype

## Introduction

This synthesis combines:

- the current llame vision, specification, shipped history, and long-term-memory
  research [13, 14, 15, 16];
- issue #194's episodic-memory direction [1];
- primary documentation and pinned implementation evidence from OpenClaw,
  Hermes, NanoClaw, gbrain, Odysseus, Letta, Mem0, and Graphiti
  [2, 3, 4, 5, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
- protocol and harness documentation for Codex App Server, ACP, A2A, and
  OpenCode, plus pinned Codex and OpenCode execution source
  [6, 9, 10, 11, 12, 51, 52, 53, 57, 58, 59, 60];
- workflow and channel references from n8n and Telegram [7, 8]; and
- official Jujutsu documentation for workspaces, concurrency, Git
  interoperability, and integration stability [30, 31, 32, 33]; and
- official Claude Code documentation for custom-agent definitions, invocation,
  permissions, skills, MCP scope, persistent memory, sessions, checkpoints, and
  worktrees [49, 50, 54, 55, 56].

Product choices marked **Decision** below were agreed in the design discussion.
They are not presented as conclusions proved by the external sources.
Statements marked **Recommendation** or **Open** are not approved product
commitments.

The accompanying JSONL files preserve the source, evidence, and claim ledgers.

## Main Analysis: what the reference systems actually establish

No reference project provides the complete model llame needs. “Brain” and
“memory” are overloaded names; copying one implementation would collapse
different trust and lifecycle requirements.

### 2.1 Markdown memory is proven, but insufficient by itself

OpenClaw treats Markdown files as the durable source of record and search data
as derived indexing [2]. Its memory-wiki work adds structured claims and
provenance [17]. Hermes combines persistent memory with curated skill
improvement [4, 5, 18]. gbrain similarly treats a repository as a system of
record and models cross-brain writes as an explicit operation [23, 24].

This supports a Git-first Markdown vault. It does **not** justify treating every
retrieved sentence as a timeless fact, using filesystem layout as
authorization, or allowing an agent process to mutate the accepted repository
directly.

### 2.2 Semantic memory solves a different problem

Odysseus extracts selected memories stated or clearly implied by the user and
adds them directly to native memory rather than creating a revision proposal
[25]. Letta exposes agent-readable and agent-writable memory blocks [26]. Mem0
preserves temporal update history [27]. Graphiti traces derived context back to
source episodes [29]. gbrain experiments with confidence decay for fact records
[28].

These systems are useful precedents for small, derived facts such as
preferences, identity details, and recurring relationships. They are not a
replacement for user-readable documents. Applying their schemas to an entire
Obsidian-like vault would make the knowledge base opaque and expensive to
maintain.

### 2.3 Sandboxing is not tenancy

NanoClaw isolates sessions in containers and places controls around package
installation and self-modification [20, 21, 22]. OpenClaw explicitly documents a
trusted-user model rather than hostile multi-tenant isolation [3].

Therefore containers, sparse checkouts, and isolated workspaces are execution
controls, not authorization boundaries. Shared or corporate knowledge requires
an independent capability and information-flow model.

### 2.4 Protocol support is an adapter layer, not the product

ACP exposes client-controlled environments and terminal execution, while remote
transport work remains evolving [9, 10]. A2A models stateful work between
independent agents [11]. Codex App Server exposes authentication, conversation
history, approvals, and streamed agent events [6]. OpenCode exposes a headless
server with an OpenAPI endpoint [12].

These are plausible execution adapters. None should define llame's durable Run,
permission, memory, or audit semantics. llame must remain the control plane and
translate its own model into vendor-specific protocols.

### 2.5 Claude Code separates an agent profile, its invocation, and its memory

Claude Code custom agents are declarative Markdown/YAML profiles. The definition
provides a routing description and system prompt, with optional model, tool,
permission, MCP-server, Skill, memory, background-execution, and worktree-
isolation settings [49]. A named agent invocation receives a fresh context and
can be selected automatically from its description, invoked explicitly, or used
for the whole session [49].

Persistent agent memory is optional rather than intrinsic identity. Claude Code
maps it to a user-, project-, or local-scoped directory, injects instructions and
a bounded prefix of its memory index, and lets the agent maintain the files
[49]. The normal Claude Code memory model likewise distinguishes human-authored
instructions from agent-authored learnings and treats both as context rather
than an enforcement mechanism [50].

This is a strong precedent for **Agent Profile + Run + optional Agent Memory**.
It is not a precedent for giving an agent an independent security principal.
Claude Code agents inherit a permission context, while managed MCP restrictions
still apply [49]. Its automatic enabling of file-write tools for persistent
memory is reasonable in a trusted local coding environment but cannot be copied
as llame's multi-tenant authorization model. In llame, any persistent agent
memory must remain visible, principal-owned, permissioned, auditable, portable,
and subject to the same revision and information-flow rules as other knowledge.

### 2.6 Coding harnesses retain a live workspace across turns

Codex, Claude Code, and OpenCode converge on a simpler continuity model than a
fresh workspace per agentic turn.

Codex keeps a task's transcript and recorded working directory while reading
the current working tree; a managed task keeps the same associated worktree over
time [52, 53]. Its App Server working-directory override applies to the current
and subsequent turns, and local child-agent threads inherit the parent's working
directory rather than receiving automatic child worktrees [51]. Codex's managed
worktree snapshots are lifecycle recovery before cleanup, not normal turn-to-
turn transport [53].

Claude Code ties a session to its current directory. Switching branches changes
the files Claude sees without replacing the conversation history [54]. It
creates a checkpoint for each user prompt, but those checkpoints are explicit
local undo: direct edit-tool changes are tracked, while Bash and ordinary
external changes are not [55]. Default subagents start in the main conversation's
current directory; worktree isolation, when requested, is scoped to the session
or child agent rather than each turn [49, 56].

OpenCode starts against a current directory, resumes Sessions, and uses Git-
backed undo/redo over file changes [57, 58, 59]. Its current source stores the
directory and workspace identity on the Session, takes before-and-after
snapshots around execution steps in the same worktree, and creates or resumes
child Sessions without allocating a child-specific directory [60].

Therefore none of these references automatically materializes Run N's
checkpoint into a fresh workspace for Run N+1. Their common model is **live
session/task workspace + per-turn delta or undo metadata**. A per-Run workspace
would be a deliberate stronger llame isolation policy, not reference parity.
This evidence does not decide llame's policy: reusing live state is cheaper and
more natural, but it creates concurrency and cross-authority risks that the
mostly local reference harnesses do not solve.

## Synthesis: resolved product decisions

### D-01 — Personal-first product and scope model

**Decision**

- llame is personal-first.
- A user's private Knowledge Spaces may be recalled across their projects by
  default.
- A space may be sealed or project-local when deliberate isolation is needed.
- Family, team, and corporate spaces require explicit grants.
- Projectless chats remain knowledge-first and may self-organize context.
- Automatic organization may change relevance, never authority.

**Consequences**

A Project is a context and workflow organizer. It may reference chats,
Knowledge Spaces, connectors, apps, and artifacts owned by different
principals. It does not own every resource placed in it.

A Project may associate one or more working directories, paths inside Knowledge
Spaces, and Artifacts. Those associations steer retrieval, tool defaults, and
context priority; they do not grant access. The Run first filters resources by
its effective authority and then materializes only explicitly selected working
roots—never every resource recursively associated with the Project. Moving a
Chat into or out of a Project changes future Runs only; the next user message
receives a visible system reminder and recomputes context while prior Runs keep
their original Project and security lineage.

The global assistant should reduce filing work, but it must expose which sources
were used and allow the user to constrain or correct routing. “The system
figured it out” is acceptable for retrieval ranking; it is not acceptable for
crossing a permission boundary.

### D-02 — Three durable stores plus derived projections

**Decision**

1. **Knowledge Spaces** are the user- and agent-maintained Markdown source of
   record and revision history.
2. **Episodic memory** preserves control-plane-recorded, append-only Chats, Runs,
   events, and their provenance during normal operation. Erasure exceptions
   remain open under O-11. Issue #194 is the current foundation [1].
3. **Semantic memory facts** hold small derived facts such as preferences,
   identity, relationships, and recurring constraints.
4. **Indexes and embeddings** are rebuildable projections over those stores,
   never a fourth canonical memory store.

**Consequences**

- Knowledge documents must not be atomized wholesale into the facts table.
- A semantic fact must retain its source episode or document, governing scope,
  temporal status, and correction/supersession relationship.
- The facts table may accelerate recall; it may not silently override the
  Markdown source of record.
- Agent-specific memory is optional and selected by an Agent Profile, but its
  Knowledge Space remains owned and governed by a person, group, or
  organization. It may be attached to a Project, but configuration and
  organizational scope do not become ownership.
- Humans, subagents, workflows, tools, and external harnesses may all contribute
  authenticated current activity to episodic memory, but they cannot directly
  insert arbitrary past events or choose their own actor, timestamp, approval,
  or lineage. The control plane derives and seals those fields from the
  authenticated execution path. Harness-reported internal events remain
  identified as reported rather than independently observed.
- An agent may improve Knowledge, derived semantic facts, or its optional
  persistent Agent Memory through the normal governed write paths. That does not
  grant it permission to rewrite the episodic event log or attribute its claims
  to a user.
- Procedural improvement belongs to inspectable, versioned Skills, Agent
  Profiles, and workflows under D-19; it must not be hidden inside semantic
  facts or mutable runtime prompts.

### D-03 — The agent maintains the knowledge base

**Decision**

The agent is expected to create, expand, correct, and reorganize knowledge. A
request such as “research this potential client” should improve the relevant
Knowledge Space, not merely return a disposable answer.

Knowledge writes use risk-tiered autonomy:

- well-sourced, low-consequence, in-scope changes may land automatically;
- weakly sourced, conflicting, consequential, destructive, or
  scope-widening changes become proposals;
- ordinary corrections supersede prior claims without erasing their history;
  and
- authorized readers may inspect accepted history; a revert enters the same
  propose/land policy and requires the corresponding capabilities.

**Consequences**

“User-authored” records provenance and edit authority, not factual correctness
or immortality. Agent-authored and imported records require the same provenance
model. Newer verified evidence may inform an answer while the revision service
proposes a correction to the canonical record.

**Working security recommendation — details open**

Ordinary correction history is not an excuse to retain exposed secrets,
unlawful data, or compromised content forever. A privileged purge traverses all
three durable stores plus internal copies: reachable and unreachable Git
objects; Jujutsu operation, workspace, and hidden-revision state; episode
messages, Run events, and tool payloads; semantic facts; workspaces, artifacts,
and snapshots; indexes, caches, logs, and traces; and managed mirrors and
backups.

The purge rewrites, tombstones, crypto-shreds, or quarantines each copy as its
storage and any legal hold permit, leaves only a non-sensitive audit tombstone,
and reports prior clones, exports, provider calls, or unmanaged backups that
cannot be retracted.

### D-04 — Freshness is empirical and risk-sensitive

**Decision**

Markdown stays simple. Freshness is primarily enforced at retrieval and use,
not by forcing every sentence into a database schema.

Optional page metadata may be used when valuable:

    ---
    verified_at: 2026-07-15
    review_after: 2026-10-15
    ---

Current factual claims should include a source and checked date where practical.
The retrieval envelope may add path, modification time, verification time,
review status, and trust metadata without rewriting the document.

Page-level verification metadata is only a retrieval hint; it does not certify
every claim on a page. Consequential or independently volatile claims may need
their own asserted, observed, source-published, verified, and valid-time
metadata.

The agent follows these rules:

- verify material volatile claims before relying on them;
- do not re-verify stable historical facts solely because they are old;
- treat a newer direct preference statement as superseding an older one only
  for the same subject, predicate, and context;
- keep user- or system-owned standing policies active until revised, while
  flagging overdue review; verify volatile external legal or organizational
  policy before consequential use;
- schedule monitoring only for explicitly watched entities or projects; and
- never equate filesystem modification time with factual verification time.

Access control is not Markdown frontmatter. Revision history is infrastructure,
not content schema.

### D-05 — Tool connectivity precedes the knowledge loop

**Decision**

The first useful increment is the existing assistant augmented with governed
tool use. It can:

- connect to an MCP server;
- make selected tools available to a Run;
- invoke them from an ordinary chat interaction;
- incorporate their results into the response; and
- expose tool access and calls to the user and audit log.

llame owns a protocol-neutral tool runtime. MCP is its first primary adapter,
not its internal domain model. Native tools, MCP servers, and later connector
protocols share llame's tool identity, permission, approval, secret-brokering,
invocation, audit, and result-provenance model. “Supports MCP” alone is not a
user capability; the runtime must prove useful through complete user jobs.

Permission is keyed to a concrete, origin-qualified tool identity: integration
installation plus tool name, regardless of whether the origin is native, MCP, a
connector, or an App. There is no blanket per-MCP permission unit. A configured
policy survives ordinary schema and implementation changes to that same tool;
replacing the integration installation creates new tool identities and requires
new policy. Trusting an installation includes trusting compatible evolution of
its existing tools—the runtime cannot infer semantic safety from schema diffs.

Each tool has an explicit three-state execution policy, following the Claude.ai
interaction model:

- **allow** — invoke without per-call confirmation;
- **ask** — request confirmation before invocation; and
- **deny** — do not expose or invoke the tool.

Instance-owned system tools may define an instance default—for example, web
search may default to **allow**. User-owned MCP tools initially default to a
conservative policy until configured. A user's deliberate **allow** may cover a
mutating tool; risk classification informs the default rather than permanently
overriding explicit consent. Effective policy and every invocation remain
visible and auditable.

That policy applies to child Runs as well as the root Run. By default, a child
inherits the initiating user's available tool catalog and each concrete tool's
configured policy; it is not reduced to read-only merely because it is a
subagent. A child may therefore send email or perform another mutating action
when the effective tool policy is **allow**. The parent delegation, child-Chat
envelope, Agent Profile, governing policy, or adapter may attenuate that surface,
but none may widen it. A parent's one-off approval is not inherited as a durable
tool policy.

For **ask**, invocation creates a pending approval and moves the same Run into a
paused `awaiting_approval` state. Initial implementation requires an eligible
user to approve or deny it. A child may route the request through its
orchestrator, which may reject, refine, or relay it, but mere parenthood does not
let one model turn **ask** into **allow**. Approval resumes the same logical Run;
denial, cancellation, or timeout follows the Run's ordinary terminal or recovery
path. This is a logical lifecycle state, not a requirement to keep an executor or
sandbox process alive while waiting.

Letting an orchestrator or risk classifier satisfy the request without a human
is an eventual, separate, explicit `auto` approval policy. A classifier may
inform defaults or the `auto` decision, but it cannot override **deny** or
manufacture authority.

**Scope boundary**

The first tool milestone does not depend on a first-party workspace, Knowledge Space,
semantic graph, episodic recall, or agent-authored Markdown. Those are subsequent
increments. Web search is the initial behavioral evaluation, not a restriction
on supported tools: users should be able to connect other compatible remote MCP
servers. The first iteration supports remote MCP transport; local stdio servers
are deferred. Server registrations initially have either instance-wide or
user-wide scope. An instance-wide registration may include an instance-owned
managed credential and expose the server as a system capability to eligible
users and Runs—for example, one managed search account serving the instance. A
user-wide registration and its credentials belong to that user; in the first
iteration, the user may configure this MCP connection directly. A later managed
connector may install an instance-wide server definition while letting each user
bind their own external account through a first-party authorization flow—for
example, “Connect GitHub”—without manually configuring MCP. More granular
Project, Chat, agent, and workflow strategies are left open. Shipping only
protocol conformance or a connector catalog would be platform theater.
Exposing llame's own capabilities through MCP is a later outward-facing adapter
under D-18 and is not part of this first client milestone.

### D-06 — One logical system, separate resource and trust boundaries

**Decision**

The user's Home is the canonical, principal-controlled content and configuration
tree. It is not a generated export, and it is never exposed to a sandbox as one
shared writable filesystem.

| Resource          | Purpose                                                            | Durable authority              |
| ----------------- | ------------------------------------------------------------------ | ------------------------------ |
| Home              | Canonical user-controlled files and portable configuration         | Owning principal               |
| Knowledge Space   | Human-readable Markdown knowledge                                  | User or group principal        |
| Workspace         | Live scratch, working copies, drafts, and intermediate output      | Governing principal and domain |
| Execution sandbox | Isolated runtime for tools and code                                | Disposable or snapshot-backed  |
| Artifact          | Versioned generated output and sandboxed preview                   | No ambient authority           |
| App               | Explicitly installed artifact with a manifest and service identity | Granted capabilities only      |
| Connector         | Brokered access to an external system                              | Principal-scoped grant         |

An artifact remains powerless until the user explicitly promotes or installs it
as an App. Apps receive isolated runtime and data, explicit capabilities, and
brokered credentials. They do not receive direct database access, raw OAuth
secrets, or a shared writable volume with the vault or other apps.

App-to-app integration uses declared APIs and events. Effective authority is the
intersection of user grant, app manifest, task context, and platform policy.

**Decision at the product-boundary level; backend details remain open**

A Workspace is a durable, domain-bound live file namespace associated with a
Chat, not a disposable namespace recreated for every Run. Every Run in that Chat
reattaches to the current Workspace state, reauthorizes access under its own
capability snapshot, and records its file delta or boundary revision. The Chat
binding is continuity, not authority.

When an orchestrator creates a child Chat, its authorized creator may select the
Workspace mode once:

- **shared** binds the child Chat to the parent's current Workspace; or
- **isolated** creates a copy-on-write Workspace pinned to a recorded parent
  revision.

That mode belongs to the child Chat and applies to all of its later Runs. It is
not a per-Run setting and cannot silently change when the child is resumed. A
different mode requires a new child Chat. Security may reject sharing when the
child's governing domain or authority is incompatible. When the creator does not
select a mode, the child Chat defaults to **shared**. Parallel or background work
that should not touch the live parent tree must explicitly request **isolated**
at creation. Concurrent shared-writer behavior remains open under O-06.

Milestone two builds a first-party **workspace service** and does not require a
sandbox vendor. An execution sandbox is optional compute that may attach to a
Workspace without owning its lifecycle. This distinction is already
visible in the provider landscape: Vercel directs data that outlives one sandbox
to a separate Drive [35], Daytona backs persistent volumes with S3-compatible
storage [39], and Modal separates persistent Volumes from sandbox snapshots
[42, 43].

The working implementation recommendation is deliberately boring:

- one durable namespace per Workspace binding, backed by a local filesystem on
  a single-node instance and a storage adapter when multi-node storage is needed;
- a child Chat either references the parent's namespace or receives a
  copy-on-write namespace when it is created;
- the sandbox may receive only an explicitly selected Project working copy, an
  isolated Artifact working copy, and a private scratchpad;
- the Project mount is a copy-on-write overlay, Git worktree, or equivalent
  disposable view rather than the canonical directory itself;
- the Home root, Knowledge repositories, other Projects and Artifacts, platform
  databases, and storage credentials remain inaccessible;
- knowledge reads and changes go through governed retrieval and revision tools,
  not a raw filesystem mount; and
- selected Project or Artifact outputs publish back through a controlled service
  operation rather than arbitrary sandbox writes to Home.

Provider volumes and machine snapshots are replaceable caches or execution
state, never llame's durable authority or portable export format.

| Candidate          | Current fit                                                                                                                                                     | Consequence for llame                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Vercel Sandbox     | General Firecracker-backed compute, not GitHub-repository-only; hosted authentication, metering, persistence, and storage [34, 35]                              | Optional executor adapter; cannot be the required self-hosted workspace               |
| E2B                | General agent sandboxes; BYOC currently targets AWS/GCP and still sends anonymized infrastructure metrics to the E2B control plane [36, 37]                     | Useful optional backend, but BYOC is not equivalent to zero vendor reliance           |
| Daytona            | General composable computers, S3-backed volumes, and customer-managed runner regions [38, 39, 40]                                                               | Closest named fit for optional customer-controlled compute; still not the data model  |
| Modal              | Hosted usage-billed sandboxes with separate Volumes and snapshot retention policies [41, 42, 43]                                                                | Optional burst backend, not a self-hosted default                                     |
| Docker plus gVisor | Locally operable OCI path; Docker needs explicit resource limits and daemon hardening, while gVisor adds a per-sandbox application-kernel boundary [44, 45, 46] | Plausible later single-node executor; requires a threat model and compatibility evals |
| Direct Firecracker | Strong microVM primitive, but the operator must add egress filtering and snapshot packaging, security, and lifecycle management [47, 48]                        | Too much orchestration for the workspace milestone; evaluate only for a later runtime |

This is consistent with the agent-harness boundary: llame's trusted control
plane owns operational identity, authorization, credentials, and audit, and
mediates changes to durable Home files; replaceable sandboxes own only temporary
views and execution.

### D-07 — Git-first knowledge, Jujutsu-backed revision service

**Decision**

- The accepted Knowledge Space is Git-compatible and exportable.
- Every Knowledge Space has exactly one canonical accepted ref. For a
  Home-managed Space, the accepted Git ref in Home is canonical. For an
  upstream-managed attachment, the external upstream ref is canonical and the
  Home checkout plus llame indexes are imported projections. Postgres and search
  state follow the configured canonical ref; they do not overrule it.
- Within one target Knowledge Space, one logical accepted knowledge revision
  becomes one semantic commit, not one commit per file write.
- For every target Knowledge Space it mutates, a change session receives a
  separate isolated revision workspace pinned to a recorded base revision.
- Jujutsu is the internal revision engine behind a trusted Knowledge Revision
  Service, not the API or security boundary exposed to agents.
- The service owns Git/Jujutsu metadata; ordinary sandboxes see only their
  scoped working tree.
- A shell-capable or hostile run uses a stronger isolated clone or snapshot and
  submits a patch for import.

**Working architecture consequence — not an approved implementation contract**

Jujutsu workspaces give each workspace its own working-copy commit [30]. Its
operation model can merge divergent operation-log views, but unresolved
bookmark and reference conflicts remain explicit [31]. That makes it a good fit
for parallel agent changes; it does not eliminate the need for a serialized
visible-revision landing path.

The landing lifecycle is:

1. for each target Knowledge Space, read its canonical accepted Git ref as H and
   create an isolated revision workspace at H;
2. make and snapshot semantic changes;
3. refresh H from the accepted ref and rebase the candidate when it moved;
4. retain conflicts as a proposal rather than guessing;
5. run validation and bind any approval to the Space, H, exact candidate commit,
   policy version, and authorization epoch;
6. durably record the prepared intent and audit metadata before publication;
7. publish through the Space's governing landing path: atomically
   compare-and-swap a Home-managed accepted ref, or submit the candidate to the
   upstream proposal/pull-request path; if H changed, restart steps 3–5,
   including approval when required;
8. observe and idempotently import the canonical accepted ref into Postgres,
   semantic facts, mirrors, and derived indexes, then clean up the revision
   workspace.

The explicit states are **candidate → prepared → accepted → indexed**. A commit's
existence does not make it accepted; movement of the canonical accepted ref does.
Postgres records prepared workflow state, audit, and the last observed and indexed
revisions. After partial failure, reconciliation follows Home and repairs those
projections for a Home-managed Space; for an upstream-managed Space it follows
the configured upstream instead. It never moves the canonical source back to a
database pointer. The exact crash-safe prepared-intent journal remains an
implementation detail.

A cross-space change is a Postgres proposal group containing one base revision,
workspace, and candidate commit per Knowledge Space. Its commits land through
their own policies; the design does not pretend that separate Git repositories
provide atomic multi-repository commits.

Interleaving unmanaged Git and Jujutsu operations can create confusing
divergence [32]. Jujutsu's library and CLI integration surfaces are not stable
[33]. Therefore llame needs a narrow, version-pinned adapter with contract
tests.

The service must not place one writable Jujutsu repository on a shared
filesystem across worker nodes. A central repository owner or isolated
per-worker clones import changes into the landing service [31].

The owner of a personal Home can move an accepted ref outside llame. That is an
external import: llame detects it, records its external provenance, validates
what it can, and reindexes it, but cannot pretend its agent landing policy
constrains the filesystem owner. Managed shared and organization repositories
instead restrict accepted-ref writers at the storage layer and route other
changes through incoming refs, proposals, or upstream pull requests. A Knowledge
Space has one configured canonical accepted ref; remote Git hosting may mirror
it or serve as that canonical upstream, but never creates a second source of
truth.

### D-08 — One repository per governance and export boundary

**Decision**

A personal vault and a corporate vault are not directories in the same
repository. Each Knowledge Space has one governing principal and one coherent
history, policy, retention, and export boundary.

The governing principal may be:

- a person;
- a family or group; or
- an organization.

Membership grants distinct capabilities such as query, read, propose, land,
export, and manage. Query or read does not imply clone or export. Once full Git
history has been cloned, later access revocation cannot claw it back.

Corporate sources may remain upstream-canonical. llame may attach and index them,
while changes become proposals or pull requests to the upstream owner rather
than silent local truth.

This is the north-star boundary, not a requirement for the initial personal
Knowledge slice. Initially, multiple user-owned Knowledge Spaces may be only
organizational and share one owner trust domain, with no per-Space ACL or
information-flow policy.

### D-09 — Run, not Chat, is the durable security boundary

**Decision**

A **Run** is one durable agentic turn, not one model-provider inference. It starts
from a user message, workflow trigger, or parent delegation and may contain many
model calls, tool calls, child Runs, workspace or Artifact changes, intermediate
events, pauses, approvals, and execution segments before reaching a terminal
result. In ordinary chat, the next user message after completion creates another
Run in the same Chat. Steering or resuming an active or paused turn instead adds
an event and, when necessary, a new execution segment to the same logical Run.
Completed, failed, and cancelled Runs are immutable terminal records. A later
follow-up creates a new Run linked as a continuation; it does not reopen the old
capability snapshot or audit envelope.

A **Chat** contains one or more Runs and retains conversational continuity. It may
be an ordinary interactive conversation, a child/subagent conversation created
by a parent Run, or a background/system conversation created for workflow or
maintenance execution. Every Run belongs to exactly one Chat and uses the same
transcript, event, streaming, steering, and continuation architecture. Origin and
presentation metadata may keep background and nested Chats out of the primary
chat list without inventing a second execution model. Chat identity and retained
context are not an authority snapshot, and common storage does not imply that
all prior Chat content is injected into every Run. Codex App Server's Thread maps
to llame's Chat and its Turn maps to llame's Run; active steering appends to the
current Run rather than creating another [6, 51].

At most one Run is active in a Chat. New input either steers that active Run or
queues a later Run; it does not create an interleaved concurrent Run in the same
transcript. Parallelism uses separate child Chats, whose creation-time Workspace
mode determines whether their file state is shared or isolated.

A Chat may retain a Workspace binding without becoming a security boundary. Each
new Run independently reauthorizes attachment to that Workspace. If its current
authority is incompatible with the Workspace's governing domain, it cannot
attach; prior file state is never silently exposed through conversational
continuity.

The initial personal Knowledge slice treats every Space owned by one user as part
of that user's single trust domain. Spaces and attached directories affect
organization, retrieval priority, and revision targets—not access control. It
does not ship cross-user shared Spaces, corporate attachments, or mixed-domain
writes. Existing authenticated user-to-user tenant isolation still applies and
is not deferred.

For the first shared-knowledge implementation, each Run has one governing
security/output domain and a source-lineage set constrained to that domain. A
Chat is UX continuity and may contain multiple Runs, but it must not silently
carry authority or context from one Run to another.

Each Run receives a frozen capability snapshot:

- authenticated identity and governing principal;
- readable Knowledge Spaces;
- allowed models and embedding providers;
- tools and connectors;
- writable sink;
- retention requirements; and
- policy version.

The minimum information-flow rule is necessary but not sufficient:

> An output destination must accept every source security domain used to
> produce that output.

**Working security consequences — not approved implementation details**

The snapshot is an immutable audit record and maximum authority, not an
irrevocable lease. A live revocation epoch or short-lived capability lease may
only narrow it and is rechecked before retrieval, model/provider calls, secret
minting, tool or connector calls, writes, proposal landing, and publication.

Every flow must satisfy the intersection of source egress policy, processor
policy, and destination ingress policy. Processors and destinations include
model and embedding providers, rerankers, MCP/tool endpoints, connectors,
trace stores, logs, and caches—not only the final user-visible sink. Deny when
there is no permitted intersection.

Messages, tool results, and compaction summaries carry domain lineage. Context
assembly for a later Run filters incompatible prior Chat content rather than
rehydrating the Chat wholesale.

Mixed-domain synthesis is not enabled by default in the first implementation.
If explicitly introduced later, the response, transcript, summary, workspace,
artifact, derived memory, tool payload, logs, and caches inherit a governed
mixed domain whose policy accepts every source. If no such policy intersection
exists, the Run is denied. Corporate-derived facts never enter personal
semantic memory automatically. Mixed-domain writes, sends, exports, and
publication become explicit transfer or release proposals.

This is deliberately coarse run-level lineage, not AI-generated per-span DLP.

### D-10 — Sharing should expose capabilities, not entire worlds

**Decision**

Cross-user resource access should eventually prefer narrow, purpose-built
capabilities. Calendar free/busy sharing is a connector disclosure capability,
not Knowledge Space access control; it belongs to the connector and sharing
model even if knowledge-flow policy later uses the same release concepts.

**Working security consequences — details open**

Revoking a member immediately invalidates their capability leases, tokens,
future connector access, and subject/policy-scoped caches, and terminates their
affected Runs where possible. Their workspace state is destroyed, sealed, or
quarantined according to the governing domain's frozen retention and legal-hold
policy; execution authority ends in every case.

An ACL change or source detachment is not a purge. It traverses recorded lineage
and re-authorizes every dependent episode, fact, summary, proposal, snapshot,
artifact, cached output, and index entry. Affected objects are revoked,
re-derived, quarantined, or retained only inside their original inaccessible
domain according to policy.

A privileged purge invokes D-03's transitive store-wide erasure path, subject to
legal hold. Neither revocation nor purge can retract data already shown, cloned,
exported, or sent to an external model.

### D-11 — Agents are profiles; orchestration forms an attenuated Run tree

**Decision**

- An **Agent Profile** is a reusable, versioned declaration of routing
  description, prompt, model defaults, Skills, tool/MCP defaults, permission
  ceiling, and optional memory binding. The main assistant is the default
  generalist profile, not a separate kind of entity.
- Invoking a profile creates an auditable **Run**. A user may invoke one
  directly; a parent Run may dispatch multiple child Runs in parallel or
  sequence; and a child may dispatch nested Runs when its profile and policy
  permit it.
- A child Run may execute natively in llame or through a replaceable harness
  adapter such as Codex App Server, ACP, A2A, OpenCode, or another vendor-specific
  agent interface. llame still owns the Run tree, lifecycle, approvals,
  cancellation, audit, lineage, and published results.
- Optional persistent Agent Memory is principal-owned and governed as described
  in D-02. A specialist prompt plus memory does not create an autonomous
  principal. Long-lived service identity remains reserved for installed Apps and
  unattended workflows.

Creating a child Chat records a persistent maximum delegation envelope. The
envelope is a ceiling, not a reusable grant or frozen permission snapshot. Every
new child Run re-resolves current authority:

> **child Run authority** = current initiating principal or delegator grants ∩
> child Chat delegation envelope ∩ Agent Profile ceiling ∩ current governing
> policy ∩ adapter capability

Child Chat creation also records its immutable Workspace mode: share the
parent's current binding or create an isolated copy-on-write binding from a
recorded revision. Every later Run and resumed external harness session for that
child reuses the same binding. Workspace mode is independent of Agent Profile and
tool permissions and does not change when either changes, although authorization
may prohibit a requested shared mode. Omission resolves to `shared`; isolation is
an explicit child-Chat creation choice.

Unless the user, parent delegation, or Agent Profile narrows it, the child
Chat's initial tool envelope mirrors the initiating Run's user-configured tool
catalog and per-tool policies. This preserves ordinary subagent jobs that need
side-effecting tools without treating the child as a new principal.

Direct steering of an active Run cannot widen its existing ceiling. A later
human-, parent-, or workflow-initiated Run in the same child Chat remains inside
the Chat envelope even when the initiator holds broader grants. Widening requires
an explicit authorized one-Run grant or Chat reconfiguration; revocation and
current policy may always narrow the effective result.

Delegation passes the minimum task context, Knowledge Spaces, workspace files,
and output destinations required. Tool availability follows the inherited,
attenuable policy above rather than an unconditional read-only or minimum-tool
rule. Source lineage follows the delegated context. A child result is data
returned to the parent, not a permission grant; neither a child nor an agent
message can approve an escalation or widen descendant authority. An explicit
`auto` approval policy may authorize a call inside the existing ceiling; that is
resolution of predelegated authority, not escalation.

A parent Run initially delegates by creating or addressing a child Chat and
starting a child Run within it. Every child Run is separately inspectable.
Recursive delegation is bounded by policy-controlled depth, fan-out, time, token,
and cost budgets, with cancellation propagating through active descendants. The
working starting point is a default depth of three below the root and a hard
platform ceiling of five; these are implementation defaults, not frozen vision
commitments. Exact limits, failure aggregation, and synthesis UX remain open.
Claude Code is a useful precedent for parallel, chained, depth-limited agents and
resuming a completed agent as a new run under the same agent ID [49], but its
limits are not llame's specification.

Best-of-N and Summary-of-N are orchestration patterns over that same model. A
parent Run starts N child Runs in N child Chats, waits for their results, then
selects, evaluates, or synthesizes them itself or through another bounded child
Run. They do not require concurrent Runs inside the parent Chat. Candidate file
changes follow each child Chat's creation-time Workspace mode: shared changes are
live immediately, while isolated changes require an explicit integration path.
Artifact publication remains governed independently. Exact judge, scoring,
synthesis, and shared-writer behavior remain open.

A Run transcript is multi-actor. Its canonical input events distinguish the
authenticated actor—human, parent Run, workflow, external harness, or system—from
the role or envelope used to deliver content to a model provider. A delegation or
steering instruction may therefore be projected as a provider `user` message
without becoming user-authored. Reminder text is a model-behavior hint, never an
authorization, provenance, or memory boundary.

A child Run's instructions, messages, tool activity, results, and direct human
steering are valid episodic events with their actual actors. A child may create
durable Knowledge or memory contributions within its grants, but it cannot forge
history, approvals, or user statements. For an external executor, llame records
the events it can authenticate and labels additional executor-streamed detail as
harness-reported.

An authorized user may open a child Chat and address its current Run directly
rather than asking the parent to relay a message. A parent-agent or human message
sent while that Run is active steers the same Run; a message deliberately queued
for later or sent after terminal completion starts another Run in the same child
Chat. This matches Codex's distinct `send_message` and `followup_task` behavior
[51]. The child Chat remains linked to its orchestration lineage, and steering
does not transfer ownership or grant approval. The parent receives a state-change
event so it can reconcile its plan with the intervention.

A live-capable adapter injects steering at a safe runtime boundary. Otherwise
llame pauses or restarts execution as a new immutable segment of the same logical
Run, preserving its transcript, workspace, lineage, budget, and exact context
revisions. Claude Code's subagent panel, direct follow-ups, and resumable agent
IDs are a useful product precedent [49], not a constraint on llame's adapter
protocol.

An executor session and a Run have different lifecycles. llame may reuse a
Claude, Codex, ACP, or other harness session—and therefore its retained model
context—for a continuation Run. The adapter binding belongs to the Chat, while
each new agentic turn still receives a new Run ID, capability snapshot, budget,
and audit envelope linked to the prior Run.

Run completion does not archive its child Chat. A completed child remains
inspectable and addressable in the orchestration tree until the user or an
authorized orchestrator action explicitly archives it. UI nesting or visual
collapse may control clutter without changing archival state. Archival is not
deletion and does not erase the transcript or prevent an authorized later
continuation. Compute and workspace lifecycles remain separate: a terminal Run
does not keep an executor alive merely because its Chat remains unarchived, while
its Workspace binding remains available according to Chat and retention policy.
Archiving a child Chat must not delete a Workspace still shared by another Chat.

### D-12 — Unattended workflows use dedicated service identities

**Decision**

An unattended workflow never borrows its creator's live user session or silently
continues with a snapshot of the creator's personal authority. Enabling one
creates or binds a dedicated workload identity governed by the person, group, or
organization that owns the workflow.

A portable workflow definition declares trigger logic, an Agent Profile or Run
template, and behavior. Activation creates a control-plane installation that
pins an exact definition revision and separately binds its service identity,
explicit capability grants, connector secrets, active triggers, allowed input
and output domains, budgets, and approval policy. Editing executable Home content
cannot change installation authority; activation or an installation update must
pass the governing review path. Every schedule, email, message, webhook, or other
trigger creates or addresses a background Chat and starts an ordinary auditable
Run under the installed identity. The triggering payload is untrusted input and
source context, not an authority grant. Sharing the Chat architecture does not
silently make unrelated prior workflow executions part of the new Run's context.

Chat routing is configurable per workflow installation. Independent executions
may create a new background Chat per trigger, while continuous processes may
reuse a configured Chat and add one Run per trigger. Both modes use the same
Chat/Run architecture. The initial default, target selection, correlation keys,
and overlapping-trigger behavior remain open.

Removing the creator does not silently preserve their personal grants and does
not arbitrarily destroy organization-owned automation. The workflow continues
only with capabilities explicitly granted to its service identity by its current
governing principal. Revoking or narrowing those grants blocks new affected Runs
and narrows or terminates in-flight Runs through the same live-revocation model
as D-09.

Human approval remains attributable to an eligible person or role. Neither the
workflow, its agent, nor a child Run can approve its own escalation. Exact
ownership-transfer, orphaning, retry, idempotency, concurrency, approval-timeout,
and secret-rotation behavior remains open.

### D-13 — Home is the canonical user data plane; upstream attachments stay external

**Decision**

Home is the durable user data plane, not a package generated when the user asks
to export. At minimum:

- each Project has a canonical directory in or attached to Home;
- each Home-managed Knowledge Space is a directory containing its own Git
  repository, while an upstream-managed Space has an attached checkout or index
  projection; both follow one repository per governance and export boundary as
  required by D-08; and
- each Artifact is a versioned file tree in or attached to Home; and
- Skills, Agent Profiles, and workflow definitions are inspectable, versioned
  Home resources; and
- llame observes or imports those sources and builds its retrieval indexes and
  application projections from them.

A Project directory remains an organizational and working-context root, not an
automatic authorization boundary. A Home may reference shared or organization
Knowledge Spaces without folding their history into the personal repository.

The operational control plane remains database-authoritative for identities,
grants, service identities, Runs, audit, approvals, and secret bindings. Search,
embeddings, and other content projections are rebuildable from Home. Moving a
Home to another instance therefore means attaching or copying the canonical tree
and reimporting it, not exporting content out of an opaque llame database.

As defined in D-06, sandboxes do not mount Home. They receive only selected
copy-on-write Project and Artifact working copies plus a private scratchpad;
everything else is inaccessible. The exact Home layout beyond these durable
resource roots, and the portable representation of database-only episodic and
operational state, remains open.

### D-14 — An Artifact is one lightweight versioned file tree

**Decision**

An Artifact is a versioned file tree; a single file is a valid tree. The product
does not initially define separate single-file, bundle, source-code, document,
or binary Artifact classes.

- A published version is immutable. Editing happens in an isolated working copy
  and publishing creates the next version; a mutable `latest` pointer may select
  it.
- A single Markdown, text, or code file receives a lightweight, Gist-like
  content/edit/history experience rather than repository-management UI.
- A multi-file source Artifact uses the same abstraction and may additionally be
  mounted as a workspace or previewed.
- Text and source content may use Git internally. Binary content is not forced
  through Git. That storage choice is not an initial user-facing setting.
- Work targeting an existing Project remains a Project change rather than
  creating a redundant Artifact repository.

The Artifact remains powerless until explicitly installed as an App under D-06.
Backend layout, Git repository granularity, and richer media-specific behavior
remain implementation details until actual use requires them.

### D-15 — External channel identities fail closed until linked

**Decision**

An external Telegram, Slack, or other channel sender must map to a llame user
before the channel can create a Run. Unlinked senders receive no public assistant,
knowledge, or tool capabilities. A later implementation may offer only an
account-linking response; the first implementation may simply deny or ignore
them.

The initial mapping may be configured manually in the database or an
administrator UI. It binds a stable provider-supplied identifier in the scope of
the connector or provider tenant to a llame user. Usernames and display names do
not establish identity. Self-service linking, when added, must complete through
an already authenticated llame session or another explicit verification flow.

A linked private-channel message creates a Run under that user's authority, with
the channel recorded as an output destination. A group-channel response uses the
group's output domain and does not silently inject any participant's personal
knowledge. Channel transport never expands the user's grants.

Later channel behavior is composed from independent policy axes: destination
binding, sender admission, activation rules, handling of non-triggering messages,
and delivery visibility. Named UX modes are presets over those axes, not one
hard-coded group-mode enum. Providers and policy axes ship incrementally rather
than blocking the first linked private-channel slice.

Provider-specific linking UX, bot installation, group membership synchronization,
message editing, attachments, commands, and delivery guarantees remain open.

### D-16 — Email and calendar are connectors, not separate agent subsystems

**Decision**

Initial email and calendar access uses the protocol-neutral tool runtime from
D-05. A user may connect a compatible remote MCP server manually; its tools use
the same registration ownership, credentials, `allow`/`ask`/`deny` policy,
invocation provenance, and audit path as every other connector.

Later first-party connectors may replace manual setup with managed OAuth, account
binding, token refresh, and provider subscriptions or webhooks. They still expose
the same governed tool identities and workflow-trigger events rather than
creating parallel permission, credential, or audit systems. An incoming email or
calendar event is trigger data, not authority; an unattended reaction creates a
Run under D-12's service identity.

Provider adapters, event normalization, polling versus push delivery, token
lifecycle, and initial write scopes remain open.

### D-17 — User machines enroll as outbound Workers

**Decision**

A user-controlled machine participates as an explicitly enrolled Worker that
initiates an authenticated outbound connection to the llame control plane. It
does not require a public inbound listener and is not exposed as a general remote
shell.

Enrollment binds a device identity to its governing principal, advertised
capabilities, and revocable local policy. The control plane may dispatch only an
authority-attenuated Run or child Run under D-11. The Worker independently limits
execution to explicitly registered Project roots and capabilities, creates a
copy-on-write worktree or sandbox, streams auditable events and approvals, and
publishes only selected results.

Neither enrollment nor a job grants ambient access to the device's Home,
filesystem, credentials, or network. A private repository may remain on the
device, but local execution alone does not guarantee local privacy: any model,
tool, or connector receiving its content is still an egress destination governed
by D-09.

Revocation blocks future dispatch and attempts to terminate affected in-flight
work. It cannot retract task data already delivered to an offline or compromised
Worker. Enrollment UX, device keys, attestation, sandbox runtime, updates, local
secret handling, and offline recovery remain open.

### D-18 — Managed external harnesses use llame's internal model

**Decision**

llame first defines its own Chat, Run, resource, revision, provenance, and audit
semantics. A Claude Code, Codex, enrolled Worker, or other harness orchestrated by
llame is an executor attached to a llame Chat and its current Run; the harness
session does not replace or redefine that model.

When granted through a managed Run, an external agent may:

- query and read permitted Knowledge, episodes, and semantic facts;
- modify its Project working copy and publish authorized changes;
- create and revise Artifacts;
- submit authenticated current messages and outputs that llame records as
  attributed episodic events, and contribute semantic-fact candidates; and
- update Knowledge through the revision service, including automatically landing
  changes when its grant and the normal risk policy allow it.

A proposal is a landing state used when review is required, not a permanent
restriction on external agents. All writes retain the external agent, harness,
Run, source, and governing-domain provenance. Managed Runs use short-lived scoped
credentials.

The supported interface does not provide raw platform-storage access or bypass
the accepted-ref, workspace-publish, approval, and audit paths. A personal Home
owner may still edit their own files outside llame as described in D-07; that is
an external import rather than an integrated agent write.

The long-range goal still includes first-party read/write API and MCP access for
standalone third-party clients. Its authentication, session/Run mapping, MCP
resources and tools, conflict UX, and synchronization semantics are deliberately
open. Generic client constraints must not distort the internal model before that
model has shipped and been validated.

### D-19 — Self-improvement is versioned; self-maintenance produces PRs

**Decision**

llame improves itself by maintaining inspectable, attributable, and reversible
Knowledge, Skills, Agent Profiles, and workflow definitions in Home. It does not
silently mutate hidden prompts or train model weights as its normal improvement
mechanism.

Each execution segment pins the exact versions of these resources that formed its
context. Accepted changes affect later Runs by default. An authorized actor may
pause an active Run, attach an exact accepted or candidate Skill or context
revision through an explicit amendment, and resume as a new immutable segment of
the same Run. This supports a parent noticing a child struggle, writing a Skill,
and steering that child to use the pinned revision without rewriting prior
context.

Within externally configured policy, agents may create, edit, review, land, and
activate versioned Skills, prompts, Agent Profile behavior, workflow definitions,
and allowlisted non-authority runtime preferences for later Runs. The governing
pipeline may include automatic validation, an independent model review, a local
change request or pull request, and policy-approved automatic landing. Editable
instructions cannot grant tools, credentials, Knowledge access, output
destinations, approval power, or a wider self-modification scope; authority
remains external to content.

Eventually, an instance owner may explicitly register llame's own source and
deployment configuration as a Project. A user or authorized maintenance workflow
can then dispatch a coding Run to diagnose a problem, create an isolated branch
or worktree, implement and verify a change, push the branch, and open a pull
request through a granted source-control connector. The llame source tree is the
Project; build outputs, reports, and previews may be Artifacts.

The default source-maintenance posture is pull-request-only: the maintenance Run
does not rewrite the running installation, merge, deploy, or widen permissions.
Merge and deployment may eventually be separately granted to an eligible
identity and policy pipeline; they never follow merely from source-write access.
Automatic issue intake, log access, CI-feedback loops, dependency updates, merge
authority, and deployment remain open and outside initial scope.

## 4. Material architecture consequences

This section is an architectural interpretation of the decisions, not a frozen
implementation specification.

### 4.1 Core domain model

| Concept          | Responsibility                                                  | Must not become                                      |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Principal        | Owns policy and grants                                          | A client-supplied tenant ID                          |
| Home             | Canonical principal-controlled content tree                     | A raw sandbox mount                                  |
| Knowledge Space  | Canonical knowledge and history                                 | A folder used as an ACL                              |
| Project          | Organizes context, defaults, and a working root                 | The universal ownership boundary                     |
| Chat             | Persistent interactive, child, or background container for Runs | A permanent authority or automatic-context container |
| Run              | Durable agentic turn, capability and lineage boundary           | One provider inference or mutable permission bag     |
| Episode          | Immutable record of interaction and execution                   | Canonical current knowledge                          |
| Semantic fact    | Derived compact recall with provenance                          | A hidden replacement for Markdown                    |
| Revision         | Proposed or accepted vault change                               | Direct agent mutation of main                        |
| Workspace        | Domain-bound live working state bound to one or more Chats      | An authority shortcut or raw Home mount              |
| Artifact         | Lightweight versioned file tree                                 | An implicitly trusted application                    |
| App              | Installed capability-bearing service                            | Arbitrary code with user authority                   |
| Connector        | Secret and external-capability broker                           | Raw credentials passed to sandboxes                  |
| Agent profile    | Prompt, skills, model, and tool defaults                        | Owner of user knowledge                              |
| Delegation       | Parent-child Run task and attenuated authority                  | Ambient context or permission copy                   |
| Service identity | Stable workload subject for unattended Runs                     | A copy of its creator's authority                    |
| Channel mapping  | External stable ID to authenticated llame user                  | Username-based authentication                        |
| Worker           | Enrolled outbound execution endpoint                            | A general remote shell                               |

### 4.2 Request-to-revision lifecycle

1. **Resolve intent:** infer the relevant Project and candidate Knowledge
   Spaces without expanding authority.
2. **Freeze maximum authority:** create the Run capability snapshot and output
   domain, then attach the live revocation lease.
3. **Retrieve:** enforce authorization before candidate generation and ranking,
   expand graph edges only through visible nodes, and rank permitted knowledge,
   episodes, and facts with provenance and freshness metadata. Retrieval caches
   either contain authorization-neutral data or use an authorization
   fingerprint covering the principal, policy/revocation version, readable
   resource set and grants, governing domain, provider policy, and explicit Run
   constraints. Authorization is rechecked on reuse.
4. **Verify, act, or delegate:** invoke native or MCP tools through the broker,
   dispatch bounded child Runs, and create a workspace or sandbox only when
   needed.
5. **Answer:** preserve source and domain lineage in the response.
6. **Learn:** derive provenance-, scope-, and domain-bearing semantic-fact
   transition candidates, plus a Markdown patch when user-readable knowledge
   should change.
7. **Govern:** apply the same risk, transfer, and approval policy to the
   optional Markdown revision and every fact transition.
8. **Publish:** make the approved revision and/or fact transitions visible,
   update derived indexes, and make the improved context available to later
   Runs.

Semantic facts are durable records, not indexes. Every candidate retains an
exact source-kind and source reference. A revision-derived candidate remains
pending until its source commit becomes reachable from the canonical accepted
Git ref. Reconciliation then accepts the fact transition idempotently. Retrieval
must not serve a revision-derived fact whose source commit is not accepted. An
episode- or event-derived candidate may be accepted under the same risk,
approval, domain, and live-revocation rules without requiring a Markdown
revision.

Reconciliation follows each Space's configured canonical accepted ref and updates
operational records and derived projections after logical visibility. A revert
moves knowledge forward with a new commit and append-only fact supersession or
invalidation events. A privileged purge follows the transitive erasure path
instead.

### 4.3 Storage ownership

**Recommendation**

- Home owns portable user-controlled content and configuration. Home-managed
  Knowledge Space Git commits and accepted refs are canonical; an
  upstream-managed Space follows its configured external accepted ref and keeps
  only a checkout or index projection in Home. Project directories are canonical
  working roots. Artifact file trees and version history are canonical Home
  content. Jujutsu workspaces, operation history, hidden revisions, and change
  IDs are adapter-local workflow state.
- Postgres owns identity, grants, episodes and Run events, semantic facts and
  transitions, Run capability snapshots, candidate/prepared workflow state,
  proposals, approvals, audit events, connector metadata, Artifact catalog
  projections, App installation state, and the last observed and indexed
  canonical Knowledge revisions.
- Object storage or local filesystem storage may back Home content, artifact
  blobs, workspace snapshots, and imports; the backend does not replace Home's
  logical resource and version boundaries.
- Search, graph, and vector stores remain disposable projections with source
  pointers. They enforce authorization before retrieval or traversal; a
  post-top-k filter is not isolation.
- A dedicated service, not an agent sandbox, crosses these storage boundaries.

This split avoids two bad extremes: putting authorization in editable Markdown,
or hiding the user's knowledge inside an opaque application database.

## 5. Initial scope

### 5.1 The first vertical slice: tool-enabled chat

**Recommendation**

Add useful MCP tool use to the current chat and Run model:

1. Protocol-neutral tool runtime with permissions, approvals, secrets, audit,
   and result provenance.
2. Minimal remote MCP client adapter with instance-owned and user-owned server
   registrations and credentials; stdio transport is out of scope.
3. Tool discovery and an explicit effective tool set for each Run.
4. Per-tool **allow**, **ask**, or **deny** selection, with configurable defaults
   for instance-owned system tools.
5. Agent-loop invocation, result streaming, cancellation, and useful failures.
6. User-visible access, calls, approvals, and audit history.
7. Web search as the first end-to-end evaluation, while allowing other
   compatible remote MCP servers to be connected through the same path.

Acceptance is behavioral: from an ordinary chat, a user can connect and grant a
remote MCP web-search tool, the agent can use it to answer a question, an
ungranted tool cannot be called, and the user can inspect what happened. The
evaluation must not special-case or limit the runtime to search. Workspace
files, knowledge mutation, and later recall are explicitly outside this
milestone.

### 5.2 Agreed short-term sequence

1. **Tool-enabled chat:** protocol-neutral tool runtime and MCP adapter in the
   existing Run loop.
2. **Agent workspace:** Chat-associated live files, child sharing or isolation,
   and native workspace tools.
3. **Durable knowledge loop:** personal organizational spaces inside one owner's
   trust domain, retrieval, provenance, episodic recall, and the revision
   service. Per-Space policy and shared domains are not prerequisites.

The detailed short-term plan ends here. Later layers remain directional horizons
until their dependencies and product value are proven.

### 5.3 Long-range horizons — abstract, not implementation commitments

1. **Interactive artifacts:** sandboxed, versioned, temporary read-only
   capabilities.
2. **Installed apps:** manifests, persistent state, triggers, connectors,
   service identity.
3. **Agent orchestration:** reusable profiles, optional governed memory, and
   bounded parallel or nested Run trees.
4. **Shared domains:** family/team spaces, narrow shared capabilities, explicit
   transfers.
5. **Execution fabric:** outbound enrolled Workers plus remote harnesses using
   ACP, A2A, App Server, OpenCode, or vendor adapters.
6. **Automation:** dedicated service identities, durable workflow triggers,
   retries, approvals, and observability.
7. **Multi-channel surfaces:** fail-closed linked identities and channel-aware
   output domains.
8. **Enterprise controls:** organization policy, upstream knowledge sources,
   retention, release workflows, and stronger DLP.
9. **Self-maintenance:** governed diagnosis and pull requests against an
   explicitly registered llame Project.

The order within these long-range horizons is still open; this is neither an
implementation plan nor an estimate.

## 6. Explicit non-commitments

The following are part of the long-range vision but are not resolved initial
scope:

- an n8n-style visual workflow builder;
- arbitrary marketplace MCP servers;
- the implementation schedule and concrete limits for nested multi-agent
  orchestration;
- persistent full Linux machines for every agent;
- unconstrained package installation or agent-authored authority-bearing runtime
  policy;
- automatic Worker installation, unattended host access, and concrete private-
  machine coding harness support;
- artifact-to-App installation details;
- autonomous Home Assistant or other high-consequence control;
- managed first-party email/calendar onboarding and broad write scopes;
- self-service channel linking and provider-specific delivery semantics;
- per-span classification, automatic redaction, or full enterprise DLP;
- cross-instance federation;
- automatic merge or deployment of self-authored changes;
- model-weight training or unconstrained recursive self-modification.

Deferral is not rejection. These depend on the Run, capability, revision, and
information-flow primitives being trustworthy first.

## 7. Open decisions

### O-01 — Knowledge routing UX

How should the global assistant show and correct automatic Project/Space
selection without making every message start with a filing form?

### O-02 — Knowledge layout and editing contract

What conventions, if any, should exist above ordinary Markdown: stable IDs,
links, attachments, page types, generated sections, and conflict-safe
reorganization?

### O-03 — Revision policy

The high-level risk-tiered policy is decided. What exact thresholds determine
which knowledge changes may auto-land? The implementation still needs a
concrete risk matrix, validators, review UX, and rules for destructive
refactors.

### O-04 — Semantic fact schema

What is the smallest useful representation for subject, predicate/value,
source, scope, temporal validity, confidence, status, and supersession without
building a second knowledge base?

### O-05 — Agent model

The high-level profile, Run-tree, memory, and service-identity split is resolved
in D-11. Multi-actor transcripts and direct human steering of still-parented
child Chats are also resolved there. Still open: profile scope and inheritance,
which Agent Memory scopes ship and their defaults, delegation budget defaults,
delegation-envelope and one-Run-grant UX, failure aggregation, result synthesis,
Best-of-N judging, Chat retention and archive authorization details, eventual
`auto` approval rules, and how each external harness adapter maps steering
boundaries, llame approvals, and cancellation.

### O-06 — Local and remote execution

The outbound enrolled-Worker boundary is resolved in D-17. Still open: enrollment
and recovery UX, device-key rotation, attestation, sandboxing, networking, local
secret access, updates, offline cancellation, and concrete coding-harness
adapters. Also open after the reference verification in section 2.6: whether
parallel child creation should warn or require isolation; when snapshots are
taken; and how concurrent shared writers, integration, retention, and cleanup
behave.

### O-07 — Artifact and App contract

The minimal versioned-file-tree Artifact model and explicit Artifact-to-App trust
boundary are resolved in D-14 and D-06. Still open: the smallest App manifest,
capability vocabulary, installation review, API/event integration, quotas, and
update model. Artifact subclasses and backend-selection UX are deliberately not
planned.

### O-08 — Workflow semantics

The dedicated-service-identity and ordinary-Run model is resolved in D-12. Still
open: definition and installation schemas, ownership transfer and orphaning,
trigger delivery guarantees, idempotency, retries, concurrency, installation
updates, the default Chat-routing strategy, target and correlation rules,
overlapping Runs in a reused Chat, approval timeout, secret rotation, and
retention of triggering payloads.

### O-09 — Shared-domain transfer

What is the exact review flow for moving a fact, artifact, summary, or message
from corporate or mixed context into personal/shared context?

### O-10 — Portable Home format

The Home-first direction is resolved in D-13: portable user-controlled content is
already canonical and is attached or copied into a new instance, then reimported
and reindexed; upstream-managed Spaces are reattached to their canonical source.
Still open: the exact directory conventions and how database-only episodes,
semantic facts, Apps, connector configuration, grants, audit history, and
optionally encrypted secrets migrate alongside Home. Derived indexes are rebuilt,
not exported as authority.

### O-11 — Purge and retention contract

Which principals may invoke privileged history rewrite, what evidence must be
retained in the audit tombstone, how are mirrors and backups rotated, and how
does llame prove deletion without falsely claiming it can retract prior exports?

### O-12 — Multi-channel delivery details

The fail-closed identity mapping and group-output boundary are resolved in D-15.
Still open: self-service linking, bot installation, group membership changes,
commands, attachments, message edits, retries, and channel-specific retention.

### O-13 — Standalone external integration semantics

After the internal Chat, Run, resource, revision, and audit model is proven, how
should a manually connected third-party client authenticate, group calls into
sessions or Runs, contribute episodic activity, and receive resumable context
without fabricating lifecycle boundaries the client does not expose?

## 8. Implications for llame's canonical documents

**Recommendation**

Do not paste this platform vision into the existing giant SPEC. That would
repeat the current failure: vision, future architecture, shipped behavior, and
implementation detail would drift inside one document.

After the open domain questions above are settled:

- **VISION.md** should state the product thesis, target users, compounding loop,
  principles, staged horizon, and explicit non-goals.
- **SPEC.md** should specify current committed product behavior and durable
  invariants, not every plausible future subsystem.
- **ADRs or focused architecture docs** should own Run security, knowledge
  revision, memory layers, Apps, execution fabric, and information flow.
- **ROADMAP.md** should contain only sequenced work that llame intends to build,
  not the entire idea inventory.
- **Research packages** should preserve comparisons, evidence, rejected
  alternatives, and uncertainty.

The current vision already labels several of these ideas as unreviewed emerging
directions [13]. This synthesis is the intermediate decision record needed
before promoting them into canonical commitments.

## Claims-Evidence Table

This table covers the factual findings that materially influenced the design.
The decision log itself records product choices rather than externally provable
claims.

| Finding                                                                                                                                        | Evidence                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue #194 explicitly defers semantic memory and Knowledge Spaces                                                                              | Issue #194 [1]; evidence c52774f32b399275                                                                                                                                                 |
| OpenClaw documents a provenance-rich knowledge layer but does not claim hostile multi-tenant isolation                                         | OpenClaw memory and security docs [2, 3]; evidence 687ed5bd92df88f5, 61da5c9ac4f16e14                                                                                                     |
| Hermes describes bounded persistent memory and connects memory with agent-managed skills                                                       | Hermes docs [4, 5]; evidence 2b62f0e92699e139, 027da02fa12fbda2                                                                                                                           |
| gbrain treats the repository as the system of record and asks before cross-brain writes                                                        | Pinned gbrain sources [23, 24]; evidence 121a0b8bd2961acd, 12e442f0b5c12996                                                                                                               |
| Odysseus restricts extraction to facts stated or clearly implied by the user but adds extracted entries automatically                          | Pinned Odysseus extractor [25]; evidence 6b86866a3873e69e, 897e68a080afe5b0                                                                                                               |
| Letta memory blocks are agent-writable by default and block replacement overwrites the current value                                           | Letta documentation [26]; evidence ad59ae9af843bec9, 20d3611633f7b5f3                                                                                                                     |
| Mem0 retains temporal context rather than treating a newer value as history erasure                                                            | Mem0 [27]; evidence 553a875582b62181                                                                                                                                                      |
| Graphiti traces derived context back to the source episodes that produced it                                                                   | Graphiti [29]; evidence 23667aefbcf9d045                                                                                                                                                  |
| ACP lets the client control the environment and terminal execution, while remote transport standardization is still evolving                   | ACP documentation [9, 10]; evidence 56ff27d59f0d966d, 81aa231de7dd88c5, 4f33f2aabeb17e06                                                                                                  |
| Jujutsu gives each workspace a working-copy commit and merges divergent operation-log views while recording unresolved conflicts               | Jujutsu documentation [30, 31]; evidence 6021f5a2f4b84257, 84aa86dd75c9e6c2, e1521eed46e404ff                                                                                             |
| Jujutsu documents Git-backend corruption risk under shared-filesystem concurrency                                                              | Jujutsu concurrency documentation [31]; evidence e7a53f39204a4c1b                                                                                                                         |
| Jujutsu warns about interleaved Git operations and does not promise a stable library or CLI integration API                                    | Jujutsu documentation [32, 33]; evidence af934055fd659084, 2a6b96b1e2574965, 3f250d63829b10f2                                                                                             |
| The named hosted products provide general sandbox compute rather than requiring a GitHub repository                                            | Vercel, E2B, Daytona, and Modal docs [34, 36, 38, 41]; evidence 9d4713df736e3ba2, 1c8b3aa40b240ea7, e14ef5934e7f2636, c95d589aca65d3cc                                                    |
| Current providers commonly separate durable or shared storage from an individual sandbox lifecycle                                             | Vercel Drive, Daytona Volumes, and Modal Volumes/snapshots [35, 39, 42, 43]; evidence 7596d7cc3f81b100, 31fae1d890f9525b, 318ce38a02945690, e39a1d0d9b7e93c5                              |
| E2B BYOC and Daytona customer-managed runners reduce data-plane dependence but do not imply the same deployment or control-plane model         | E2B and Daytona docs [37, 40]; evidence dcd683e05029ac5f, 0fd5395f897b0c60, fa81b17b4746da45                                                                                              |
| Low-level local runtimes do not supply a complete multi-tenant sandbox service                                                                 | Docker, gVisor, and Firecracker docs [44, 45, 46, 47, 48]; evidence 72613df217101340, e3ae6b8fcba4ded1, f64d7cd21b317fbf, b80e7a011517506b, 8cad84a816e4b5bb, 9cada48e0097878a            |
| Claude Code custom agents separate declarative profiles, isolated invocations, scoped tools/Skills/MCP, optional memory, and nested delegation | Claude Code subagent and memory docs [49, 50]; evidence 7ae2b49c183d650f, d8c3041af95e672b, 64bd278ea1f9053c, 29fbe73a608c4d12, f920d61c4a7e38b2                                          |
| Codex and Claude Code keep active steering inside the current turn/run but start a new turn/run when continuing an idle or completed agent     | Codex App Server and pinned source [6, 51], Claude Code subagent docs [49]; evidence 46f9a70b2dce1834, 813ac6d9ef20574b, 5bd24e813fc970a6                                                 |
| Codex retains a task's live working tree or associated worktree across turns rather than restoring a fresh filesystem per turn                 | Codex task and worktree docs plus pinned source [51, 52, 53]; evidence 22d2fae0dd48f1c3, 95df8f8e790d1162, bced15120943b3b9, 889331f6a99a5626                                             |
| Claude Code binds sessions to a live directory and uses prompt checkpoints for local undo rather than ordinary next-turn workspace transport   | Claude Code session, checkpoint, worktree, and subagent docs [49, 54, 55, 56]; evidence 8f4dc09d09e6156c, 6a91333904299dd7, feecbc68e34d1d0c, 38e87df61f2f7b16, 4da31d69e97f7b00          |
| OpenCode stores a directory on the Session and applies snapshots and undo to the same live worktree                                            | OpenCode TUI, configuration, CLI, and pinned source [57, 58, 59, 60]; evidence 95e13fd9a4fbb35b, a16f66d04db80ce8, 12bb64de3e92c64d, f430632ac0744b34, 9fc542b89b7f4421, a3e20e127d8700a5 |
| Across Codex, Claude Code, and OpenCode, child conversation identity and filesystem isolation are separate choices                             | Pinned Codex and OpenCode source plus Claude Code subagent/worktree docs [49, 51, 56, 60]; evidence 889331f6a99a5626, 4da31d69e97f7b00, 38e87df61f2f7b16, 1f3690110519620c                |

## Counterevidence Register

| Tempting premise                                                                   | Counterevidence or limitation                                                                                                                                         | Design response                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A Markdown “brain” is the complete memory system                                   | Reference systems add curated claims, temporal facts, or separate episodes [17, 25, 26, 27, 28, 29]                                                                   | Keep Markdown, episodes, semantic facts, and indexes distinct                         |
| Container isolation makes a shared instance safely multi-tenant                    | OpenClaw explicitly rejects that security interpretation [3]; NanoClaw separates groups when different people are involved [20]                                       | Model principals, capabilities, Runs, and information flow independently of sandboxes |
| One repository can hold personal and corporate vaults if directories are protected | Git history is an export surface, and filesystem layout is not an authorization engine                                                                                | Use one repository per governance and export boundary                                 |
| Jujutsu removes the need for a landing service                                     | Git/Jujutsu interleaving can diverge and integration APIs can change [32, 33]                                                                                         | Pin an adapter and serialize accepted-head updates                                    |
| A protocol choice solves the remote execution product                              | ACP remote transports are still being standardized [10], while ACP, A2A, App Server, and OpenCode expose different abstractions [6, 9, 10, 11, 12]                    | Keep llame's Run model protocol-neutral and treat harnesses as adapters               |
| Universal age-based confidence decay solves stale knowledge                        | Mem0 retains temporal history rather than simply deleting it [27], and historical facts do not become false from age alone                                            | Verify volatile facts at use; model supersession and validity explicitly              |
| A hosted sandbox should own the durable workspace                                  | Named providers expose separate volume, drive, or snapshot lifecycles [35, 39, 42, 43]                                                                                | Keep durable Workspace files in llame and treat executors as replaceable attachments  |
| Firecracker is a ready-made self-hosted sandbox service                            | Firecracker leaves egress filtering and snapshot packaging, security, and lifecycle to the operator [47, 48]                                                          | Do not build a microVM control plane as milestone two                                 |
| Persistent agent memory requires an autonomous agent identity                      | Claude Code stores optional memory at user/project/local scope and agents inherit a permission context [49]                                                           | Keep memory principal-owned; reserve service identities for unattended Apps/workflows |
| Postgres should decide which Home knowledge revision is canonical                  | That would make the accepted Git ref a database projection rather than Home-first state                                                                               | Make the accepted ref authoritative and reconcile database/index state from Home      |
| A fresh restored workspace per Run is required for parity with coding harnesses    | Codex, Claude Code, and OpenCode retain live task/session directories and use snapshots chiefly for undo or cleanup recovery [51, 52, 53, 54, 55, 56, 57, 58, 59, 60] | Choose per-Run rematerialization only as an explicit stronger isolation policy        |

## 9. Limitations

- This is architecture research, not implementation validation.
- The references are weighted toward open-source agent systems and public
  documentation; they do not establish product-market demand.
- No end-to-end threat model has tested cross-domain retrieval, model-provider
  leakage, connector payloads, logs, caches, or revision-service compromise.
- No prototype has measured Jujutsu repository contention, indexing latency,
  large-vault behavior, or failure recovery.
- No final connector, workflow, sandbox, or export format has been selected.
- No enterprise compliance claim follows from the proposed security model.
- Estimates and milestone commitments have intentionally not been invented.

## Recommendations: prioritized next work

1. **Specify tool-enabled chat.** Turn the agreed remote-MCP, registration,
   three-state permission, audit, and web-search evaluation boundary into the
   first implementation plan.
2. **Prototype the MCP vertical slice.** Connect a real remote search server,
   invoke it through the existing Run loop, enforce denial, and render the audit
   trail. Do not depend on workspace or knowledge work.
3. **Specify the workspace slice.** Define top-level Chat binding, child-Chat
   creation modes, recorded base revisions, Run deltas, and audit before
   selecting any sandbox runtime; use the agreed shared default and leave
   shared-writer details open.
4. **Threat-model execution separately.** Evaluate local OCI/gVisor and optional
   hosted adapters before enabling model-directed processes; plain Docker is not
   an assumed hostile multi-tenant boundary.
5. **Only then rewrite canonical docs.** Promote approved decisions into
   VISION.md, a short-term roadmap, and focused architecture records; trim
   SPEC.md rather than growing it.

## Revision history

- **v0.32 (2026-07-15):** Made `shared` the default Workspace mode for a newly
  created child Chat and required its creator to request copy-on-write
  `isolated` explicitly; kept concurrent shared-writer behavior open.
- **v0.31 (2026-07-15):** Replaced the Run-owned workspace proposal with a
  domain-bound live Workspace associated with a Chat; made `shared` versus
  copy-on-write `isolated` an immutable child-Chat creation choice reused by all
  later child Runs; left the creation-time default and concurrent-writer details
  open.
- **v0.30 (2026-07-15):** Verified Codex, Claude Code, and OpenCode workspace
  continuity against current official documentation and pinned source; found
  that all three retain live task/session workspaces and use snapshots for undo
  or cleanup rather than automatic per-turn rematerialization; recorded the
  conflict with D-06 without silently changing the product decision.
- **v0.29 (2026-07-15):** Made **ask** pause the same Run in an auditable
  `awaiting_approval` state; required user approval initially; deferred
  orchestrator/classifier `auto` approval; kept executor suspension separate
  from the logical Run state.
- **v0.28 (2026-07-15):** Let child Runs inherit the initiating user's available
  concrete tools and per-tool policies by default, including mutating tools;
  retained attenuation and audit; separated routing an **ask** through the
  orchestrator from explicitly granting an `auto` policy that may approve
  without a human.
- **v0.27 (2026-07-15):** Limited each Chat to one active Run; routed steering or
  queued work explicitly; modeled Best-of-N and Summary-of-N as a parent Run
  orchestrating parallel isolated child Chats rather than concurrent Runs in one
  Chat.
- **v0.26 (2026-07-15):** Made workflow Chat routing configurable: independent
  triggers may create new background Chats, while continuous processes may reuse
  a configured Chat and create a new Run there; left defaults, correlation, and
  overlapping-trigger behavior open.
- **v0.25 (2026-07-15):** Required every Run—including workflow, maintenance,
  and other background work—to belong to a Chat and reuse one transcript/event/
  steering architecture; allowed origin and presentation metadata to hide or
  nest non-interactive Chats without implying automatic context reuse.
- **v0.24 (2026-07-15):** Prioritized llame's internal Chat, Run, resource,
  revision, provenance, and audit model over speculative manual-integration
  semantics; kept orchestrated harnesses inside managed Runs; moved standalone
  API/MCP lifecycle and authentication details back to an open decision.
- **v0.23 (2026-07-15):** Kept completed child Chats unarchived and visible until
  a user or authorized orchestrator explicitly archives them; separated visual
  collapse, archival, transcript retention, workspace retention, and executor
  lifetime.
- **v0.22 (2026-07-15):** Gave each child Chat a persistent maximum delegation
  envelope rather than reusable authority; required every Run to intersect that
  ceiling with current initiator grants, Agent Profile limits, governing policy,
  and adapter capability; kept widening explicit and revocation live.
- **v0.21 (2026-07-15):** Verified Codex and Claude Code lifecycle behavior;
  generalized Chat as the persistent root-or-child conversation containing Runs;
  kept active parent or human steering inside the current Run; treated queued or
  post-terminal follow-ups as new Runs in the same Chat; and left continuation
  authority explicitly open.
- **v0.20 (2026-07-15):** Synchronized earlier agreed resolutions: qualified
  permissions by concrete integration tool; separated Home-managed from
  upstream-managed canonical refs; split portable workflow definitions from
  authority-bearing installations; made Project associations steering rather
  than recursive materialization; defined channel policy axes; and allowed
  bounded, versioned self-improvement plus explicit live context amendments
  without self-expanding authority.
- **v0.19 (2026-07-15):** Made completed, failed, and cancelled Runs immutable;
  modeled later follow-ups as linked continuation Runs; and separated persistent
  external executor-session context from llame Run identity and authority.
- **v0.18 (2026-07-15):** Allowed humans, native subagents, workflows, tools, and
  external harnesses to contribute authenticated episodic events and durable
  memory changes while reserving actor, time, approval, and lineage sealing to
  the control plane; distinguished harness-reported detail from observed events.
- **v0.17 (2026-07-15):** Moved per-Space authorization and cross-domain
  information-flow enforcement out of the initial personal Knowledge slice;
  retained user-to-user tenant isolation; treated early Spaces as organization,
  retrieval, and revision boundaries; and separated calendar disclosure from KB
  access control.
- **v0.16 (2026-07-15):** Defined a Run as one durable agentic turn containing
  potentially many model inferences, tools, child Runs, pauses, and execution
  segments; distinguished a new completed-chat turn from steering or resuming
  the same active logical Run.
- **v0.15 (2026-07-15):** Separated authenticated event authorship from provider
  message roles; made Run transcripts explicitly multi-actor; allowed authorized
  users to inspect and steer a child directly without changing its parentage or
  authority; required parent notification and adapter-specific safe-boundary
  injection or segmented resume.
- **v0.14 (2026-07-15):** Defined self-improvement as visible, versioned changes
  to Home resources pinned per Run; prevented instructions from expanding their
  own authority; and added a long-range self-maintenance loop that changes an
  explicitly registered llame Project and opens a PR without self-merging or
  self-deploying.
- **v0.13 (2026-07-15):** Made the future first-party llame API/MCP surface
  genuinely read/write for external agents; allowed governed Project, Artifact,
  episode, fact, and Knowledge contributions—including policy-approved automatic
  landing—without bypassing provenance, revision, or audit paths.
- **v0.12 (2026-07-15):** Defined user machines as explicitly enrolled,
  outbound-connected Workers rather than inbound remote shells; constrained jobs
  to attenuated Runs and registered roots; preserved local policy, audit,
  revocation, and provider-egress boundaries.
- **v0.11 (2026-07-15):** Unified email and calendar with the normal connector
  and tool runtime; kept manual remote MCP viable first; reserved first-party
  integrations for managed OAuth and event ingestion without duplicating
  permissions, credentials, Runs, or audit.
- **v0.10 (2026-07-15):** Made external channels fail closed: only senders mapped
  to llame users may create Runs; allowed manual database/UI mappings initially;
  rejected username-based identity; and kept group-channel output separate from
  personal knowledge by default.
- **v0.9 (2026-07-15):** Reduced Artifacts to one lightweight versioned-file-tree
  abstraction; made published versions immutable; kept single-file text/code UX
  Gist-like; allowed Git as an internal text/source mechanism without creating an
  Artifact taxonomy or storage configuration surface.
- **v0.8 (2026-07-15):** Made Home the canonical user content/configuration
  plane; made Project directories and Knowledge Git repositories imported
  sources; limited sandboxes to Project and Artifact working copies plus
  scratch; reversed knowledge visibility so the accepted Git ref is authoritative
  and Postgres/index state reconciles from Home.
- **v0.7 (2026-07-15):** Decided that unattended workflows execute as ordinary
  Runs under dedicated, explicitly granted service identities rather than
  borrowing their creator's authority; separated governing ownership, trigger
  input, human approval, and live revocation.
- **v0.6 (2026-07-15):** Added the Claude Code custom-agent reference model;
  separated Agent Profiles, isolated Run invocations, optional scoped Agent
  Memory, and unattended service identities; decided that native and external
  agents form bounded, auditable, authority-attenuating Run trees; recorded the
  multi-tenant boundary that persistent memory remains principal-owned and
  governed.
- **v0.5 (2026-07-15):** Made tool-enabled chat the independent first milestone;
  added remote-first MCP scope, instance/user ownership, managed-connector
  evolution, per-tool allow/ask/deny policy, and web-search evaluation; separated
  first-party Workspace storage from replaceable execution backends and
  added a current provider/runtime evidence pass.
- **v0.4 (2026-07-15):** Kept agreed product choices as decisions and explicitly
  demoted deeper revision, revocation, purge, and consistency mechanics to
  working recommendations or open details; clarified logical revision
  visibility and episode-sourced facts without treating them as finalized
  design.
- **v0.3 (2026-07-15):** Added privileged purge semantics, live revocation over
  frozen Run snapshots, retention-aware revocation, derived-lineage
  invalidation, per-Space revision workspaces, compare-and-swap landing,
  authorization-fingerprinted caches, governed semantic-fact transitions, and
  cross-store recovery; narrowed Jujutsu and memory claims and synchronized
  their evidence.
- **v0.2 (2026-07-15):** Reframed Markdown as a source of record; separated
  three durable stores from derived indexes; clarified page-level freshness and
  the unresolved revision-policy thresholds; corrected Odysseus extraction
  wording; added Jujutsu conflict, shared-filesystem, cleanup, canonical-Git,
  and external-ingress constraints; completed processor-aware information flow,
  Chat lineage filtering, pre-ranking authorization, and scoped revocation;
  refreshed the Jujutsu evidence ledger.
- **v0.1 (2026-07-15):** Initial synthesis of ten decisions, architecture
  consequences, staged scope, open decisions, and the research evidence base.

## Bibliography

[1] (2026). [Chat search to episodic memory](https://github.com/leon0399/llame/issues/194)

[2] (2026). [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)

[3] (2026). [OpenClaw Security and Sandboxing](https://docs.openclaw.ai/security)

[4] (2026). [Hermes Agent Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)

[5] (2026). [Hermes Agent Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)

[6] (2026). [Codex App Server](https://learn.chatgpt.com/docs/app-server.md)

[7] (2026). [Telegram Bot API Changelog](https://core.telegram.org/bots/api-changelog)

[8] (2026). [n8n Workflow Sharing](https://docs.n8n.io/workflows/sharing/)

[9] (2026). [Agent Client Protocol v1 Overview](https://agentclientprotocol.com/protocol/v1/overview)

[10] (2026). [Agent Client Protocol Updates](https://agentclientprotocol.com/updates)

[11] (2026). [A2A Protocol Specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)

[12] (2026). [OpenCode Server](https://opencode.ai/docs/server/)

[13] (2026). [llame Vision](https://github.com/leon0399/llame/blob/feat/chat-project-archive/VISION.md)

[14] (2026). [llame Feature Specification](https://github.com/leon0399/llame/blob/feat/chat-project-archive/SPEC.md)

[15] (2026). [Long Term Memory for llame Cross Report](https://github.com/leon0399/llame/blob/feat/chat-project-archive/docs/research/long-term-memory/2026-07-05-memory-landscape/CROSS-REPORT.md)

[16] (2026). [llame Changelog](https://github.com/leon0399/llame/blob/feat/chat-project-archive/CHANGELOG.md)

[17] (2026). [OpenClaw Memory Wiki Claims](https://github.com/openclaw/openclaw/blob/623ec0f369a5c19c1cc45c83ce814bae36c7d91a/docs/plugins/memory-wiki.md#L121-L129)

[18] (2026). [Hermes Agent Skill Curator](https://github.com/NousResearch/hermes-agent/blob/df5700ebe317ff9f2d9ea4677513e012eb68b6f4/agent/curator.py#L9-L19)

[19] (2026). [Hermes Agent Delegate Tool](https://github.com/NousResearch/hermes-agent/blob/df5700ebe317ff9f2d9ea4677513e012eb68b6f4/tools/delegate_tool.py#L1-L16)

[20] (2026). [NanoClaw Isolation Model](https://github.com/nanocoai/nanoclaw/blob/b7e24123ef7e2a8cb31bf24e59e752b55a34aa93/docs/isolation-model.md#L59-L74)

[21] (2026). [NanoClaw Container Runner](https://github.com/nanocoai/nanoclaw/blob/b7e24123ef7e2a8cb31bf24e59e752b55a34aa93/src/container-runner.ts#L57-L68)

[22] (2026). [NanoClaw Self Modification Guard](https://github.com/nanocoai/nanoclaw/blob/b7e24123ef7e2a8cb31bf24e59e752b55a34aa93/src/modules/self-mod/guard.ts#L13-L31)

[23] (2026). [GBrain Architecture Overview](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/README.md#L280-L286)

[24] (2026). [GBrain Brains and Sources](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/docs/architecture/brains-and-sources.md#L207-L220)

[25] (2026). [Odysseus automatic memory extractor](https://github.com/pewdiepie-archdaemon/odysseus/blob/c80462e4621c1a3360e5441843bb83b4691a8766/services/memory/memory_extractor.py)

[26] (2026). [Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)

[27] (2026). [Mem0 temporal reasoning](https://mem0.ai/blog/introducing-temporal-reasoning-in-mem0)

[28] (2026). [gbrain fact confidence decay](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/facts/decay.ts)

[29] (2026). [Graphiti temporal context graph](https://github.com/getzep/graphiti)

[30] (2026). [Jujutsu CLI reference: workspaces](https://docs.jj-vcs.dev/latest/cli-reference/#jj-workspace)

[31] (2026). [Jujutsu concurrency model](https://docs.jj-vcs.dev/latest/technical/concurrency/)

[32] (2026). [Jujutsu Git compatibility](https://docs.jj-vcs.dev/latest/git-compatibility/)

[33] (2026). [Jujutsu integration API stability FAQ](https://docs.jj-vcs.dev/latest/faq/#i-want-to-write-a-tool-which-integrates-with-jujutsu-should-i-use-the-library-or-parse-the-cli)

[34] (2026). [Vercel Sandbox documentation](https://vercel.com/docs/sandbox)

[35] (2026). [Vercel Sandbox duration and persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence)

[36] (2026). [E2B sandbox documentation](https://e2b.dev/docs)

[37] (2026). [E2B BYOC documentation](https://e2b.dev/docs/byoc)

[38] (2026). [Daytona sandboxes documentation](https://www.daytona.io/docs/en/sandboxes/)

[39] (2026). [Daytona architecture documentation](https://www.daytona.io/docs/en/architecture/)

[40] (2026). [Daytona regions and custom runners](https://www.daytona.io/docs/regions/)

[41] (2026). [Modal Sandbox resources and pricing](https://modal.com/docs/guide/sandbox-resources)

[42] (2026). [Modal Volumes documentation](https://modal.com/docs/guide/volumes)

[43] (2026). [Modal Sandbox snapshots](https://modal.com/docs/guide/sandbox-snapshots)

[44] (2026). [Docker Engine security](https://docs.docker.com/engine/security/)

[45] (2026). [Docker container resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)

[46] (2026). [gVisor architecture documentation](https://gvisor.dev/docs/)

[47] (2026). [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

[48] (2026). [Firecracker snapshot support](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)

[49] (2026). [Claude Code custom subagents](https://code.claude.com/docs/en/sub-agents)

[50] (2026). [Claude Code memory model](https://code.claude.com/docs/en/memory)

[51] (2026). [Codex turn steering and multi-agent routing source, commit 2e1607e](https://github.com/openai/codex/tree/2e1607ee2fa8099a233df7437adee5f16a741905)

[52] (2026). [Codex projects, chats, and tasks](https://learn.chatgpt.com/docs/projects)

[53] (2026). [Codex Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)

[54] (2026). [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)

[55] (2026). [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing)

[56] (2026). [Claude Code worktrees](https://code.claude.com/docs/en/worktrees)

[57] (2026). [OpenCode TUI](https://opencode.ai/docs/tui/)

[58] (2026). [OpenCode configuration](https://opencode.ai/docs/config/)

[59] (2026). [OpenCode CLI](https://opencode.ai/docs/cli/)

[60] (2026). [OpenCode session, snapshot, and child-task source, commit 05c3e40](https://github.com/anomalyco/opencode/tree/05c3e40a4e641732b991499000ca479e5dad4b02)

## Methodology appendix

- Research question: How should llame be scoped as a self-hosted,
  knowledge-first, self-improving personal AI platform with memory, workflows,
  agents, local execution, artifacts, portability, and multi-user sharing?
- Mode: standard multi-source architecture research.
- Evidence policy: prefer official documentation and commit-pinned source code;
  distinguish reference-system behavior from llame product decisions.
- Targeted 2026-07-15 update: compared the current official Vercel Sandbox,
  E2B, Daytona, Modal, Docker, gVisor, and Firecracker documentation to separate
  Workspace storage from execution-provider concerns.
- Targeted 2026-07-15 update: reviewed the official Claude Code subagent and
  memory documentation to separate agent configuration, invocation, persistent
  learning, and security identity.
- Targeted 2026-07-15 update: verified active steering, queued follow-ups,
  post-completion continuation, and subagent message routing against the current
  Codex manual, pinned Codex source, and Claude Code subagent documentation.
- Targeted 2026-07-15 update: compared sequential-turn workspace continuity,
  resume, snapshots, undo, worktrees, and child-agent directories in current
  Codex, Claude Code, and OpenCode documentation and pinned source.
- Decision policy: only choices explicitly agreed in the design discussion are
  marked **Decision**.
- Cutoff: 2026-07-15.
- Durable artifacts: report.md, sources.jsonl, evidence.jsonl, claims.jsonl,
  run_manifest.json.
