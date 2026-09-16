---
type: Reference
title: "Loki Agent"
description: "Rebranded Hermes fork; managed connector gateway degradation and retry contract, per-child input-token ceilings for delegation"
resource: "https://github.com/wundercorp/loki"
observed:
  date: "2026-09-17"
  revision: "a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979"
sources:
  - id: scripts-verify-rebrand-mjs-l5
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/scripts/verify-rebrand.mjs#L5"
    title: "rebrand guard"
  - id: tools-tool-gateway-bridge-py-l1-l66
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/tool_gateway/bridge.py#L1-L66"
    title: "total bridge entry points"
  - id: tools-tool-gateway-client-py-l1-l27
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/tool_gateway/client.py#L1-L27"
    title: "retry and idempotency policy"
  - id: toolsets-py-l38-l40
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/toolsets.py#L38-L40"
    title: "manage_connections core tool"
  - id: agent-conversation-loop-py-l107-l119
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/agent/conversation_loop.py#L107-L119"
    title: "aggregate input budget gate"
  - id: tools-delegate-tool-py-l259-l261
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/delegate_tool.py#L259-L261"
    title: "budget attributes set on every delegated child"
  - id: tools-delegate-tool-config-py-l103-l114
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/delegate_tool_config.py#L103-L114"
    title: "delegation.max_input_tokens knob"
  - id: loki-cli-config-defaults-py-l1237-l1258
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/loki_cli/config_defaults.py#L1237-L1258"
    title: "tightened delegation defaults"
  - id: agent-micro-compaction-py-l199-l216
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/agent/micro_compaction.py#L199-L216"
    title: "cache-aware micro-compaction deferral"
  - id: tools-file-tools-py-l688-l714
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/file_tools.py#L688-L714"
    title: "stale write blocked"
  - id: tools-file-state-py-l34-l56
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/file_state.py#L34-L56"
    title: "cross-process advisory lock under a per-uid tempdir"
  - id: tools-tool-output-limits-py-l12-l37
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/tool_output_limits.py#L12-L37"
    title: "process-global output limit cache"
  - id: agent-agents-md-l23
    resource: "https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/agent/AGENTS.md#L23"
    title: "corrupted docstring"
---

# Loki Agent

- **Stack:** Python core with TypeScript desktop, web, and TUI surfaces; MIT

Loki is a rebranded fork of [Hermes Agent](./hermes-agent.md): 32 commits since
2026-09-11, a rebrand guard[^scripts-verify-rebrand-mjs-l5] that forbids the
strings `Hermes`, `NousResearch`, and `Aurelius` across the tree, and a
`diff -r` against upstream (at the 2026-09-15 revision) that showed 6759
changed files (almost all mechanical renames), 431 Loki-only files, and 873
Hermes-only files. Sessions, SQLite state, turn leases, compaction lineage,
tool-result spill, memory, skills, cron, the gateway, tool search, approval,
`delegate_task`, and the ACP adapter were checked file by file and are Hermes
code under new names. Study those in the Hermes entry and the upstream
repository, not here.

Loki's own work is the desktop app, packaging, and a hosted "managed tool
gateway" that proxies OAuth-linked third-party connector accounts as
`connectors__*` tools beside local and MCP tools, backed by a
`manage_connections` core tool[^toolsets-py-l38-l40] and `connections`
toolset. The three commits since the previous observation (2026-09-16, one
undocumented "glorious refactor" carrying every runtime change) add a
Loki-original hardening batch: per-child delegation input-token ceilings,
tighter delegation defaults, a cache-aware micro-compaction deferral,
fail-closed stale-write blocking, a cross-process file lock, and a versioned
HTTP API alias layer.

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
3. **One budget gate, two attributes, checked per iteration.** Hermes stopped
   a background-review fork when its cumulative `session_input_tokens`
   crossed a ceiling; Loki generalizes that into
   `_aggregate_input_budget_exhausted`, which reads a
   `_aggregate_input_token_budget` attribute any auxiliary agent constructor
   can set[^agent-conversation-loop-py-l107-l119]. `delegate_task` sets it,
   plus a reason string, on every
   child[^tools-delegate-tool-py-l259-l261]; the default is 300k billed input
   tokens, `<= 0` disables[^tools-delegate-tool-config-py-l103-l114]; the
   exit reason surfaces to the parent through the normal turn-exit path as
   `status=failed, exit_reason=input_token_budget`. The same commit cut
   defaults to 80 iterations, 4 concurrent children, and a mandatory 128k
   child compression cap, with wall-clock still
   unbounded[^loki-cli-config-defaults-py-l1237-l1258]; upstream still ships
   10 children and no input ceiling. High confidence for #765 and #91 on the
   shape (a boolean gate between iterations, not per tool call; exit via the
   ordinary reason channel). It bounds one axis only: no output, time, or
   cost ceiling.
4. **Defer compaction while the cache is earning.** A due micro-compaction
   pass is skipped when provider-reported cache read plus write tokens cover
   at least 60% of the prompt and occupancy is under 80% of the compression
   threshold; absent cache telemetry never
   defers[^agent-micro-compaction-py-l199-l216]. Hermes main has no such
   guard and still documents every pass as breaking the prompt cache. Low
   applicability today, because llame's explicit-prefix compaction does not
   rewrite unprotected history; moderate for #153 if a progressive trigger
   ever needs softening against cache economics.

**Caution**

- The rebrand is a naive substitution: `synchronous` became
  `synchrowundercorp` in the agent loop documentation (corrupted
  docstring[^agent-agents-md-l23]) and `synchrowundercorply` in the shipped
  config defaults[^loki-cli-config-defaults-py-l1237-l1258]. Treat comments
  and docs as unreliable and read the upstream file when wording matters.
- "Hermes code under new names" holds per subsystem, not per function.
  Hermes main refuses stale overwrites in `write_file` before any disk
  mutation; that blocker appears nowhere in Loki's history, so Loki's write
  tools ran warn-only until this delta added its own `STALE WRITE BLOCKED`
  refusal (which also covers
  `patch`)[^tools-file-tools-py-l688-l714]. Re-check safety properties per
  file before citing Loki as equivalent to Hermes.
- The new cross-process lock is a `flock` on a tempdir file keyed by path
  hash under `loki-file-state-<uid>`[^tools-file-state-py-l34-l56]: one OS
  user, one implicit tenant, path-scoped rather than identity-scoped. llame's
  mutation fencing coordinates through its own durable state and should stay
  that way.
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

[^scripts-verify-rebrand-mjs-l5]: [rebrand guard](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/scripts/verify-rebrand.mjs#L5)

[^tools-tool-gateway-bridge-py-l1-l66]: [total bridge entry points](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/tool_gateway/bridge.py#L1-L66)

[^tools-tool-gateway-client-py-l1-l27]: [retry and idempotency policy](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/tool_gateway/client.py#L1-L27)

[^toolsets-py-l38-l40]: [`manage_connections` core tool](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/toolsets.py#L38-L40)

[^agent-conversation-loop-py-l107-l119]: [aggregate input budget gate](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/agent/conversation_loop.py#L107-L119)

[^tools-delegate-tool-py-l259-l261]: [budget attributes set on every delegated child](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/delegate_tool.py#L259-L261)

[^tools-delegate-tool-config-py-l103-l114]: [`delegation.max_input_tokens` knob](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/delegate_tool_config.py#L103-L114)

[^loki-cli-config-defaults-py-l1237-l1258]: [tightened delegation defaults](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/loki_cli/config_defaults.py#L1237-L1258)

[^agent-micro-compaction-py-l199-l216]: [cache-aware micro-compaction deferral](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/agent/micro_compaction.py#L199-L216)

[^tools-file-tools-py-l688-l714]: [stale write blocked](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/file_tools.py#L688-L714)

[^tools-file-state-py-l34-l56]: [cross-process advisory lock under a per-uid tempdir](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/file_state.py#L34-L56)

[^tools-tool-output-limits-py-l12-l37]: [process-global output limit cache](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/tools/tool_output_limits.py#L12-L37)

[^agent-agents-md-l23]: [corrupted docstring](https://github.com/wundercorp/loki/blob/a54a41ae9ef9b0174fe1889bcc72e9c4cad6e979/agent/AGENTS.md#L23)
