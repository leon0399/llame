# Tasks: durable-run-workers

## 1. Verify current behavior against the codified specs (the "supposedly here now" pass)

For each existing requirement, confirm the code matches the spec and **refactor to reconcile any drift** (fix the code to the spec, don't weaken the spec). Add a regression test where one is missing. Split by capability.

**`job-queue`:**

- [ ] 1.1 **Retry + dead-letter** — confirm the `#47` defaults (retry policy + `<queue>.dead`) apply to infra failures; confirm `ensureQueue` is idempotent (create-if-missing, policy set-once, mutable fields re-applied — the pg-boss v12 policy-immutability handling).
- [ ] 1.2 **Admission policy + coalescing** — confirm `stately` + `singletonKey` → one pending + one active per key (existing queue integration test covers this).
- [ ] 1.3 **Cron single-fire + delayed jobs** — verify a cron schedule enqueues **at most one job per tick across replicas** (pg-boss per-slot dedup) and a delayed job does not run early. This is the guarantee #116 leans on (N workers each assert the sweep schedule on boot).

**`durable-runs`:**

- [ ] 1.4 **Single-flight** — confirm `runs_chat_inflight_unique` admits one non-terminal run per chat, the 409-on-concurrent-different-message path, and same-message supersede (`markStarted`). Note any gap.
- [ ] 1.5 **Crash-safe claim/finish** — confirm `markStarted` refuses terminal runs and `markFinished` is first-writer-wins; confirm two-worker race cannot double-run. NOTE: the reclaim's app-level stale-heartbeat CAS is **replaced** by native queue heartbeat in §5 — verify the first-writer-wins guard that survives the change, not the CAS being removed.
- [ ] 1.6 **Liveness (current → replaced by §5)** — capture the current hand-rolled deadman (per-run `runs.timeouts` poll in `runAs`, app `setInterval` heartbeat, `heartbeatAt` staleness, `queued` uses `createdAt`) as the baseline the collapse must preserve at the **contract** level: a stuck run is always eventually settled in the owner's tenant scope, no cross-tenant scan. The mechanism is deleted in §5; the contract is kept.
- [ ] 1.7 **Enqueue fail-fast + self-heal** — confirm an enqueue failure fails the run (frees the slot) and residual `queued` self-heals; no manual cleanup path exists or is needed.
- [ ] 1.8 **Event stream / resume + run failure classification** — confirm the refresh-safe replay contract (existing e2e: chat-flow resume, tool-loop resume) holds and a model-level failure records terminal state while the job succeeds; leave the polling-vs-push mechanism to #118.

## 2. Queue concurrency + selective subscription (`job-queue`, design D1/D2)

- [x] 2.1 Extend `ConsumeOptions` with `concurrency?: number` (default 1 = current behavior) in `apps/api/src/queue/queue.ts`; map it to pg-boss's native **`localConcurrency`** in `PgBossQueueService.consume` (verified native in `pg-boss@12.25`'s `WorkConcurrencyOptions` — one `work()` registration, per-job settlement, no manual ack). Keep `batchSize: 1`; `stopConsumer` stays a single `offWork(wait:true)` — but see the DIVERGENCE recorded in the design/PR notes: it now drains by queue name, not by the id `work()` returns (that id only identifies pg-boss's internal worker 0; matching on it alone would leave the other `localConcurrency - 1` workers running).
- [x] 2.2 Concurrency contract test: `concurrency: N` yields N parallel in-flight handlers; a handler throwing settles ONLY its own job (siblings unaffected).
- [x] 2.3 Confirm + test **selective subscription** (the routing primitive): a process consuming only queue A never claims queue B's jobs, and two processes on the same queue share it without double-running. This should already hold via pg-boss's per-queue `work()`; add the negative test, don't add a routing layer.

## 3. Worker profiles (`job-queue`/`durable-runs`, design D2/D4)

- [ ] 3.1 Add a `workers` map to `llame.config.json` (config-as-code): profile name → `{ group: concurrency }` keyed by **consumer-group name** (a worker service, e.g. `runs`, `search-reindex`), with a default `all` profile enabling **every group at concurrency 1** (= today's behavior). Each group owns its own queues (main + internal DLQ/control queues). Validate + surface via `LlameConfig`.
- [ ] 3.2 Add a shared `resolveWorkerProfile()` selecting the active profile by `LLAME_WORKER_PROFILE` (default `all`). A worker service registers its consumers (`consume`/`schedule`) **only if its group is in the active profile**, applying that group's concurrency to its main queue (internal/control queues run at a sane fixed internal concurrency the group owns).
- [ ] 3.3 Gate `RunsWorkerService` and the search reindex/sweep worker on the active profile — no consumer self-registers unconditionally; a group absent from the profile starts none of its consumers.

## 4. Dedicated worker entrypoint + shared resolver (design D4, #116)

- [ ] 4.1 Add `apps/api/src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` (no HTTP), where `WorkerModule` composes `QueueModule` + the run-execution modules (already controller-free post-#106/#107).
- [ ] 4.2 Both `main.ts` (api) and `worker.ts` resolve the **same** profile via `resolveWorkerProfile()` — **no** `RUN_EXECUTION_MODE` toggle. Co-located dev = default `all` profile on the api process; dedicated prod = a profile on `worker.ts`.
- [ ] 4.3 One image, two entrypoints (`main.js` api / `worker.js` worker); `nest build` produces both.
- [ ] 4.4 `compose.yaml` + operator deployment example: a `worker` service (`deploy.replicas: N`) alongside `api`; document that every declared queue must be covered by *some* deployed profile (the default `all` covers it), and how to add a taint profile (e.g. a `heavy` profile for `embeddings`, #196) later.

## 5. Liveness collapse onto native heartbeat (`job-queue` + `durable-runs`, design D7)

- [x] 5.1 **Verify pg-boss `heartbeatSeconds` semantics BEFORE wiring** — auto-refresh (`heartbeatRefreshSeconds`) keeps a long-pending handler claimed for its full duration; the `>= 10s` floor; a stalled job is failed then retried then dead-lettered; a dead-lettered job carries its original payload. Record the finding (same discipline as the `localConcurrency` check). Verified via source read (`types.d.ts`) + a queue-level integration test (a 13s handler on `heartbeatSeconds: 10` completes once, not retried); dead-lettered-payload fidelity already covered by the pre-existing DLQ test.
- [x] 5.2 Add `heartbeatSeconds` to `QueueOptions` and thread it through `ensureQueue` (`createQueue` + `updateQueue` COALESCE, like the other mutable fields).
- [x] 5.3 Set `heartbeatSeconds` on `RUNS_QUEUE` (from `runs` config); **delete** the `setInterval` heartbeat loop in `executeJob` and `RunsRepository.touchHeartbeat` — pg-boss auto-refresh replaces them.
- [x] 5.4 In-process wall-clock abort in `executeJob`: an `AbortController` fired at `runs.timeoutSeconds`, **tagged** so `executeRun` records `run.expired` (timeout) — NOT `run.cancelled`; clear it on completion.
- [x] 5.5 Add a `runs.dead` consumer (the wrapper-provisioned DLQ, `pgboss-queue.service.ts:58`) that runs `runAs(payload.userId)` → `markFinished('expired')` + append `run.expired` on retry-exhaustion. Register it in the runs group, gated by the active profile (§3). NOTE: profile-gating (§3) doesn't exist yet — the consumer is registered unconditionally in `RunsWorkerService`, same as the main `runs` consumer; Slice C wires the profile gate around both.
- [x] 5.6 Simplify `markStarted` reclaim to "not terminal + first-writer" (native heartbeat drives death-detection; drop the app stale-heartbeat CAS). Keep `markFinished` first-writer-wins as the terminal-outcome guard.
- [x] 5.7 **Delete** the `runs.timeouts` queue, `RunTimeoutJob`, `checkRunLiveness`, and the compile-only `queue.type.spec.ts` references to `RUN_TIMEOUTS_QUEUE`; remove the never-started-`queued` special case (an undelivered job is just a pending pg-boss job).
- [x] 5.8 **Delete the enqueue-time unwedge** (`chat-loop.service.ts` — the third heartbeat site found in §1): drop the `heartbeatAt`/`heartbeatStaleSeconds` stale-check and the expire-the-blocker-and-retry branch; keep only 409 + the vanished-blocker retry (retry the create if no active blocker remains). A crashed blocker is freed by the queue (recovery/DLQ), not here.
- [x] 5.9 Migration (schema-first via `db:generate`, never hand-write): drop `runs.heartbeatAt` **after** 5.3/5.8 stop reading/writing it (trailing), and remove the now-unused stale-threshold config field (`heartbeatStaleSeconds`; keep `timeoutSeconds` for the in-process abort). Keep the single-flight index + terminal guard untouched. NOTE: `runs.workerId` is dead but **out of scope** — do not drop it here (separate cleanup).

## 6. Graceful drain on shutdown (design D5)

- [x] 6.1 `enableShutdownHooks` + an `onApplicationShutdown`/`onModuleDestroy` that `stopConsumer`s every registered consumer with `offWork(wait: true)` — drains in-flight runs before exit. Applies to the dedicated worker and a co-located worker. Implemented in `PgBossQueueService` (queue-wrapper level, applies to every consumer regardless of which service registers it); `main.ts` already called `enableShutdownHooks()` pre-existing — no change needed there. The dedicated worker entrypoint (`worker.ts`, task 4.1) will need the same call once it exists.

## 7. Tests (design D1, D3, D6, D7)

- [ ] 7.0 **Composite worker harness (prerequisite for 7.1–7.3/7.7)** — a fresh DB-backed harness that wires a real pg-boss `runs` queue + a live `RunsWorkerService` + `RunExecutionService` (fake `ModelsService`/model client) + `TenantDbService` in one Nest graph. Neither existing pattern (`queue.integration.spec.ts` DI-with-queue, or `active-runs.integration.spec.ts` direct-instantiation-no-queue) has this — extend pattern 1 to also provide the run-execution graph. `TEST_DATABASE_URL`-gated.
- [ ] 7.1 Concurrency integration test (DB-backed): several different-chat runs enqueued → execute in **parallel** (a slow run doesn't block others); assert wall-clock < serial sum.
- [ ] 7.2 Per-job settlement test: one concurrently-executing run fails/retries → siblings complete unaffected.
- [ ] 7.3 **Single-flight under concurrency** (design D3): assert two runs of the same chat never execute concurrently even at `concurrency > 1`.
- [ ] 7.4 Worker-entrypoint smoke (boots headless, consumes, no HTTP) + graceful-drain test (shutdown finishes an in-flight run).
- [ ] 7.5 Worker-profile routing test: a process on a profile subscribing to a subset of queues runs only those; the default `all` profile serves every queue — confirms the taint mechanism without a bespoke router.
- [ ] 7.6 Confirm the search inline-reindex composes under concurrency (design D6): concurrent finalizations reindex without cross-run interference (REPEATABLE READ + retry already covers same-chat).
- [ ] 7.7 **Liveness (design D7):** worker-death → job retried → a healthy worker re-executes and the run reaches a terminal result (not orphaned); retry-exhaustion → `runs.dead` writes `run.expired` in the owner's tenant scope (no cross-tenant scan); in-process budget exceeded → `run.expired` (timeout), distinct from a user cancel; a transient two-worker overlap yields a **single** terminal outcome (first-writer-wins).
- [ ] 7.8 **Single-flight regression (gap found in §1):** `chat-loop` has zero tests for the 409 path, duplicate-message-id rejection, or the post-collapse vanished-blocker retry. Add them (unit or integration) — they guard the D7 unwedge deletion (§5.8) against regressions.

## 8. Docs

- [ ] 8.1 `docs/scaling.md`: move constraint 3 (worker concurrency) and the topology table from "open" to shipped; add the `concurrency × replicas ≤ pool` sizing note.
- [ ] 8.2 Operator note for **worker profiles** — the `workers` config + `LLAME_WORKER_PROFILE`, the default `all` profile, `docker scale worker=N`, and how to taint a job-class to a machine via a queue-subset profile (with the "every queue must be covered by a deployed profile" caveat). Note the run-liveness config changed (queue `heartbeatSeconds` replaces the app heartbeat + stale-threshold settings). Lands in `docs/scaling.md` for now, migrates to admin docs on the later reorg.

## 9. Ship

- [ ] 9.1 Full verification: `pnpm --filter api lint` + `typecheck` + unit, `apps/api/scripts/rls-test.sh` green (incl. the new concurrency + drain + liveness integration tests), `pnpm build` (both entrypoints); `db:generate` produces the heartbeat-column-drop migration and `drizzle-kit check` passes.
- [ ] 9.2 CHANGELOG entry; PR references `Closes #117`, `Closes #116`, refs #36 (v0.2); tick the v0.2 tracker items.
