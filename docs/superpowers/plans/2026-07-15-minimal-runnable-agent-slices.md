# Minimal Runnable Tool + Knowledge + Episodic Agent — Slicing Plan

- **Date:** 2026-07-15
- **Status:** Working implementation plan; not yet canonical roadmap
- **Version:** v0.6
- **Confidence:** High on current-state findings; moderate on exact MCP/KB API shapes until the first implementation spike

## Goal

Ship the smallest llame that is materially useful:

1. It can call an arbitrary **read-only remote MCP tool** through the existing durable Run loop.
2. It can search, read, and agent-author a user's canonical **Markdown knowledge vault**.
3. It can deliberately recall prior chats through the already-shipped **episodic search** tool.
4. Tool activity and final output survive refresh because all execution remains a normal queued Run.
5. Optionally, it can launch a child task as an ordinary child Chat/Run without pretending full orchestration exists.

The target is a working vertical loop, not the platform described by the decade-sized SPEC.

## Executive decision

The wrong plan is “build tool calling, KB, episodic memory, and subagents.” Tool calling and a useful episodic baseline already run. Rebuilding those would waste the strongest shipped foundation.

The actual missing path is:

```text
existing durable Run + tool loop
    -> remote MCP tool source
    -> personal Markdown/Git vault tools
    -> one combined compounding-loop eval
    -> optional non-blocking child Chat launcher
```

Remote MCP is the first product gate. Without external tools, llame has no daily-use advantage over a generic chat UI. The existing episodic tool is useful enough not to block that gate; its hardening moves to a parallel or immediately-following slice.

Full permissions, approvals, Knowledge Space abstractions, embeddings, fact extraction, Jujutsu, automatic memory injection, and parent/child Run joins are explicitly excluded.

“No permission controls” does **not** mean removing existing authentication, RLS, or the static operator `tools.allowed` configuration. Those already exist and cost nothing to retain. It also does not make arbitrary remote write tools retry-safe: queued Runs are at-least-once, so the first MCP slice executes read-only tools only. Native KB writes get their own compare-and-swap and Git transaction semantics.

## Current state: what actually ships

| Capability                | Current evidence                                                                                                     | Verdict                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Durable agentic Runs      | `apps/api/src/runs/run-execution.service.ts`, `runs-worker.service.ts`, `run_events`; dedicated worker entrypoint    | Shipped and exercised                     |
| Multi-step tool loop      | `apps/api/src/models/openai-model-client.ts`; AI SDK `streamText` with tools and step cap                            | Shipped                                   |
| Tool execution contract   | `apps/api/src/tools/types.ts`, `registry.ts`, `runner.ts`                                                            | Shipped, static/Zod-only                  |
| Durable tool visibility   | `tool.requested/started/completed`, persisted tool parts, web renderer                                               | Shipped                                   |
| Browser refresh/replay    | `e2e/chat/tool-loop.spec.ts`                                                                                         | Shipped; three focused browser cases pass |
| Episodic recall baseline  | `search_conversations` over contextual FTS + trigram search projection                                               | Shipped and useful                        |
| Mature episodic semantics | Issue [#198](https://github.com/leon0399/llame/issues/198): temporal filters, full provenance, recency, safe framing | Missing; mostly non-blocking              |
| Projects                  | User-owned chat folders through `chats.project_id`                                                                   | Shipped; not KB/tool context              |
| Remote MCP                | No SDK dependency, lifecycle, discovery, or adapter                                                                  | Missing                                   |
| Markdown KB/Home          | No filesystem vault, KB tools, or indexing                                                                           | Missing                                   |
| Child Chats/subagents     | Forks are copies; no lineage/delegation/result routing                                                               | Missing                                   |

### Baseline verification already performed

- API tool/run/search focus: **6 suites, 64 tests passed**.
- Web tool rendering/transport focus: **3 files, 21 tests passed**.
- `pnpm test:e2e -- e2e/chat/tool-loop.spec.ts`: **3 browser tests passed** on a fresh Postgres/API/worker/web stack.
- The browser run emitted existing unrelated locale/hydration/resume warnings; exit status was zero. Do not misreport those warnings as fixed.

## Backlog and documentation drift

The canonical planning surface is currently unreliable:

- `ROADMAP.md` says durable Runs are current work, although dedicated workers already ship.
- `ROADMAP.md` schedules Projects later, although the owner-only Projects foundation already ships.
- `ROADMAP.md` orders Knowledge before MCP; the resolved product direction and this executable path require MCP first.
- `README.md` and `VISION.md` still describe the worker as incomplete.
- `SPEC.md` still contains the superseded DB-authoritative/imported-Markdown premise and prescribes AI SDK v5/LangGraph; the code uses AI SDK v6 and no LangGraph.
- [#194](https://github.com/leon0399/llame/issues/194) still shows shipped #195 as unchecked.
- Open #186 duplicates the already-shipped indexed lexical search; #172 is now decomposed into #196/#197.
- Draft PR [#146](https://github.com/leon0399/llame/pull/146) implements Postgres `memory_facts` plus auto-injection. It conflicts with Markdown-canonical knowledge and must not be used as the implementation base. Its end-to-end remember/recall scenario is reusable as a test pattern only.

Backlog cleanup should follow agreement on this plan; it must not block the first capability slice.

## Non-negotiable invariants

1. **One execution path.** Native tools, MCP tools, KB tools, and later sub-Chat tools all enter the existing `RunExecutionService` tool loop and `runTool` wrapper.
2. **Trusted identity.** `userId`, `chatId`, `runId`, and `toolCallId` come from the Run/runtime, never model arguments.
3. **No new policy platform.** No RBAC, allow/ask/deny UI, approvals, grants, policy snapshots, or per-project connector rules in these slices.
4. **Keep existing isolation.** Session auth, RLS, owner filters, and per-user filesystem roots remain mandatory.
5. **No generic remote writes yet.** A read-only MCP call is replayable. An arbitrary email/send/delete MCP call is not.
6. **Markdown is canonical.** Postgres may later index it; Postgres does not become the KB source of truth.
7. **Git history is part of the first writable KB.** Agent writes land as isolated commits. No hidden DB memory row shadows the file.
8. **Subagents remain Chats/Runs.** No second session architecture and no LangGraph.
9. **Every slice has a user-visible demo.** Infrastructure without a chat-level acceptance path does not count as shipped.

## Release slices

| Slice | Outcome                                  | Demo gate                                                         | Dependency           |
| ----- | ---------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| 0     | Instance-managed remote MCP tools        | Ordinary chat invokes real web search through MCP                 | Existing code        |
| 1     | Prove and lightly harden episodic recall | Chat B recalls a unique detail from Chat A                        | Existing code        |
| 2     | Read-only personal Markdown vault        | Ordinary chat finds and cites an existing note                    | Slice 0 catalog seam |
| 3     | Agent-authored Git-backed knowledge      | Research becomes one visible Markdown commit                      | Slice 2              |
| 4     | Combined compounding-loop eval           | MCP research -> Git note -> new-chat KB recall -> episodic recall | Slices 0–3           |
| 5     | Optional child Chat launcher             | Parent launches an inspectable child Chat/Run and continues       | Slice 4              |

Slices 0–4 are the minimal useful release. Slice 5 is optional and must not delay it.

---

## Slice 0 — Remote MCP as another tool source

### Outcome

An instance operator configures one or more remote Streamable HTTP MCP servers. Their eligible tools appear in the existing durable tool loop. Web search is the required eval, not a hard-coded connector. This is the first product gate.

### SDK decision

Pin the supported production line, `@modelcontextprotocol/sdk@^1.29`, not the v2 beta during this slice.

Use:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
```

Remote Streamable HTTP only. No stdio and no legacy SSE fallback.

### Configuration

**Modify:**

- `apps/api/src/instance-config/llame-config.ts`
- `apps/api/src/instance-config/llame.config.schema.json`
- `apps/api/src/instance-config/config-loader.ts`
- `apps/api/src/instance-config/config-loader.spec.ts`
- `apps/api/llame.config.json.example`

Minimal shape:

```jsonc
{
  "mcp": {
    "servers": [
      {
        "id": "search",
        "url": "{env:MCP_SEARCH_URL}",
        "headers": {
          "Authorization": "Bearer {env:MCP_SEARCH_TOKEN}",
        },
        // Explicit operator assertions. MCP annotations are informational
        // hints and never make a remote tool executable by themselves.
        "readOnlyTools": ["search"],
      },
    ],
  },
  "tools": {
    "allowed": ["search_conversations", "__mcp__search__search"],
  },
}
```

Constraints:

- Server IDs are unique and safe for stable namespaced tool IDs.
- URLs are operator-authored `http:`/`https:` URLs; no user-supplied server URL exists.
- Every header value supports existing config interpolation and is never logged.
- Dynamic names use `__mcp__<serverId>__<serverToolName>` for stable tool-level configuration.
- `readOnlyTools` is the operator's explicit behavioral assertion, not a policy grant. Discovered MCP annotations are logged for mismatch diagnostics only.
- Config loading derives the valid namespaced IDs from the declared server/tool manifest. Static and dynamic typos therefore still fail boot without requiring a live server.
- Discovery verifies that each declared tool really exists. A missing tool or offline server degrades that server's runtime catalog; it does not make config parsing network-dependent or stop ordinary chat.
- Reject names that cannot be represented safely as provider tool IDs; do not silently rename them and break the stable configuration key.

### Tool contract seam

**Modify:**

- `apps/api/src/tools/types.ts`
- `apps/api/src/tools/registry.ts`
- `apps/api/src/tools/runner.ts`
- `apps/api/src/tools/registry.spec.ts`
- `apps/api/src/tools/runner.spec.ts`
- `apps/api/src/runs/run-execution.service.ts`
- `apps/api/src/runs/run-worker.module.ts`

**Add:**

- `apps/api/src/tools/tool-catalog.service.ts`
- `apps/api/src/tools/tools.module.ts`

Required refactor:

1. Replace the static global registry as the Run's source with an injectable `ToolCatalogService` that combines native tools and discovered MCP adapters.
2. Preserve `buildRegistry(candidates)` as the one collision/classification validation point.
3. Split trusted context into Run scope (`userId`, `chatId`, `runId`, tenant DB) and per-call scope (`toolCallId`, composed `AbortSignal`). Enrich it at the AI SDK `execute` callback, where `toolCallId` actually exists.
4. Change `Tool.inputSchema` from Zod-only to AI SDK `FlexibleSchema`.
5. Validate through the normalized AI SDK schema in `runTool`; native Zod tools continue working unchanged.
6. Compile each MCP input schema **once during discovery** with an Ajv 2020-12 instance plus formats, then wrap that validator with AI SDK `jsonSchema(...)`. Reject a malformed/unsupported tool before advertisement; do not add a JSON-Schema-to-Zod converter or defer compilation to first use.
7. Compose Run abort and per-call timeout into the invocation signal. MCP v1.29 receives it through the third `callTool` argument: `client.callTool(params, undefined, { signal, timeout })`.
8. Move `tool.started` emission into `runTool`'s existing `onValidated` seam. A dynamic-schema-invalid call must persist `requested -> completed` with no false `started` event.
9. Preserve the current result cap, structured errors, and refusal semantics.

### MCP lifecycle and adapter

**Add:**

- `apps/api/src/mcp/mcp.module.ts`
- `apps/api/src/mcp/mcp-client-manager.ts`
- `apps/api/src/mcp/mcp-tool-adapter.ts`
- `apps/api/src/mcp/mcp-client-manager.spec.ts`
- `apps/api/src/mcp/mcp-tool-adapter.spec.ts`

Behavior:

1. Connect only in a process whose worker profile consumes `runs`.
2. Create one SDK `Client`/transport per configured server; reuse it across Runs.
3. Follow `nextCursor` until all tool pages are collected, with a defensive page cap. After discovery completes, validate each operator-declared tool and atomically publish the valid subset plus diagnostics; never expose a half-paged catalog.
4. Bound connect and discovery with short timeouts during worker bootstrap. Failure publishes no tools for that server but does not fail the process.
5. Catalog reads always return the last safe snapshot immediately. A disconnected server triggers one background single-flight reconnect after a fixed cooldown; it never adds a 60-second SDK default wait to every ordinary Run.
6. Invalidate that server's snapshot on protocol close before attempting reconnection.
7. `callTool()` maps normal MCP content/structured content into the existing `ToolResult` envelope.
8. MCP `isError` maps to a structured `remote_tool_error`; protocol/transport exceptions map to the existing redacted `execution_failed` path.
9. On Nest shutdown, best-effort terminate the MCP session, then call `client.close()`; do not close only the transport behind the protocol client.
10. Tool-list change notifications, resources, prompts, sampling, elicitation, OAuth flows, and MCP tasks are out of scope.

### Retry-safety cut

Only tools explicitly named by the operator in `readOnlyTools` can enter the executable catalog. MCP's `readOnlyHint`, `destructiveHint`, and `idempotentHint` are untrusted advisory metadata; they may produce warnings but never grant execution or replay safety.

An arbitrary remote MCP server may connect and discover; its unsafe write/send/delete tools remain unavailable until a later Run-checkpoint/idempotency design. This is a queue-correctness restriction, not the deferred policy system.

### Tests and acceptance

**Modify/add:**

- `apps/api/package.json`
- `pnpm-lock.yaml`
- `apps/api/src/chats/run-execution-tools.integration.spec.ts`
- `e2e/fixtures/mcp-search-server.ts`
- `e2e/chat/mcp-search.spec.ts`
- Playwright startup configuration only as required to run the deterministic fixture

Required gates:

`apps/api` adds direct production dependencies on the MCP SDK and `ajv-formats`; do not rely on pnpm exposing the SDK's transitive validator dependency.

1. SDK protocol test with an in-process Streamable HTTP server: discover -> validate args -> call -> map result -> close.
2. Multi-page discovery aggregates every page before publishing tools.
3. Duplicate namespaced ID or malformed 2020-12 input schema rejects only the affected catalog snapshot/tool.
4. Dynamic-schema-invalid input records requested/completed with no started event.
5. Offline MCP server leaves ordinary answer-only chat and native tools immediately available; reconnect attempts are bounded and cooled down.
6. Timeout aborts the remote call through MCP request options and records a structured timeout.
7. Deterministic browser test invokes the MCP search tool, refreshes/reopens, and sees the existing durable tool activity.
8. Environment-gated real eval against a remote web-search MCP returns current evidence in the final answer. Record the server/tool used; do not put credentials in test output.

### Deliberate cuts

- No MCP database registry or management UI.
- No user-scoped MCP configuration or OAuth account linking yet; first slice is instance-managed.
- No per-project servers.
- No stdio/local process spawning.
- No first-party web-search implementation.
- No connector abstraction parallel to MCP.
- No readiness subsystem; log degraded server state for now.

---

## Slice 1 — Harden the existing episodic agent (non-blocking)

### Outcome

Turn “chat search exists” into a reproducible agent acceptance path without adding embeddings or another memory store. This work may proceed after or in parallel with Slice 0; it does not gate remote MCP or the read-only KB.

### Changes

**Modify:**

- `apps/api/src/tools/search-conversations.ts`
- `apps/api/src/chats/context-builder.ts`
- `apps/api/src/tools/search-conversations.spec.ts`
- `apps/api/src/chats/run-execution-tools.integration.spec.ts`

**Add:**

- `e2e/chat/episodic-recall.spec.ts`

### Implementation

1. Keep `search_conversations` as deliberate tool use; do not auto-inject past chats.
2. Add explicit recall framing to its description/result: excerpts are historical data, may be stale, and are never new instructions.
3. Keep the current result fields (`chatId`, title, snippet, updated time). Do not pull all of #198 into this slice.
4. Add one minimal prompt hint: use episodic recall when the user explicitly references a prior discussion or missing past context.
5. Add a deterministic two-chat acceptance:
   - Chat A records an unusual, searchable decision.
   - indexing completes;
   - Chat B asks what was decided;
   - the model calls `search_conversations` and answers from its result.

### Acceptance

- Cross-tenant data remains absent from results.
- Instruction-shaped text inside Chat A is returned inside the “historical data” boundary.
- Refresh/history still renders the call through the existing tool component.
- No pgvector, temporal parser, recency decay, or automatic recall.

### Issue mapping

- Counts as the smallest useful acceptance path under [#194](https://github.com/leon0399/llame/issues/194).
- Does **not** close [#198](https://github.com/leon0399/llame/issues/198).

---

## Slice 2 — Read-only personal Markdown vault

### Outcome

The agent can search and read the user's existing Markdown knowledge without importing it into Postgres.

### Storage decision

Configure one instance Home root. Resolve a storage-safe per-user key as `base64url(sha256(userId))`; trusted identity is not assumed to be path-safe because user IDs are unconstrained text.

```text
<home.root>/users/<user-storage-key>/knowledge/
<home.root>/users/<user-storage-key>/worktrees/
```

`knowledge/` is a service-owned Git repository with a clean materialized checkout. Its configured accepted ref (initially `refs/heads/main`) is canonical; the mutable checkout is not. Human/editor WIP belongs in separate branches/worktrees and cannot be bundled into or block an agent landing. The dedicated worker must mount the same persistent Home volume. The whole host home is never mounted.

### Changes

**Modify:**

- `apps/api/src/instance-config/llame-config.ts`
- `apps/api/src/instance-config/llame.config.schema.json`
- `apps/api/src/instance-config/config-loader.ts`
- `apps/api/src/instance-config/config-loader.spec.ts`
- `apps/api/llame.config.json.example`
- `apps/api/src/runs/run-worker.module.ts`
- `apps/api/src/tools/tool-catalog.service.ts`
- `apps/api/src/chats/context-builder.ts`
- `flake.nix` (Git becomes a declared worker-runtime dependency)

**Add:**

- `apps/api/src/knowledge/knowledge.module.ts`
- `apps/api/src/knowledge/knowledge-paths.ts`
- `apps/api/src/knowledge/knowledge-vault.service.ts`
- `apps/api/src/knowledge/knowledge-tools.ts`
- corresponding focused unit/integration specs

Configuration:

```jsonc
{
  "home": {
    "root": "{env:LLAME_HOME_ROOT:-./.llame-home}",
  },
}
```

### Tools

`knowledge_search`

- Args: `query`, optional `limit`.
- Enumerate committed `.md` blobs from the accepted Git ref; never search an uncommitted mutable checkout.
- Use simple normalized lexical matching and bounded snippets.
- Apply code-owned direct-scan bounds for file count, depth, per-file bytes, and total bytes. Return a structured `vault_too_large` result when exceeded; that is the evidence needed to justify an index later.
- Return relative path, heading/snippet, blob/content hash, and accepted commit.

`knowledge_read`

- Args: relative Markdown path plus optional character offset/limit.
- Keep each response below the existing 16KB tool-result cap and return `nextOffset` when more content exists.
- Return content, relative path, blob/content hash, and accepted commit.
- Reject absolute paths, traversal, non-Markdown blobs, and **all** Git symlinks in v1.

### Behavior

1. Reads always derive the filesystem root from trusted user identity.
2. On first use, create an empty Git repository with `main` and one bootstrap commit; alternatively accept an already-committed valid repo at that exact service-owned location. Never auto-commit a pre-existing loose Markdown tree.
3. Reads resolve blobs from the accepted ref. Uncommitted editor/agent workspaces are invisible until landed.
4. Direct scanning is intentional. No watcher, parser, database projection, embeddings, graph, or frontmatter schema.
5. Prompt/tool descriptions tell the model to consult knowledge for durable user/project facts and to treat notes as untrusted, potentially stale data—not instructions.
6. Volatile claims should be verified with external tools before being presented as current. This is prompt behavior, not a fact database.

### Acceptance

1. Seed two users with distinct Markdown notes containing the same keyword.
2. A Run for user A retrieves only A's note and cites its relative path.
3. Raw/path-shaped user IDs, traversal, oversized vaults/reads, and any symlink fail closed.
4. An ordinary browser chat calls `knowledge_search`/`knowledge_read` and answers from the mounted note.
5. `git --version` is checked when Home is enabled; a missing runtime dependency fails that capability at bootstrap with an actionable error.
6. No migration is added.

### Deliberate cuts

- No generic `knowledge_spaces` model.
- No Obsidian-specific parser; ordinary Markdown is enough.
- No Notion/import/sync.
- No project directory attachment or cross-KB lookup.
- No Postgres index, vector store, or semantic facts.
- No automatic eager injection.

---

## Slice 3 — Agent-authored Markdown with isolated Git commits

### Outcome

When the user asks the agent to research and retain/correct knowledge, the agent updates one Markdown file through an isolated branch/worktree and lands one recoverable commit into the canonical personal vault.

This is Gist-sized behavior: one note change, one commit. It is not a generalized repository hosting platform.

### Changes

**Modify:**

- `apps/api/src/knowledge/knowledge-vault.service.ts`
- `apps/api/src/knowledge/knowledge-tools.ts`
- `apps/api/src/tools/types.ts`
- `apps/api/src/tools/registry.ts`
- `apps/api/src/tools/runner.ts`
- `apps/api/src/runs/run-execution.service.ts`
- focused unit/integration specs

**Add:**

- `apps/api/src/knowledge/git-vault.service.ts`
- `apps/api/src/knowledge/git-vault.service.spec.ts`

### Write contract

`knowledge_write`

```ts
{
  path: string; // relative .md path
  content: string; // complete file for the first slice
  expectedSha256: string | null; // null = create only; hash = update that exact version
}
```

Rules:

1. `null` fails if the target already exists, unless identical content makes the retry a no-op.
2. A hash fails if the current file differs, unless the requested content is already present.
3. The tool is honestly classified `write_low_risk`; do not label it read-only to bypass the old filter.
4. Introduce an explicit retry-safety property separate from safety classification. Tool availability for this milestone becomes `operator allowlisted AND replay-safe`; `knowledge_write` qualifies only because the Git effect protocol below deduplicates by Run. Undeclared/unsafe MCP writes remain excluded.
5. Availability remains the existing operator `tools.allowed` list. No user approval UI is added.
6. Exactly **one KB write effect per Run** is allowed in v1. `runId` is the durable dedupe key; `toolCallId` is provenance only because a full Run retry may generate a different call ID.
7. `runId` and `toolCallId` are recorded as Git commit trailers; the model cannot provide or override them.

#### Deliberate security-scope decision

The archived first-tool design required approval machinery before any write tool. This slice intentionally supersedes that rule for exactly one first-party, user-scoped, Git-recoverable tool because this milestone explicitly defers permission controls. Inclusion of `knowledge_write` in the operator-owned `tools.allowed` list is the instance-level authorization; neither the model nor an MCP server can enable it.

This does **not** prevent a prompt-injected model from proposing a bad note update. The bounded scope, explicit user root, one-effect-per-Run rule, CAS, visible Git commit, and rollback make that failure reversible and auditable; they do not make it impossible. An operator unwilling to accept autonomous KB edits omits the tool. External send/delete/payment tools remain excluded.

### Git transaction

Use the installed Git CLI through `execFile`, never a shell command string.

1. Resolve and lock the user's vault with a Postgres advisory lock so separate worker processes serialize landing.
2. Before accepting new work, enumerate retained effect branches **and registered worktrees** under the same advisory lock. Classify each effect branch by inspecting its tip:
   - a tip whose commit carries the matching `Llame-Run-Id` trailer is a completed effect; reconcile it into accepted `main` or return a visible recovery conflict;
   - a tip without that matching trailer is only a prepared-at-base branch. Because no commit/effect exists, force-remove or unlock/prune its service-owned stale worktree and delete/recreate the branch safely;
   - no later writer may overtake a completed-but-unlanded effect.
     Then look up `refs/heads/llame/effects/<runId>`: if its matching effect commit is already landed, first idempotently synchronize the service-owned materialized checkout to the accepted ref, then reconstruct and return the prior result; never create a second effect commit or return recovered success with a stale checkout.
3. Record accepted `main` HEAD and target content hash.
4. **Before modifying a file**, create the stable effect branch `refs/heads/llame/effects/<runId>` at that HEAD and check it out in a temporary worktree outside the service-owned accepted checkout. The branch itself is the durable prepared-effect record.
5. Write the one file atomically inside the temporary worktree.
6. Commit directly on the effect branch. Git advances that branch ref atomically with commit creation, so a crash observes either the unchanged base ref or the one effect commit—never an unreferenced commit that a retry could unknowingly duplicate.
7. Re-check accepted HEAD and target hash under the lock.
8. Publish only through `git update-ref <accepted-ref> <new-commit> <recorded-old-commit>` after verifying the new commit is a fast-forward. No automatic conflict resolution.
9. Synchronize the service-owned clean materialized checkout after ref publication. This operation is idempotent and part of recovery: a later invocation repairs a crash-mid-sync before reporting success. Human/editor worktrees are separate and irrelevant to landing.
10. Remove the temporary worktree but retain the effect branch as durable `(runId -> commit/result)` dedupe evidence.
11. On crash after commit but before tool-result persistence, the retry resolves the effect branch/accepted ref and returns the original result instead of invoking a second write.

Bootstrap and knowledge commits set service-owned author/committer identity per command/environment (for example, `llame Agent <agent@llame.local>`). They never depend on global Git config or the worker's `HOME`.

`knowledge_write` does not use the current “race and return timeout while work continues” wrapper. Every Git subprocess receives the composed abort signal and its own deadline. On abort/timeout the service reconciles the effect and accepted refs before returning success, conflict, or a known-not-applied error; it must never report a generic timeout while an invisible mutation may still land.

Git is the operational API for this slice. Jujutsu remains compatible with the repository but is not introduced until concurrent multi-file proposal workflows justify it.

### Prompt behavior

Add only the minimum behavior:

- When the user explicitly asks to research, remember, preserve, or correct durable knowledge, use external evidence when needed and write/update the relevant note.
- Read before updating so `expectedSha256` is available.
- Put source URLs and a human-readable “checked/updated” date in ordinary Markdown when the claim is volatile.
- Do not update the KB for every casual conversation.

No enforced frontmatter schema. Git history plus readable Markdown is enough for the first version.

### Acceptance

1. Research tool result -> create Markdown note -> exactly one new commit.
2. New Chat reads the committed note.
3. Correction reads the old hash -> updates -> exactly one later commit.
4. Stale hash fails with no file or ref change.
5. Replaying an identical create/update is a no-op, not a duplicate commit.
6. Retrying the Run with different model-generated path/content still returns/conflicts with its one recorded effect; it cannot create a second commit.
7. Crash after commit/ref publication but before `tool.completed` is reconciled to the original commit on retry.
8. Crash before/during commit leaves the stable effect branch at either the trailer-less base or the single trailer-marked commit; retry cleans/reuses the registered stale worktree and cannot create a second effect.
9. Bootstrap and agent commits succeed with an empty temporary `HOME` and no global Git identity.
10. Concurrent writes serialize; a stale second writer receives conflict.
11. Accepted ref and service-owned checkout agree after successful landing; editor worktrees may remain dirty independently.
12. Crash after accepted-ref publication but during checkout synchronization is repaired on retry before recovered success is returned.
13. Cross-user path access and symlinks fail.

### Deliberate cuts

- No multi-file patch format.
- No automatic LLM review/proposal/merge tiers.
- No Jujutsu or revision service.
- No background watcher committing human edits.
- No shared/org vaults.
- No arbitrary artifact/project writes.
- No second KB write in one Run; use another user turn/Run until semantic multi-file change sessions exist.

---

## Slice 4 — Combined compounding-loop release gate

### Outcome

Prove the product loop rather than isolated subsystems.

### Scenario

1. In Chat A, the user asks: research a current subject and retain the useful result.
2. The agent calls the configured remote MCP web-search tool.
3. It writes a sourced Markdown note through `knowledge_write`; Git lands one commit.
4. Refresh/reopen during the Run; MCP and KB tool activity reconstructs from durable events/history.
5. In new Chat B, the user asks about the subject. The agent searches/reads the KB and cites the note path plus source URLs.
6. In Chat C, the user asks what was discussed in Chat A. The agent uses `search_conversations` and answers from episodic recall.

### Test layers

**Deterministic CI path**

- Local Streamable HTTP MCP fixture.
- Scripted model responses.
- Temporary per-user Git vault.
- Real Postgres/RLS and queued worker.
- Browser assertion over persisted/replayed tool parts and final messages.

**Real-model eval path**

- Environment-gated configured model and real remote search MCP.
- Judge only observable behavior: correct tool dispatch, evidence use, readable note, later retrieval, and no unsupported claims.
- Web search is one eval. The adapter remains generic to any eligible remote MCP tool.

### Release gate

The milestone is complete only when all of these are true:

- A clean checkout can configure and run the full scenario.
- The dedicated worker can run it with the Home volume mounted.
- Git is installed in every supported worker runtime/Nix environment and capability validation proves it before serving KB tools.
- No knowledge rows or embeddings are required.
- No permission-policy branch is required.
- Git log and UI tool history make the agent's actions inspectable.
- A second user cannot retrieve or write the first user's chats or vault.

### Documentation/backlog landing in the same release

- Rewrite `ROADMAP.md` around shipped state and these vertical slices.
- Correct stale current-state text in `README.md` and `VISION.md`.
- Mark #195 complete inside #194.
- Close/supersede stale duplicate #186; clarify #172 vs #196/#197.
- Split #39/#40 into implementation issues matching Slices 0–4.
- Explicitly park #133/#45 policy work and #146 DB memory outside this release.
- Update `CHANGELOG.md` only as each slice actually ships, never in this planning branch.

---

## Slice 5 — Optional non-blocking child Chat launcher

### Strong counterargument

A real orchestrator that waits for child agents is not a small extension. The default Runs worker concurrency is one; a parent that occupies it while awaiting an enqueued child can deadlock. Durable joining also requires suspension/resumption, cancellation propagation, budgets, result routing, and recovery after either side restarts.

Do not put that into the minimal release.

### Honest small slice

Ship only `spawn_subchat`:

1. Child is an ordinary user-owned Chat, marked as a sub-Chat and linked to the parent Chat/Run.
2. The tool creates the child Chat, a delegated message whose **provider role** is `user` but whose durable actor is the parent Run, and a normal queued Run. It never sets human `senderUserId` for delegated input.
3. It returns `childChatId`/`childRunId` immediately; the parent does not wait.
4. The child uses the same model/tool configuration as an ordinary Chat.
5. Because it is a normal Chat, the user can open and inspect it while running, then send a normal follow-up after its Run completes.
6. Child Chats stay visible until the user or orchestrator archives them; no auto-archive.
7. Depth is fixed at one for this slice.

### Likely changes

**Modify:**

- `apps/api/src/db/schema/chats.ts` plus generated Drizzle migration
- `apps/api/src/chats/chats-repository.ts`
- `apps/api/src/chats/chats.service.ts`
- `apps/api/src/chats/context-builder.ts`
- `apps/api/src/tools/tool-catalog.service.ts`
- `apps/api/src/runs/run-dispatch.service.ts` or a small extracted chat/run creation service
- chat DTO/OpenAPI/client types
- sidebar/chat header only enough to identify and navigate lineage

**Add:**

- `apps/api/src/tools/spawn-subchat.ts`
- lineage/RLS/idempotency integration tests
- browser scenario opening the child Chat, observing completion, and sending a later follow-up

### Idempotency

Permit exactly one child Chat per parent Run in this slice, enforced by a DB uniqueness constraint on durable `createdByRunId`. Store actor kind plus `actorRunId` on the delegated message while projecting it as provider role `user` in context assembly. Retrying the parent finds the same child. If its initial enqueue failed and left a terminal failed child Run, create and dispatch a replacement Run in that same child Chat; never return the dead Run or create another child. This cannot rely on provider-generated `toolCallId`, because a full Run retry may produce a different call ID.

### Explicitly not included

- Parent wait/join/synthesis.
- Direct steering of an active child Run; current per-Chat single-flight rejects it. Live steering is a later Run-input protocol.
- Nested children.
- Background/foreground switching.
- Shared vs isolated workspace configuration.
- Agent Profiles or custom persistent memories.
- ACP/A2A/Codex/Claude Code harness sessions.
- Cancellation/budget propagation.

Those become a separate orchestration slice after the launcher proves useful.

---

## Explicitly deferred across all slices

- Policy engine, approvals, allow/ask/deny UI, config snapshots.
- User-wide MCP UI/OAuth/account linking.
- Remote write/send/delete MCP calls.
- stdio MCP and local process supervision.
- MCP resources/prompts/sampling/elicitation/tasks.
- `memory_facts` or auto-extracted semantic memory.
- Automatic episodic/KB injection into every prompt.
- pgvector, #196, and #197.
- Full #198 temporal/recency semantics unless the minimal recall eval proves inadequate.
- Generic Knowledge Spaces, shared/org KBs, project KB routing.
- Notion/Obsidian sync adapters.
- Jujutsu revision workspaces and LLM proposal-review-auto-merge tiers.
- Artifacts, sandboxes, project mounts, and machine connectors.
- Full subagent joins, nesting, external harness agents, ACP, or A2A.

## Recommended implementation order

**Mainline:**

1. **Slice 0:** remote MCP through the existing loop. This is the first product gate and creates immediate utility.
2. **Slice 2:** read existing Markdown using Slice 0's tool-catalog seam before inventing any KB index. Live MCP availability does not gate KB tools.
3. **Slice 3:** add the smallest honest, Git-native agent write.
4. **Slice 4:** refuse to declare victory until the combined scenario runs end to end.
5. **Slice 5:** add only if the core is useful and child task launching has a concrete immediate use.

**Parallel side lane:** Slice 1 locks the already-working episodic baseline with one real scenario. It may run after or alongside the mainline once Slice 0 is underway, but must finish before Slice 4 and cannot delay Slices 0 or 2.

## Verification commands per implementation PR

Run the narrow red/green tests while building, then before each PR:

```bash
pnpm --filter api test
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web lint
pnpm format:check
pnpm build
pnpm test:e2e -- <slice-specific browser spec>
```

For schema changes, also run the repository RLS test path and include a cross-tenant negative case. Do not claim a full gate passed when only focused tests ran.

## Revision history

- **v0.6 (2026-07-15):** Promoted remote MCP to Slice 0 and the first product gate; moved episodic hardening to non-blocking Slice 1 and made the read-only KB depend on Slice 0's tool-catalog seam rather than episodic work or live MCP availability.
- **v0.5 (2026-07-15):** Required idempotent accepted-checkout synchronization before normal or recovered success, closing the crash-after-ref-publication materialization gap.
- **v0.4 (2026-07-15):** Made pre-commit crash recovery executable by classifying prepared vs completed effect branches from the Run trailer and cleaning/reusing stale registered worktrees under the vault lock.
- **v0.3 (2026-07-15):** Closed the pre-effect-ref crash window by committing directly on a stable per-Run effect branch; declared per-command Git identity; made the intentionally policy-free native KB-write risk and operator authorization explicit.
- **v0.2 (2026-07-15):** Repaired review blockers: explicit operator MCP manifests, paginated/bounded discovery, 2020-12 validation, truthful tool events/cancellation, accepted-ref Git semantics, path-safe bounded KB reads, durable one-write-per-Run dedupe/recovery, declared Git runtime dependency, and honest child-Chat provenance/follow-up behavior.
- **v0.1 (2026-07-15):** Initial repository-, backlog-, and SDK-grounded slicing plan.
