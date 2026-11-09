---
type: Research
title: "llame baseline for cost ledger, background jobs and subagents"
description: "The shipped Run lifecycle, queue, suspension, tool execution, usage persistence, Chat relations and permission model that a cost ledger, a background job primitive and subagents must build on (#1612 F2/F3)."
tags: [runs, usage, permissions, baseline, subagents]
status: draft
generated: { by: "omp/claude-opus-5-5", at: "2026-11-07" }
---

# R0 — llame current state for F2 (cost ledger), F3 (background jobs), subagents (#765)

Source: worktree `/home/leon0399/.herdr/worktrees/llame/worktree-green-meadow-21ab`, branch `research/agent-substrate` = master `4cfa9176` (as given in the assignment; I did not run git). Paths are relative to the repo root. Specs are `openspec/specs/<cap>/spec.md`. I read code and specs only; nothing was executed. Anything not read in source is marked [unverified]. I did not fetch issue #1612 itself (not requested in this slice).

## 1. Run lifecycle, jobs, workers, cancellation

### 1.1 `runs` table (`apps/api/src/db/schema/chats.ts:340-460`)

Columns: `id`, `chat_id` (FK chats, cascade), `message_id` (FK messages, set null; composite FK with chat), `user_id` (owner, FK users), `model_id` (opaque catalog id captured at enqueue, NOT NULL, `:355`), `status`, `worker_id` (native executor identity), `cancel_requested_at`, `error` jsonb, `created_at`, `started_at`, `finished_at`, `effort`, `permission_mode` (default/bypass/read-only, CHECK), `active_attempt_id`, `completed_attempt_id`, `turn_tool_availability` jsonb, `follow_up_action` (`continue|regenerate`), `source_run_id` (self-FK, same owner).

- **No `parent_run_id`, no child-chat id, no budget/cost columns.** The only run→run link is `source_run_id` for turn-actions follow-ups (`:431-434`, FK `runs_source_run_id_user_id_fk`).
- Indexes: `runs_chat_created_idx`, `runs_user_status_idx`, `runs_id_user_id_unique_idx`.
- **Single-flight**: partial unique index `runs_chat_inflight_unique` on `chat_id WHERE status NOT IN (completed, failed, cancelled, expired)` (`:441-447`). Spec: `durable-runs` "One in-flight run per chat (single-flight)". A child Run in the same Chat is therefore impossible; a child needs its own Chat.
- RLS: `runs_owner` policy = chat owned by `current_setting('app.current_user_id')` (`:448-453`).

### 1.2 Status enum (`chats.ts:314-329`, `apps/api/src/runs/run-status.ts:1-27`)

Enum: `queued, resolving_config, retrieving_context, planning, waiting_for_approval, running_model, running_tool, running_sandbox, updating_artifact, summarizing, completed, failed, cancelled, expired`. Comment: "DB enum retains reserved future states… runtime emits only the subset in SPEC §9.3" (`chats.ts:311-313`). Terminal = `completed|failed|cancelled|expired` (`run-status.ts:10-15`). Claim moves `queued → running_model` (spec `run-cancellation` "A recorded cancellation settles the Run as cancelled").

- `waiting_for_approval` appears only in the enum, the OpenAPI document, the live protocol and the generated web models (grep outside migrations). **No runtime writer exists.** It is a reserved, unused state.

### 1.3 Attempts

- `active_attempt_id` is assigned by each queue-authorized claim/reclaim; `completed_attempt_id` records the winner (`chats.ts:411-416`). Used for fencing receipts, invocation admission, publication.
- `system_prompt_receipts` (`db/schema/system-prompt-receipts.ts:21-60`): one immutable row per (owner, run, attempt) with `system_prompt`, `prompt_hash`, `source`. Owner-scoped RLS (`owner_user_id = current_setting(...)`).
- Retry restarts the loop from step 1: spec `tool-calling` "No mid-run tool-state checkpointing" (`:1217-1262`): a claimable Run retries "from its first step with new worker context" only if no native attempt/MCP dispatch is recorded; a Run with a recorded `native.attempt` and no result is failed `outcome_unknown`. **There is no durable mid-loop state to resume from.**

### 1.4 Continuation (#1047 = `turn-actions`, shipped)

- `POST /api/v1/chats/:chatId/messages/:userMessageId/runs` with `continue|regenerate` (spec `turn-actions` "An owner starts a follow-up Run on the latest turn"; code `apps/api/src/chats/follow-up-admission.service.ts:80-86`, DTO `chats/dto/follow-up-run.dto.ts`). Continue resumes completed steps of a `failed|cancelled|expired` Run; `run.continued` event holds the kept parts (`runs-repository.ts:579-581`); a Continue Run takes model+effort from the source Run. Only the latest user turn qualifies, and it passes the same single-flight admission.
- It is owner-initiated after a terminal state, not a pause/resume of a live Run. Generic durable continuation is #309 and is explicitly not assumed (`ROADMAP.md:67-70`).

### 1.5 `durable-runs` spec requirements (headings)

Every message executes as a durable, resumable run; One in-flight run per chat; Run claiming and completion are crash-safe (first-writer-wins terminal); A run never stays stuck (no cross-tenant reaper); Enqueue is fail-fast and self-healing; Run failures are classified (infra retries, model failure terminal); Runs execute in parallel across chats; Single-flight holds under concurrency; The worker can run as a dedicated process; Workers drain gracefully; Final assistant-message projection preserves replay order; Received reasoning is durable before browser delivery.

- Liveness mechanisms (`durable-runs:131-178`): optional `runs.timeoutSeconds` → `run.expired`; hard ceiling 23h55m (`run-queues.ts:49-61`, `RUN_EXECUTION_CEILING_SECONDS = 86_100`); model-stream idle watchdog 300 s → `model_stream_idle`, time in tools not counted; pg-boss heartbeat for worker death; dead-letter `runs.dead` consumer settles `run.expired` in the owner's tenant (`runs-worker.service.ts:120-140`).
- **Implication of the above for suspension**: the 23h55m ceiling and `RUNS_JOB_EXPIRE_SECONDS = 86_399` (pg-boss max, `run-queues.ts:44-50`) bound how long a Run may sit in an active job. A durable suspension that releases the job would sit outside these limits [INFERENCE].

### 1.6 pg-boss job model

- `PgBossQueueService` (`apps/api/src/queue/pgboss-queue.service.ts`): `ensureQueue` creates a DLQ (`retryLimit:0`) then the queue with `DEFAULT_QUEUE_OPTIONS = {retryLimit:3, retryDelay:2, retryBackoff:true, deadLetter:true, policy:'standard'}` (`:41-56`); `policy` is immutable after creation (`:128-137`); `heartbeatSeconds` and `expireInSeconds` only when the definition sets them. `consume` uses `batchSize:1`, `localConcurrency = options.concurrency` (`:200-228`). `enqueue` forwards `id, priority, startAfter, retryLimit, retryDelay, retryBackoff, singletonKey` (`:157-183`). Also `jobState(queue,id)`, `schedule` (cron), `cancel(queue,jobId)`.
- Queue channels (`apps/api/asyncapi.queues.yaml`): `runs`, `search-reindex`, `search-embed`, `search-sweep` (cron), `sessions.cleanup` (cron), `machines.probe` (cron). Payload `RunJob = {runId, chatId, userId, modelId, userMessage}` (`asyncapi.queues.yaml:253-275`).
- **runs queue**: job id = Run id (`run-dispatch.service.ts:59-60`, `enqueue(RUNS_QUEUE, job, {id: job.runId})`), standard policy, heartbeat from `runs.heartbeatSeconds`, `expireInSeconds=86_399` (`run-queues.ts:38-50`). No `singletonKey` on runs. `singletonKey = chatId` + policy `stately` only on search reindex/embed (`search/reindex-queues.ts:30-34, 60-64`; dispatchers pass `{ singletonKey: chatId }`).
- **Enqueue is not transactional with the run row** (`run-dispatch.service.ts:29-41`): failure fails the Run via `failRunTransactionally`; orphaned `queued` runs self-heal via `jobState` in admission (`chat-admission.ts:30-92`, spec `durable-runs` "Enqueue is fail-fast and self-healing").
- Spec `job-queue` requirements: Typed durable queues with per-job settlement; Bounded retry and dead-lettering; Native worker liveness; A producer may name a job and read its state by that name; Admission policy and coalescing; Per-consumer concurrency; Selective queue subscription is the routing primitive; Scheduled (cron) and delayed jobs.

### 1.7 Co-located vs dedicated worker

- `RunsWorkerService` header: "Co-located in the API process for v0.2; separate entrypoint #116" (`runs-worker.service.ts:46-50`); `onApplicationBootstrap` consumes `runs` (+ `runs.dead`) only if the worker profile includes group `runs` (`:93-125`).
- `WorkerProfileService` (`instance-config/worker-profile.service.ts:10-69`): env `LLAME_WORKER_PROFILE`, default `all` (every group, concurrency 1); profile from config `workers` map; `concurrencyFor(group)` returns null → registers nothing.
- Dedicated worker: `apps/api/src/worker.ts:1-36` boots `WorkerModule` with no HTTP; same image, second entrypoint. Spec `durable-runs` "The worker can run as a dedicated process".
- Consequence recorded in spec: cross-process cancellation is not yet shipped (#207): "When the Run executes in a different process, a cancellation recorded after the claim is outside this requirement" (`run-cancellation` "A recorded cancellation settles the Run as cancelled").

### 1.8 Cancellation path

- API: `PATCH`-style update with `status: cancelled` → `RunsRepository.requestCancel` (`runs-repository.ts:491-502`, controller `runs.controller.ts:143-147`) sets `cancel_requested_at` for non-terminal runs, idempotent; terminal → 409 (spec `run-cancellation` "The owner requests cancellation of a Run").
- Fast path: `RunAbortRegistry` in-process `Map<runId, AbortController>` (`runs/run-abort-registry.ts:22-48`); comment says it stops finding entries when the worker is in its own process and "mid-flight via LISTEN/NOTIFY later" (`:14-19`).
- Worker: pickup gate reads `cancelRequestedAt` (`runs-worker.service.ts:158-178`), re-checks after registering the controller (`:213-231`), arms a wall-clock `setTimeout` abort (`:247-260`), then `executeRun`. Abort reason classifies to `expired` vs `cancelled` (`run-execution.service.ts:690-700`, `classifyAbortedRun`).
- Chat delete cancels the active Run first (`chats/chats.service.ts:479-483`), then deletes the Chat (cascade).
- Tool settlement on termination: spec `tool-calling` "Termination settles in-flight tool activity"; cooperative cancel signal reaches tools: "Cooperative cancellation reaches tool execution".

## 2. Existing suspension / approval / ask

- **None ships.** SPEC §7.5: "An interactive approval workflow does not ship (#778)" (`SPEC.md:77`). ROADMAP B6 (#778) "the `ask` tool and interactive permission approvals… owns pending requests, owner decisions, cancellation, and safe resumption", blocked by #763 (`ROADMAP.md:39-41`).
- Permission rejection is a non-fatal observation: `permission_denied` tool result with fixed text ending "In-run approval is unavailable" (`apps/api/src/tools/permissions/messages.ts:29-30`; spec `tool-call-permissions` "Safe decision provenance and non-fatal rejection").
- UI-only remnants: `packages/ui/src/components/ai-elements/tool.tsx:89-111` renders `approval-requested` / `approval-responded` tool states (AI Elements default) — no server producer found. `waiting_for_approval` enum value unused (see 1.2).
- A Run that "pauses" today only by being in `running_model`/`running_tool` while a tool awaits; no tool awaits a human. The nearest durable pause primitive is the `native.attempt`/`native.result` event pair (spec `bash-execution` "Unknown command effects are never replayed automatically") which is a fence, not a wait.
- VISION wording for the target: "A Run is one durable agentic turn, including model calls, tool calls, pauses, observations, and final output" (`VISION.md` "Runs are the unit of execution").

## 3. Tool execution, bash, artifacts

### 3.1 Timeouts

- `tools.callTimeoutSeconds` (default 120; `instance-config/llame-config.ts:743-744, 863`; loader `config-loader.ts:303-312`). Per-tool override `Tool.timeoutSeconds` (code-level; must be ≤ global: `tools/turn-tool-catalog.ts:139-150`). Runner: `timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds)*1000`, `AbortSignal.timeout`, composed with the Run abort signal (`tools/runner.ts:117-123`). Spec `tool-calling` "Cooperative cancellation reaches tool execution": a tool ignoring the signal is still bounded by the timeout.
- `tools.maxStepsPerRun` default null = no cap (`llame-config.ts:738-741, 862`).
- bash: managed context `durationMs: 300000`, `maxProcesses: 1`, `inputBound: 8000`, `outputBoundBytes = tools.artifacts.maxBytes` (`tools/bash-limits.ts:20-30`) vs runner call timeout 120 s default. bash.ts passes `context.timeoutSignal`/`timeoutMs` to the executor (`tools/bash.ts:377-380`). Which of the two bounds wins at 120 s vs 300 s is not traced here [unverified].

### 3.2 Bash process manager (`packages/bash-executor/src/execute.ts`)

- A module-global counter `activeProcesses`; `maxProcesses` compared against it (`:64-70, :137`). Slot reservation `reserveManagedProcessSlot` is shared with `ssh://` bash: "a worker runs one managed bash at a time whatever its target" (`:56-71` doc). With `maxProcesses: 1` this is a **per-worker-process** limit across all Runs, not per Run [INFERENCE from the global; spec `bash-execution` "Command results are bounded and explicit" requires "finite … process … bounds"].
- Lifecycle: foreground only; the call blocks until exit/timeout/cancel. Result kinds include `timed_out`, `cancelled`, `unavailable`, `outcome_unknown`. Output captured to a bound, redacted, spilled to an artifact (spec `tool-artifacts` "A bash call spills each stream before it is recorded").
- Process-group proof: result is "known" only after the process group is proven empty; else `outcome_unknown` (spec `bash-execution` "Unknown command effects…"). `native.attempt` event is written before start, `native.result` after (same requirement).
- **No background mode, no job/handle concept.** `grep -i 'background|detach|handle|poll'` over `bash-execution/spec.md` returns no matches. No `run_in_background`-style parameter found.
- Placement: local host (needs `tools.nativeExecutorId`, spec `bash-execution` "Alpha host bash uses the native executor gate"); `ssh://` cwd runs via `tools/ssh-bash.ts`; `machine://` cwd runs on a Machine daemon (`tools/bash.ts:93-110, 211-216, 332-336`). Machine output bound is the protocol constant 32,000 units (`packages/machine-protocol/src/constants.ts:34-36`, `maxProcesses: 1` there too).
- `runs.worker_id` binds the Run to one native executor so physical paths cannot move hosts (`chats.ts:360-363`).

### 3.3 Artifacts (`artifact://`)

- Tables `tool_artifacts` (`chat_id`, `seq`, `tool_name`, `tool_call_id`, `run_id` **without FK**, `complete`) and `tool_artifact_parts` (bytea `content`, `sha256`, `line_count`, `findings` jsonb) (`db/schema/tool-artifacts.ts:26-125`). Locator `artifact://<toolName>-<n>` from `chats.artifact_seq` (spec `tool-artifacts` "An artifact has a locator scoped to its Chat"). RLS: owner via chat join (select + insert policies; no update/delete policy shown).
- Lifetime: until Chat or owner deleted; not replayed or compacted ("An artifact is a Chat resource, not a replayed record"). Atomic write ("An artifact is complete or absent"). Each part ≤ `tools.artifacts.maxBytes`. Host files mirror artifacts when bash can run ("Artifacts are host files when bash can run").
- Forks copy only artifacts named by copied parts (`chats/fork-artifacts.ts`; spec `owner-chat-forks` "A fork copies the artifacts that its copied parts name").
- A tool result is stored via `read("artifact://…")`; artifact existence requires the Run to be able to read it (spec "An artifact needs a way to read it").
- Artifacts are Chat-scoped, so a child Chat's artifacts would not be readable from the parent Chat by locator [INFERENCE from "readable only in its own Chat"].

## 4. Usage persistence

### 4.1 What is stored where

- **`messages.usage` jsonb** (`chats.ts:259`) — the only durable per-turn usage record for chat Runs. Shape `TurnTelemetry` (`apps/api/src/chats/turn-telemetry.ts:13-95`): `inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, totalTokens, reasoningTokens, modelId, contextTokens, effort, permissionMode ('bypass' only), latencyMs, firstTokenMs, chunkCount, generationMs, tokensPerSecond, finishReason, status (completed|aborted|error), costUsd (number|null), billing ('usage'|'subscription'), complete`. Reply starts with a `running` usage `{status:'running', complete:false, runId, attemptId, modelId, effort, permissionMode}` (`run-reply-finalizer.ts:50-60`; spec `run-usage-accounting` "Usage records whether it is complete").
- Spec `run-usage-accounting` requirements: Message usage aggregates every model request of its attempt; Estimated cost prices each request before summing (cost only when model declares `pricingUsdPer1M`; never recomputed); Usage records its billing mode; Usage records whether it is complete; Reasoning tokens known only when every request reported them; Stream performance metrics; Every terminal assistant turn keeps its known usage; Live and reloaded usage agree; Compaction uses the final request's size, not the aggregate; Historical usage is marked, never recomputed; owner-facing display requirements.
- **Compaction receipt**: a published compaction's usage is "a single-request receipt on its checkpoint message row" (`messages` role `checkpoint`); unpublished compaction and title-generation requests are not recorded (spec `run-usage-accounting` "Compaction and title spend stay separate categories").
- **Decision/rerank cost**: `decision.completed` is a **log line** (pino-style payload with `runId, chatId, tool, status, model, cards, requests, judged, inputTokens, outputTokens, costUsd, latencyMs`) built in `decisions/decisions.service.ts:524-546`. Not a table. Usage shape `DecisionUsage {inputTokens|null, outputTokens, costUsd|null}` (`decisions/decision-protocol.ts:75-79`). The ranked tool part additionally keeps `display.rerank` with `latencyMs`, `costUsd`, `runLengths` (`tools/grep-page.ts:46-58`) — stored in the tool part inside `messages.parts`. Spec: "A decision rank call keeps its separate provenance… no assistant message usage includes that decision request."
- Also not recorded: hosted-search sub-requests of web_search engines (same spec requirement).
- Turn telemetry also has a log sink: `TurnTelemetryLogger` (`turn-telemetry.ts:141-143`).
- **There is no usage/cost table, no per-user/instance rollup, no child-run roll-up.** Table list (`db/schema/*`): auth, chat_creation_records, chats/messages/runs/run_events, org/identity tables, knowledge_spaces, machines_status, media_*, memory_settings, personalization, pins, project(`_repositories/_defaults`), repositories/aliases/checkouts/worktree_leases, search_*, system_prompt_receipts, tool_artifacts(+parts).
- Per-event data: `run_events.payload` carries `telemetry` that the stream bridge surfaces as message metadata (`run-stream-bridge.ts:243-247`) — event-log copy of usage until the terminal write.

### 4.2 Loss on deletion

- `messages.chat_id` and `runs.chat_id` are `ON DELETE CASCADE` (`chats.ts:234-236, 346-348`); `run_events.run_id` cascades from runs (`:476-478`); `system_prompt_receipts` cascade via composite FK to runs; artifacts cascade from chats. Deleting a Chat therefore removes `messages.usage`, checkpoint receipts and all run events — all spend history for that Chat. Deleting a user cascades everything (`runs.user_id`, `chats.owner_user_id` FKs cascade).
- Logs (`decision.completed`, turn telemetry) survive only in log storage [unverified retention].

### 4.3 RLS / tenancy pattern

- Tenant boundary = `chats.owner_user_id`; every request-path query runs inside `TenantDbService.runAs(userId, tx)` which sets `app.current_user_id` (e.g. `runs-worker.service.ts:158`). Tables are `.enableRLS()` plus a migration-issued `FORCE ROW LEVEL SECURITY` (comments at `chats.ts:140-146`, `tool-artifacts.ts:20-24`).
- Three owner-scoping idioms: (a) direct `owner_user_id = current_setting(...)` (chats, system_prompt_receipts); (b) `chat_id IN (SELECT id FROM chats WHERE owner_user_id=…)` (messages, runs, artifacts); (c) join through runs→chats (run_events select/insert, artifact parts). Public share: SELECT-only policies gated on `current_setting(...) = ''` (`chats_public_read`, `messages_public_read`, which also excludes checkpoint rows).
- Workers act under the job's `userId` (queue payload comment: "The chat owner; the worker acts under this identity", `asyncapi.queues.yaml:268-271`); no cross-tenant scans (spec `durable-runs` "A run never stays stuck…").
- Tool execution spec: "Tenant-scoped tool execution" — every datastore access inside the owner's tenant tx.

## 5. Chat/Run relations, forks, Projects, events

- **No parent link exists** between Runs (see 1.1) or Chats. `chats` has `project_id` (0–1 project, `ON DELETE SET NULL`, `chats.ts:107-110`) and nothing like `parent_chat_id`/`forked_from`. Grep for `forkedFrom|parentChat|source_chat` found only the artifact-copy helper arguments (`chats/fork-artifacts.ts:47-82`). Forks are provenance-free: spec `owner-chat-forks` "Fork lifetime is independent… no inherited pin or Project membership… copy no Run, event, job, cancellation, worker, or native-effect state".
- `owner-chat-forks` requirements: The owner selects a durable prefix; Copied rows are literal (usage copied verbatim, a copied assistant message "keeps its original Run identifier as a value"); The fork's Chat row carries the source's frozen context; Checkpoint rows are copied; A copied checkpoint absorbs what its source absorbed; A shared or public fork receives no checkpoint row; A fork copies the artifacts that its copied parts name.
- Fork copies `usage` verbatim (`chats.service.ts:582-592`), so spend recorded on source messages is duplicated into the fork's `messages` — an F2 double-count hazard if a ledger sums `messages.usage` across chats [INFERENCE].
- Projects: `projects` table + `chats.project_id`; spec `projects` ("Project repository links are deleted with the project"). Deleting a Project unfiles Chats.
- VISION target: "A subagent uses the same architecture: an inspectable child Chat containing child Runs… Parent Runs may dispatch bounded children, and authorized users may inspect or steer them directly. Nesting, delegation, and budget details stay open" (`VISION.md` "Runs are the unit of execution"). ROADMAP B3 #765: "spawn, inspect, cancel, and collect results with inherited permissions and #91 run limits. Requires B1 and B2's contracts" (`ROADMAP.md:59-61`). B2 #764 sessions and owner forks reuse Chat/Run control.
- Representing a child Chat today would need: a new nullable link (parent run id / parent chat id), tenant consistency with owner (the `chats_id_owner_user_id_unique_idx` and `runs_chat_id_user_id_fk` composite-FK pattern is the existing way to enforce same-owner), and a way for the parent loop to wait. None exists. [INFERENCE]

### 5.1 Event stream (`run_events`)

- Table: `sequence` bigint identity PK (table-global, monotonic, not dense per run), `run_id` cascade FK, `event_type` text, `payload` jsonb, `created_at`; index `(run_id, sequence)` (`chats.ts:472-505`). Append-only; RLS select+insert only (no update/delete policy).
- Vocabulary (`runs/runs-repository.ts:569-599`): `run.created, run.started, model.requested, model.delta, model.completed, run.completed, run.failed, run.cancelled, run.expired, run.continued, reasoning.delta, tool.requested, tool.started, tool.completed, native.attempt, native.result, run.step_cap_reached`. Invariant: each terminal status change appends its `run.<status>` event in the same transaction (`:553-568` doc). Also written by admission (`chat-admission.ts:112`, `run-creation.ts:73`).
- **No event type exists for suspended/waiting/child-spawned.** `RunEventType` is a closed union.
- Delivery: (1) `GET /api/v1/runs/:id/events` — SSE cursor replay; `Last-Event-ID` wins over `after_sequence`; the server **polls the DB** until terminal; `MAX_STREAM_MS` deadline then client reconnects (`runs.controller.ts:159-300`). (2) `GET /api/v1/chats/:id/stream` — AI SDK UI-message stream (SSE) replaying the active Run; 204 when none (`chats.controller.ts:143-165`); `RunStreamBridge` maps events to UI chunks and handles `run.completed|cancelled` vs `run.expired|failed` (`runs/run-stream-bridge.ts:150-165, 430-445`). The first frame is a `start` frame whose `messageId` is the Run id (spec `run-cancellation` "The Run stream identifies its Run at acceptance"). (3) `GET /api/v1/live` WebSocket (`live/live-gateway.service.ts:1-60`): per-owner messages `chat.upserted|deleted, run.updated, run.progress, machine.*, project.*, pins.replaced, resync`, driven by Postgres `LISTEN llame_changes` notifications `{k:'run'|'run_event', owner, chat, run, status|type}` (`live/live-messages.ts:34-60`); "Run progress needs no read: it is folded from run event types alone" (`:9-10`). Max 16 sockets/user.
- Because `live-messages.ts` folds progress from run event types, a new status/event type needs the AsyncAPI live protocol regenerated (`live/generated/live-protocol.ts` carries the status enum) [INFERENCE from generated files].

## 6. Permissions a child would inherit

- `tools.allowed`: exact-id operator allowlist, default empty (spec `tool-calling` "Each execution attempt applies the operator availability gate and per-call permission"); evaluated strictly as a predicate over the source-owned inventory per attempt. Process-wide, not per Run.
- `tools.permissions`: map keyed by exact tool id → allow/reject groups (spec `tool-call-permissions` "Permission groups are matched by exact tool identity at call time"; "Any matching reject vetoes all matching allows"; absent group rejects; omitted `tools.permissions` rejects everything). Execution policy is "frozen per process" at startup ("Execution policy is frozen per process and reevaluated after restart").
- **Per-Run mode**: `runs.permission_mode` ∈ `default|bypass|read-only`, fixed at acceptance, never changes (spec `permission-modes` "The accepted mode is fixed on its Run"; chat send accepts optional `permissionMode`). Effective mode resolved once per attempt (`run-execution.service.ts:706-713`; spec `tool-call-permissions` "A Run's effective permission mode selects whether the policy is evaluated"): `read-only` never downgrades; `bypass` only if the executing process enables it in `tools.permissionModes` (default `['default']`, `llame-config.ts:861`); otherwise `default`.
  - `read-only` = ceiling before policy evaluation (`runner.ts:394-397`, `permissions/admit.ts:76-101`): reads and plain Workspace transitions only.
  - `bypass` = skip `tools.permissions` group evaluation but never `tools.allowed`, tenant/owner authorization, native locator validation, bounds, or the native recovery fence.
- The mode is not model-visible (spec `permission-modes` "The permission mode is not model-visible"); usage records `permissionMode: 'bypass'` only (spec "Usage records a bypassed turn").
- A rejection text already tells the model not to "delegate it to another agent" (`messages.ts:30`) — existing wording that a subagent spec must reconcile.
- No spec text defines inheritance by a child Run; the only ordering rule is "read-only never downgrades" (`run-execution.service.ts:701-705`). Bypass cannot cross owners (spec scenario "Bypass cannot cross owners").
- Prior art in llame's own harness notes (not re-verified here): `docs/research/harnesses/index.md:177-179` lists Kilo Code (fail-closed headless subagent guard), MiMo Code (parent-grant inheritance), Kimi Code (subagent type allowlist with inherited permission mode); `continue.md` records a beta executor that temporarily replaces shared permissions with `* allow`, flagged as conflicting with llame's "bounded inherited authority"; `bb.md:146` advises "durable parent-child provenance instead of treating a provider's internal delegation id as a tenant or resume authority".

## 7. Implications for llame (short)

1. A child needs its own Chat: single-flight (`runs_chat_inflight_unique`) forbids two live Runs in one Chat, and artifacts, `artifact_seq`, `workspace_*` and baselines are Chat-scoped.
2. No parent/child columns exist anywhere (`runs`, `chats`, `source_run_id` is follow-up-only); same-owner enforcement idiom is a composite FK on `(id, owner)`.
3. No suspension primitive: `waiting_for_approval` is enum-only, retry replays from step 1, and 86_399 s job expiry plus the 86_100 s ceiling bound an active job. F3's "park parent Run durably" needs a new non-active state, a new event type, and live-protocol changes.
4. No background-process concept: bash is foreground, `maxProcesses: 1` is a process-global counter shared with ssh, so concurrent background jobs on one worker conflict today.
5. Spend is only in `messages.usage` (+ checkpoint receipts); decision/rerank cost is log-only plus `display.rerank` in tool parts; there is no table, so deletion cascades erase it and forks duplicate it. F2 must add an owner-scoped table that survives Chat deletion (or accept loss) and define fork de-duplication.
6. Cross-process cancel is unshipped (#207): a dedicated worker will not see a mid-flight cancel except by DB flag at pickup — child cancellation fan-out depends on it.
7. Permission inheritance is undefined; the safe monotone rule implied by shipped code is "read-only never downgrades; bypass requires the executing process to enable it; tools.allowed always applies".
