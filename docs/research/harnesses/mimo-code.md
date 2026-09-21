---
type: Reference
title: "MiMo Code"
description: "Frozen prefix snapshots, parent-grant inheritance for subagents, and local dream/distill self-improvement"
resource: "https://github.com/XiaomiMiMo/MiMo-Code"
observed:
  date: "2026-09-21"
  revision: "55ae290c43804ba69c75b61e021f0826967aca21"
sources:
  - id: packages-opencode-src-session-llm-ts-l809-l816
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/opencode/src/session/llm.ts#L809-L816"
    title: "outbound headers"
  - id: packages-opencode-src-session-llm-ts-l582-l583
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/opencode/src/session/llm.ts#L582-L583"
    title: "chat.headers hook is triggered except on ephemeral calls"
  - id: packages-opencode-src-plugin-mimo-ts-l95-l98
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/opencode/src/plugin/mimo.ts#L95-L98"
    title: "the opencode and opencode-go providers stay enabled"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l100-l120
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/handler.ts#L100-L120"
    title: "gateway reads x-opencode-session and keys the sticky provider on it"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l169-l175
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/handler.ts#L169-L175"
    title: "opencode headers stripped before forwarding"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l403-l417
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/handler.ts#L403-L417"
    title: "per-format model gate"
  - id: packages-console-app-src-routes-zen-util-stickyprovidertracker-ts-l3-l16
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/stickyProviderTracker.ts#L3-L16"
    title: "session-keyed sticky provider with a 24 hour TTL"
  - id: packages-console-app-src-routes-zen-go-v1-chat-completions-ts-l1-l10
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/go/v1/chat/completions.ts#L1-L10"
    title: "Go chat completions route"
  - id: packages-console-app-src-routes-zen-go-v1-messages-ts-l1-l10
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/go/v1/messages.ts#L1-L10"
    title: "Go messages route"
  - id: packages-opencode-src-session-session-sql-ts-l15-l79
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/session.sql.ts#L15-L79"
    title: "session and prefix snapshot tables"
  - id: packages-opencode-src-session-prefix-snapshot-ts-l85-l191
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/prefix-snapshot.ts#L85-L191"
    title: "pin, rotate, advance"
  - id: packages-opencode-src-permission-index-ts-l150-l300
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/permission/index.ts#L150-L300"
    title: "permission service"
  - id: packages-opencode-src-mcp-index-ts-l1-l93
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/mcp/index.ts#L1-L93"
    title: "MCP capabilities"
  - id: packages-opencode-src-session-compaction-ts-l272-l420
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/compaction.ts#L272-L420"
    title: "compaction reuses the prefix snapshot"
  - id: packages-opencode-src-agent-prompt-dream-txt-l1-l73
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/agent/prompt/dream.txt#L1-L73"
    title: "dream prompt"
  - id: packages-opencode-src-agent-prompt-distill-txt-l1-l43
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/agent/prompt/distill.txt#L1-L43"
    title: "distill prompt"
---

# MiMo Code

- **Stack:** TypeScript, Bun, Effect, Drizzle/SQLite, Hono, SolidJS TUI; Xiaomi fork of OpenCode; MIT

Listed by OpenCode Go as a problematic client. Confirmed at this revision: the
model call builds its headers with `x-session-affinity` and
`x-parent-session-id` for every non-ephemeral request and a
`mimocode/<version>` User-Agent, never
`x-opencode-session`[^packages-opencode-src-session-llm-ts-l809-l816], while the
vendored Zen handler reads that header, and only that one, when it keys its sticky
provider, dumps request metadata, and attributes usage[^packages-console-app-src-routes-zen-util-handler-ts-l100-l120].
The hook is not the missing piece: `chat.headers` is triggered on the agent
path[^packages-opencode-src-session-llm-ts-l582-l583] and no bundled plugin claims an
`opencode*` provider id, so nothing in this tree derives a session header for those
ids. Its own providers stay on by default, including `opencode-go`, which only loads
once a subscription key exists[^packages-opencode-src-plugin-mimo-ts-l95-l98].
`skipAll`, `autoApproveDelete`, and timeout-deny exist to keep an attended
CLI from hanging; none transfer to a durable multi-user server unchanged.

**Study**

1. **Frozen prefix snapshots.** A `SessionPrefixSnapshotTable` stores the
   system prompt and tool declarations per session, provider, model, and
   agent with hashes[^packages-opencode-src-session-session-sql-ts-l15-l79];
   pin, rotate, and advance move a revision-gated
   watermark[^packages-opencode-src-session-prefix-snapshot-ts-l85-l191], and
   compaction reuses the frozen tool set rather than recomputing
   it[^packages-opencode-src-session-compaction-ts-l272-l420]. High
   confidence as the closest peer analog to llame's immutable per-Run receipt
   of prompt and tools.
2. **Permission service with parent-grant inheritance.** Deny wins; a forced
   ask for `bash_delete` cannot be pre-authorized by wildcard; background
   subagents inherit a parent's approved ruleset without a human round trip;
   unanswered forwarded asks deny after five
   minutes[^packages-opencode-src-permission-index-ts-l150-l300]. Moderate
   confidence for #765 and #778: inheritance bounded by the parent's grants,
   timeout as denial.
3. **Declare only implemented MCP capabilities.** The client declares a
   custom turn-lifecycle notification and empty sampling capabilities to
   avoid server-pushed payloads it cannot
   honor[^packages-opencode-src-mcp-index-ts-l1-l93]. Moderate confidence for
   llame's MCP client advertisement.
4. **Local self-improvement from trajectories.** `dream` consolidates
   durable project memory from the local read-only trajectory
   database[^packages-opencode-src-agent-prompt-dream-txt-l1-l73], and
   `distill` mines it for repeated workflows to package as skills, subagents,
   or commands[^packages-opencode-src-agent-prompt-distill-txt-l1-l43]. Both
   are manual, user-watched subagents. Low confidence for direct reuse; a
   design analog for agent-authored Knowledge and skills, not model training.
5. **The vendored relay shows what the header is for.** The Zen handler reads
   `x-opencode-session` plus the optional request, project, and client
   companions[^packages-console-app-src-routes-zen-util-handler-ts-l100-l120], then
   strips all four before forwarding upstream[^packages-console-app-src-routes-zen-util-handler-ts-l169-l175].
   The session value is not authentication: it keys a sticky upstream provider in
   KV for 24 hours[^packages-console-app-src-routes-zen-util-stickyprovidertracker-ts-l3-l16], which is
   the behavior described in llame's brief as backend pinning, and it is truncated
   to 30 characters for usage attribution. Go is not a separate code path here:
   `zen/go/v1/chat/completions` and `zen/go/v1/messages` are thin wrappers that
   pass `format: "oa-compat"` or `"anthropic"` with the lite model
   list[^packages-console-app-src-routes-zen-go-v1-chat-completions-ts-l1-l10][^packages-console-app-src-routes-zen-go-v1-messages-ts-l1-l10], and the
   handler rejects any model whose catalog entry lacks an entry for the requested
   format[^packages-console-app-src-routes-zen-util-handler-ts-l403-l417] - that is the
   pre-auth format gate. Note what is absent: an empty session id disables the
   sticky tracker and falls back to the client IP rather than failing, so this
   copy does not contain the enforcement that rejects a headerless request.
   Moderate confidence: it establishes the accepted header name and its purpose,
   not the deployed rejection behavior.

**Caution**

- Single project directory is the trust boundary; permission state and the
  database are instance-scoped with no tenant model.
- `skipAll`, `autoApproveDelete`, and timeout-deny exist to keep an attended
  CLI from hanging; none transfer to a durable multi-user server unchanged.
- The session-header gap is a live protocol defect at this revision: the client
  sends the legacy `x-session-affinity`/`X-Session-Id` pair while the relay reads
  `x-opencode-session`. The enforcement that rejects the client is not in this
  repository, so the vendored handler proves the accepted name but cannot show
  which schemes fail in production. Do not assume MiMo exercises Go's prompt-cache
  routing.

[^packages-opencode-src-session-llm-ts-l809-l816]: [outbound headers](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/opencode/src/session/llm.ts#L809-L816)

[^packages-opencode-src-session-llm-ts-l582-l583]: [`chat.headers` hook is triggered except on ephemeral calls](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/opencode/src/session/llm.ts#L582-L583)

[^packages-opencode-src-plugin-mimo-ts-l95-l98]: [the `opencode` and `opencode-go` providers stay enabled](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/opencode/src/plugin/mimo.ts#L95-L98)

[^packages-console-app-src-routes-zen-util-handler-ts-l100-l120]: [gateway reads `x-opencode-session` and keys the sticky provider on it](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/handler.ts#L100-L120)

[^packages-console-app-src-routes-zen-util-handler-ts-l169-l175]: [opencode headers stripped before forwarding](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/handler.ts#L169-L175)

[^packages-console-app-src-routes-zen-util-handler-ts-l403-l417]: [per-format model gate](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/handler.ts#L403-L417)

[^packages-console-app-src-routes-zen-util-stickyprovidertracker-ts-l3-l16]: [session-keyed sticky provider with a 24 hour TTL](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/util/stickyProviderTracker.ts#L3-L16)

[^packages-console-app-src-routes-zen-go-v1-chat-completions-ts-l1-l10]: [Go chat completions route](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/go/v1/chat/completions.ts#L1-L10)

[^packages-console-app-src-routes-zen-go-v1-messages-ts-l1-l10]: [Go messages route](https://github.com/XiaomiMiMo/MiMo-Code/blob/55ae290c43804ba69c75b61e021f0826967aca21/packages/console/app/src/routes/zen/go/v1/messages.ts#L1-L10)

[^packages-opencode-src-session-session-sql-ts-l15-l79]: [session and prefix snapshot tables](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/session.sql.ts#L15-L79)

[^packages-opencode-src-session-prefix-snapshot-ts-l85-l191]: [pin, rotate, advance](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/prefix-snapshot.ts#L85-L191)

[^packages-opencode-src-permission-index-ts-l150-l300]: [permission service](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/permission/index.ts#L150-L300)

[^packages-opencode-src-mcp-index-ts-l1-l93]: [MCP capabilities](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/mcp/index.ts#L1-L93)

[^packages-opencode-src-session-compaction-ts-l272-l420]: [compaction reuses the prefix snapshot](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/compaction.ts#L272-L420)

[^packages-opencode-src-agent-prompt-dream-txt-l1-l73]: [dream prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/agent/prompt/dream.txt#L1-L73)

[^packages-opencode-src-agent-prompt-distill-txt-l1-l43]: [distill prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/agent/prompt/distill.txt#L1-L43)
