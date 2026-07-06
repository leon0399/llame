# Reasoning persistence — thinking survives a reload

## Objective

llame streams a reasoning model's "thinking" live and replays it on run-resume
(from the run-event log), but DELIBERATELY does not persist it in the assistant
message parts (`run-execution.service.ts:452-454`) — so after the run ends, a
later page reload (which loads message history from the DB, not run-events)
shows NO reasoning. It vanishes. Persist it, so thinking is durable — matching
our stack template (Vercel `ai-chatbot` persists reasoning parts and renders
them from history via `message-reasoning.tsx`).

The original intent — *reasoning is NEVER re-fed to the model* — is preserved by
a different mechanism: persist the reasoning part for DISPLAY, but strip it from
the context sent to the model. (The current mechanism achieves "never re-fed" by
simply not persisting; we keep the guarantee while gaining persistence.)

## Design (backend only — the web already renders it)

The web already renders `reasoning` parts from `message.parts` on the SAME path
for live and history (`chat-page.tsx:313` → `MessageReasoning`). So this is
backend-only:

1. **Persist** (`run-execution.service.ts`): accumulate the full reasoning text
   across the turn — appending each `onReasoningDelta` chunk to a string (NOT the
   SDK's `onFinish.reasoningText`, which is only the FINAL step's reasoning and
   would drop step-1 thinking on a multi-step tool turn) — and in `onFinish`
   include it as a leading `reasoning` part via `assistantParts(reasoning, text)`:
   `[{ type: 'reasoning', text }, { type: 'text', text }]` (reasoning part only
   when non-empty; text part always, as today). **Capped** at
   `REASONING_PERSIST_MAX` (24k chars) so an unbounded blob doesn't amplify every
   later turn's context read (each build reads ALL message parts, then discards
   reasoning — the real cost, on the single shared connection).
   - **Abort scope (review correction):** the COMMON event-driven abort path
     goes through `onError` (`parts: []`), NOT `onFinish` — so a normally-aborted
     turn persists no reasoning (exactly as it persists no partial text today; no
     NEW inconsistency). Only turns reaching `onFinish` — normal completion and
     the narrow generation-finishes-as-abort-fires race — get the reasoning part.
     The `onError` path stays `parts: []`, unchanged.
2. **Never re-feed** (`context-builder.ts`): `partsToText` FILTERS OUT reasoning
   parts (today it `JSON.stringify`s any non-text part into the context — which
   would re-feed reasoning as JSON garbage). A `ReasoningPart` type is added to
   the `MessagePart` union for a typed narrow. `buildContext` calls `partsToText`
   per message and is the ONLY production path from stored parts → model input;
   compaction also uses `partsToText`, so reasoning is out of summaries too.
   - **Second model-visible surface (adversarial P1):** `search_conversations`'s
     `snippetOf` reads `.parts` directly and returns a snippet as a TOOL RESULT
     (re-enters the model). It is safe by construction — a text-only allowlist —
     and now carries a comment forbidding widening it to reasoning. The SQL search
     (`chats-repository.ts`) likewise matches `type='text'` only. Invariant named,
     not left implicit.
3. Update the stale `run-execution.service.ts:452-454` comment.

## Reference (Vercel ai-chatbot — our exact stack)

Persists reasoning parts and renders them on reload (`message-reasoning.tsx`,
`components/chat/message.tsx`). Confirms the persist-and-display pattern for our
stack; llame's non-persistence is the divergence being corrected.

## Testability

- `partsToText` unit: a `reasoning` part is EXCLUDED from the text (never
  re-fed); text parts pass through; unknown parts still JSON-serialised.
- Integration (run-execution or a focused persist test): a turn that streamed
  reasoning persists an assistant message whose parts include a `reasoning` part
  before the `text` part; a turn with no reasoning persists text only (no empty
  reasoning part).
- Context: a stored assistant message with a reasoning part yields model context
  that does NOT contain the reasoning text.
- Existing run-execution / reasoning-ordering suites stay green.

## Non-goals (named)

- Per-segment reasoning interleaving (one consolidated reasoning block before the
  text is enough for display; the live stream already shows ordering).
- Re-feeding reasoning to the model / provider-native thinking-block continuation
  (Anthropic signed thinking blocks, etc.) — explicitly NOT done; reasoning stays
  display-only.
- Persisting partial reasoning on the true-error/abort path (`onError` stays
  `[]`) — a normally-aborted turn shows no reasoning on reload, same as it shows
  no partial text today.
- Per-segment reasoning ordering AND tool-call structure on reload: neither
  tool-call nor tool-result parts are persisted in `message.parts` today
  (`onFinish` writes text only), so a multi-step tool turn ALREADY collapses on
  reload — reasoning consolidation is consistent with that pre-existing behavior,
  not a new loss. A projection-based context read (not loading reasoning at all
  for context) is the real read-amplification follow-up beyond the cap.

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial). Verifier P1: the
  "onFinish covers aborted turns" claim was contradicted by two e2e tests — the
  common abort is `onError`→`parts:[]`; scoped the claim (code was already
  correct — only the comment overclaimed). Adversarial P1s: named
  `search_conversations`/SQL-search as a second model-visible `.parts` surface
  (safe text-only allowlist, now commented) and added a `REASONING_PERSIST_MAX`
  cap for the per-turn read-amplification. Documented manual-accumulation (vs the
  SDK's final-step-only `reasoningText`) and the pre-existing tool-structure
  collapse-on-reload. Double-render-on-resume cleared against the useChat hook
  internals (seeds once per id).
- **v1 (2026-07-03):** Initial.
