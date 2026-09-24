## Context

See proposal.md for motivation. Inspected at master `6fc747af` with `ai@6.0.256`.

- Every production wire client assembles `streamText` options itself and shares `applyToolCallingOptions` for the tool loop (`openai-model-client.ts:88-123`; called from the Responses client, which also serves `openai-codex`, from `openai-completions-model-client.ts:337`, which `opencode-go` delegates to, and from `anthropic-model-client.ts:361`). `ModelStreamInput.onFinish` exposes only `usage` (`model-client.ts:144-148`), which the SDK sets to `finalStep.usage`; the SDK's separate `totalUsage` is not forwarded.
- The SDK holds each provider response's `finish` part, the part that carries its usage, until every tool call of that step has produced a result (`outstandingToolResults`, `ai/dist/index.mjs:6698-6749`). `onStepFinish` therefore fires only after the step's tools finish. `totalUsage` is built with `addTokenCounts`, which turns a missing count into 0 once any step reports one (`:2697`), and is delivered only to `onFinish`, which never runs on the error path.
- `RunExecutionService` builds telemetry in three terminal places: `onFinish` (`run-execution.service.ts:1397-1421`), `onError` with hardcoded `usage: null` (`:1313`), and parent-abort settlement, which passes no telemetry at all (`settleToolsOnParentAbort`, `:1131-1173`, #594). `finishRun` appends `model.completed` only when the caller supplies it (`:2057-2060`), and the stream bridge emits usage metadata only from that event (`run-stream-bridge.ts:274-291`). Pre-model aborts (`settleAbortedRun`, `:625`, `:713`, `:735`, `:1576`) make no model request.
- Compaction receives `lastTurnTotalTokens: telemetry.totalTokens` (`:1558`) and uses it as measured context (`compaction.ts:299`), falling back to an estimate when it is not a positive number.
- Each attempt that reaches prompt preparation writes a `system_prompt_receipts` row before its first model call (`:2713-2744`). The unique index `(owner_user_id, run_id, attempt_id)` serves an owner-and-Run lookup; `findByOwnedRun` already exists (`system-prompt-receipts.repository.ts:14-81`).
- `messages.usage` is untyped JSONB returned as `UnknownRecord` (`chats.dto.ts:568`, `:597`). Persisted tool activity uses `tool-<name>` part types (`tool-observation-part.ts:16-18`). The web parser already tolerates missing numeric fields (`message-usage.tsx:76-132`).

Prior art, all separating per-request receipts from the context signal: OMP and pi record usage per assistant response and sum records for session totals, while compaction reads the last valid response and pi skips errored, aborted and all-zero usage (`earendil-works/pi@d5629e2`, `packages/coding-agent/src/core/compaction/compaction.ts:123-155`). Codex keeps `TokenUsageInfo { total_token_usage, last_token_usage }` (`openai/codex@3d64285`, `codex-rs/protocol/src/protocol.rs:2240-2340`). OpenClaw derives context prompt tokens from the last call and keeps an aggregate for diagnostics (`openclaw/openclaw@0ef73eb`, `src/agents/usage.ts:450-503`). OpenCode sums cost per step but overwrites message tokens per step (`anomalyco/opencode@0f54984`, `packages/opencode/src/session/processor.ts:421-461`); this change avoids that mixed meaning.

## Goals / Non-Goals

**Goals:** one per-request receipt stream feeding every terminal path; one aggregation function; the compaction signal read from the same receipts; no new table, column, index, or event type.

**Non-Goals:** a durable per-request record (#170 decides that storage); exact accounting across reclaimed attempts; changes to compaction usage records.

## Decisions

### M1: Receipts are observed at the provider stream

A shared helper beside `applyToolCallingOptions` wraps `streamOptions.model` with the SDK's `wrapLanguageModel` when the caller supplies a new `ModelStreamInput.onRequestUsage` callback. Its `wrapStream` transform passes every part through unchanged and, on each provider `finish` part, converts the provider usage to `LanguageModelUsage` and calls `onRequestUsage` once per model request. All three wire clients call the helper; the test clients call it too, so harness Runs exercise the same path.

Alternatives:

- `onFinish.totalUsage`: rejected. It is missing on error and abort, and it turns unreported steps into zeros (see Context).
- `onStepFinish`: rejected. The SDK holds the step's finish until its tools complete, so cancelling during a tool call (#594's main case) would lose the usage of the request that asked for the tool, even though the provider has already reported it.
- Reading `steps` from `onAbort` or `onError`: rejected. The error callback carries no steps, and abort steps exclude the held finish.

The SDK does not export its V3-to-`LanguageModelUsage` conversion, so the helper maps the documented V3 fields itself (input total and cache read/write, output total and reasoning). A test drives one multi-request stream through a scripted provider and requires the helper's receipts to equal the SDK's own per-step usage. That test fails on any SDK upgrade that changes the mapping, including #882.

### M2: Aggregation stays in `turn-telemetry.ts`

`buildTurnTelemetry` remains the per-request normalizer and pricer; compaction keeps using it unchanged. A new `aggregateTurnTelemetry(receipts, context)` normalizes and prices each receipt, sums the results, derives `complete` and `reasoningTokens` by the spec's rules, and omits the token and cost fields when no receipt carried an input or output count. `costUsd` is `null` whenever pricing is absent, otherwise the sum of per-request costs. `finishReason` comes from the final request and `latencyMs` from the attempt clock, as today. The persisted assistant shape is `TurnTelemetry` with optional token and cost fields plus `complete`. Compaction usage keeps its current shape and carries no `complete`.

Alternative: pricing the summed buckets once. Rejected because per-request bounding of cache subsets would no longer hold; summed per-request costs keep each request priced as it would be alone.

### M3: One accumulator per attempt, read by every terminal path

The Run's streaming closure owns an ordered receipt array filled by `onRequestUsage`. `onFinish`, `onError`, parent-abort settlement, and both progress-write-failure settlements (`:1150`, `:1167`, `:1929`) build telemetry from it. Parent-abort settlement starts passing telemetry to `settleTerminalRun`, which already forwards it to `finishRun`. Pre-model abort paths stay unchanged because no request was made. Only the `completed` status can produce `complete: true`; every other terminal status yields `false` (spec: completeness). The `ModelStreamInput.onFinish` event also gains the SDK's step count, and a completed attempt with fewer receipts than steps is marked incomplete, so a provider response that ended without a `finish` part is not silently counted as complete.

### M4: Reclaim detection inside the terminal transaction

When `finishRunInTransaction` persists an assistant turn that carries telemetry, it reads the Run's receipts through `findByOwnedRun` within the owner-scoped transaction. If any receipt belongs to a different attempt, it sets `complete: false` before the write. The read uses the existing unique index prefix. Receipts of other Runs or owners are unreachable under RLS and the Run predicate.

### M5: Live usage reuses `model.completed`

Every terminal path that passes telemetry also passes `modelCompleted: { finishReason, telemetry }`, so the event is appended in the same transaction before the terminal event. The order `model.completed` → `run.failed` already exists (`run-execution.service.test.ts:3007-3009`). The bridge is unchanged; the web replaces message metadata rather than summing it, and each attempt emits at most one terminal `model.completed`, so a replay shows the same value.

### M6: The compaction signal is the final receipt

`maybeCompact`'s `lastTurnTotalTokens` is renamed to `lastRequestTokens` through LSP. The completed path passes the final receipt's normalized input plus output, or `undefined` when that receipt lacks counts, which keeps the existing estimate fallback. Compaction still runs only for completed Runs.

### M7: Historical marker migration

A hand-authored custom Drizzle migration follows `apps/api/src/db/AGENTS.md`: a leading SQL comment giving its purpose, why generation cannot emit it, and why a rerun is safe; `NO FORCE ROW LEVEL SECURITY` around the update, then `FORCE` restored, as in `20260914091147_great_iron_patriot.sql`. For assistant rows whose usage is a JSON object without a `complete` key, it sets `complete` to `false` when `parts` contains a `tool-%` part or `usage->>'status'` is distinct from `completed`, and to `true` otherwise. The `WHERE NOT (usage ? 'complete')` guard makes a rerun a no-op; null usage is untouched. The migration test seeds an existing ledger before applying it, per the Drizzle timestamp lesson recorded for this repository.

### M8: Web display

`parseTurnUsage` reads `complete`. Token totals and cost render with `≥` when `complete` is false, and the hover card adds one explanation row. Reasoning moves under Output as `of which reasoning`, with `—` when absent. An absent value renders as unavailable, a `null` cost keeps its current unpriced treatment, and complete usage renders as today.

## Risks / Trade-offs

- [Mapping drift: the helper's V3 conversion diverges from the SDK after an upgrade] → the equality test in M1 fails on upgrade.
- [A provider stream ends a billed request without a `finish` part] → it produces no receipt; the step-count check in M3 marks a completed attempt incomplete, and every other terminal status already is.
- [Reclaimed attempts' spend is lost] → marked incomplete; exact recovery waits for #170's receipts.
- [A reclaimed Run aborted before its first request records no usage although an earlier attempt spent tokens] → accepted; it matches today's pre-model behavior and needs #170.
- [Compaction signal overestimate after a large in-loop tool read] → existing behavior, unchanged and out of scope.
- [Historical error rows keep fabricated zeros] → marked incomplete, so they render as `≥ 0`, never as exact.

## Migration Plan

The API layer ships the migration and the new writer together, so no new row is written without `complete`. Deploy order is the ordinary migrate-then-start. Rollback: older code ignores the `complete` key and the optional-absent fields render as unavailable in the current web. The migration is data-only and not reversed on rollback, because the key changes no existing value. Leo's running instance keeps all chats.

Ownership: the linear stack in tasks.md serializes work; each layer has one owner and no parallel edits to shared files.
