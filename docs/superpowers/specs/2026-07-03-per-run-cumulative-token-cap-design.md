# Per-run cumulative token cap (complete #91's tool-loop budget)

## Objective

#91's per-run budget applies a per-CALL `maxOutputTokens` and a `maxSteps` loop
cap, but NOT a cumulative cap across the tool loop's steps — `run-budget.ts` itself
notes the token/cost caps "join when the tool loop (v0.7) and cost accounting
(v0.4) give them something to bite on." Both now exist (loop-2 shipped the tool
loop + cost accounting), so add the piece the comment deferred: a CUMULATIVE
total-token cap for a run. Each tool-loop step re-sends the growing context, so
`maxSteps × maxOutputTokens` badly under-counts real BYOK spend (input dominates);
a cumulative cap bounds the run's actual token cost and stops the loop cleanly.
Aligned with /agents-best-practices ("a measurable done condition / budget").

## Design

Opt-in, config-driven (null = no cap) — consistent with the existing
`maxOutputTokens`/`maxSteps`; no default that could truncate a legitimate long
run before real-world tuning (a default + a user-facing setting are follow-ups).

- `run-budget.ts`: `RunBudget` gains `maxRunTokens?`; `readRunBudget` reads it
  (via a new `snapshotMaxRunTokens`). A pure `sumStepTotalTokens(steps)` helper
  (sums each step's `usage.totalTokens`, treating missing as 0).
- `config-resolver/effective-config.ts`: `snapshotMaxRunTokens(snapshot) =
  positiveInt(section(snapshot,'run')?.maxRunTokens)` — parallel to
  `snapshotMaxSteps`.
- `model-client`: `ModelStreamInput.maxRunTokens?`; `openai-model-client`'s
  `stopWhen` becomes an ARRAY `[stepCountIs(maxSteps), cumulativeCap]` when
  `maxRunTokens` is set (+ tools present). `cumulativeCap = ({ steps }) =>
  sumStepTotalTokens(steps) >= maxRunTokens` — stops the loop BEFORE the next step
  once the run's cumulative tokens cross the cap (bounds to cap + at most the
  crossing step).
- `run-execution.service.ts`: pass `budget.maxRunTokens` to `streamText`; in
  `onFinish` destructure `totalUsage` (cumulative, already provided by the AI SDK)
  and pass `totalTokens: totalUsage.totalTokens` to the breach check.
- `isBudgetExceeded`: also breach when `maxRunTokens` is set and cumulative
  `totalTokens >= maxRunTokens` AND the finish was a CUT (not a clean `'stop'` —
  a tool-loop cut reports `finishReason 'tool-calls'`; a natural finish exactly at
  the cap is completion, not a breach — mirrors the existing `maxOutputTokens`
  nuance). Surfaces via the existing budget/finish-reason UI (loop-2).

## Testability

- `sumStepTotalTokens` (unit): sums totalTokens; missing/partial usage → 0 for
  that step; empty → 0.
- The cumulative stop predicate (unit): true at/over the cap, false below.
- `isBudgetExceeded` (unit): cumulative breach fires when `totalTokens >= cap` +
  `finishReason 'tool-calls'`; does NOT fire on a clean `'stop'` at the cap; the
  existing `maxOutputTokens` cases unchanged.
- `readRunBudget` (unit): reads `maxRunTokens` from the snapshot; null when absent.

## Non-goals (named)

- A cost ($) cap — token first (cost = tokens × price; a token cap bounds cost).
- A default cap value + a user-facing "run limit" setting — config/governance-set
  for now (a default risks truncating legit runs before tuning).
- Aborting mid-generation — `stopWhen` stops BEFORE the next step.
- Capping single (non-tool) generations — `maxOutputTokens` already bounds those;
  the cumulative cap is a multi-step-loop concern.

## Revision history

- **v2 (2026-07-03):** Round-1 review verified the mechanism against `ai@6`
  source — `stopWhen` accepts an array (OR via `.some`), `onFinish.totalUsage` is
  literally `steps.reduce(addUsage)` (== the stop predicate's sum, so stop⇔detect
  with no off-by-one). Its three P1s: (a) the `maxRunTokens`-only path must not be
  gated on `maxOutputTokens` — handled here (`readRunBudget` returns a budget when
  EITHER is set; `isBudgetExceeded` ORs the two independent checks) + an explicit
  `maxRunTokens`-only test; (b) `ModelStreamInput.onFinish` widened with
  `totalUsage?` (optional so single-step fakes may omit it); (c) the
  `run.budget_exceeded` surfacing was hardcoded to output-token semantics — now it
  branches on `isRunTokenBudgetExceeded` and reports the RUN's cumulative total +
  the correct cap (a `maxRunTokens`-only breach no longer prints "undefined
  tokens"). Layering kept clean: the pure `sumStepTotalTokens`/`runTokenCapReached`
  live in `models/step-budget.ts` (no `models → chats` import edge). Discriminator
  is the negation `finishReason !== 'stop'` in both code and prose.
- **v1 (2026-07-03):** Initial.
