---
type: Research
title: "Background jobs and subagent lifecycle: prior art"
description: "How oh-my-pi, Claude Code, Codex, OpenClaw, Seal, Pi Durable, Paperclip, Temporal, Inngest and pg-boss run background work and child agents, deliver results, cancel trees, bound concurrency and treat child output, with the parent-Run lifecycle options for llame (#1612 F3)."
tags: [background-jobs, subagents, durable-execution, suspension, cancellation]
status: draft
generated: { by: "omp/claude-opus-5-5", at: "2026-11-07" }
---

# R0 — Background jobs and subagent execution lifecycle (prior art for #1612 F3)

Scope: facts only, with sources. "Implications" at the end is short. Anything not seen in source or docs is marked `[unverified]`.

Pinned sources (read 2026-11-07):

| Source         | Pin                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------- |
| oh-my-pi (OMP) | `can1357/oh-my-pi` @ `88a69582c7`, paths under `packages/coding-agent/src/`                     |
| Codex CLI      | `openai/codex` @ `d92aae5501`, paths under `codex-rs/`                                          |
| OpenClaw       | `openclaw/openclaw` @ `d40aa7c6f2ba70e0c59e244d09a325d25e1457b0`, docs under `docs/`            |
| Claude Code    | live docs at `https://code.claude.com/docs/en/*.md` (no git pin; fetched 2026-11-07)            |
| Seal           | `vercel-labs/seal` @ `7724faa0c71c744a44751dcf15d666a296e8badb`                                 |
| pg-boss        | `apps/api/node_modules/pg-boss` 12.25.0 (llame's pinned dependency, `apps/api/package.json:89`) |
| Harness refs   | `docs/research/harnesses/{earendil-pi,seal,paperclip,orca,bb}.md` in the session worktree       |

---

## 1. oh-my-pi

### 1.1 Job registry and capacity

- One in-memory registry per root session: `AsyncJobManager` holds `#jobs = new Map<string, AsyncJob>()` (`async/job-manager.ts:378`). It is process-local; OMP's own prompt tells the model "Job IDs are process-local; delivered results expire shortly (~30s), unconsumed results within ~5min" (`prompts/tools/task-async-contract.md`). Nothing is persisted for bash/eval jobs.
- Job kinds: `AsyncJobType = "bash" | "task" | "eval"` (`job-manager.ts:49`). One primitive carries shell commands, subagents and eval cells. Row fields: `status` (`running|completed|failed|cancelled`), `abortController`, `ownerId` (registry id of the agent that registered it), `agentId` (subagent it runs), `resultText`/`errorText`/`structured`, `progressText`, `queued`, `foreground` (`job-manager.ts:82-158`).
- Capacity is a hard reject, not a queue: `register()` throws "Background job limit reached (N). Wait for running jobs to finish or cancel one." when running non-queued jobs ≥ cap (`job-manager.ts:469-477`). Setting `async.maxJobs` default 100, runtime clamp `Math.min(100, …)` (`tools/settings.ts:977-982`, `sdk.ts:2481`); constant `DEFAULT_MAX_RUNNING_JOBS = 15` (`job-manager.ts:44`) is the manager's own fallback `[unverified which wins when the option is absent]`. A subagent batch can park jobs as `queued` behind its own semaphore without counting toward the cap (`job-manager.ts:136-141`).
- Auto-backgrounded bash falls back to foreground at the cap rather than failing: "At the running-job cap, fall through to direct foreground execution" (`tools/bash.ts:1380-1388`).

### 1.2 Starting: explicit `async` and auto-background

- `bash` has an `async` flag; with it the call returns a job id immediately (`tools/bash.ts:1345-1368`, `#buildBackgroundStartResult`). Prompt text: "`async` defers finite results but keeps the deadline (default Ns); `timeout: 0` for watchers and long jobs" (`prompts/tools/bash.md:5`).
- Auto-background: a foreground call is registered as a hidden, delivery-suppressed `foreground` job; the tool races its settlement against a threshold (`DEFAULT_AUTO_BACKGROUND_THRESHOLD_MS = 60_000`, `async/auto-background.ts:9`; bounded by `timeout − 1 s`, `:16-21`). `raceJobSettlement` ends on completion, threshold, caller abort, or a _steering_ signal (a queued user/peer message) (`auto-background.ts:24-74`).
  - Completed in time → `releaseForegroundJob`, inline result (`bash.ts:1425-1428`).
  - Aborted → job cancelled (`bash.ts:1433-1437`).
  - Threshold or steer → `backgroundJob()` promotes it; the call returns a handle plus "Backgrounded early to handle an incoming message; the command keeps running" for steer (`bash.ts:1438-1452`).
  - Auto-background is skipped for PTY, ACP client terminal, or when disabled (`bash.ts:1382-1388`). Settings `bash.autoBackground.{enabled,thresholdMs}` (`exec/settings.ts:131,286`); same for `eval` (`eval/settings.ts:72,85`).

### 1.3 Inspect, wait, kill

- `proc://` internal URL: `read proc://` lists jobs/services, `read proc://<id>` inspects status/output "without consuming delivery", `write proc://<id>/kill` cancels (`prompts/tools/task-async-contract.md`; handler `internal-urls/proc-protocol.ts`).
- `wait` tool (`tools/wait.ts`): blocks on the caller's own running jobs/services/replies. Wake sources raced in one `Promise.race`: job settle, bus message, service, reply-gone, ladder timeout, abort (`wait.ts:309`). Ladder windows 5/10/30/60/300 s, reset after 60 s of non-waiting (`wait.ts:31-34`). After the first job settles it keeps collecting for 1.5 s so near-simultaneous completions share one result (`wait.ts:37`, race at `:309-325`). Returns "Nothing to wait for" immediately if nothing owned is running (`wait.ts:213`).
- A `wait` registers `watchJobs(ids)` (`wait.ts:239`), which suppresses automatic delivery of those jobs so the result is returned by the tool instead of also being injected (`job-manager.ts` `watchJobs/unwatchJobs`). Prompt: "Results auto-deliver; NEVER poll … Completely blocked? Call `wait`" (`prompts/tools/task-async-contract.md`, `wait.md`).

### 1.4 Result delivery into the conversation (how and when)

- Owner-routed sink: on session construction the session registers `manager.registerDeliverySink(agentId, …)` and a yield-queue dispatcher of kind `async-result` (`session/agent-session.ts:2714-2723`). A completion for an owned job goes only to its owner's sink. With no live sink it is dead-lettered: dropped with a warning, row keeps the text until retention (`job-manager.ts:178-187`). Unowned completions use `onJobComplete`.
- The sink formats the result (spill > 12 000 chars to an artifact with a 4 000-char inline preview, `session/async-job-delivery.ts:27-34`), checks an epoch (a `/new` bumps `#asyncDeliveryEpoch` so a prior session's result cannot enter the next transcript) and calls `yieldQueue.enqueueWithReceipt("async-result", …)` (`agent-session.ts:3703-3728`). The delivery promise settles only after the queue injects or discards the entry; the job body stays readable through `proc://` meanwhile (`agent-session.ts:3697-3701`).
- Two injection timings, both via `YieldQueue` (`session/yield-queue.ts`):
  1. Run in progress (`isStreaming()`): entries wait; the agent loop's aside provider calls `yieldQueue.drainLazy()` at step boundaries (`agent-session.ts:2564`), so the result is injected into the same run before the next model call. `agent.hasBackgroundCompletions` lets a pending `wait` return early (`agent-session.ts:2545-2551`).
  2. Session idle: `enqueue` schedules an idle flush (`yield-queue.ts:84-93`), `injectIdle` starts a new turn with the batch as a follow-up message (`agent-session.ts:2474-2500`). Exception: after a user interrupt, completions are folded into context _without_ starting a turn (`agent-session.ts:2481-2493`).
- Delivery shape: a `custom` message of `customType: "async-result"`; template wraps results in `<system-notice>` "N background jobs have completed. Resume your work using the results below." with per-job result, `agent://`/`history://` handles, and structured-output status (`prompts/tools/async-result.md`; `async-job-delivery.ts:113-179`). Several completions are batched into one message.
- Delivery retries with backoff 500 ms → 30 s plus jitter (`job-manager.ts:9-11`). Consumed rows are evicted after 30 s; unconsumed after 5 min (`:12-24`).

### 1.5 End of turn / end of session

- A turn ending does not cancel owner jobs. `#finishTurnObservation` calls `settleAsyncWork()`: wait for owner jobs, drain deliveries, wait for the injected follow-up turn(s) to go idle, loop while more work is pending (`agent-session.ts:1888-1913, 3680-3695`). This is how a subagent's run stays open until its own background children finish and it can `yield` (comment cites #11564).
- Lifecycle transitions (`newSession`, `switchSession`, `handoff`, `dispose`) call `#cancelOwnAsyncJobs`: `cancelAll({ownerId})`, evict rows, bump the delivery epoch, clear the `async-result` queue (`agent-session.ts:3538-3567`). It is scoped by `ownerId`, so a subagent's teardown cannot cancel its parent's jobs; a secondary in-process top-level session does not reach the global manager (issue #1923 cited at `:3550`).
- Print mode (`-p`) disposes after the last prompt and cancels running jobs unless `async.printWake` is on; with it the process stays alive and each result "starts another turn in the same session", exiting once nothing is pending (`tools/settings.ts:984-998`, `main.ts:2052`).
- `omp --restore` is the only persistence story: persisted subagent transcripts left mid-turn (no tombstone, has `session_init` contract, not isolated) are re-run for one monitored turn as a background job of the parent, reusing the original subagent id so a parent waiting on it finds it (`task/restore.ts:1-18`). Bash jobs are not restored `[unverified]`.

### 1.6 Subagent `task` tool as a background job

- Mode per item: agent types with `blocking: true` run inline; every other item becomes a background job when `async.enabled` and a manager exist (`task/index.ts:1195-1203, 1052-1053`). Runs can start speculatively while the call's arguments stream, and are adopted or discarded if the mode changed (`task/index.ts:1037-1057, 1204-1212`).
- Concurrency: semaphore sized by `task.maxConcurrency` (default 32; 0 unlimited), re-read before each acquire/release (`task/settings.ts:376-390`, `task/index.ts:813, 1059-1067`). Total job cap is the separate async cap.
- Recursion: `task.maxRecursionDepth` default 2 (`task/settings.ts:445-460`). Enforced structurally: at `childDepth >= max` the `task` tool is filtered out of the child's tool list (`task/executor.ts:4462-4486`). `wait` is auto-added to any agent that has `task` or `bash` (`executor.ts:4494-4505`). Hard wall-clock per subagent `task.maxRuntimeMs` (default 0 = off) (`task/settings.ts:465`).
- Isolation: opt-in `task.isolation.enabled` (default false) with `isolated: true` per task; otherwise the shared checkout (`task/settings.ts:28-35`). Async/auto-background settings are inherited by subagents (`executor.ts:1209`). Subagent jobs are registered on the root's manager through a cross-thread RPC proxy (`thread/services/async-jobs.ts`, `async-jobs-remote.ts`); ownership via `ownerId`.
- Result delivery: same `async-result` path, with the child's id, `agent://<id>` and `history://<id>` handles and structured output (§1.4). Detached spawns retain their artifact directory past completion so the handle still resolves (`task/index.ts:1949-1954`). Prompt: "`completed`: subagent yielded successfully; claimed artifacts unverified" (`task-async-contract.md`).
- Cancellation cascade: `cancelAndReapOwnerJobs(ownerId, deadline)` cancels then waits for an owner's jobs (`job-manager.ts:355`, used at `executor.ts:5292, 5327, 5332`). Manager shutdown aborts with `ASYNC_JOB_MANAGER_SHUTDOWN_REASON`, which the subagent executor maps to "Async job manager shutdown" (`executor.ts:1578, 1603`).
- Per-call model: `task.perCallModel` (`off|eval|on`, default off), the operator's own settings layer must enable it (project layers can only turn it off); `task.perCallModelAllow` is an exact-selector allowlist (`task/settings.ts:309-372`).

### 1.7 eval `agent()` / `workpool()`

- `agent()` inside an eval cell runs a structured subagent through the same executor (`eval/agent-bridge.ts:1-30`, `task/structured-subagent.ts`). `workpool()` keeps a pool of keep-alive subagents with queued items and per-agent states `running|idle|dead`, bounded by `task.maxConcurrency` (`task/workpool.ts`). Pools and handles are released with the owner (`agent-session.ts:3554-3558`: `releaseCompletionHandles`, `releaseJudgmentBatches`, `WorkPoolRegistry.global().releaseOwner`). The eval tool is itself an async-job kind with auto-background (`tools/eval.ts:641-742`).

---

## 2. Claude Code (docs; no source)

- Background bash: `run_in_background: true` returns a task id; output streams to a file the model reads with `Read`. `TaskOutput` was removed in v2.1.277; `TaskStop` stops a task (`tools-reference.md`, tool table and "Background commands"). Ctrl+B moves a running foreground command to the background (`interactive-mode.md#how-backgrounding-works`).
- Auto-background: a foreground command reaching its timeout (default 2 min, max 10 min) is moved to the background instead of killed, unless it starts with `sleep` (`tools-reference.md#foreground-commands-that-move-to-the-background`). Result text states the move and the output file path.
- Limits: interactive local sessions have no background time limit; unattended sessions (`-p`, SDK, CI, cloud) cap at 30 min default, 2 h max (10 min for `-p` with text prompt); output past 5 GB kills the task (`tools-reference.md#time-limit-for-background-commands`, `interactive-mode.md`).
- Lifecycle at end: a command started by a _foreground subagent_ stops when that subagent run ends; a command started by the main conversation or a _background_ subagent survives the final response until exit/stop/limit (`tools-reference.md#when-a-background-command-stops`). Tasks are cleaned up when Claude Code exits; backgrounding the whole session (agent view) keeps them running (`interactive-mode.md`). `-p` stays open after the result to wait for background work, 10 min idle ceiling (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`), then takes one more turn with the outcome (`headless.md#background-tasks-at-exit`). `--max-budget-usd` reached → remaining background work is stopped, not waited on (same page).
- Subagents (`Agent` tool, formerly Task): own context window, own system prompt, tool allow/deny list; "Claude Code runs subagents in the background by default" except listed cases; foreground subagents block the main conversation (`sub-agents.md#run-subagents-in-foreground-or-background`, `tools-reference.md#agent-tool-behavior`).
- Result delivery for background subagents: "A background subagent's results reach Claude as a completion notification in a later turn. Claude waits for that notification before reporting"; the notification is marked as an automated event, not a user message (`sub-agents.md`, same section and "Subagent output scanning"). A background subagent can leave a background command running past its turn; on exit it is sent a notification (same).
- Caps: 20 concurrent subagents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`; error "Concurrent subagent limit reached", told not to retry); depth default 3 layers below main (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); at the limit the `Agent` tool is withheld; no cap on total spawned (`sub-agents.md#concurrent-subagent-limit`, `#let-subagents-spawn-their-own-subagents`). Resumes bypass the concurrency check (same).
- Nested waiting: in an interactive session a subagent that launches background subagents waits for their results before finishing; under `claude -p` with fork mode off, nested children start in the background and report to the main conversation if they outlive the spawner (`sub-agents.md#let-subagents-spawn-their-own-subagents`).
- Untrusted output: each subagent final report is scanned before the parent reads it; text imitating `<system-reminder>` or `Human:`/`Assistant:` gets a backslash inserted, a `[harness: subagent output matched instruction-shaped pattern(s)…]` marker line may be prepended, and the report arrives under a header saying instructions in it carry no authority from the user. The docs state the scan does not change what an instruction can do; tool calls still go through permission checks (`sub-agents.md#subagent-output-scanning`).
- Permissions: background subagents have a smaller tool set and surface every permission prompt in the main session (`sub-agents.md`, "Tools, permissions, and results of background subagents").
- Cost: subagent requests count toward the same usage limits (`sub-agents.md`, intro). API failure in a background subagent marks it failed and the end message includes its last output (`#api-errors-in-subagents`). Fallback-model chain applies per subagent and the report opens with "This agent switched to `<model>`…" (same).
- Resume: each invocation is a new instance; `SendMessage` with agent id/name resumes with full history (`sub-agents.md#resume-subagents`). Scheduling/wakeups: `CronCreate` (session-scoped, restored on `--resume` if unexpired), `ScheduleWakeup` for self-paced `/loop`, `Monitor` tool feeds each output line of a background command to the model (`tools-reference.md` tool table).

---

## 3. Codex CLI

### 3.1 Subagents / multi-agent

- Two tool generations coexist. v1: `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent` (`core/src/tools/handlers/multi_agents/*.rs`). v2: `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, `list_agents` (`.../multi_agents_v2/*.rs`).
- Limits: `DEFAULT_AGENT_MAX_THREADS = Some(6)`, `DEFAULT_AGENT_MAX_DEPTH = 1` (`core/src/config/mod.rs:260, 270`). Capacity is a CAS counter that fails the spawn with `AgentLimitReached` (`agent/registry.rs:100-108, 338-346`); `exceeds_thread_spawn_depth_limit` gates the tool (`agent/registry.rs:93`, `tools/spec_plan.rs:738`). Rejection, not queueing.
- Completion delivery, v1 (and v2 without a path): a per-child completion watcher subscribes to the child's status stream, waits for a final status, then `parent_thread.inject_fragment_without_turn(SubagentNotification{agent_path,status})`, a `<subagent_notification>{json}</subagent_notification>` user-role fragment added to history **without starting a turn** (`agent/control.rs:445-565`; `context/subagent_notification.rs:23-50`). Tree shutdown is explicitly not reported as a child result (`control.rs:488-492`).
- Completion delivery, v2: an `InterAgentCommunication` (kind `Result`) from child path to parent path with `trigger_turn = false` (`control.rs:520-540`). The parent sees it at its next turn or when waiting.
- `wait_agent` v2 does not return results: it waits on "mailbox activity", a steering input, or timeout and returns `{message:"Wait completed."|"Wait interrupted by new input."|"Wait timed out.", timed_out}` (`multi_agents_v2/wait.rs:64-148`). Timeouts clamped to config min/max (`:62-72`). v1 `wait_agent` takes agent ids, default 30 s, clamped, and returns statuses (`multi_agents/wait.rs:95-102`; `multi_agents_common.rs:22-24`).
- Cancellation: `interrupt_agent` sends `Op::Interrupt` to one child (`control.rs:317-330`). `close_agent` persists the spawn edge as `Closed`, then `shutdown_agent_tree` collects live descendants first, shuts down the target, then each descendant, tolerating `ThreadNotFound/InternalAgentDied` (`control/legacy.rs:52-120`). Closing is explicit; a finished child is not auto-closed `[unverified]`.
- Durable parent/child graph: spawn edges are persisted `Open|Closed` in `agent-graph-store` (`agent-graph-store/src/types.rs:7-12`; written at `control.rs:640-661` unless the thread is ephemeral).
- Inheritance: children get the parent's environment snapshot (`control.rs` `inherited_environments_for_source`); role/model overrides per spawn `[unverified details]`.

### 3.2 Exec sessions (unified exec / background terminals)

- `exec_command` returns after a yield window (`MIN_YIELD_TIME_MS` 250 ms, `MAX_YIELD_TIME_MS` 30 s); if the process is alive it returns a `process_id`; later `write_stdin` (empty input = poll, floor 5 s) reads more output (`core/src/unified_exec/mod.rs:66-71, 206-212`). `MAX_UNIFIED_EXEC_PROCESSES = 64` (`:75`; enforced at `process_manager.rs:1731`). Default background terminal max timeout 300 s (`:71`, config `background_terminal_max_timeout` `config/mod.rs:1144`).
- Delivery model is pull: no code in `unified_exec/` injects completions into model history (grep for `inject_*` in the directory returned nothing). Clients can list and terminate background terminals (`codex_thread.rs:894-899`). `[unverified]` whether events reach the model by another path.
- Interruption: `Op::Interrupt` aborts tasks (`session/handlers.rs:62-64`); background terminals are killed by `Op::CleanBackgroundTerminals` (`handlers.rs:65-67`) and on session shutdown (`handlers.rs:320-334`). Turn interrupt itself does not kill them `[inference from handler split]`.

---

## 4. OpenClaw (docs)

- `sessions_spawn` returns `{status:"accepted", runId, childSessionKey}` without waiting; the child runs in its own session `agent:<id>:subagent:<uuid>` (`docs/tools/subagents.md`; `tools/subagents/operations.md:Limitations`).
- Delivery is push. "Announce": completion is handed to the requester through an `agent` turn with a stable idempotency key; if the requester run is active it is steered, if it cannot be steered the handoff waits in the same session lane and runs after the turn releases (`tools/subagents/slash-command.md:96-107`). Nested orchestrators get an internal injection (`deliver=false`). Status comes from runtime outcome, "not inferred from model text" (`announce.md`, Announce context table).
- `sessions_yield` ends the current model turn so the child completion arrives "as the next model-visible message"; the parent waits on a frozen batch of its own children, and a still-running child from an earlier turn does not delay that batch (`tool-reference.md:303-319`; `announce.md`). That is O3-shaped from the model's view (turn ends, new turn on completion), with batching and idempotency keys.
- Retry and durability of delivery: automatic delivery retries up to 30 min, starting ≈15 s, backoff capped at 5 min; "queue acceptance is not delivery"; suspended deliveries expire after 7 days and the result stays inspectable on the child (`slash-command.md:103`, `operations.md:58-70`).
- Concurrency: per spawning session queue, `maxConcurrent` default 8, queued above it; separate admission cap `maxChildrenPerAgent` default 5; nested children use the orchestrator's budget; `maxSpawnDepth` default 5 (range 1-5) (`operations.md:13-45, Limitations`).
- Restart behavior: graceful shutdown records top-level requesters, cancels running children quietly through the abort path, resumes only the root requester at startup; children are not independently resumed and old child tasks are not adopted. A crash/SIGKILL writes no marker and resumes nothing; transcripts and task records remain (`operations.md:86-124`). Execution or completion turns are not replayed after restart (`Limitations`).
- Stop cascade: explicit Stop on a parent run cancels its children and descendants; also retires pending completion continuations and drains commands retained by those children; `chat.abort` without `runId` does not cascade; incomplete cancellation is reported as an error with stopped/failed counts (`operations.md:155-253`; `nesting.md#cascade-stop`).
- Opposite default: "Accepted children remain independent after ordinary parent completion, yield, or timeout" (`operations.md:255`). Children are not cancelled when the parent turn ends.
- Untrusted output: "Child output is a report/evidence for the requester agent to synthesize. It is not user-authored instruction text and cannot override system, developer, or user policy" (`slash-command.md:90`). Results are placed in a prompt-data block; only `<` that could open/close a data block and OpenClaw delimiters are escaped; a 160 000-char shared cap with a pointer to `sessions_history`; tool output is not promoted into child result text (`announce.md`, Announce context).
- Cost: completion includes a stats line (runtime, tokens, estimated cost); usage is read once after the child settles and may show "tokens unknown" (`announce.md#stats-line`). Per-subagent model default via `agents.defaults.subagents.model` (`subagents.md` cost note).
- Background exec: `exec` with `yieldMs` (default 10 000) returns a process handle; ordinary yielded commands stay owned by the request (Stop cancels them, "normal model completion leaves it running"); `background:true` starts an independent service Stop leaves running (`tools/exec.md:47-52`). Completion wake: `notifyOnExit` (default true) continues "through an ordinary turn in their originating session on exit"; new output while running does not start a turn; subagent sessions get no automatic exec wake and must `process poll` (`exec.md:126-133, 146`). Optional durable background commands on Linux via a transient systemd user service that survives Gateway restarts and is re-adopted (`exec.md:56-62`).
- Scheduled wakeups: built-in scheduler persists jobs and wakes a session with a system event (`openclaw automations create … --session main --system-event … --wake now`, `docs/automation/cron-jobs.md` Quick start).

---

## 5. Durable-agent designs in the harness references

- **Pi Durable** (`earendil-pi.md` item 5, pin `earendil-works/pi@428a12b`): durable state is conversations, immutable entries, tasks, submissions in memory/SQLite/JSONL. On reopen the scheduler turns surviving `running` tasks into `pending` and `resume()` enables dispatch (`scheduler.ts#L230-L262`). Tool arguments and a `safe|unsafe` replay policy are committed before execution; recovery reruns only if both stored and current policy say `safe`, otherwise the model gets an interrupted result (`tool.ts#L35-L111`). Submissions are idempotent by `requestId`; steering is picked at the post-tools boundary and follow-ups at the final boundary (`submissions.ts#L141-L206`, `inbox.ts#L58-L106`). Deferred handles are polled and durable tool tasks are waited on at a checkpointed generation phase (`generation.ts#L111-L231`). Nothing says a parent waits without a live process on a _child agent_ specifically `[unverified]`; the useful part is the committed-state-before-effect pattern and boundary-based injection.
- **Seal** (`seal.md`; source read at pin): a session workflow starts a turn as a child workflow via `spawn_turn_workflow` (a `@workflow.step(max_retries=0)`), then suspends on a typed `TurnHook` with a deterministic token (`driver.py:11-32, 62-85`). The `subagent` tool derives `child_session_id = f"{session_id}:child:{tool_call_id}"`, creates the hook for that id _before_ spawning the child, emits a `subagent_called` event, and `await hook` (`turn.py:210-250`). The child result returns as the tool result. This is a blocking (foreground) subagent with durable suspension; no background mode. Child runs with `gated=False` (no approvals), flagged in `seal.md` as a caution. The code carries a TODO that retrying the spawn step is not safe without a hook-uniqueness check (`driver.py:16-17`).
- **Paperclip** (`paperclip.md` items 2-3): agents run when woken; wakeups are rows with `source`, `coalescedCount`, `idempotencyKey`; the scheduler skips paused agents, agents with an active run, agents over hard budget; a renewable controller lease protects a claimed run. Issue checkout is one conditional `UPDATE` (409 on loss); `checkoutRunId` and `executionRunId` are separate and finalization compare-and-clears. The liveness rule: every agent-owned non-terminal issue must have a live run, a typed wait, or an explicit recovery action (`doc/SPEC-implementation.md#L587-L627` per `paperclip.md`). Scheduling runs in the server process with no separate queue.
- **Orca** (`orca.md` item 3): session records separate execution location, provider handle chain, account home, options and a fenced lease; resume only when the provider reports a restorable session; "An unknown transport outcome must not be silently retried."
- **bb** (`bb.md`, attempt/session and child-thread bullets): durable thread identity vs provider thread vs provider process identity; an unexpected provider exit emits a failed turn rather than replaying an unknown step; thread model has standard and manager threads with child ownership.

---

## 6. Temporal / Inngest primitives and pg-boss mapping

- Temporal child workflows have a **Parent Close Policy**: `Abandon` (child unaffected), `Request Cancel`, `Terminate` (default), set per child; parent "Closed" = completed, failed, or timed out (`https://docs.temporal.io/parent-close-policy`). Signals are async write requests with no response; Updates are synchronous tracked writes that can return a result or error; Queries are non-blocking reads that do not add history (`https://docs.temporal.io/encyclopedia/workflow-message-passing`). Replay/determinism of workflow code is Temporal's recovery mechanism `[unverified in the pages fetched]`.
- Inngest `step.waitForEvent(id, {event, timeout, match|if})` pauses a function until a matching event or timeout (returns `null` on timeout); a losing wait inside a parallel race is not cancelled and keeps the run `Running` until its timeout (`https://www.inngest.com/docs/reference/typescript/v4/functions/step-wait-for-event.md`).
- pg-boss 12.25.0 surface relevant to F3 (`apps/api/node_modules/pg-boss/dist/types.d.ts`, `index.d.ts`): `send` options `startAfter`, `singletonKey`, `singletonSeconds`, `group` + `groupConcurrency`, `deadLetter`, `priority` (`:253-262`); queue options `expireInSeconds` default 900 (active job expiry), `retentionSeconds` default 14 d, `retryLimit` default 2, `retryBackoff`, `heartbeatSeconds` ≥ 10 (worker liveness; monitor fails/retries without a heartbeat) (`:185-245`); queue policies `standard|short|singleton|stately|exclusive|key_strict_fifo` (`:340-366`); `flow(jobs)` with `dependsOn` refs and `getDependencies/getDependents` (`:264-270`, `index.d.ts:30,60`); `cancel` state exists (`:6`). There is no built-in "wait for event/signal" primitive; a signal is a row you write plus a `send` of a continuation job `[inference]`.
- Mapping (concepts, not llame code): Temporal signal/Inngest `waitForEvent` = durable row "awaiting jobs" + a job-completion hook that `send`s the continuation (with `singletonKey = runId` to coalesce N completions into one re-enqueue); Temporal child workflow = a child Run row plus its own job; Parent Close Policy = an explicit per-job `onParentEnd: cancel|abandon` field; Paperclip's liveness rule = a sweeper asserting every suspended Run has a live job or a recovery action; Temporal Update/Seal hook token = idempotent continuation keyed by `(runId, jobId)`.

---

## 7. Implications for llame (short; options as seen in prior art)

**Lifecycle options**

- **O1 (hold the worker/process)**: OMP and Claude Code `-p` do this in effect (`settleAsyncWork`, "Waiting for background work" ceiling 10 min idle), as do Codex `wait_agent` and Seal's foreground subagent (but Seal holds a _workflow suspension_, not a worker). It is free where the process is the session; it pins capacity in a shared pool. pg-boss's `expireInSeconds` default 900 would kill a held job `[inference]`.
- **O2 (durable suspension + re-enqueue)**: closest analogues are Seal (`await hook` with deterministic token created before spawn), Temporal signal / Inngest `waitForEvent`, Pi Durable (state committed before effect, `running→pending` on reopen). None of the CLI harnesses does it; they are single-process. pg-boss has no wait primitive, so the suspension row, the completion hook, and the sweeper are llame's to build. Needs: coalescing of simultaneous completions (OMP 1.5 s settle window; Paperclip `coalescedCount`), idempotency key per continuation, a liveness sweeper (Paperclip rule), a deadline for "awaiting jobs" (Inngest timeout; OMP `wait` ladder).
- **O3 (end the Run, new Run on completion)**: OpenClaw `sessions_yield` and `notifyOnExit` wakes, Codex v2 mailbox with `trigger_turn=false`, OMP idle flush (`injectIdle` starts a new turn). In every one of these the new turn is system-triggered and bound to the original session identity; OpenClaw drops the result if the parent session was reset (`announce.md`, Private parent completion) and OMP's epoch does the same. OMP and OpenClaw suppress autonomous wakeups after a user interrupt (`agent-session.ts:2481-2493`; OpenClaw Stop retires pending completion continuations).

**Delivery models**

- _Inject at next step boundary while running, new turn when idle, batched_: OMP (`drainLazy` at aside boundaries + idle flush). Codex injects a fragment without a turn; OpenClaw steers an active run or queues behind it; Claude Code delivers "in a later turn". No harness lacks an on-demand read path: OMP `proc://`, Claude Code output file + `/tasks`, Codex `write_stdin` poll / `wait_agent`, OpenClaw `sessions_history` / `process poll`.
- All push designs also have explicit waiting for a model that has nothing else to do (OMP `wait`, Codex `wait_agent`, OpenClaw `sessions_yield`) and tell the model not to poll.
- Oversized results spill to an artifact with an inline preview and a handle (OMP 12 000/4 000 chars; OpenClaw 160 000 shared cap + `sessions_history`; Claude Code 30 000 chars inline then file).

**Cancellation cascade**

- Owner-scoped teardown on turn/session end: OMP (`ownerId`), Claude Code (foreground-subagent-started commands die with it; main/background ones survive), OpenClaw (children independent after parent completion; explicit Stop cascades to descendants, retires pending completion wakes, drains child commands). Codex cascades only on explicit `close_agent` (tree walk) and on session shutdown.
- Per-child policy exists only in Temporal (Parent Close Policy: abandon/request-cancel/terminate). Cancelling a parent while jobs run raises two defaults harnesses disagree on: kill-on-parent-end (OMP, Claude Code foreground) vs survive (OpenClaw, Claude Code background, Temporal `Abandon`).
- Settling the late result of a cancelled child without delivering it: OpenClaw "retires pending completion continuations"; OMP bumps an epoch and clears the queue; Codex treats tree shutdown as "a lifecycle handoff, not a child result" (`control.rs:488-492`). Cost of cancelled work is still reported by Paperclip ("usage receipts for cancelled provider work are still drained").

**Untrusted child output**

- Claude Code: scan + backslash escaping of imitated tags + marker line + header disclaiming authority; docs state it does not change tool permissions. OpenClaw: data-block framing, escape of block delimiters, status from runtime not model text, tool output not promoted. Codex: fragment typed `subagent_notification` with JSON `{agent_path,status}` (final message text handling `[unverified]`). OMP: `<system-notice>` wrapper plus "claimed artifacts unverified". Seal: child runs ungated (anti-example).

**Bounds seen**

| System      | Concurrent                                     | Depth                     | Total jobs/procs    | Rejection style                        |
| ----------- | ---------------------------------------------- | ------------------------- | ------------------- | -------------------------------------- |
| OMP         | `task.maxConcurrency` 32                       | 2 (tool removed at limit) | `async.maxJobs` 100 | throw / fall to foreground             |
| Claude Code | 20 subagents                                   | 3 (tool withheld)         | no total cap        | error "do not retry"                   |
| Codex       | 6 threads                                      | 1                         | 64 exec procs       | `AgentLimitReached`                    |
| OpenClaw    | 8 running, 5 admitted per session, queue above | 5 (1-5)                   | per-session budgets | queue (execution) / reject (admission) |

**Not found in any source read**: a harness that suspends the _parent_ durably across a process restart while a background _job_ runs and then resumes it automatically (OMP `--restore` re-runs subagents only; OpenClaw resumes only the root requester after graceful shutdown and replays nothing; Claude Code's cloud/agent-view keeps a live process). The durable-suspension evidence is workflow engines (Seal, Temporal, Inngest) and Pi Durable's task recovery.
