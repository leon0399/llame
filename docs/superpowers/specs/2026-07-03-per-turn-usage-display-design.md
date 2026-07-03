# Per-turn usage & cost transparency

## Objective

Surface the per-turn telemetry that llame already computes and persists — tokens
(in/out/cached/reasoning), latency, model, and `costUsd` — on each assistant
message. For a BYOK tool (users pay per token) this is real cost transparency,
and it makes the instrumented-but-invisible telemetry/budget work (#91) visible.
Well-integrated (surfaces existing data), user-visible, not gated.

## What already exists (the data)

- `buildTurnTelemetry` (`turn-telemetry.ts`) computes a `TurnTelemetry`
  `{ inputTokens, cachedInputTokens, outputTokens, totalTokens, reasoningTokens?,
  model, provider, latencyMs, finishReason, status, costUsd }` (costUsd from a
  price map; null when the model isn't priced).
- It is persisted on the assistant message's `usage` (`recordAssistantTurn`) and
  returned by `GET /chats/:id/messages`.
- A `model.completed` run-event is emitted at completion (previously
  `{ usage, finishReason }`).

So this is a DISPLAY feature; the numbers exist.

## Design

### Live path (backend)

- Enrich `model.completed` to also carry the full `telemetry`. The bridge
  translates `model.completed` → an AI SDK v6 **`message-metadata`** UI chunk
  `{ messageMetadata: { usage: telemetry } }` — `useChat` lands it on
  `message.metadata`. No terminal effect; a legacy event without `telemetry`
  emits nothing. Persisted event → shows live AND on resume/replay.

### History path (web)

- `toChatUiMessages` carries the message's `usage` into `metadata: { usage }`,
  so historical assistant turns expose the SAME shape as the live path. One
  render path reads `message.metadata.usage`.

### Display (web)

- `MessageUsage` — a discreet muted footer under an assistant message:
  `[«label» ·] «total» tokens · ~«cost» · «latency»`, with the token breakdown
  (in / cached / out / reasoning · model) on hover (`title`).
  - Cost is prefixed `~` (estimate — from the built-in price map, not real BYOK
    billing) and OMITTED when `costUsd` is null/absent — never `$0`.
  - Latency renders `«N»ms` under 1s, else `«N.N»s`.
  - `«label»` (`usageStatusLabel`, a pure helper) prefixes `stopped` for an
    `aborted` turn / `error` for an `error` turn, so a partial (real but
    cut-short) usage line isn't misread as a finished answer — a stopped
    generation goes through `onFinish` with `status:'aborted'` and DOES carry
    partial tokens/cost. Completed turns are unlabeled.
  - Renders nothing when there is no real token data (legacy `{ status }`-only
    rows, or `totalTokens === 0`).
- `parseTurnUsage(metadata)` — a pure parser from the opaque
  `metadata.usage` (Record) to typed fields, tolerant of missing/legacy fields.

## Reference alignment (OWUI / opencode / ai-chatbot)

- OWUI shows a discreet per-message usage line/tooltip (tokens, tokens/sec,
  response time) from stored response metadata — a footer, not a modal.
- The MVP mirrors that: discreet, hover-for-detail, honest about unknown cost.
- (Confirm exact fields/placement against the pending research; adjust the
  footer copy if it recommends otherwise.)

## Testability

- Bridge unit: `model.completed` with telemetry → a `message-metadata` chunk
  (usage passthrough), non-terminal; without telemetry → no chunk.
- Web unit: `parseTurnUsage` (full telemetry; null cost; legacy `{ status }`;
  non-object). `toChatUiMessages` carries usage → metadata (existing test
  updated).
- Existing suites green: submit/regenerate unaffected (additive event field +
  additive UI chunk).

## Honesty & edge behavior (from review)

- **Cost is an ESTIMATE, labeled.** `costUsd` comes from a small built-in price
  map keyed by model id — it is NOT the user's real BYOK billing (a proxy or a
  different tier could differ). The UI prefixes it `~` to signal an estimate;
  it's shown only when the model is priced (null → hidden, never `$0`).
- **Stopped vs error turns (corrected in review).** A user STOP goes through
  `onFinish` with `status:'aborted'` and DOES emit `model.completed` with the
  partial (real) tokens/cost — so it shows a footer, LABELED `stopped`, not
  misread as final. A stream ERROR goes through `onError` (emits `run.failed`,
  not `model.completed`, with `usage:null` → 0 tokens) → no footer. The
  budget-exceeded path emits `model.completed` before `run.failed`, so its
  (real, up-to-the-cap) usage also shows.
- **Live == history shape.** Live metadata is `{ usage: telemetry }`; history
  metadata is `{ usage: message.usage }` where `message.usage` IS the same
  persisted `telemetry` — byte-identical, one render path.
- **No SSR hydration mismatch:** the chat list is client-rendered (useChat), and
  number formatting pins `en-US`.

## Non-goals (named)

- A full run inspector (policy-decision trace, tool-call timeline, memory
  provenance) — a larger follow-up; this is the cost/usage slice only.
- Model pricing beyond the existing tiny price map (OpenRouter catalog sync #84
  would populate `costUsd` for more models) — the UI already handles null cost.
- Aggregate per-chat / per-user cost rollups.

## Revision history

- **v2 (2026-07-03):** Round-1 review. Primary reviewer CONVERGED (bridge
  protocol/non-terminal/attachment/replay verified against AI SDK v6 source).
  Adversarial P1s fixed: a stopped (`aborted`) turn does emit `model.completed`
  with partial usage → now LABELED `stopped` (`usageStatusLabel`, tested) so
  it's not misread as final; the Display contract was made accurate to the
  shipped code (`~` cost estimate, `ms`/`s` latency). Documented the
  budget-exceeded usage-still-shows path. Confirmed clean: cost arithmetic
  (cached discount, no double-count), no metadata leakage, live==history shape,
  no SSR hydration mismatch (`en-US` pinned).
- **v1 (2026-07-03):** Initial.
