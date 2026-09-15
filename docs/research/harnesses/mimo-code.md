---
type: Reference
title: "MiMo Code"
description: "Frozen prefix snapshots, parent-grant inheritance for subagents, and local dream/distill self-improvement"
resource: "https://github.com/XiaomiMiMo/MiMo-Code"
observed:
  date: "2026-09-15"
  revision: "b4cc11cd652195af9a80297ed543218f3172e6c4"
sources:
  - id: packages-opencode-src-session-llm-ts-l821-l826
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/llm.ts#L821-L826"
    title: "outbound headers"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l99-l103
    resource: "https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/console/app/src/routes/zen/util/handler.ts#L99-L103"
    title: "gateway reads x-opencode-session"
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

Listed by OpenCode Go as a problematic client. Confirmed at this revision:
outbound requests carry MiMo's own `x-session-affinity` and
`x-parent-session-id` and a `mimocode/<version>` User-Agent, never
`x-opencode-session`[^packages-opencode-src-session-llm-ts-l821-l826], while
the vendored Zen gateway code reads that header on the server
side[^packages-console-app-src-routes-zen-util-handler-ts-l99-l103]. The
`chat.headers` plugin hook exists for other providers and is missing for the
`opencode` ids, which is the whole defect.

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

**Caution**

- Single project directory is the trust boundary; permission state and the
  database are instance-scoped with no tenant model.
- `skipAll`, `autoApproveDelete`, and timeout-deny exist to keep an attended
  CLI from hanging; none transfer to a durable multi-user server unchanged.
- The session-header gap is a live protocol defect at this revision; do not
  assume it exercises Go's prompt-cache routing.

[^packages-opencode-src-session-llm-ts-l821-l826]: [outbound headers](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/llm.ts#L821-L826)

[^packages-console-app-src-routes-zen-util-handler-ts-l99-l103]: [gateway reads `x-opencode-session`](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/console/app/src/routes/zen/util/handler.ts#L99-L103)

[^packages-opencode-src-session-session-sql-ts-l15-l79]: [session and prefix snapshot tables](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/session.sql.ts#L15-L79)

[^packages-opencode-src-session-prefix-snapshot-ts-l85-l191]: [pin, rotate, advance](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/prefix-snapshot.ts#L85-L191)

[^packages-opencode-src-permission-index-ts-l150-l300]: [permission service](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/permission/index.ts#L150-L300)

[^packages-opencode-src-mcp-index-ts-l1-l93]: [MCP capabilities](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/mcp/index.ts#L1-L93)

[^packages-opencode-src-session-compaction-ts-l272-l420]: [compaction reuses the prefix snapshot](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/session/compaction.ts#L272-L420)

[^packages-opencode-src-agent-prompt-dream-txt-l1-l73]: [dream prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/agent/prompt/dream.txt#L1-L73)

[^packages-opencode-src-agent-prompt-distill-txt-l1-l43]: [distill prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/b4cc11cd652195af9a80297ed543218f3172e6c4/packages/opencode/src/agent/prompt/distill.txt#L1-L43)
