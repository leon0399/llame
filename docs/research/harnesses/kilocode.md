---
type: Reference
title: "Kilo Code"
description: "Provider-gated header tiers, hard permission rulesets, and a fail-closed headless subagent guard"
resource: "https://github.com/Kilo-Org/kilocode"
observed:
  date: "2026-09-15"
  revision: "2151ac907ca51f10592b07fb220b4b158e9d25f5"
sources:
  - id: packages-opencode-src-session-llm-request-ts-l222-l263
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/llm/request.ts#L222-L263"
    title: "provider-gated header set"
  - id: packages-opencode-src-session-llm-request-ts-l191-l201
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/llm/request.ts#L191-L201"
    title: "chat.headers plugin hook"
  - id: packages-kilo-vscode-src-services-cli-backend-server-manager-ts-l129-l153
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/kilo-vscode/src/services/cli-backend/server-manager.ts#L129-L153"
    title: "extension spawns kilo serve"
  - id: packages-opencode-src-session-session-ts-l62-l260
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/session.ts#L62-L260"
    title: "session table with permission ruleset"
  - id: packages-opencode-src-permission-index-ts-l106-l135
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L106-L135"
    title: "resolve defaults to ask"
  - id: packages-opencode-src-permission-index-ts-l193-l249
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L193-L249"
    title: "hard ruleset and config protection"
  - id: packages-opencode-src-kilocode-permission-headless-ts-l1-l45
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/kilocode/permission/headless.ts#L1-L45"
    title: "headless subagent denial"
  - id: packages-opencode-src-tool-task-ts-l118-l288
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/tool/task.ts#L118-L288"
    title: "task tool depth cap and tool narrowing"
  - id: packages-opencode-src-session-compaction-ts-l96-l300
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/compaction.ts#L96-L300"
    title: "turn budget and pruning"
  - id: packages-opencode-src-mcp-index-ts-l45-l56
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/mcp/index.ts#L45-L56"
    title: "MCP capabilities restricted to roots"
---

# Kilo Code

- **Stack:** Bun, TypeScript, Effect, Drizzle/SQLite; hard fork of OpenCode with a shared engine embedded by the CLI and the VS Code extension; MIT

Listed by OpenCode Go as a validated client for the CLI after PR #13752. The
engine is one code path: the extension spawns `kilo serve` with
`KILO_CLIENT=vscode`[^packages-kilo-vscode-src-services-cli-backend-server-manager-ts-l129-l153],
so the CLI/extension distinction on the Go page is not a code-level branch at
this revision. Compare with [OpenCode](./opencode.md) for the upstream.

**Study**

1. **Provider-gated header tiers.** When `providerID` starts with `opencode`,
   the request adds `x-opencode-session` (session id), `x-opencode-request`,
   `x-opencode-client`, optional `x-opencode-project`, and the product
   User-Agent[^packages-opencode-src-session-llm-request-ts-l222-l263];
   per-model headers and a `chat.headers` plugin hook merge on
   top[^packages-opencode-src-session-llm-request-ts-l191-l201]. High
   confidence for #809: built-in per-provider headers, operator config, and
   per-request overrides as three tiers.
2. **Permission ruleset on the session row and hard rules.** Sessions persist
   their permission ruleset[^packages-opencode-src-session-session-ts-l62-l260];
   unmatched permission/pattern pairs resolve to
   `ask`[^packages-opencode-src-permission-index-ts-l106-l135], and a hard
   ruleset plus config-file protection override saved
   approvals[^packages-opencode-src-permission-index-ts-l193-l249]. High
   confidence as a shape for llame approvals (#778): saved grants must not
   override operator restrictions.
3. **Fail-closed headless subagent guard.** Non-interactive root sessions are
   marked headless and any permission ask from their descendants is denied
   rather than left pending
   forever[^packages-opencode-src-kilocode-permission-headless-ts-l1-l45].
   High confidence for llame's pg-boss Runs with no attached terminal (#765).
4. **`task` tool bounds.** Depth cap from config, child tool set stripped of
   `question`, `todowrite`, and `task`, child session persisted with
   `parentID`[^packages-opencode-src-tool-task-ts-l118-l288]. High confidence
   for #765's depth and allowlist narrowing.
5. **Separate pruning and compaction.** A turn budget preserves the recent
   tail while `prune()` erases old tool outputs behind a step floor and
   protects named tools[^packages-opencode-src-session-compaction-ts-l96-l300].
   Moderate confidence for llame's compaction design.

**Caution**

- Single-user server: permission state is one in-memory structure per
  instance, not scoped by identity.
- Several guards swallow errors into permissive defaults (project id, machine
  id, trusted-skill lookup); audit each before copying.
- MCP client capabilities are limited to `roots` because upstream bugs, not
  policy, disabled sampling, elicitation, and
  tasks[^packages-opencode-src-mcp-index-ts-l45-l56].
- No immutable per-turn record of the system prompt and tool declarations;
  prompts are assembled fresh per request.

[^packages-opencode-src-session-llm-request-ts-l222-l263]: [provider-gated header set](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/llm/request.ts#L222-L263)

[^packages-opencode-src-session-llm-request-ts-l191-l201]: [`chat.headers` plugin hook](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/llm/request.ts#L191-L201)

[^packages-kilo-vscode-src-services-cli-backend-server-manager-ts-l129-l153]: [extension spawns `kilo serve`](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/kilo-vscode/src/services/cli-backend/server-manager.ts#L129-L153)

[^packages-opencode-src-session-session-ts-l62-l260]: [session table with permission ruleset](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/session.ts#L62-L260)

[^packages-opencode-src-permission-index-ts-l106-l135]: [resolve defaults to ask](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L106-L135)

[^packages-opencode-src-permission-index-ts-l193-l249]: [hard ruleset and config protection](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L193-L249)

[^packages-opencode-src-kilocode-permission-headless-ts-l1-l45]: [headless subagent denial](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/kilocode/permission/headless.ts#L1-L45)

[^packages-opencode-src-tool-task-ts-l118-l288]: [`task` tool depth cap and tool narrowing](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/tool/task.ts#L118-L288)

[^packages-opencode-src-session-compaction-ts-l96-l300]: [turn budget and pruning](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/compaction.ts#L96-L300)

[^packages-opencode-src-mcp-index-ts-l45-l56]: [MCP capabilities restricted to `roots`](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/mcp/index.ts#L45-L56)
