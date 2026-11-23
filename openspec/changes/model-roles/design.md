## Context

See proposal.md for the motivation. Facts below were read at `214390e4e` (master after #1898) and
re-checked in review round 1.

- A Run holds one model for its whole life: `runs.model_id` is `NOT NULL` and fixed at accept time
  (`apps/api/src/db/schema/chats.ts:409`). The worker builds one model client per job
  (`runs/runs-worker.service.ts:485,541`) and carries it on `ExecuteRunInput.client`
  (`runs/run-execution.service.ts:884`); a delivery (`startDelivered`, `:2502-2516`) keeps it.
- No Chat column stores a selection. The web restores the picker from the last turn's usage
  (`apps/web/app/(chat)/components/use-chat-engine.ts:199-236`).
- Admission validates before any database work (`chats/chat-loop.service.ts:213-215,244-262`);
  `models/models.service.ts:92-104,136-152` resolves the model, then the effort, then the mode.
  Continue takes `latestRun.modelId` and the stored effort (`follow-up-admission.service.ts:326-374,
  566-577`); Regenerate must name `modelId` (`:381-423`). A plain send serializes on the Chat `touch`
  update; deliveries, follow-ups, `/compact`, and promotion call `lock()`.
- Pending items carry `ChatDeliverySettings { modelId, effort?, permissionMode }`
  (`db/schema/chat-deliveries.ts:41-45`). Jobs take their settings from the live client
  (`run-execution.service.ts:3214-3218`). Queue promotion and job-notice Runs re-check settings and fail
  closed (`runs/queue-promotion.ts:74,95-108`, `runs/job-notice-run.service.ts:183-193,253-263`).
- Failure paths: the closed class set (`models/provider-failure/provider-failure.ts:1-16`),
  `MAX_SENDS = 11` and `retryable()` (`models/request-recovery.ts:28,58-75`). Three provider-failure
  paths exist in `run-execution.service.ts`: the synchronous throw (catch at `:6389-6436`, rethrows),
  `onError` (quota decision `:5954-5966`, then `settleErrorOutcome` `:3811-3883`), and the failed send
  after a started tool call (`decideFailedSend` `:5117-5188`). A fourth is the boundary-compaction
  failure (`:9158-9250`).
- A delivery opens a segment through `moveRunToDelivery` (`runs/segment-delivery.ts:84-123`), which
  mints an attempt and appends `run.delivered`. `DeliveryCause` is closed:
  `'steer' | 'interrupt' | 'notice' | 'compaction'` (`segment-delivery-close.ts:97`). Seven files read
  the current segment through `run-segment-queries.ts` (resume cursor, usage completeness, the reply
  finalizer, the model-change dedupe). `closeReply` writes `completed` or `cancelled` only
  (`segment-delivery-close.ts:303`).
- A step-boundary compaction already continues on a host message with cause `compaction`
  (`segment-delivery.ts:473-480`); host messages are role `user` with no sender
  (`segment-delivery-close.ts:191-204`).
- Quota wakes: `RunWaitCause` is closed (`runs/run-wait.service.ts:30`), the queue wake payload is
  `{ generation, jobId }`, and a stale deadline job is detected by a `currentJobId` mismatch
  (`runs-worker.service.ts:203-215`).
- The model-switch item is staged by the worker on the triggering message
  (`run-execution.service.ts:10756-10998`); `ModelChangePayload.cause` is the literal `'model'`
  (`chats/context-item-producers.ts:273-297`), and `isModelSwitchItem` matches only that
  (`chats/accepted-turn-parts.repository.ts:79-86`).
- Reasoning replays only when `usage.modelId` equals the request model and the reply is `completed`
  (`chats/context-builder.ts:640-660`). Adapters pass tool-call ids through unchanged
  (`@ai-sdk/anthropic@3.0.118`, `@ai-sdk/openai@3.0.97`, `@ai-sdk/openai-compatible@2.0.75`).
- `billing` is `usage | subscription` in the schema (`llame.config.schema.json:367-371`), the type
  (`models/model-client.ts:34-35`), and the web parser (`message-usage.tsx:155-158`).
- `chats`, `runs`, `chat_deliveries`, and `chat_jobs` force row-level security; data migrations use the
  `NO FORCE … FORCE` window (`apps/api/src/db/AGENTS.md`, precedent
  `migrations/20260709160717_open_chameleon/migration.sql:6-15`).
- The only active change, `tool-search`, modifies `owner-chat-forks` "The fork's Chat row carries the
  source's frozen context" and adds two `instance-config` requirements. This change modifies neither.

Prior art, read for the map tickets (details on #1755, #1757, #1822):

| Harness     | Role or chain                                                   | Explicit pick            | Sticky fallback                                   | Automatic failover       |
| ----------- | --------------------------------------------------------------- | ------------------------ | ------------------------------------------------- | ------------------------ |
| oh-my-pi    | `modelRoles` plus `retry.fallbackChains`, effort per assignment | not strict               | until cooldown expiry, then primary at turn start | on once a chain exists   |
| OpenClaw    | `model.fallbacks` per agent                                     | strict                   | rate-limit stickiness up to 30 min                | on once configured       |
| Claude Code | `fallbackModel`, max three                                      | not documented as strict | current turn only                                 | availability errors only |
| Codex CLI   | backend reserve model                                           | manual pick wins         | persisted revert target                           | backend decides          |

llame keeps oh-my-pi's shape (one ordered list, effort per candidate, cooldown-expiry revert) and
OpenClaw's strict explicit pick, and it adds an opt-in matrix for the automatic part.

## Goals / Non-Goals

**Goals:**

- One model selector grammar from request to Run to Chat, with the served model recorded apart.
- A model switch that reuses the delivery machinery, so every segment reader works unchanged.
- Manual switching that works with every failover cell off.

**Non-Goals:**

- A cross-Run cooldown cache (settled Q22: each Run discovers failures itself).
- Changing the same-model retry, the quota-wait bounds, or the broken-send continuation.

## Decisions

### D1: `modelRoles` is one top-level map, validated by the published schema

```jsonc
"modelRoles": {
  "coding": {
    "candidates": [{ "model": "codex", "effort": "high" }, { "model": "sonnet" }],
    "allowPaidFallback": false,
    "failover": { "agent": { "availability": "on", "quota": { "switchAfterSeconds": 7200 } } }
  }
},
"failover": { "agent": { "availability": "on" } },
"defaults": { "selector": "@coding", "titleGenerationSelector": "@titles" }
```

The JSON Schema declares the shape; `config-loader.ts` cross-checks candidates against `models[]`
and effort against declared levels, as it does for `defaults` today. Rejected: role membership on
each model entry (grilling Q1 B), because the order would live in many places.

### D2: Requests carry `selector`; Runs and usage keep `modelId` for the served model

The send, chat-creation, Regenerate, delivery, and `/compact` DTOs replace `modelId` with an optional
`selector`. The Run gains `selector text NOT NULL` and `selected_effort text NULL` (the effort that
admission resolved, grilling Q4); `runs.model_id` and `runs.effort` keep their meaning: the model and
effort of the current segment. `latestRun`, `RunResponse`, and the delivery echo publish `selector`.
Validation codes stay `model_not_available` and `effort_not_available`; next-candidate refusals add
`next_candidate_unavailable`. A request that still names `modelId` gets 400 from the closed DTO.

The glossary gains **Model selector**, apart from the `read` **Selector**. Rejected: keeping
`modelId` for selectors (grilling Q3 A); see the ADR
[Requests name a selector, and `modelId` names the model that served](../../../docs/adr/2026-11-23-requests-name-a-selector.md).

### D3: The Chat stores a revisioned selection, resolved inside the admission transaction

`chats.model_selection jsonb NULL` holds
`{ revision, selector, effort, hold?: { selector, modelId, effort, revertAt } }`, under the existing
owner RLS of `chats`. Each owner write bumps `revision`; the Run records the revision it read
(`runs.selection_revision`). Admission splits in two:

1. before any write: DTO shape and blank checks;
2. inside the admission transaction, after the Chat row is touched or locked: resolve the selector
   (named, stored, or `defaults.selector`), drop an expired or invalid hold, resolve the effort by the
   order of `model-roles`, validate both, and write the selection.

The error order changes per path, and the tests that pin today's order move with it:

| Path                          | Order                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| send, chat creation, delivery | 400 (shape) → 404 → 409 (single-flight) → 422 (selector, effort, mode)              |
| follow-up                     | 400 → 404 → stuck-Run expiry → 422 returned as a value, so the expiry still commits |
| `/compact`                    | 400 → 404 → 422 → 409, as today                                                     |

A send, chat creation, delivery, Regenerate, or `/compact` writes the selection: a named `selector`
with the effort admission resolved, a named `effort` alone onto the hold or the selection, or, on a
Chat with none, the resolved selection. Continue, promotion, and job notices write only the removal of
an expired or invalid hold. A stored selector that the config no longer offers resolves to
`defaults.selector`, stored with its resolved effort.

`selected_effort` writers: a send, creation, Regenerate, promotion, and a job notice write the effort
admission resolved; Continue copies the source Run's `selected_effort` and takes `effort` and
`model_id` from its last segment; Continue on next candidate keeps the source's `selected_effort` and
writes the D5 result to `effort`.

### D4: Hold and return to the primary

The switch writes `hold` only when `model_selection.revision` still equals
`runs.selection_revision`, so any owner write during the Run, including a re-pick of the same role,
wins. `revertAt` is `failure.resetsAt`, else `now + failure.hintMs`, else `now + 5 min`.
`modelRequestFailure` and the four `failureDetails` builders carry `hintMs` into `runs.error` (a
`jsonb` key, no column), so the owner path (D7) has it. Admission compares `revertAt` with the
database clock. A live Run never reads the hold again, and Continue never clears it. A Run that
resolves to a held model takes the hold's effort.

### D5: Effort after a switch

A pure function takes `runs.selected_effort`, the new model's declared levels, and the candidate
effort, and returns the first that applies: the selected effort if declared, the candidate effort,
the model default, or none. The switch writes the result to `runs.effort` and the hold.

### D6: A switch inside a live Run is a delivery with cause `failover`

`DeliveryCause` gains `failover`; no consumer switches on it exhaustively. The switch runs in one fenced
transaction, in the worker's Run-then-Chat order:

1. apply the failed-send cut (`applyFailedSendCut`), so the reply keeps parts through the last settled
   tool part;
2. close the reply as a failed Run would: `closeReply` takes the terminal status `failed` for cause
   `failover`, which maps to usage status `error`, and a failover pre-mutation of the live telemetry,
   beside `abortedByInterrupt`, forces `complete: false` (`segment-delivery-close.ts:235,244,303`);
3. store the host message: the `effective-context-change` item with cause `failover` first, then any
   pending steer and notice items of that boundary, as the compaction continue message does;
4. call `moveRunToDelivery` with cause `failover`, which mints the attempt, moves `runs.message_id`,
   and appends `run.delivered`;
5. write `runs.model_id` and `runs.effort` through `updateForAttempt` with the new attempt id, and
   the hold (D4);
6. append `model.switched` (added to `RunEventType`).

After the commit, the worker re-enters `executeAttempt` through `startDelivered` with a client from
`createClient`, so prompt, tools, window, pricing, and billing follow the new model, and the retry,
wait, and step counts start at zero. `recoverSupersededSend` is the precedent: it sets `nextCall`
from `onError`. The segment runs the pre-step compaction check, as a first segment does
(`run-execution.service.ts:9869`), so a switch to a smaller window compacts first. The attempt fence
(`ownsLiveReply`), not the reply status, keeps a later settle of the Run from rewriting the closed
reply; a test pins it.

Seams that learn the `failover` cause: `isModelChangePayload` and `createModelChangeItem`
(`context-item-producers.ts:279-297`), `isModelSwitchItem`, the web `isModelSwitchPayload` and its
trusted producers (`apps/web/.../history.ts:240-266,482-533`), `message-boundaries.tsx`, and the
boundary label in `packages/ui`. The payload gains `failureClass`. A `failover` item on the trigger
suppresses the derived cause-`model` item. The live view needs no new stream event: the bridge
already ends the segment on `run.delivered`, and the web refetches the host row through
`useRunHandoff`. The effective-context inspector takes each attempt's model from `model.requested`.

The decision points, in order, before any terminal write:

- `onError`: after `settlePendingAbort` and the superseded-retry branch, for a `ProviderFailure` with
  no `superseded`, before `quotaWaitForFailure`;
- `decideFailedSend`: before `failedSendQuotaWait` and at `!continuesFailedSend`;
- the synchronous-throw catch, which returns `await startDelivered(…)` instead of rethrowing.

These points get a production caller only with the policy (D11). The `in-run-switch` layer ships them
behind an injected decision function that returns "no switch" in production, so its tests drive a
live stream.

The fixed text of the item:

```text
The active model changed during this Run, because <prior model> failed: <failure label>.
You are now <new model>.
Some tool calls before this point can have taken effect. Check their results before you repeat any of them.
Follow the current system instructions and continue the task.
```

Rejected: a model id on every part (ADR
[A model switch within a Run opens a new segment](../../../docs/adr/2026-11-20-a-model-switch-opens-a-segment.md));
a `model.switched`-only boundary, which seven segment readers would have to learn.

### D7: Continue on next candidate

- **Failed Run.** `POST /api/v1/chats/:chatId/messages/:messageId/runs` with
  `{ action: "continue", candidate: "next" }`. The source Run is terminal, so the whole opening runs
  in the admission transaction: apply the Continue cut to the source reply with a parts-only writer
  that keeps its usage; store the host message with the `failover` item; create the Run on the host
  message (`createRunForMessage(host)`) with the role selector, the new model, and the D5 effort, and
  with no `run.continued` and no `replacesUsage`; write the hold; append `model.switched` with origin
  `owner`. The first dispatch is an ordinary first segment on the host message, so it writes a new
  reply and runs the window check. The web refetches history after the request, because the
  follow-up hiding rule keys on `latestRun.messageId`.
- **Waiting Run.** `POST /api/v1/runs/:id/next-candidate`. A parked Run has no worker and no active
  attempt, so the API transaction does the switch, in the wait subsystem's Chat-then-Run lock order:
  fence on `status = 'awaiting_quota'` and `current_job_id`; close the parked reply from the
  `run.suspended` payload with `finalizeRunReply` and no live attempt, as `failRunTransactionally`
  does; store the host message with the `failover` item and the pending steers and notices; run an
  exported null-attempt variant of the move that mints the attempt and appends `run.delivered` with
  cause `failover`; set model, effort, and hold; clear `awaiting`; enqueue through the
  `enqueueSuspendedRun` path with a fresh job id, `wake: { generation, jobId }`, and
  `currentJobId = jobId`. The job keeps the pre-switch message as its `userMessage`, so the claim
  takes the `currentSegmentInput` path. The old deadline job then finds a `currentJobId` mismatch.
- **Paid label:** the web reads `paid` from the role catalog (D9). The owner path never skips
  (grilling Q6 B).
- Compaction Runs and exact selectors get 409 `next_candidate_unavailable`.

### D8: Pending items store what the owner named

`ChatDeliverySettings` replaces `modelId` with `selector?` and keeps `effort?` and `permissionMode`.
An owner item stores only what its send named. A job stores the Run's `selector`, `selected_effort`,
mode, and origin; `RunClaimResult` already carries effort and mode and gains `selector`, so
`ToolContext.jobSettings` takes them from the claim rather than the live client. Queue promotion and
job-notice Runs call the D3 resolver at start, so a hold written by the live Run applies to an item
that named no selector.

### D9: Catalog and picker

`GET /api/v1/models` adds `roles: [{ selector, candidates: [{ modelId, effort?, paid }] }]` and
renames `defaultModelId` to `defaultSelector`. `paid` is `resolvedBilling === "usage"`; no other
billing field is published. The picker lists roles, then models; a held Chat shows
`@coding → sonnet until 14:00`. The effort picker offers the levels of the resolved model. After a
pick, the next send names `selector`; later sends omit it.

### D10: Run origin (cutover 2)

`runs.origin` is an enum `owner | agent`, default `owner` in the migration, written by every Run
creator. A job stores its Run's origin; its notice Run copies it. Nothing writes `agent` until
subagents ship; the failover tests insert an `agent` Run directly.

### D11: Failover policy (cutover 2)

One pure function `policyCell(role, origin, failureClass)` merges the role matrix over the instance
default cell by cell and maps the class to its group. It replaces the injected decision function of
D6. At each D6 decision point, after `retryable()` says no:

- no role, no next candidate, a compaction Run, or cell `off`: the existing quota wait or failure;
- `on`, or a `switchAfterSeconds` below the time to reset, or a reset beyond
  `runs.quotaWaitMaxSeconds`: D6 with cause `policy`;
- the paid skip walks past `usage` candidates when leaving a `subscription` or `free` model and the
  role lacks `allowPaidFallback`.

The worker reads the live config object, so a restart applies only to the next failure (grilling Q7
A).

### D12: Title generation through a role (cutover 2)

`resolveTitleModelConfig` returns the ordered candidate list. The title service tries each in order,
skips gated paid ones, and stops at the first usable title. It writes no hold and never enters a quota
wait. Cutover 1 uses only the primary. The ADR
[A title call walks its model role's chain](../../../docs/adr/2026-11-23-a-title-call-walks-its-role-chain.md)
records the exception to the opt-in rule.

### D13: Tool-call id normalization

One map per request covers every replayed part. Two assembly points build it: `requestMessages` for
Run requests (`run-execution.service.ts:11449-11481`) and `buildCompactionRequest` for summaries
(`compaction/compaction.ts:485-506`); title requests carry no tool parts. A history reply counts as
the request's own model when its `usage.modelId` equals the request model, the same input that
`replaysPrivateParts` uses. Its ids stay, unless an earlier part of the request already used the same
id. Every other id that does not match `^[a-zA-Z0-9_-]{1,40}$`, and every repeated id, becomes: the
characters outside the class replaced by `_`, cut to 28 characters, then `_` and an 8-character hash
of the original, then `_` and a two-digit counter when a collision remains. The result is at most 40
characters. 40 is the reported limit of OpenAI Chat Completions, below Anthropic's pattern and the
64 of OpenAI Responses. Stored parts, `tool_artifacts`, and `chat_jobs` keep the original id.

### D14: Migration

One Drizzle migration with hand-written data steps, each inside the documented `NO FORCE … FORCE`
window with its ledger comment:

1. add `chats.model_selection`, `runs.selector`, `runs.selected_effort`, and
   `runs.selection_revision`; `runs.error` is `jsonb` and gains an optional `hintMs` key with no
   schema change;
2. `UPDATE runs SET selector = model_id, selected_effort = effort`, then `SET NOT NULL` on `selector`;
3. set each Chat's selection from its latest turn Run (`model_id`, `effort`), with no hold;
4. `UPDATE … SET settings = (settings - 'modelId') || jsonb_build_object('selector', settings->'modelId')
   WHERE settings ? 'modelId'` on `chat_deliveries` and `chat_jobs`.

`RunsRepository.create` defaults `selector` to `modelId` and `selected_effort` to `effort`, so the 77
test call sites need no edit. Cutover 2 adds `runs.origin` with default `owner` in its own migration.
Nothing is deleted, so Leo's running instance keeps every Chat.

Rollback is a forward migration: it restores `settings.modelId` from an exact `selector` on pending
items and jobs, withdraws a pending item whose selector is a role (the old code cannot run it), and
drops the new columns, whose data is derived.

## Risks / Trade-offs

- [The config rename breaks every operator file] → startup names the unknown key; CHANGELOG and the
  operator docs carry a **Breaking** note with the two renames.
- [The API rename breaks old web bundles during deploy] → the web and API deploy together; an old
  bundle that sends `modelId` gets 400, not a silent wrong model.
- [A switch to a smaller window needs a compaction before the first request on the new model] → the
  segment runs the pre-step compaction check (D6), whose window summary uses the previous completed
  Run's model; when that fails, the existing `context_incompatible` failure applies. Context promotion
  (C4) is out of scope.
- [A tool call of the failed step can have taken effect] → only settled calls stay; the switch
  reminder tells the model to check results before it repeats them.
- [Mistral-family models through OpenRouter or Ollama are reported to need 9-character alphanumeric
  ids (third-party report only)] → D13 does not cover it; a Run that hits it fails with
  `invalid_request`, and a wire-specific rule can follow with evidence.
- [An `agent` origin has no producer yet] → the integration tests insert `agent` Runs directly;
  subagents (#765) add the producer.
- [A hold copied into an owner fork can point at a model that a later config removed] → admission
  clears a hold whose model left the role.

## Migration Plan

1. Operators rename `defaults.modelId` to `defaults.selector` and
   `defaults.titleGenerationModelId` to `defaults.titleGenerationSelector`.
2. Deploy API, worker, and web together; run `pnpm db:migrate`.
3. Roles and the failover matrix are optional; a config without them behaves as before, apart from
   the new names.

## Open Questions

None that change the specs or the task split.

## Revision history

- **r2 (2026-11-23):** two reviewers plus the PR bots (Codex, CodeRabbit, pullfrog) on `2512eac2f`.
  Reviewers: 0 P0, 12 P1, 14 P2; bots: 14 threads. Fixed: the closed reply is `error` with
  `complete: false` through a failover telemetry pre-mutation; `failover` added to the `run.delivered`
  cause list; pending steers and notices join the switch host message; a pick stores its resolved
  effort and a first send stores its resolved selection; a selection revision decides the hold, so a
  same-role re-pick wins; any admission drops an expired or invalid hold; a compaction request never
  switches; a switch segment runs the pre-step compaction check; the waiting-Run switch in the
  Chat-then-Run lock order with a woken job; the Continue-next opening in the admission transaction;
  error order per path; `selected_effort` writers; `hintMs` plumbing; the D13 map at both assembly
  points with a suffix inside 40 characters and repeated own-model ids; rollback of the settings
  rewrite; MODIFIED `context-injection` and two more `run-steering` requirements; the negative
  isolation scenario; layers re-split so the API rename and its web callers merge together and the
  in-worker switch ships with a test seam. Rejected: none.
- **r1 (2026-11-23):** two reviewers (spec consistency; feasibility against code). 2 P0, 23 P1, 24
  P2. Fixed: one order for an omitted effort; `runs.selected_effort` for Q4; the switch is a delivery
  with cause `failover` re-entered with a new client; closed reply `failed`; the four decision
  points; the waiting-Run switch in the API transaction; the Continue-next opening; the hold carries
  its selector and yields to an owner pick; selection writers listed; pending items and jobs store
  selectors; `latestRun.selector`; compaction Runs never switch; the quota cell beyond the wait cap;
  the `failover` dedupe; reasoning keyed on the reply; the 503 case; a stored selector that left the
  config; tool-call ids at 40 characters with one map per request; the RLS window; the route under
  `/api/v1/runs`; `next_candidate_unavailable`; MODIFIED `run-steering`, `background-jobs`, two more
  `turn-actions` and one more `provider-failures` requirements; ADR wording; layers split. Rejected:
  none. Kept as reading: the `available-models` opaque-id scenario.
- **r0 (2026-11-23):** initial draft.
