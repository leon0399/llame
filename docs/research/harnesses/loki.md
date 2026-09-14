---
type: Reference
title: "Loki Agent"
description: "Rebranded Hermes fork; managed connector gateway degradation and retry contract"
resource: "https://github.com/wundercorp/loki"
observed:
  date: "2026-09-15"
  revision: "447514cbd156c77dc8bca1ca96556644cde69a4c"
sources:
  - id: scripts-verify-rebrand-mjs-l5
    resource: "https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/scripts/verify-rebrand.mjs#L5"
    title: "rebrand guard"
  - id: tools-tool-gateway-bridge-py-l1-l66
    resource: "https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/tools/tool_gateway/bridge.py#L1-L66"
    title: "total bridge entry points"
  - id: tools-tool-gateway-client-py-l1-l27
    resource: "https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/tools/tool_gateway/client.py#L1-L27"
    title: "retry and idempotency policy"
  - id: toolsets-py-l38-l40
    resource: "https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/toolsets.py#L38-L40"
    title: "manage_connections core tool"
  - id: tools-tool-output-limits-py-l12-l37
    resource: "https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/tools/tool_output_limits.py#L12-L37"
    title: "process-global output limit cache"
  - id: agent-agents-md-l23
    resource: "https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/agent/AGENTS.md#L23"
    title: "corrupted docstring"
---

# Loki Agent

- **Stack:** Python core with TypeScript desktop, web, and TUI surfaces; MIT

Loki is a rebranded fork of [Hermes Agent](./hermes-agent.md): 29 commits since
2026-09-11, a rebrand guard[^scripts-verify-rebrand-mjs-l5] that forbids the
strings `Hermes`, `NousResearch`, and `Aurelius` across the tree, and a
`diff -r` against upstream that shows 6759 changed files (almost all mechanical
renames), 431 Loki-only files, and 873 Hermes-only files. Sessions, SQLite
state, turn leases, compaction lineage, tool-result spill, memory, skills,
cron, the gateway, tool search, approval, `delegate_task`, and the ACP adapter
were checked file by file and are Hermes code under new names. Study those in
the Hermes entry and the upstream repository, not here.

Loki's own work is the desktop app, packaging, and one runtime addition: a
hosted "managed tool gateway" that proxies OAuth-linked third-party connector
accounts as `connectors__*` tools beside local and MCP tools, backed by a new
`manage_connections` core tool[^toolsets-py-l38-l40] and `connections` toolset.

**Study**

1. **Total entry points with silent degradation.** Every bridge function
   catches its own exceptions and returns a structured empty value, so a
   signed-out principal, disabled config, or dark gateway leaves local tool
   search behaving exactly as before (total bridge entry
   points[^tools-tool-gateway-bridge-py-l1-l66]). Remote execution runs only
   after core dispatch has applied scope, hook, approval, and middleware policy
   to the composed tool name. Moderate confidence applicability to llame's
   remote MCP failure policy: the pattern is a contract that an optional
   remote source can never break the local catalog.
2. **Bounded retry with a call-frame idempotency key.** At most one retry, on
   transport failure or 5xx only, reusing the same `x-idempotency-key` held in
   the execute call frame so no store needs cleanup; a 409 is treated as a
   client bug and never retried; the state-changing connection-start route is
   never retried automatically (retry and idempotency
   policy[^tools-tool-gateway-client-py-l1-l27]). Auth headers are re-read per
   call because portal tokens expire within the hour. High confidence as a
   shape for any llame remote tool transport that must not duplicate side
   effects.

**Caution**

- The rebrand is a naive substitution: `synchronous` became
  `synchrowundercorp` in the agent loop documentation (corrupted
  docstring[^agent-agents-md-l23]). Treat comments and docs as unreliable and
  read the upstream file when wording matters.
- Loki lags upstream in places. Its tool-output limit cache is a single
  process-global slot[^tools-tool-output-limits-py-l12-l37], while current
  Hermes keys the cache by profile home because one multiplexed gateway
  process serves every profile. A fork this young inherits upstream defects
  and fixes them later, so cite Hermes for current behavior.
- Inherited fail-open paths remain: the approval gate imports fail open, the
  `tirith` scanner fails open by default, the OSV preflight before spawning
  MCP servers fails open on timeout, and `execute_code` runs a persistent
  host Python kernel unless a Docker or remote terminal backend is configured.
  None of this is tenant isolation; one `LOKI_HOME` profile is one implicit
  user.
- The connector gateway is a WunderCorp-hosted service. The remote execution
  leg is opaque to Loki's own approval surface once dispatched, and the
  connector catalog depends on a vendor account. It is prior art for the
  transport contract, not for llame's ownership model.

[^scripts-verify-rebrand-mjs-l5]: [rebrand guard](https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/scripts/verify-rebrand.mjs#L5)

[^tools-tool-gateway-bridge-py-l1-l66]: [total bridge entry points](https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/tools/tool_gateway/bridge.py#L1-L66)

[^tools-tool-gateway-client-py-l1-l27]: [retry and idempotency policy](https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/tools/tool_gateway/client.py#L1-L27)

[^toolsets-py-l38-l40]: [`manage_connections` core tool](https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/toolsets.py#L38-L40)

[^tools-tool-output-limits-py-l12-l37]: [process-global output limit cache](https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/tools/tool_output_limits.py#L12-L37)

[^agent-agents-md-l23]: [corrupted docstring](https://github.com/wundercorp/loki/blob/447514cbd156c77dc8bca1ca96556644cde69a4c/agent/AGENTS.md#L23)
