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

Knowledge is primarily Markdown in Git-compatible repositories. For
Home-managed knowledge, the accepted files and Git history are the source of
record. Indexes and embeddings are rebuildable projections.

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

### Runs are the unit of execution

A Chat is the persistent place where work continues. A Run is one durable
agentic turn, including model calls, tool calls, pauses, observations, and final
output.

An Agent Profile may later package a prompt, model defaults, Skills, tool
defaults, and optional memory. Invoking it creates a Run. A subagent uses the
same architecture: an inspectable child Chat containing child Runs, not a second
session system. Parent Runs may dispatch bounded children, and authorized users
may inspect or steer them directly. Nesting, delegation, and budget details stay
open until this slice is planned.

External coding agents and protocols such as ACP, A2A, Codex App Server, or
OpenCode remain executor adapters. llame should keep ownership of Chat and Run
identity, lifecycle, provenance, cancellation, and published results.

### Portable data, isolated execution

The long-term Home model keeps user-controlled Projects, Knowledge, Artifacts,
Skills, and agent configuration in inspectable, exportable forms. Sandboxes do
not receive the whole Home tree. They receive only selected project or artifact
working copies and scratch space, with controlled publication back to durable
state.

Artifacts start small. A single Markdown, text, or code file should not require a
repository-scale workflow. Larger coding artifacts may use Git when versioning
and collaboration justify it.

## Staged horizons

### Active: external tool connectivity

Connect instance-managed remote MCP tools to the existing durable tool loop. Keep
the adapter generic and prove it with a real web-search interaction.

### Near: runnable personal knowledge agent

Read a personal Markdown/Git vault, land one recoverable agent-authored change,
and prove deliberate recall across Chats. The release gate is the combined loop,
not isolated infrastructure.

### Later, unsequenced

- Durable Chat workspaces and lightweight Artifacts.
- Agent Profiles, child Chats/Runs, bounded orchestration, and external harnesses.
- Installed Apps, event-driven workflows, email/calendar connectors, and linked
  messaging channels.
- Enrolled user-machine Workers and replaceable sandbox backends.
- Shared family, team, and organization knowledge with explicit information-flow
  rules.
- Versioned Skills, prompts, and runtime configuration that agents may improve
  within granted boundaries.
- Self-maintenance that diagnoses llame itself and proposes changes through normal
  project and pull-request workflows.

Ordering inside this list is intentionally unresolved. A horizon enters the
roadmap only when its user job, boundaries, dependencies, and acceptance path are
clear.

## Explicit deferrals

The current release sequence does not include:

- a full RBAC or allow/ask/deny tool-permission interface;
- user-managed provider credentials or managed OAuth connector onboarding;
- automatic knowledge routing across projects or shared knowledge domains;
- semantic fact extraction, automatic memory injection, or a knowledge graph;
- arbitrary write-capable remote MCP tools or local stdio MCP processes;
- model-directed shell execution or a production sandbox fabric;
- child-agent orchestration, persistent per-agent machines, or remote coding
  harness dispatch;
- workflow builders, autonomous email/calendar actions, multi-channel bots, or
  Home Assistant control; and
- automatic merge or deployment of self-authored changes.

Deferral is not rejection. These features stay out of committed scope until the
smaller loop proves their value and the required trust boundaries are designed.
