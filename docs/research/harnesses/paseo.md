---
type: Reference
title: "Paseo"
description: "Local-first Node daemon ADE for Claude Code, Codex, Copilot ACP and other agent CLIs, with WebSocket clients, worktree workspaces, plugins and optional E2E relay."
tags: [harness, peer-executor, host-daemon, acp, worktrees, plugins]
status: draft
resource: "https://github.com/getpaseo/paseo/tree/a4eb0adcf62b643a7b817743f7a6fa752f4068af"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "a4eb0adcf62b643a7b817743f7a6fa752f4068af"
sources:
  - id: readme-l32-l79
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/README.md#L32-L79"
    title: "Parallel agents, daemon clients, plugins trust warning"
  - id: readme-l81-l112
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/README.md#L81-L112"
    title: "Daemon plus desktop mobile web CLI; optional relay"
  - id: license-l1-l15
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/LICENSE#L1-L15"
    title: "Apache-2.0 with third-party portions"
  - id: architecture-l1-l90
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/architecture.md#L1-L90"
    title: "Daemon owns agents; clients speak WebSocket"
  - id: architecture-l171-l185
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/architecture.md#L171-L185"
    title: "Relay zero-knowledge E2E encryption"
  - id: lifecycle-l5-l51
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/agent-lifecycle.md#L5-L51"
    title: "Agent states, closed residency, idempotent interrupt"
  - id: lifecycle-l53-l85
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/agent-lifecycle.md#L53-L85"
    title: "Subagent parentage and provider-managed children"
  - id: providers-l39-l68
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/providers.md#L39-L68"
    title: "ACP base client vs direct AgentClient; Paseo tools catalog"
  - id: data-model-l33-l55
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/data-model.md#L33-L55"
    title: "File-backed JSON under $PASEO_HOME"
  - id: readme-l147-l148
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/README.md#L147-L148"
    title: "paseo run --host targets a remote daemon; --cwd is on that host"
  - id: development-l576-l586
    resource: "https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/development.md#L576-L586"
    title: "CLI --host and ssh:// to another daemon; does not install remote daemon"
---

# Paseo

- **Stack:** Node.js monorepo (`packages/server` daemon, `protocol`, `client`,
  `app` Expo, `desktop` Electron, `cli`, optional `relay`); TypeScript
  throughout.[^architecture-l1-l90] Site: [paseo.sh](https://paseo.sh).
  **License:** Apache-2.0 for first-party code; third-party components keep
  their own licenses.[^license-l1-l15]

**Status:** Source and documentation inspection only; nothing was run. A
local-first agentic IDE: a daemon spawns Claude Code, Codex, Copilot (ACP),
OpenCode, Pi, Antigravity, Muse Code and others; desktop, mobile, web and CLI
clients attach over WebSocket.[^readme-l32-l79][^readme-l81-l112] Closest to
[bb](./bb.md) and [Orca](./orca.md) for daemon-owned peer execution. High
confidence on lifecycle and ACP adapter docs; moderate confidence on plugin
and Hub surfaces beyond architecture notes.

**Study**

1. **Daemon is the authority.** The Node daemon manages agent lifecycle,
   streams a timeline, and exposes transport-neutral agent tools (MCP is one
   adapter); clients only observe and
   command.[^architecture-l1-l90] Same split as llame's API/worker vs thin web:
   peer processes are executors, not Chat owners.
2. **Lifecycle with closed residency.** States move
   `initializing` → `idle` ↔ `running` (or `error`); `closed` keeps Paseo agent
   identity and timeline without a live provider process; interrupt is
   idempotent at the session boundary and must not accept new work after an
   ambiguous interrupt.[^lifecycle-l5-l51] Direct checklist for llame Run
   cancel and resume.
3. **Parentage is explicit.** Agent-scoped `create_agent` stamps
   `paseo.parent-agent-id`; subagents archive with the parent unless detached
   or open in another tab; provider-managed children (for example OMP
   `child_session`) are imported into the same track while the provider still
   owns the runtime.[^lifecycle-l53-l85] Maps to future llame child Runs:
   correlate identity, do not let the peer mint owner scope.
4. **ACP preferred, direct when needed.** New providers should extend
   `ACPAgentClient`; Copilot is the built-in ACP provider, with
   `GenericACPAgentClient` for `extends: "acp"` customs. Direct
   `AgentClient`/`AgentSession` covers Claude, Codex, OpenCode, Pi and
   omp.[^providers-l39-l68] Aligns with llame's ACP/A2A adapter direction and
   Zeron's ACP decision.
5. **Paseo tools are not MCP-first.** A shared tool catalog is filtered per
   provider; native registration strips the internal MCP server to avoid
   duplicates; Hub unattended MCP preapproval must fail closed until exact
   server/tool identity can be approved.[^providers-l39-l68] Same fail-closed
   instinct as llame tool allowlists.
6. **File-backed persistence.** Agents and registries live as JSON under
   `$PASEO_HOME` (default `~/.paseo`); Zod-validated, mostly atomic
   writes.[^data-model-l33-l55] Durable for a single-user daemon, not a
   multi-tenant RLS store.
7. **Optional E2E relay.** Curve25519 + NaCl box; the relay routes ciphertext
   only.[^architecture-l171-l185] Useful remote-access pattern; still assumes
   a trusted daemon host for agent execution.
8. **CLI selects among daemons.** `paseo run --host workstation.local:6767`
   runs on a remote daemon with `--cwd` on that host; global `--host` and
   `ssh://user@host` (optional `?daemonPort=`) point the CLI at another
   daemon without installing or starting it.[^readme-l147-l148][^development-l576-l586]
   Multi-host placement: many daemons, one client selector. Each daemon still
   owns execution on its machine.

**llame fit**

- High: items 1 to 5 for daemon ownership, cancel/resume, child correlation and
  ACP adapters.
- Moderate: items 7 and 8 for encrypted relay and multi-daemon host selection.
- Low: item 6 as storage; llame already persists in Postgres.
- Avoid: treating Paseo agent IDs or `$PASEO_HOME` as llame Chat/Run authority.

**Caution:** Plugins run with daemon-machine access; install only trusted
code.[^readme-l32-l79] There is no llame-style authenticated tenant isolation
across owners. Privacy claims (no telemetry) do not replace datastore
tenancy.

[^readme-l32-l79]: [Parallel agents, daemon clients, plugins trust warning](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/README.md#L32-L79)

[^readme-l81-l112]: [Daemon plus desktop mobile web CLI; optional relay](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/README.md#L81-L112)

[^license-l1-l15]: [Apache-2.0 with third-party portions](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/LICENSE#L1-L15)

[^architecture-l1-l90]: [Daemon owns agents; clients speak WebSocket](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/architecture.md#L1-L90)

[^architecture-l171-l185]: [Relay zero-knowledge E2E encryption](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/architecture.md#L171-L185)

[^lifecycle-l5-l51]: [Agent states, closed residency, idempotent interrupt](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/agent-lifecycle.md#L5-L51)

[^lifecycle-l53-l85]: [Subagent parentage and provider-managed children](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/agent-lifecycle.md#L53-L85)

[^providers-l39-l68]: [ACP base client vs direct AgentClient; Paseo tools catalog](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/providers.md#L39-L68)

[^data-model-l33-l55]: [File-backed JSON under $PASEO_HOME](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/data-model.md#L33-L55)

[^readme-l147-l148]: [paseo run --host targets a remote daemon; --cwd is on that host](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/README.md#L147-L148)

[^development-l576-l586]: [CLI --host and ssh:// to another daemon; does not install remote daemon](https://github.com/getpaseo/paseo/blob/a4eb0adcf62b643a7b817743f7a6fa752f4068af/docs/development.md#L576-L586)
