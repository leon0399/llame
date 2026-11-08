---
type: Research
title: "oh-my-pi yield and agent messaging"
description: "How oh-my-pi ends a subagent with a validated yield, delivers its result, messages and steers running or parked agents, detects reply deadlocks and revives idle agents, with what that implies for llame child chats, long-lived agent sessions and chat summaries (#1612)."
tags: [subagents, yield, agent-communication, oh-my-pi, summaries]
status: draft
generated: { by: "omp/claude-opus-5-5", at: "2026-11-08" }
---

# R0: oh-my-pi subagent `yield` + agent<->subagent messaging

Source: `~/.cache/checkouts/github.com/can1357/oh-my-pi`, HEAD `88a69582c755bd000e8dc0290981fc787a4f400c` (branch main).
All paths below are under `packages/coding-agent/src/`. Read-only analysis; nothing run.

## 1. The `yield` tool (child's terminal step)

### 1.1 Schema

- `tools/yield.ts:316-` `YieldTool`, name `"yield"`, `approval: "read"`, hidden (not in the user-visible tool list; subagent-only).
- Parameters (`yield.ts:buildYieldParameters`, ~l.287): plain object, `additionalProperties:false`, optional props `type`, `data`, `error`; `required: []`.
  - `data` = the agent's declared output schema (JTD/JSON Schema), dereferenced and sanitised for strict mode, wrapped by `withSectionVariants` so a lone section is also accepted.
  - No output schema -> `data` is a loose object (`looseRecordSchema`, yield.ts:~120).
  - `error: string` = failure reason, "mutually exclusive with data".
  - `type`: omitted = terminal; `string[]` non-empty = incremental/non-terminal section that accumulates; `"result"` string with no `data` = terminal, "use last assistant turn" (`useLastTurn`).
  - `data` xor `error` is enforced at runtime in `execute()`, NOT in schema: a top-level `anyOf/oneOf` makes OpenAI/Codex reject the tool (comment yield.ts:~283).
- Tool result `details` (`YieldDetails`, yield.ts:~52): `{ data?, status: "success"|"aborted", error?, type?, useLastTurn?, complete?, schemaOverridden? }`. Status is derived by the tool: `error` present -> `aborted`, else `success` (yield.ts:~478). So the model never supplies status directly; host-side derivation.
- Workpool variant (`wrapWorkPoolYieldParameters`, yield.ts:~255): `{key, data|error}` per item; last key ends the turn.
- Prompt: `prompts/tools/yield.md` ("`{ data }` for success, `{ error }` for failure. Never both; never a bare payload outside `data`"). With an output schema the terminal `data` MUST be the full object; data-less `type:"result"` only legal after incremental sections.

### 1.2 Validation (inside the tool, retryable errors thrown to the model)

- Unknown root keys rejected (`assertSupportedRootFields`, yield.ts:~268) - "nothing was submitted".
- `data`+`error` together -> conflict error (yield.ts:~432). Strict-mode filler errors (`"none"`, `"n/a"`, `"unused"`...) next to `data` are ignored (`PLACEHOLDER_YIELD_ERRORS`, ~l.176).
- Schema validation: `buildOutputValidator` (`tools/output-schema-validator.ts`). Failure throws "Output does not match schema: ..." with retry hint. `MAX_SCHEMA_RETRIES = 3` (yield.ts:~311): after 3 consecutive failures the tool ACCEPTS the data anyway, sets `schemaOverridden`, and the host later adds `SUBAGENT_WARNING_SCHEMA_OVERRIDDEN` (executor.ts:717). Fail-open safety net.
- JSON-encoded string payloads are losslessly re-parsed if that revalidates (yield.ts:~512).
- Empty submissions: `MAX_EMPTY_RESULT_RETRIES = 3` (yield.ts:~320); 4th returns a `status:"aborted"` result "aborting child instead of retrying forever".
- A data-less last-turn yield with a schema and no sections is rejected (retryable) because prose cannot satisfy the schema (yield.ts:~490). A last turn with no text (thinking only) is rejected (yield.ts:~500). `resolveYieldReportText` (yield.ts:~22) chooses the report text: current assistant text, or previous assistant "stop" turn skipping `<system-reminder>` developer messages.

### 1.3 How yield ends the child

- `subprocessToolRegistry.register("yield", ...)` (yield.ts:~800). `extractData` copies details into `progress.extractedToolData.yield[]`; `shouldTerminate`: true unless `status=success` with non-empty `type[]` (incremental) and not `complete`. So a plain/aborted/last-turn yield terminates the run; incremental sections keep it going.
- The executor monitor (`task/executor.ts` `createSubagentRunMonitor`, ~l.1345-2083) marks `yieldCalled`, records `yieldAcceptedAt`, aborts the turn.
- Quiescence barrier: a yield with owner background jobs still running is a "scheduling pause", not completion; jobs are settled, results fed back as follow-up turns, each delivered result supersedes the earlier yield and a fresh yield is demanded (executor.ts:~2662-2700, `yieldInvalidatedByAsync` ~l.1439). Relevant to llame: parent-suspends-while-children is mirrored here at the child level.
- Forced final: `finalYieldForced` latch (executor.ts:~1303-1306, 1437): on the last reminder the next accepted yield is terminal even if incremental.

### 1.4 Loop guard `MAX_YIELD_TOOL_ERRORS = 6`

- `executor.ts:1251` constant; `executor.ts:2032-2060`: on each `yield` tool_execution_end with `isError` (tool threw) and not already aborting, `consecutiveYieldToolErrors++`, captures the error text; at >=6 `failWithError("Subagent submitted invalid yield results N times; stopping to avoid an infinite submit loop. Last yield error: ...")`. Any successful yield resets to 0 (l.2058). This is separate from, and outer to, the in-tool counters (schema 3, empty 3). Order in practice: 3 schema failures -> override accepted (counter reset) so the 6-guard mostly catches other throws (root-field, conflict, unknown labels).

## 2. What the parent receives

### 2.1 Shape

- Finalisation: `finalizeRunResult` (executor.ts:~2856) -> `finalizeSubprocessOutput` (executor.ts:749). Inputs: monitor raw output, exit code, `yieldItems`, output schema + mode (`permissive|strict`), last assistant text. Outputs `{rawOutput, exitCode, stderr, structuredOutput?}`.
  - `rawOutput` = JSON of yield `data` (or the string) assembled from sections; `structuredOutput = {source, mode, status, error?, data}`.
  - Null yield data -> `SUBAGENT_WARNING_NULL_YIELD`, strict mode -> `schema_violation` outcome with `{error:"schema_violation", message, missingRequired, data(preview)}`, exit 1 (executor.ts:724-747).
  - Yield `error` -> `abortedViaYield`, abort reason = the error string (executor.ts:~2915).
- `SingleResult` (type in pi-tui `tools/task`): id, agent, output, stderr, exitCode, aborted, abortReason, error, requests, tokens, durationMs, outputPath, outputMeta{lineCount,charCount}, structuredOutput, isolated.
- Model-facing envelope `task/result-summary.ts:formatTaskResultSummary` + `prompts/tools/task-summary.md`:

  ```text
  <task-result id= agent= status="completed|cancelled|failed (exit N)|merge failed" duration=>
    [<meta lines size/>] [<abort-reason>... resumable hint ...</abort-reason>] [<error>]
    <output>full</output>  OR  <preview full-output="agent://<id>">head</preview>
    [<merge-summary>]
  </task-result>
  ```

  Status is HOST-derived from `aborted`/`exitCode`/`error`, never model-asserted (result-summary.ts:~55-62).

### 2.2 Size bounds / who summarises

- NO host LLM summarisation of the child transcript anywhere in this path. The "summary" is the child's own `yield` `data` (child-authored). The host only truncates.
- `INLINE_OUTPUT_CHARS = ASYNC_INLINE_RESULT_MAX_CHARS(12_000, session/async-job-delivery.ts:28) - 500` inline whole; above that a `PREVIEW_CHARS = 5000` head (line-boundary if past half) + `agent://<id>` pointer (result-summary.ts:~22-34, 85-92). Async delivery spills >12k to an artifact with `ASYNC_PREVIEW_MAX_CHARS = 4000` preview.
- Hard cap on the stored artifact: `MAX_OUTPUT_BYTES = 500_000`, `MAX_OUTPUT_LINES = 5000` (task/types.ts:29-32, env-overridable), applied with `truncateTail` (executor.ts:~2960).
- Artifacts: `<artifactsDir>/<id>.md` (rawOutput) and `<id>.json` sidecar with structured `data` (executor.ts:~2985-3030); stale sidecar deleted on re-publish. `read agent://<id>` = whole file, `agent://<id>/key/0/x` = JSON-path extraction from sidecar (agent-protocol.ts:~160-290). Agent text escaped with `escapeHarnessTags` so a child cannot forge harness envelopes.
- Aborted/cancelled child with no output: salvage line "[cancelled after N req, M tok - last activity: \"...\"]" (executor.ts:~2960) so the parent does not redo work.

### 2.3 Delivery path

- Background spawn: result is an owner-routed async job ("task", id = child id, ownerId = parent) via `AsyncJobManager` (`async/job-manager.ts`); delivered as `async-result` into the parent transcript, or fetched by `wait`. A rejected job (`AsyncJobError(text, structured)`) is used for aborted/failed results (executor.ts:~3500).

## 3. Child stops without yielding

- Detection: after each turn, `driveSessionToResult` (executor.ts:2459-2700) loops while `!monitor.yieldCalled()`:
  - Reminder ladder `MAX_YIELD_RETRIES = 3` (executor.ts:2448). Each reminder is a synthetic `<system-reminder>` prompt rendered from `prompts/system/subagent-yield-reminder.md`: "Last turn had no tool call -> session idle. Reminder N of 3. Every turn MUST end with a tool call", options 1 resume, 2 incremental, 3 yield success, 4 yield error ("NEVER fabricate a forced-immediate-yield reason").
  - Last (3rd) reminder carries `toolChoice` pinned to `yield` (`buildNamedToolChoice`, executor.ts:2588,2633) and `forceFinalYield`.
  - Skipped when last assistant `stopReason === "error"` (provider failure: re-prompt would hit the same wall, executor.ts:~2607), or when owner async work is pending (settled first, not counted).
  - Prompt dispatch dropped before provider: `MAX_PROMPT_DISPATCH_ATTEMPTS = 4`, `PROMPT_DISPATCH_IDLE_TIMEOUT_MS = 5000`, backoff 250*2^n (executor.ts:2449-2450, 2513-2551).
- After the ladder: `finalizeSubprocessOutput` else-branch (executor.ts:~880-901): no yield -> prepend `SUBAGENT_WARNING_MISSING_YIELD` ("exited without calling yield tool after 3 reminders"); if the agent has an output schema OR produced no text -> exit 1; otherwise last-turn text becomes the result with a warning, exit 0. Empty -> `SUBAGENT_WARNING_EMPTY_MESSAGE`, exit 1.
- Non-structured mode (`structured:false`, no `yield` tool): final assistant message IS the result; only a budget stop prompts one more tool-less wrap-up turn (executor.ts:2459-2465, 2588 `toolChoice "none"`).
- Soft request budget (`softRequestBudget`, `softRequestBudgetFor`): crossing it aborts the in-flight turn and collapses the ladder to ONE forced `yield`/wrap-up with the budget reminder variant ("MUST call yield NOW with best final report ... mark remaining gaps incomplete"). If still no yield: abort reason "Soft request budget exceeded (N requests; budget M) - agent did not yield when force-stopped" (executor.ts:~1618).
- Wall clock: `task.maxRuntimeMs` default 0 = disabled (task/settings.ts:464); timer `requestAbort("timeout")` -> abort reason "Subagent runtime limit exceeded"; wins over a late yield, forcing exit 1 (executor.ts:1586-1616, ~2990). Per-call override `maxRuntimeMs` (executor.ts:500-506). No per-turn idle timeout apart from dispatch-idle above. Also an optional `completionProbe` (task/completion-probe.ts) periodically asks the child for a completion estimate, only for owner-woken turns.

## 4. Messaging surface

### 4.1 Tools / URLs

- `write agent://<id>` (`internal-urls/agent-protocol.ts` `write`, ~l.185): requires IRC enabled (`isIrcEnabled`, irc/messaging.ts:17 - any subagent, or main if it can spawn); no JSON-path suffix; `?progress` flag = quiet non-interrupting progress note (not allowed with `all`); non-empty body. Delegates to `executeSend` (irc/messaging.ts:50).
- `write agent://all` = broadcast; ONLY main agent may (messaging.ts:63-70); targets `registry.listVisibleTo(sender)`; per-target receipts reported.
- Receipt text: `Delivered to X.` / `Queued for X (was parked; revived).` / `Failed: X is not running...` (messaging.ts:108-114). Outcome enum `injected | woken | revived | failed`.
- `read agent://<id>`: finished -> `<id>.md`; running/parked/non-terminal-yield with no output -> status + progress (agent-protocol.ts header + `#resolveProgress`); if the agent is streaming a new turn while an old file exists, it is prefixed with a "superseded" banner (agent-protocol.ts:~245, `isSuperseded`).
- `history://<id>`: read-only concise markdown transcript for live, parked (reads JSONL from disk) and aborted agents; `history://` index lists id/status/kind/last activity; `history://current/full` experimental (history-protocol.ts:1-20, 306-420). Unknown id -> error listing known agents.
- Child -> parent: same `write agent://<parentId>` (peer id; main agent id `MAIN_AGENT_ID`). No special "ask parent" tool; plus the final `yield` and wake relays.
- Prompt doc: `prompts/internal-urls/agent.md`.

### 4.2 IRC bus (`irc/bus.ts`)

- Process-global `IrcBus`; `send()` is fire-and-forget: "never blocks on the recipient generating anything" (bus.ts:1-10, 128-150). Receipt reports delivery mode only.
- `#deliver` (bus.ts:232-300): unknown id -> failed; `kind:"advisor"` refs not messageable; parked/aborted or mid-park/adopted -> `lifecycle.ensureLive(to)` (revive; `revived = prior session differs`); a pending `wait` by the recipient consumes the message directly (never enters context twice); else `session.deliverIrcMessage`. A failed live hand-off is buffered in a mailbox (`MAILBOX_CAP = 100`, oldest dropped); successful delivery never lingers in the mailbox (avoids double delivery).
- Reply accounting: `unansweredSends(from,sinceTs)` tracks direct sends not yet answered; a `progress` note marks the request "promised" so only an explicit message (not a settled job) answers it; `recordReply` counts a settled owner job as the child's reply (bus.ts:100-230).

### 4.3 Reaching a running child: steer vs aside (`session/irc-bridge.ts` `deliver`, l.220-330)

- Streaming recipient AND sender is its direct parent (and not a peer/broadcast) -> `agent.steer({role:"user", steering:true, content: parent-irc.md})`: "[Wait interrupted by message] `<irc from="parent" agent=ID>`msg</irc>" - interrupts at next step boundary; it also aborts an in-flight `wait` via `TOOL_INTERRUPT_ABORT_REASON`.
- Streaming and anyone else (peer, grandchild, broadcast, progress) -> queued as `irc:incoming` custom record in `#interrupts` (non-interrupting "aside" injected at next step boundary; quiet records never cut a `wait` short).
- Idle recipient -> `wakeForIrc([record])` -> a real turn ("woken"). Plan-mode idle agent just appends. Parent steers are tracked by object identity in a WeakSet (`isParentSteer`), not by text, so forged text cannot impersonate.
- Peer vs descendant rule: a descendant's message (a result or question) is in-run for an ancestor; non-parent/non-descendant messages to a subagent are `peerMessage`s that get their own wake turn instead of extending a finished turn (whose text is the result) (irc-bridge.ts:~20-25, 235-250).
- Bodies are agent-authored: `escapeHarnessTags` before embedding in the harness envelope (`prompts/system/irc-incoming.md`); raw body kept in `details.message`.

### 4.4 `wait` semantics (`tools/wait.ts`)

- Blocks on: owned background jobs (children spawned by this agent), owned services, a direct message arriving, or a reply owed. Returns queued messages immediately if any.
- Window ladder `WAIT_LADDER_MS = [5s,10s,30s,60s,300s]`, climbing per back-to-back idle wait; reset after 60s gap; from rung 1 a "stop polling, do other work" notice is appended (wait.ts:~25-60, 380-410). `useless:true` marks idle polls for the generic loop guard.
- After one job settles it keeps collecting 1.5 s so near-simultaneous completions batch (`WAIT_SETTLE_WINDOW_MS`).
- Reply wait (no jobs/services): `pendingReplies` splits asked agents into `from` (can still answer: streaming, queued message, or promised), `blocked` (waiting on caller - `registry.awaits.blocksOn(to, sender)`), `onUser` (waiting on the user, e.g. `ask`), `stopped` (finished the turn without replying). Returns early with an explanation ("cannot reply before you finish: it is waiting on your result" / "finished its turn without replying. Ask again..."). This IS the deadlock check; re-evaluated on awaits change, registry change, and the asked agent's `agent_end`.
- While a wait only watches subagent jobs, `registry.awaits.hold(sender, watchedAgents)` records the caller as blocked on them, so their own reply waits see the cycle (wait.ts:~255).
- A direct message arriving mid-wait ends it; broadcasts/progress do not (they inject as asides after).
- `proc://` relation: in omp `proc://` exists for services (launch/broker; `waitForOwnedServiceCompletion`), and the "No service finished within X. Read proc:// for status" text. Subagent jobs are `AsyncJob`s (id == agent id, `agentId` set) in the same manager, so `wait` treats agent jobs and bash jobs/services uniformly. Agent liveness itself is read via `agent://`/`history://`, not `proc://`.

## 5. Lifecycle: idle -> parked -> revived; multi-turn child

- `registry/agent-lifecycle.ts:1-30`: `AgentLifecycleManager` owns idle -> parked -> revived. Finished subagent is `adopt`ed; TTL timer on idle (`task.agentIdleTtlMs` default 420_000 ms = 7 min, 0 = never park; task/settings.ts:497-507); on expiry the live session is disposed, `AgentRef` + `sessionFile` kept (status `parked`). `ensureLive(id)` revives from JSONL transcript; concurrent calls coalesce; park-in-flight is cancelled or awaited; refs are bound to the exact ref instance to avoid stale async clobbering. Killed (`aborted`) agents revive the same way ("transcript still on disk"), unless no reviver (error: "was killed and cannot be revived... read `history://<id>`", agent-lifecycle.ts:523).
- `isResumable(ref)` (registry/agent-registry.ts:101): `idle`, or `parked|aborted` with a `sessionFile`. Isolated (worktree) runs are not resumable (worktree gone). The `<task-result>` of an aborted-but-resumable child tells the parent: "agent is still live with its full context; message it via `write agent://<id>` to resume instead of redoing the work" (task-summary.md).
- Revival cost model: `task/persisted-revive.ts` rebuilds a session from transcript: needs a `session_init` contract and conversational history (else "no persisted session contract / no message history ... was not revived"), restores tool set, output schema (`init.outputSchema`), model identity (a per-call model not recorded separately -> refuses to revive, l.267), parent liveness (a dead parent's model grants nothing). Prompt-cache continuity: credential pins inherited from the child's own transcript (sdk.ts:2131).
- Continue a finished child = write a message. Two entry points:
  1. Peer/parent IRC wake: `bus.send` -> revive -> `deliverIrcMessage` -> idle -> `wakeForIrc` -> an `IrcWakeTurnObserver` (executor.ts:3280-3560) runs a MONITORED turn: resets the yield tool's per-turn state (`resetYieldTurnState`, yield.ts:~395 - counters/sections must not leak), registers an owner-routed async job (id = child id, ownerId = parent) when the parent woke it or its steer was consumed (`registerWakeJob` ~l.3316), drives to `yield` again with the same ladder, rewrites `<id>.md`/`.json`, and settles the job with the same `<task-result>` envelope (reject for failed/cancelled).
  2. Explicit follow-up turn: `runSubagentFollowUpTurn` (executor.ts:3789) = `ensureLive` + real prompt + `driveFollowUpTurn` -> same `SingleResult` as a first run; "the session's full conversation history is retained". Session is NOT torn down; stays adopted (idle -> park -> revive). Used by the task tool resume path and `omp --restore`.
- Peer-woken turns (not parent) are relayed back: `relayWakeTurnOutput` (executor.ts:3134-3180) sends the turn output to every waker that was not already answered (dedup via `bus.sentSince`) as an IRC message with `replyTo` = original message id and `wakeRelay:true`; failures/cancels always notify; non-answer notices carry `See history://<id> for details.` (`buildWakeRelayBody`, executor.ts:3201-3260). Prevents a `wait` from mistaking a dead peer for a silent one.
- Artifact `<id>.md` is only rewritten by a wake turn when it actually yielded (`hasYield || hasMessageResult`, executor.ts:~2957), so conversational replies do not clobber the accepted result (issue #9518 note).
- Persistence across restarts: sessions are JSONL files; parked refs are rediscovered from disk (`ensurePersistedRoster`, registry/persisted-agents.ts; `persisted-agents` ref `displayName: id`). `omp --restore` (`task/restore.ts:1-60`): every persisted subagent transcript left mid-turn (`hasRestorableTurn`), not killed (tombstone file `agent-tombstone`), revivable and not isolated runs one more monitored turn as a background job of its parent, same job id as the first run so a waiting parent finds it. The parent's in-flight `wait` is NOT durable in a DB sense: it is recomputed from jobs re-registered at restore. Requires async jobs enabled.

## 6. Mapping to llame (#1612 contract)

### 6.1 (a) `yield` as the structured terminal step of a child Run

What transfers:

- Terminal tool call with `{data}` xor `{error}`; host derives status (success/aborted) and the envelope status (completed/cancelled/failed) from exit/abort, never from model text. Maps to a `result` message kind written by the host (not by the model) when the child Run finalises: `{status (host), data|text (child), error?, usage (host), artifact handle}`.
- Retryable in-tool validation with bounded counters, then a hard outer guard (3 schema, 3 empty, 6 total throws). Keep the outer guard; reconsider the fail-OPEN override at 3 schema failures: for llame a non-conforming `result` is safer persisted with `status: "schema_overridden"` flagged in the envelope than silently accepted (omp surfaces it only as a warning string).
- Reminder ladder when a child stops without yielding: 3 nudges, forced `toolChoice: yield` on the last, skip on provider error, skip while own jobs pending, then host-synthesised failure ("exited without yield"). Fits llame's Run loop: nudge = synthetic developer message; forced final = tool_choice pinned.
- Budget stop -> single forced wrap-up yield with "report partial work, mark gaps" - maps to llame cost/step ceilings (F2 ledger) and gives cancel-with-salvage.
- Preview + handle bound: inline ~12k chars whole, else 5k head + handle; hard artifact cap 500 KB / 5000 lines. llame already plans bounded preview + artifact handle (Q5).
- Salvage line for aborted children (last assistant text + counters) so the parent does not redo work.
- Escape agent-authored text before embedding in harness envelopes (`escapeHarnessTags`) - mandatory for `chat://` message bodies and `result` previews (prompt-injection / envelope forgery).
  Risks / differences:
- omp's yield is terminal-for-the-turn, not for the session; the child survives. llame must separate "Run ends" (yield) from "Chat ends" (never; parked).
- Incremental sections (`type:[...]`) add a lot of complexity (section variants, assembly, label closure); not needed for v1 - single terminal result suffices.
- Pooled "workpool" yield and `useLastTurn` data-less yield are omp specifics; `useLastTurn` rescues weak models but breaks schema guarantees: skip, or allow only when no output schema.
- Result idempotency: omp rewrites `<id>.md` on every re-yield and marks old reads "superseded"; llame should instead append a new `result` message with a monotone result index (append-only ledger, Q10) and let "latest result" be a view.
- omp has NO host-side summariser; summary quality = child's discipline. If llame wants a host summary of a child with no/poor yield, it needs a separate cheap model call (new cost, new failure mode, must be ledgered).

### 6.2 (b) Revivable child chats via `write chat://<uuid>`

What transfers directly:

- State machine running / idle / parked / aborted with `isResumable`; message to non-running child = revive + wake turn; receipt vocabulary `injected | woken | revived | failed` returned synchronously to the sender; delivery never blocks on generation. llame persists everything in DB so "park" is just "no live Run"; revival = start a new Run on the same Chat with the message appended (no reviver factory/JSONL replay needed; omp's `persisted-revive` complexity is largely avoidable).
- Parent steer vs peer aside distinction: parent message to a RUNNING child = step-boundary steer (matches #1612 "steer at next step boundary"); non-parent senders (siblings, user in child chat) = aside / own wake turn. Track "from parent" structurally (message author/kind), not by text.
- One owner-routed job/Run handle per wake turn, same id as the first run, settled with the same envelope => parent can `wait` the same handle regardless of whether the child ran its first or its Nth turn. llame equivalent: a child Run per wake with a parent-visible result message.
- Reply tracking: `unansweredSends`/"promised" progress notes and the `wait` early-exit reasons (blocked on caller / waiting on user / finished without replying) are the right deadlock checks. llame needs the same "awaits" graph (A waits on B and B waits on A) before allowing agent<->agent chats; with durable suspension the cycle must be detected at suspend time, not by polling, or it becomes a permanent deadlock that survives restarts.
- Relay of a non-parent-woken turn's output back to the waker, deduped against what the child already sent (`sentSince`), always notifying on failure.
  Risks:
- Conflict with one-live-Run-per-Chat baseline: a message to a running child must queue (steer queue), never start a second Run.
- A message to an idle child with an old accepted result: omp marks the previous result "superseded" while the new turn streams. llame needs the same: `latest result` must carry the status of the Run that produced it.
- Revival of a child whose model/provider/failover target changed (F1 roles): omp refuses revive if per-call model identity was not recorded; llame has persisted `requested selector + resolved model`, so it can re-resolve; must narrate the switch (Q3).
- Permission/grant drift: omp notes a revived child whose parent is dead has no model grants (persisted-revive.ts:~335). llame equivalent: re-check owner-scoped grants at revive, not at spawn.
- Park TTL is irrelevant in DB-backed llame, but context cache TTL is not: reviving after the cache window costs a cold prefix (omp pins credentials to keep cache hits, sdk.ts:2131). Surface this in cost ledger.
- Broadcast: omp restricts it to main only, because a subagent's broadcast wakes every peer for nothing. Copy that rule; fan-out writes cost wake turns.
- Mailbox cap 100 / drop oldest is lossy; llame's ledger should never drop, only bound what is injected.

### 6.3 (c) Reuse for agent<->agent sessions and chat summaries

- Long-lived agent<->agent (Grok Bot / Duet style): omp's IRC is already peer-to-peer addressing by id with revive-on-message, wake relays and reply-ledger; the missing pieces for llame are (1) addressing by chat id (settled), (2) durable awaits graph, (3) loop guards: omp has `wait` loop ladder + `useless` poll counter, but nothing bounds ping-pong between two woken agents beyond provider cost; llame must add a per-pair message/step budget in the cost tree and a "last N exchanges with no tool use" breaker.
- General "yield-like final summary of any chat": omp's yield is the CHILD's self-report in its own context (cheap, high fidelity, but only available if the model is told to do it). For arbitrary chats (including user chats that never yield) llame needs either (i) a host-triggered final turn with tool_choice pinned to a `summarize`/`yield`-style tool on the same chat (reuses cache; this is exactly omp's budget-stop forced wrap-up), or (ii) a separate summariser run over the transcript. Prefer (i) for chats that are still revivable (same ladder, same envelope, result kind `summary`), (ii) only for deleted/forked/over-context chats. Store summaries as ledger messages with `{covers: [firstMsg, lastMsg], produced_by: run}` so they can be re-derived and invalidated when the chat continues (omp's "superseded" lesson).
- Cross-chat reading as episodic recall (F4): omp `history://<id>` renders a CONCISE markdown transcript, read-only, available for live/parked/killed agents, index listing with status. That is the right shape for `read chat://<id>` (transcript view) vs `write chat://<id>` (message). Also its `agent://<id>/<json-path>` sidecar extraction for structured results is a cheap, objective alternative to summarising.
- Security: `history://` lets any agent read any visible agent's transcript. llame must scope by owner/tenant (RLS) and hide child chats from default search (Q11); `escapeHarnessTags` on everything crossing chats.

## 7. Facts that look surprising / easy to miss

- Parent-steer on a streaming child is a USER-role steering message, and it interrupts a child blocked in `wait` (not just at tool boundary).
- Yield with owner jobs pending does not end the run (quiescence barrier) - structured concurrency inside the child.
- No transcript summarisation exists: parents see only the child's own yield data (or last assistant text for message-result agents), truncated by size.
- A wake turn that does not yield never overwrites the accepted artifact (structured agents), but still reports via the job/relay.
- `schemaOverridden` fail-open after 3 schema failures keeps the child from looping at the cost of accepting invalid data.
- `MAX_YIELD_TOOL_ERRORS` (6) counts only thrown (isError) yields, consecutive; success resets.
