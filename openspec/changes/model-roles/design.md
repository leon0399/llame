## Context

See proposal.md for the motivation. Facts below were read at `214390e4e` (master after #1898).

- A Run holds one model for its whole life: `runs.model_id` is `NOT NULL` and fixed at accept time
  (`apps/api/src/db/schema/chats.ts:409`). The worker re-executes it verbatim.
- No Chat column stores a selection. The web restores the picker from the last turn's usage
  (`apps/web/app/(chat)/components/use-chat-engine.ts:199-236`).
- Admission resolves the model, then the effort, then the permission mode
  (`apps/api/src/models/models.service.ts:91-114,148-166`); `run-creation.ts:62-108,160-189`
  writes the Run. Continue takes `latestRun.modelId` and the stored effort
  (`follow-up-admission.service.ts:326-374,566-577`); Regenerate must name `modelId` (`:381-423`).
- Pending items carry `ChatDeliverySettings { modelId, effort?, permissionMode }`
  (`apps/api/src/db/schema/chat-deliveries.ts:37-42`); jobs carry the settings of their Run
  (`chat-jobs.ts:88-89`). Queue promotion and job-notice Runs reuse them
  (`runs/queue-promotion.ts:115,171`, `runs/job-notice-run.service.ts:216-235`).
- The failure seams: the closed class set (`models/provider-failure/provider-failure.ts:1-16`),
  `retryable()` and `MAX_SENDS = 11` (`models/request-recovery.ts:24,66-83`), the quota-wait decision
  (`runs/quota-wait.ts:16`, `runs/run-wait.service.ts:125`), the failed-send continuation
  (`runs/run-execution.service.ts:1052-1058,5117-5183`), the cut (`:3779-3806`), and the two terminal
  writes: a synchronous throw (`:6408-6440`) and `settleErrorOutcome` (`:3811-3881`).
- A delivery opens a segment: `moveRunToDelivery` mints an `attemptId`, moves `runs.message_id`, and
  appends `run.delivered` (`runs/segment-delivery.ts:84-123`); `segment-delivery-close.ts:293-336`
  closes the reply. Receipts are unique per `(owner, run, attempt)`
  (`db/schema/system-prompt-receipts.ts:44-50`).
- The model-switch item is staged by the worker on the triggering user message
  (`run-execution.service.ts:10790-10998`, `chats/context-item-producers.ts:258-340`), with the
  template `chats/prompts/effective-context-change.md`.
- Reasoning replays only when `usage.modelId` equals the request model
  (`chats/context-builder.ts:640-660,728-748`). No code normalizes tool-call ids; ids are replayed
  verbatim from `models/stream-parts.ts:91-109`.
- `billing` is `usage | subscription` in the schema (`llame.config.schema.json:367-371`), the type
  (`models/model-client.ts:34-35`), and the web parser (`message-usage.tsx:155-158`).
- Config is validated by the published JSON Schema, then re-resolved in `config-loader.ts`
  (`:157-185` defaults, `:3660-3891` models).
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

- One selector grammar from request to Run to Chat, with the served model recorded apart from it.
- A model switch that reuses the segment machinery of in-Run steering, with no new Run state.
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
`selector`. Admission resolves it in one function that returns `{ selector, modelId, effort }`. The
Run gains `selector text NOT NULL`. `runs.model_id` keeps its meaning: the model of the current
segment. Validation codes stay `model_not_available` and `effort_not_available`, so existing client
error handling still applies. A request that still names `modelId` gets 400 from the closed DTO.

The same name moves into `defaults.selector` and `defaults.titleGenerationSelector`. The schema is
closed, so the old keys fail as unknown keys with their path in the error. Rejected: keeping
`modelId` for selectors (grilling Q3 A), because a request `modelId` and a usage `modelId` would mean
different things.

### D3: The Chat stores a selection document

`chats.model_selection jsonb NULL` holds
`{ selector, effort, hold?: { modelId, effort, revertAt } }`. The admission transaction that creates
a Run writes it under the Chat row lock that single-flight admission already takes, so two sends
cannot interleave. RLS is the existing owner policy of `chats`; no new table is added. The Chat read
DTO returns it. A send with `selector` clears `hold`; a send without `selector` and with `effort`
updates `hold.effort` when a hold exists, or `effort` otherwise (grilling Q5 A).

### D4: Hold and return to the primary

The transaction that opens a switch (D6) writes `hold`. `revertAt` is `failure.resetsAt`, else
`now + failure.hintMs`, else `now + 5 min`. `auth` and `billing` carry no reset, so they get 5 minutes
(#1762). Admission compares `revertAt` with the database clock. A Run past `revertAt` clears the hold
and resolves the role again; the existing worker comparison against the previous reply then stages
the cause-`model` switch item, so the owner and the model both see the return. A live Run never
reads the hold again.

### D5: Effort after a switch

A pure function takes the Run effort, the new model's declared levels, and the candidate effort, and
returns the first that applies: the Run effort if declared, the candidate effort, the model default,
or none. The switch writes it to `runs.effort` and to the hold (grilling Q4).

### D6: One switch primitive for owner and policy

`switchRunModel(run, failure, cause)` runs in one fenced transaction:

1. apply the existing failed-send cut, so the reply keeps parts through the last settled tool part;
2. close the reply (`closeReply`), with its usage on the old model;
3. store a host message with one `effective-context-change` item, cause `failover`, from a new
   packaged template;
4. set `runs.message_id`, `runs.model_id`, `runs.effort`, a new `activeAttemptId`;
5. write the Chat hold;
6. append `model.switched { fromModelId, toModelId, failureClass, messageId, cause }`.

The attempt then continues in the same worker without a new claim, as a delivery does. The request
retry count and the wait count restart, as after a delivery (`provider-failures` "Some events end the
counts of the next step"). The host message makes the existing per-reply rules (reasoning replay,
usage, badge, receipts) work unchanged. Rejected: a model id on every part (ADR "A model switch
within a Run opens a new segment").

The fixed text of the item:

```text
The active model changed during this Run, because <prior model> failed: <failure label>.
You are now <new model>.
Some tool calls before this point can have taken effect. Check their results before you repeat any of them.
Follow the current system instructions and continue the task.
```

The model names render as in the cause-`model` item; the failure label is the plain-language label
of the `provider-failure` notice.

### D7: Continue on next candidate

- **Failed Run:** `POST /chats/:chatId/messages/:messageId/runs` with
  `{ action: "continue", candidate: "next" }`. Admission computes the next candidate from the role's
  current config and the failed Run's `model_id`, then creates a Continue Run with the role selector
  and the new model. Its dispatch applies the Continue cut to the failed reply and opens its first
  segment through D6 with cause `owner`, so the failed reply keeps its own usage and a new reply
  follows the host message.
- **Waiting Run:** `POST /chats/:chatId/runs/:runId/next-candidate`. It is a waker of
  `awaiting_quota`: it bumps `wakeGeneration` and enqueues the Run with a wake cause
  `next_candidate`. The woken worker calls D6 in place of the re-send. The deadline job then finds a
  stale generation and does nothing.
- **Paid label:** the web reads `paid` from the role catalog (D9). The owner path never skips
  (grilling Q6 B).

### D8: Pending items store selectors

`ChatDeliverySettings` and the job settings replace `modelId` with `selector`. Queue promotion and
job-notice Runs call the admission resolver at start, so a hold written by the live Run applies to
the next item. A job records the origin of its Run (D10) for its notice Run.

### D9: Catalog and picker

`GET /api/v1/models` adds `roles: [{ selector, candidates: [{ modelId, effort?, paid }] }]` and
renames `defaultModelId` to `defaultSelector`. `paid` is `resolvedBilling === "usage"`; no other
billing field is published. The picker lists roles, then models; a held Chat shows
`@coding → sonnet until 14:00`. The effort picker offers the levels of the resolved model (primary
or held). After a pick, the next send names `selector`; later sends omit it.

### D10: Run origin (cutover 2)

`runs.origin` is an enum `owner | agent`, default `owner` in the migration, written by every Run
creator. A job stores its Run's origin; its notice Run copies it. Nothing writes `agent` until
subagents ship; the failover tests insert an `agent` Run directly.

### D11: Failover policy (cutover 2)

One pure function `policyCell(role, origin, failureClass)` merges the role matrix over the instance
default cell by cell and maps the class to its group. The worker calls it at the two terminal seams
(D-context), after `retryable()` says no and before the quota-wait decision:

- `quota` cell `off`, or no next candidate: the existing quota wait or failure.
- `on`, or `switchAfterSeconds` below the time to reset: D6 with cause `policy`.
- the paid skip walks forward past `usage` candidates when leaving a `subscription` or `free`
  model and the role lacks `allowPaidFallback`.

The worker reads the live config object, so a restart with a new policy applies to the next
failure only (grilling Q7 A).

### D12: Title generation through a role (cutover 2)

The title service resolves the selector; for a role it loops over the candidates in order, skips
gated paid ones, and stops at the first usable title. It writes no hold and never enters a quota
wait. Cutover 1 resolves a title role to its primary only. The ADR
[A title call walks its model role's chain](../../../docs/adr/2026-11-23-a-title-call-walks-its-role-chain.md)
records the exception to the opt-in rule.

### D13: Tool-call id normalization

The context builder maps each replayed tool-call id per request: keep an id that matches
`^[a-zA-Z0-9_-]{1,64}$`; otherwise replace each other character with `_`, truncate to 55 characters,
and add `_` plus a 8-character hash of the original. A collision within the request gets a numeric
suffix in stored order. Stored parts, `tool_artifacts`, and `chat_jobs` keep the original id.

### D14: Migration

One Drizzle migration with a hand-written data step:

1. add `chats.model_selection`, `runs.selector`, and (cutover 2) `runs.origin`;
2. set `runs.selector = runs.model_id`, then `NOT NULL`;
3. set each Chat's selection from its latest turn Run (`model_id`, `effort`), with no hold;
4. rewrite `modelId` to `selector` in `chat_deliveries.settings` and `chat_jobs.settings`.

Nothing is deleted, so Leo's running instance keeps every Chat. Rollback is a forward migration that
drops the columns; the data in them is derived.

## Risks / Trade-offs

- [The config rename breaks every operator file] → startup names the unknown key; CHANGELOG and the
  operator docs carry a **Breaking** note with the two renames.
- [The API rename breaks old web bundles during deploy] → the web and API deploy together; an old
  bundle that sends `modelId` gets 400, not a silent wrong model.
- [A switch to a smaller window needs a source-model compaction on the model that just failed] → the
  existing `context_incompatible` failure applies; the owner can pick a larger model. Context
  promotion (C4) is out of scope.
- [A tool call of the failed step can have taken effect] → only settled calls stay; the switch
  reminder tells the model to check results before it repeats them.
- [An `agent` origin has no producer yet, so the matrix column is untested in production] → the
  integration tests insert `agent` Runs directly; subagents (#765) add the producer.
- [A hold copied into an owner fork can point at a model that a later config removed] → admission
  validates the resolved model, and a removed model clears the hold and falls back to the primary.

## Migration Plan

1. Operators rename `defaults.modelId` to `defaults.selector` and
   `defaults.titleGenerationModelId` to `defaults.titleGenerationSelector`.
2. Deploy API, worker, and web together; run `pnpm db:migrate`.
3. Roles and the failover matrix are optional; a config without them behaves as before, apart from
   the new names.

## Open Questions

None that change the specs or the task split.
