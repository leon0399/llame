# Surface why a reply ended — budget/length truncation & content filtering

## Objective

Per-run budgets (#91) are ENFORCED — the run loop caps output tokens
(`maxOutputTokens`) and tool-loop steps (`maxSteps`), and a breach persists
`finishReason: 'length'` in the turn telemetry (plus a `run.budget_exceeded` run
event). But it is INVISIBLE to the user: a reply truncated at the token budget
just stops mid-sentence, its footer still reads a plain "completed"-looking
usage line. Same for a `content-filter` stop. Surface it — when a turn ended
abnormally, the per-turn footer says so. This completes #91's enforcement with
the transparency half, via the same architecture-to-UX lever that made
compaction-surfacing and model-labels valuable. Client-only: `finishReason` is
already persisted in `messages.usage` (`recordAssistantTurn` stores the full
`TurnTelemetry`), the web just never read it.

## Design

- `parseTurnUsage` (message-usage.tsx): extract `finishReason` (a string) from
  the telemetry, alongside the existing fields.
- Pure `finishReasonLabel(finishReason)` → a short user-facing label, or null for
  a normal end:
  - `'length'` → `"length limit"` (the reply was truncated at the output-token
    budget or the model's own max — both surface as `length`; see non-goals).
  - `'content-filter'` → `"content filtered"`.
  - `'stop'`, `'tool-calls'`, `null`, anything else → null (normal completion).
- `buildUsageLine` picks ONE abnormal-end label — `usageStatusLabel(status) ??
  finishReasonLabel(finishReason)` — so a stopped/errored STATUS always wins over
  a finish reason and they are MUTUALLY EXCLUSIVE (never a confusing "stopped ·
  length limit" combo). The model leads the line, then this label, then the token
  parts — e.g. `GPT-4o · length limit · 512 tokens`. A genuine budget/length
  truncation is `status: 'completed'` (the status is fixed before the breach is
  computed), so it correctly shows "length limit" on its own.

## Testability

- `finishReasonLabel` (unit): `length` → label; `content-filter` → label; `stop`
  / `tool-calls` / `null` / unknown → null.
- `buildUsageLine` (unit): a `length` turn shows "length limit" before tokens; a
  normal `stop` turn does not; an aborted turn carrying `finishReason: 'length'`
  shows only "stopped" (status precedence).
- `parseTurnUsage` (unit): extracts a string `finishReason`, drops a non-string.

## Non-goals (named)

- Distinguishing a per-run BUDGET truncation from the model's OWN default-limit
  truncation — both persist `finishReason: 'length'`, and the client can't tell
  without the run's budget (not exposed to it). A future step could expose the
  effective budget to say "stopped at the N-token budget" specifically.
- Surfacing a tool-loop STEP-cap (`maxSteps`) stop — there is no distinct
  persisted signal (a `tool-calls` finish is normal too), so it can't be
  reliably surfaced from the message telemetry alone. Follow-up.
- The `isBudgetExceeded` FALLBACK path (primary-review P2): when a provider
  reports a vague `finishReason` (`other`/`null`) but `outputTokens >= the cap`,
  the run is marked budget-exceeded server-side yet the persisted
  `finishReason` is NOT `length` — so this label shows nothing and that breach
  stays invisible. The client can't detect it (the cap isn't exposed to it);
  closing it needs a distinct persisted signal (e.g. a `budgetExceeded` telemetry
  flag) or exposing the effective budget. Low real-world exposure (the current
  OpenAI provider reports `length` correctly). Follow-up.
- Surfacing the live `run.budget_exceeded` run event during streaming — the
  persisted `finishReason` is the reload-stable signal this uses instead.
- Retroactively labelling historical turns whose telemetry predates
  `finishReason` (they simply show no label).

## Revision history

- **v3 (2026-07-03):** Primary reviewer (landed after v2). It re-verified the
  full persistence chain incl. the HTTP hop (`usage` is an opaque
  `Record<string, unknown>` — `finishReason` survives) and found one new P2: the
  `isBudgetExceeded` vague-`finishReason` fallback path isn't surfaced (added as a
  named non-goal — the client can't detect it without the cap). Its P1 (co-exist
  vs precedence) was already fixed in v2.
- **v2 (2026-07-03):** Round-1 review (on the shipped code). The adversarial
  reviewer verified the substance is correct: `content-filter` is reachable
  (`openai.chat` maps `content_filter`), live + reload carry identical telemetry
  (same object from `onFinish`), and the status/finish-reason collision is
  impossible. Doc fixes: the "labels can co-exist" claim was wrong — they are
  MUTUALLY EXCLUSIVE via `??` (status precedence); "before the model/token parts"
  → "before the token parts" (model leads); and added the `parseTurnUsage`
  finishReason test the Testability section named.
- **v1 (2026-07-03):** Initial.
