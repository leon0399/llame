---
type: Reference
title: "Superset"
description: "Bun monorepo ADE that runs CLI coding agents in Git worktree workspaces with host-service tRPC, terminal panes, diff review, remote hosts and automations."
tags: [harness, peer-executor, desktop, worktrees, host-daemon, elv2]
status: draft
resource: "https://github.com/superset-sh/superset/tree/575bd21377f2716ca5db67dc3f1b9244a63c20d9"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "575bd21377f2716ca5db67dc3f1b9244a63c20d9"
sources:
  - id: readme-l1-l36
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L1-L36"
    title: "CLI agents in one workspace with review and browser preview"
  - id: readme-l67-l69
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L67-L69"
    title: "Worktrees separate files; not a process sandbox"
  - id: readme-l167-l209
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L167-L209"
    title: "Supported agents and terminal-plus-settings surface"
  - id: license-l1-l17
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/LICENSE.md#L1-L17"
    title: "Elastic License 2.0 limitations"
  - id: development-l1-l38
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/DEVELOPMENT.md#L1-L38"
    title: "Bun monorepo with local Postgres Redis Docker stack"
  - id: agent-def-l13-l67
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/packages/shared/src/agent-definition.ts#L13-L67"
    title: "TerminalAgentDefinition: command resume fork nonInteractive"
  - id: agent-launch-l20-l74
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/packages/shared/src/agent-launch.ts#L20-L74"
    title: "Agent launch status source and terminal request schema"
  - id: agent-tooling-l47-l76
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/docs/agent-tooling.md#L47-L76"
    title: "Multi-login config dirs; credentials stay with provider CLIs"
  - id: host-service-l1-l14
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/packages/host-service/AGENTS.md#L1-L14"
    title: "host-service tRPC version skew rules"
  - id: readme-l112-l139
    resource: "https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L112-L139"
    title: "Connect another machine; cloud workspaces; Remote Access hosts"
---

# Superset

- **Stack:** Bun/Turborepo TypeScript monorepo (`apps/desktop`, `api`, `web`,
  `relay`, `realtime`; `packages/host-service`, `shared`, `agent-setup`,
  `pty-daemon`); local Docker Postgres/Redis for
  development.[^development-l1-l38] Site: [superset.sh](https://superset.sh).
  **License:** Elastic License 2.0 (ELv2); no offering as a hosted managed
  service of substantial features, and license-key circumvention is
  forbidden.[^license-l1-l17]

**Status:** Source and documentation inspection only; nothing was run. An
agent development environment that keeps vendor subscriptions and launches
Claude Code, Codex, OpenCode, Cursor Agent and many other CLIs inside per-task
Git worktree workspaces with terminals, diffs and browser
previews.[^readme-l1-l36][^readme-l167-l209] Peer to [Orca](./orca.md),
[MonoCode](./monocode.md) and [Paseo](./paseo.md). High confidence on the
terminal-agent definition and launch schemas; moderate confidence on cloud and
mobile surfaces, which are product docs more than inspected runtime code.

**Study**

1. **Worktrees are isolation of files, not sandboxes.** The README states
   worktrees separate working files and do not sandbox processes or prevent
   merge conflicts.[^readme-l67-l69] llame must not treat peer worktree adapters
   as a tenancy or OS isolation boundary.
2. **Terminal agent as a declared command surface.** `TerminalAgentDefinition`
   carries `command`, `promptCommand`, `promptTransport`, optional
   `resumeCommand`, `forkCommand` (with `{sessionId}` token) and a locked-down
   `nonInteractiveCommand` for headless runs.[^agent-def-l13-l67] That is the
   checklist for a llame executor adapter that must resume, fork or run
   one-shot without inventing provider-specific APIs.
3. **Launch request is typed and sourced.** Launch status is
   `queued` / `launching` / `running` / `failed`; sources include
   `new-workspace`, `mcp` and `command-watcher`; the request schema is
   terminal-kind only in the inspected
   revision.[^agent-launch-l20-l74] Useful for correlating peer starts with a
   llame Run attempt token.
4. **Provider CLIs own credentials.** Multi-login profiles point
   `CLAUDE_CONFIG_DIR` / `CODEX_HOME` at provisioned dirs; Superset never
   touches credential stores, and capability directories are
   symlinked while auth identity stays
   per-account.[^agent-tooling-l47-l76] Same rule for llame: do not hoist peer
   OAuth into llame's secret surface.
5. **Host service version skew.** `host-service` is called by desktop, CLI and
   mobile across versions; changes must be additive, and clients must guard
   missing procedures rather than relying only on
   `MIN_HOST_SERVICE_VERSION`.[^host-service-l1-l14] Directly applicable to
   llame API/web/worker skew.
6. **Any CLI agent as custom terminal.** Built-ins plus "any other CLI agent"
   via settings; per-agent launch commands and prompt
   templates.[^readme-l167-l209] Supports llame's peer-as-adapter model when the
   peer is a local binary, not an HTTP identity.
7. **Remote Access hosts and cloud workspaces.** Connect another machine and
   reach its workspaces from desktop, CLI or phone; cloud workspaces run without
   keeping the laptop online.[^readme-l112-l139] Multi-host placement beside
   local worktrees; Remote Access still needs the host awake and online.

**llame fit**

- High: items 2 and 3 for executor capability and launch correlation.
- Moderate: items 4, 5 and 7 for credential discipline, API skew and multi-host
  / cloud workspace placement.
- Low: workspace IDE chrome (diff viewer, browser Design mode) as product UX.
- Avoid: adopting ELv2-encumbered code or treating worktrees as security
  isolation.[^readme-l67-l69][^license-l1-l17]

**Caution:** ELv2 blocks offering substantial features as a hosted managed
service and forbids license-key circumvention.[^license-l1-l17] Unsuitable as a
dependency for llame's own hosted control plane. Remote and cloud workspace
paths still assume a trusted host machine for agent processes.

[^readme-l1-l36]: [CLI agents in one workspace with review and browser preview](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L1-L36)

[^readme-l67-l69]: [Worktrees separate files; not a process sandbox](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L67-L69)

[^readme-l167-l209]: [Supported agents and terminal-plus-settings surface](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L167-L209)

[^readme-l112-l139]: [Connect another machine; cloud workspaces; Remote Access hosts](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/README.md#L112-L139)

[^license-l1-l17]: [Elastic License 2.0 limitations](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/LICENSE.md#L1-L17)

[^development-l1-l38]: [Bun monorepo with local Postgres Redis Docker stack](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/DEVELOPMENT.md#L1-L38)

[^agent-def-l13-l67]: [TerminalAgentDefinition: command resume fork nonInteractive](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/packages/shared/src/agent-definition.ts#L13-L67)

[^agent-launch-l20-l74]: [Agent launch status source and terminal request schema](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/packages/shared/src/agent-launch.ts#L20-L74)

[^agent-tooling-l47-l76]: [Multi-login config dirs; credentials stay with provider CLIs](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/docs/agent-tooling.md#L47-L76)

[^host-service-l1-l14]: [host-service tRPC version skew rules](https://github.com/superset-sh/superset/blob/575bd21377f2716ca5db67dc3f1b9244a63c20d9/packages/host-service/AGENTS.md#L1-L14)
