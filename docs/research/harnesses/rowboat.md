---
type: Reference
title: "Rowboat"
description: "Per-person local agent behind a thin shared Space server, agent-authored Markdown memory, ACP peer executors, and classifier-based auto-approval"
resource: "https://github.com/rowboatlabs/rowboat"
observed:
  date: "2026-09-17"
  revision: "649a5f1bd12b53455e4f22a0221a4d51e12f8261"
sources:
  - id: apps-harbor-packages-server-src-mcp-ts-l12-l20
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/mcp.ts#L12-L20"
    title: "agent face over MCP, no privileged path"
  - id: apps-harbor-packages-server-src-mcp-ts-l36-l46
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/mcp.ts#L36-L46"
    title: "MCP calls authenticated to a member"
  - id: apps-x-apps-renderer-src-lib-spaces-rowboat-ts-l22-l46
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/apps/renderer/src/lib/spaces-rowboat.ts#L22-L46"
    title: "maybeInvokeRowboat on the sender's machine"
  - id: apps-x-packages-core-src-spaces-topic-agent-ts-l63-l88
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/spaces/topic-agent.ts#L63-L88"
    title: "thread to session registry"
  - id: apps-x-packages-core-src-spaces-topic-agent-ts-l196-l206
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/spaces/topic-agent.ts#L196-L206"
    title: "mention turn defaults to autoPermission"
  - id: apps-x-packages-core-src-spaces-agent-activity-ts-l168-l186
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/spaces/agent-activity.ts#L168-L186"
    title: "agent_working and agent_idle presence lease"
  - id: apps-x-packages-core-src-knowledge-build-graph-ts-l363-l371
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/knowledge/build_graph.ts#L363-L371"
    title: "note-creation agent instructions"
  - id: apps-x-packages-core-src-knowledge-knowledge-index-ts-l190-l200
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/knowledge/knowledge_index.ts#L190-L200"
    title: "recursive Markdown scan index"
  - id: apps-x-packages-core-src-code-mode-acp-agents-ts-l10-l14
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/code-mode/acp/agents.ts#L10-L14"
    title: "ACP adapter packages per coding agent"
  - id: apps-x-packages-core-src-runtime-turns-runtime-ts-l816-l830
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/runtime/turns/runtime.ts#L816-L830"
    title: "classifyBatch"
  - id: apps-x-packages-core-src-runtime-turns-runtime-ts-l884-l910
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/runtime/turns/runtime.ts#L884-L910"
    title: "classifier allow resolves; deny escalates when a human is available"
  - id: apps-x-packages-core-src-background-tasks-code-sessions-ts-l346-l354
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/background-tasks/code-sessions.ts#L346-L354"
    title: "humanAvailable false on background tasks"
  - id: apps-x-packages-core-src-runtime-assembly-skills-spaces-procedures-ts-l40-l48
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/runtime/assembly/skills/spaces/procedures.ts#L40-L48"
    title: "privacy rule as prompt text"
  - id: apps-x-packages-shared-src-mcp-ts-l3-l16
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/shared/src/mcp.ts#L3-L16"
    title: "MCP server config with plain env map"
  - id: apps-x-packages-core-src-models-gateway-ts-l10-l27
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/models/gateway.ts#L10-L27"
    title: "Rowboat-hosted model gateway"
  - id: apps-harbor-packages-server-src-deployment-ts-l103-l105
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/deployment.ts#L103-L105"
    title: "PgStore per org over one pool"
  - id: apps-harbor-packages-server-src-pg-store-ts-l250-l253
    resource: "https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/pg-store.ts#L250-L253"
    title: "orgId as a constructor field"
---

# Rowboat

- **Stack:** TypeScript; `apps/x` is the per-person Electron app, a headless `rowboat-server` build of the same core, and an Expo mobile client; `apps/harbor` is the shared Spaces server (Hono, Postgres); about 2.6k commits since 2025-01-13; Apache-2.0 (YC S24)

Each teammate runs their own Rowboat with local Markdown knowledge, MCP
config, and model keys. The only shared component is Harbor: a chat, file, and
whiteboard server whose agent face is an MCP endpoint that Rowboat's own agent
uses with "no privileged
path"[^apps-harbor-packages-server-src-mcp-ts-l12-l20]; every call is
authenticated to a member before any tool
runs[^apps-harbor-packages-server-src-mcp-ts-l36-l46]. Runs are never owned by
Harbor. This inverts llame's host-owned Run model and is the closest shipped
analogue to the Personal Realm framing.

**Study**

1. **Thin shared server, fat local agent.** Local keys and knowledge never
   appear in the Spaces protocol schema; Harbor sees only what a local run
   posts through the same member-authenticated MCP tools a human client
   uses. High confidence for #757 as the shape of a synchronization or relay
   surface that must not see model traffic or personal data.
2. **Mention dispatch is sender-local.** `@rowboat` is detected on the
   poster's own machine at send time and routed through an Electron IPC, not
   observed from the live
   feed[^apps-x-apps-renderer-src-lib-spaces-rowboat-ts-l22-l46]. A JSON
   registry maps `(org, space, threadRoot)` to exactly one local session so
   repeated mentions steer one run instead of forking
   it[^apps-x-packages-core-src-spaces-topic-agent-ts-l63-l88]. The only
   cross-machine signal that a run exists is an `agent_working` /
   `agent_idle` presence lease renewed on a
   timer[^apps-x-packages-core-src-spaces-agent-activity-ts-l168-l186]. If
   the addressed machine is off, nothing else picks the mention up. High
   confidence as a contrast case: llame's durable pg-boss Run exists
   precisely so identity outlives one device.
3. **Agent-authored Markdown memory, indexed by scan.** A note-creation
   agent is instructed to "create or update notes in 'knowledge' directory"
   and merge same-entity notes across
   sources[^apps-x-packages-core-src-knowledge-build-graph-ts-l363-l371];
   retrieval is a recursive directory scan with a frontmatter-field regex
   and an in-memory cache, with no embedding or vector store in
   `packages/core`[^apps-x-packages-core-src-knowledge-knowledge-index-ts-l190-l200].
   The write format is the read format. High confidence for #212: a working
   precedent that agent-written plain Markdown plus scan-time indexing is
   enough for personal knowledge; llame adds Git recoverability on top.
4. **Peer coding agents over ACP.** Code Mode drives Claude Code and Codex
   through the published ACP adapter packages
   (`@agentclientprotocol/claude-agent-acp`,
   `@agentclientprotocol/codex-acp`)[^apps-x-packages-core-src-code-mode-acp-agents-ts-l10-l14]
   and stores those sessions in the same session store as chat. Moderate
   confidence for #29: the executor-adapter boundary matches llame's, the
   client code itself is Electron-specific.
5. **Two-tier approval with an explicit unattended fork.** A deterministic
   gate (command allowlists, path grants) runs first; in `auto` mode an LLM
   classifier judges each remaining tool call once per model
   response[^apps-x-packages-core-src-runtime-turns-runtime-ts-l816-l830].
   `allow` resolves with no human; `deny` escalates to a human when
   `humanAvailable`, otherwise it is a hard
   deny[^apps-x-packages-core-src-runtime-turns-runtime-ts-l884-l910].
   Background tasks set `humanAvailable: false` so a turn "must fail fast
   instead of suspending for 90 minutes on an approval card nobody will
   answer"[^apps-x-packages-core-src-background-tasks-code-sessions-ts-l346-l354].
   High confidence for #778 on the suspend-versus-deny fork; see Caution on
   the classifier itself.

**Caution**

- **A model is the approver by default.** Every mention turn runs with
  `autoPermission` unless the composer asked for manual
  prompts[^apps-x-packages-core-src-spaces-topic-agent-ts-l196-l206], so the
  classifier's `allow` executes tools with a human nominally present and
  never consulted. Prompt injection against the classifier is in scope
  before this can count as a permission gate; llame's #763 policy must be
  deterministic first.
- **The private-to-shared boundary is prompt text.** "Never paste emails,
  chats, or DM content into a shared space" lives in a skill
  prompt[^apps-x-packages-core-src-runtime-assembly-skills-spaces-procedures-ts-l40-l48];
  no server-side filter or scope check enforces it.
- **MCP secrets are a plain env map** edited in
  Settings[^apps-x-packages-shared-src-mcp-ts-l3-l16], with no redaction
  path found in the MCP client. llame's declared-env and redaction rules
  are the stronger bar.
- **The hosted model gateway is a first-class path.** `getGatewayProvider`
  is an OpenRouter client pointed at Rowboat's backend, authenticated with
  the user's Rowboat account token and use-case
  headers[^apps-x-packages-core-src-models-gateway-ts-l10-l27]. Knowledge
  context assembled locally transits that backend for anyone who has not
  configured a direct provider, which weakens the README's "own model keys"
  framing.
- **Harbor tenancy is application-level.** One `PgStore` is constructed per
  org over a shared
  pool[^apps-harbor-packages-server-src-deployment-ts-l103-l105] with
  `orgId` as a constructor field consumed by hand-written
  queries[^apps-harbor-packages-server-src-pg-store-ts-l250-l253]; no RLS
  policy was found in the migrations. The opposite of llame's fail-closed
  posture.

[^apps-harbor-packages-server-src-mcp-ts-l12-l20]: [agent face over MCP, no privileged path](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/mcp.ts#L12-L20)

[^apps-harbor-packages-server-src-mcp-ts-l36-l46]: [MCP calls authenticated to a member](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/mcp.ts#L36-L46)

[^apps-x-apps-renderer-src-lib-spaces-rowboat-ts-l22-l46]: [`maybeInvokeRowboat` on the sender's machine](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/apps/renderer/src/lib/spaces-rowboat.ts#L22-L46)

[^apps-x-packages-core-src-spaces-topic-agent-ts-l63-l88]: [thread to session registry](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/spaces/topic-agent.ts#L63-L88)

[^apps-x-packages-core-src-spaces-topic-agent-ts-l196-l206]: [mention turn defaults to `autoPermission`](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/spaces/topic-agent.ts#L196-L206)

[^apps-x-packages-core-src-spaces-agent-activity-ts-l168-l186]: [`agent_working` and `agent_idle` presence lease](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/spaces/agent-activity.ts#L168-L186)

[^apps-x-packages-core-src-knowledge-build-graph-ts-l363-l371]: [note-creation agent instructions](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/knowledge/build_graph.ts#L363-L371)

[^apps-x-packages-core-src-knowledge-knowledge-index-ts-l190-l200]: [recursive Markdown scan index](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/knowledge/knowledge_index.ts#L190-L200)

[^apps-x-packages-core-src-code-mode-acp-agents-ts-l10-l14]: [ACP adapter packages per coding agent](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/code-mode/acp/agents.ts#L10-L14)

[^apps-x-packages-core-src-runtime-turns-runtime-ts-l816-l830]: [`classifyBatch`](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/runtime/turns/runtime.ts#L816-L830)

[^apps-x-packages-core-src-runtime-turns-runtime-ts-l884-l910]: [classifier allow resolves; deny escalates when a human is available](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/runtime/turns/runtime.ts#L884-L910)

[^apps-x-packages-core-src-background-tasks-code-sessions-ts-l346-l354]: [`humanAvailable` false on background tasks](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/background-tasks/code-sessions.ts#L346-L354)

[^apps-x-packages-core-src-runtime-assembly-skills-spaces-procedures-ts-l40-l48]: [privacy rule as prompt text](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/runtime/assembly/skills/spaces/procedures.ts#L40-L48)

[^apps-x-packages-shared-src-mcp-ts-l3-l16]: [MCP server config with plain env map](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/shared/src/mcp.ts#L3-L16)

[^apps-x-packages-core-src-models-gateway-ts-l10-l27]: [Rowboat-hosted model gateway](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/x/packages/core/src/models/gateway.ts#L10-L27)

[^apps-harbor-packages-server-src-deployment-ts-l103-l105]: [`PgStore` per org over one pool](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/deployment.ts#L103-L105)

[^apps-harbor-packages-server-src-pg-store-ts-l250-l253]: [`orgId` as a constructor field](https://github.com/rowboatlabs/rowboat/blob/649a5f1bd12b53455e4f22a0221a4d51e12f8261/apps/harbor/packages/server/src/pg-store.ts#L250-L253)
