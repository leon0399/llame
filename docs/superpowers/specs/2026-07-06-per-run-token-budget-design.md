# Per-run token budget enforcement (#91)

## Objective

A run currently has no ceiling on model spend: a single call can generate an
unbounded amount of output, and — once the tool-calling loop lets a run take
multiple steps — a run can re-send a growing context step after step with no
bound on cumulative tokens. Add two independent, opt-in caps, both resolved
through the config resolver (#46) and snapshotted onto the run row at creation
(`runs.config_snapshot`), so a mid-flight config change can never re-budget a
run already executing:

- `run.maxOutputTokens` — a per-CALL output-token ceiling, enforced by the
  provider (`streamText({ maxOutputTokens })`); the spend ceiling holds even if
  our own callbacks never run.
- `run.maxRunTokens` — a CUMULATIVE total-token ceiling across the tool loop's
  steps. Each step re-sends the growing context, so `maxSteps × maxOutputTokens`
  badly under-counts real BYOK spend; this bounds the run's actual token cost.

Aligned with `/agents-best-practices` ("a measurable done condition / budget").

## Design

Opt-in, config-driven (unset = no cap) for both — no default that could
truncate a legitimate long run before real-world tuning (a default + a
user-facing "run limit" setting are follow-ups).

- `config-resolver/effective-config.ts`: `snapshotMaxOutputTokens` /
  `snapshotMaxRunTokens` narrow `runs.config_snapshot` → the two caps, mirroring
  the existing `snapshotMaxSteps` accessor.
- `config-resolver/config-resolver.service.ts`: the instance layer reads
  `RUN_MAX_OUTPUT_TOKENS` / `RUN_MAX_RUN_TOKENS` from env, same pattern as
  `RUN_MAX_STEPS` — org/user/chat scope config rows can still override either.
- `runs/run-budget.ts`: `RunBudget = { maxOutputTokens?, maxRunTokens? }`;
  `readRunBudget(configSnapshot)` reads both (returns `null` only when NEITHER
  is set — the `maxRunTokens`-only path is not gated on `maxOutputTokens`).
  `isBudgetExceeded` ORs two independent breach checks:
  - `isOutputBudgetExceeded` — primary signal is the provider's `finishReason
'length'`; a usage fallback covers a vague finish, but deliberately never
    fires on a clean `'stop'` (landing exactly on the cap is completion, not a
    breach).
  - `isRunTokenBudgetExceeded` (exported separately so the run's failure
    surfacing can tell which cap fired) — fires when cumulative
    `totalTokens >= maxRunTokens` AND the finish was a CUT, i.e.
    `finishReason !== 'stop'` (mirrors the same "natural finish at the cap is
    completion" nuance).
- `models/step-budget.ts`: pure helpers for the model client's `stopWhen`
  (`sumStepTotalTokens`, `runTokenCapReached`) — kept in the models layer (the
  client owns the AI SDK loop) and free of any `ai` import so they're trivially
  unit-tested. No `models → chats/runs` import edge.
- `models/model-client.ts`: `ModelStreamInput` gains `maxOutputTokens?` and
  `maxRunTokens?`; `onFinish` gains `totalUsage?` (the SDK's CUMULATIVE usage
  across all tool-loop steps — optional so single-step fakes may omit it).
- `models/openai-model-client.ts`: forwards `maxOutputTokens` unconditionally
  when set. `stopWhen` becomes an ARRAY `[stepCountIs(maxSteps),
cumulativeCap]` when `maxRunTokens` is set (+ tools present) — the AI SDK v6
  `stopWhen` array is OR'd, so the loop stops on EITHER condition.
  `cumulativeCap = ({ steps }) => runTokenCapReached(maxRunTokens, steps)`
  stops the loop BEFORE the next step once cumulative tokens cross the cap.
- `runs/run-execution.service.ts`: the claim reads `readRunBudget` alongside
  the existing `snapshotMaxSteps`; the `budget` snapshot is forwarded to
  `streamText`. In `onFinish`, a breach (`isBudgetExceeded`) fails the run
  cleanly instead of completing it — partial output is still persisted (no
  corruption), a `run.budget_exceeded` event lands in the trace (between
  `model.completed` and the terminal `run.failed`) with whichever cap actually
  fired (`isRunTokenBudgetExceeded` decides the discriminant, so a run-token
  breach reports the run's cumulative total, never a hardcoded output-token
  message), and post-turn work (compaction, titling) is skipped — a run that
  just ran out of budget must not trigger further model spend.

## Testability

- `sumStepTotalTokens` / `runTokenCapReached` (unit): sums `totalTokens` across
  steps, missing/partial/null usage → 0 for that step, empty → 0; the stop
  predicate is true at/over the cap, false below.
- `readRunBudget` (unit): reads either cap independently from the config
  snapshot; `null` only when both are absent; floors fractional values;
  rejects non-positive/invalid values.
- `isBudgetExceeded` / `isRunTokenBudgetExceeded` (unit): output-cap breach on
  `finishReason 'length'` (+ vague-finish usage fallback), never on a clean
  `'stop'`; run-token breach fires when cumulative tokens are at/over the cap
  AND the finish was a cut, never on a clean `'stop'` even over the cap; the
  two checks are independent (a `maxRunTokens`-only budget breaches without
  `maxOutputTokens` set, and vice versa).

## Non-goals (named)

- A cost ($) cap — token first (cost = tokens × price; a token cap bounds
  cost). Tracked as a follow-up once cost accounting lands (issue #37).
- A default cap value + a user-facing "run limit" setting — config/governance-
  set for now (a default risks truncating legit runs before tuning).
- Aborting mid-generation — `stopWhen` stops BEFORE the next step, not
  mid-stream.
- Capping single (non-tool) generations against `maxRunTokens` — the
  cumulative cap is a multi-step tool-loop concern; `maxOutputTokens` already
  bounds a single generation.
- Clamping a lower scope's cap to a higher scope's ceiling (an org/user/chat
  config can currently RAISE, not just narrow, an ancestor scope's budget —
  the generic config-layer merge is later-wins with no min/max strategy for
  numeric fields yet). Flagged as an open review question, not fixed here —
  see the PR description.

## Revision history

- **v1 (2026-07-06):** Initial (carved from a design-review round that
  verified the mechanism against `ai@6` source — `stopWhen` accepts an array,
  OR'd; `onFinish.totalUsage` is exactly the stop predicate's cumulative sum,
  so stop ⇔ detect with no off-by-one — and fixed three issues before ship:
  the `maxRunTokens`-only path was gated on `maxOutputTokens` being set, the
  model-client `onFinish` seam needed `totalUsage`, and `run.budget_exceeded`
  was hardcoded to output-token wording for a run-token breach).
