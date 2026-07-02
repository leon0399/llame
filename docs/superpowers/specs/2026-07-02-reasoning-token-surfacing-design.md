# Surface model reasoning (thinking) in the chat

## Objective

Reasoning models (o1/o3, Claude extended-thinking, deepseek-r1, …) emit a
"thinking" stream before their answer. llame captures ONLY `text-delta` today
(`openai-model-client.ts:60`) — reasoning is silently discarded. Surface it: the
user sees the model's reasoning live (and on resume of an in-flight run), which
is transparency/trust value and increasingly standard. Backend-only — the web
already renders `reasoning` message parts (`chat-page.tsx:282-287` via
`MessageReasoning`).

## Research-backed decisions (ai-chatbot, opencode, open-webui)

- **Persist as run-events, not ephemeral.** All three persist reasoning
  durably. llame's run-event log is already the durable, resumable record for a
  run, so reasoning rides it as `reasoning.delta` events — resumability for free.
- **Do NOT put reasoning in the assistant message parts (MVP).** The message
  stays text-only, so reasoning is (a) not in permanent chat history and (b) not
  re-fed to the model next turn. This is the safe path: my "stripping is the
  usual practice" assumption was WRONG (ai-chatbot re-feeds unconditionally;
  opencode re-feeds only when the SAME model+provider is active, demoting to
  plain text on a model switch because Anthropic thinking signatures are
  provider-bound). llame has heterogeneous BYOK (model can change between
  turns), so the naive re-feed is unsafe. The MVP keeps reasoning out of
  context entirely; **opencode's same-model re-feed + permanent-history display
  is a named follow-up**, not the MVP.
- **Access / the agents-best-practices "don't expose hidden reasoning" caveat.**
  That caveat targets SHARED/operational traces (other tenants, audit
  dashboards, agent-to-agent handoffs, exported artifacts). Reasoning here lives
  in a per-user, RLS-scoped run-event log, from a model call the user triggered
  with their own credentials — the "own chat" case the caveat isn't about. Real
  follow-up flagged by research: when chats become shareable in a project (v0.5),
  decide whether reasoning is visible to all members or only the author, and
  strip reasoning at any agent-handoff/skill/artifact boundary. Not an MVP
  concern (chats are user-owned today).

## Design (extends the existing delta → bridge → UI pipeline)

1. **Capture (both provider clients).** `onChunk` already maps `text-delta`;
   add `reasoning-delta` → `input.onReasoningDelta(chunk.text)`. New optional
   `onReasoningDelta` on `ModelStreamInput` (a narrow seam like `onTextDelta`).
2. **Persist (run-execution).** A second delta buffer coalesces reasoning
   (reusing the delta-buffer → no per-token row flood) and appends
   `reasoning.delta` `{ text }` run-events through the SAME serialized
   `deltaWrites` chain as `model.delta`/tool events — so reasoning, text, and
   tool events land in stream order. Two flush obligations, both required (each
   caught by a different reviewer):
   - **Before every `tool.call` and before the terminal events** (adversarial
     P0) — matching the existing text-buffer flush sites; else buffered
     reasoning (Anthropic think→tool→…) lands AFTER the tool events.
   - **Cross-flush on a modality switch** (verifier P0): at the top of
     `onTextDelta`, drain any buffered reasoning first; at the top of
     `onReasoningDelta`, drain any buffered text first. reasoning and text
     stream one at a time, so a sub-threshold reasoning tail before text would
     otherwise flush only at `onFinish` — landing AFTER the text. The
     opposite-buffer flush is a no-op once empty (cheap on the steady stream).
3. **Translate (bridge).** `reasoning.delta` → `reasoning-start` (first) /
   `reasoning-delta` UI chunks (a distinct reasoning part id). A reasoning part
   CLOSES (`reasoning-end`) before a text part, a tool part, or a terminal —
   generalize the existing "close the open text part before a tool" logic to
   "opening a text/tool/terminal closes the open reasoning part, and vice
   versa" so parts never interleave. `useChat` turns these into a `reasoning`
   message part.
4. **UI.** No change — `chat-page.tsx` already renders `part.type ===
   "reasoning"` via `MessageReasoning`.

## Testability

- Bridge unit (`run-stream-bridge.spec`): `reasoning.delta` → start/delta;
  ordered reasoning → text (reasoning closes before text opens); reasoning →
  tool; reasoning-only run closes on terminal. Pure state machine.
- Loop mechanism / executeRun integration (`MockLanguageModelV3`, like
  `memory-loop`): a mock emitting reasoning then text through the real
  `streamText` → assert `onReasoningDelta` fired and `reasoning.delta`
  run-events persisted in order before `model.delta`. No provider.
- Existing suites green: a model with no reasoning (the e2e mock, gpt-4o)
  emits none → no `reasoning.delta` events → today's behavior unchanged.

## Accepted consequences / non-goals (named)

- **Reasoning is ephemeral to a run (adversarial P1).** It's visible while the
  run's stream is live OR being resumed (the run-event log replays it) — but a
  full chat RELOAD after the run completes rebuilds history from `messages`
  rows, which are text-only, so the thinking block DISAPPEARS on a later reload.
  Accepted for the MVP (reasoning is most useful live); permanent display needs
  it in the message parts (below).
- Reasoning in permanent message history + opencode's same-model context
  re-feed (Anthropic thinking-with-tools continuity) — a distinct follow-up.
  **NOTE (adversarial P1):** the MVP captures `chunk.text` only, DROPPING
  `chunk.providerMetadata` (Anthropic thinking SIGNATURES). So the persisted
  `reasoning.delta` text CANNOT be replayed into a valid signed thinking block —
  the re-feed follow-up needs a different capture (raw reasoning parts +
  metadata), not just "turn on re-fed reasoning" against this MVP's stored text.
- Provider reasoning CONFIG (effort level, Anthropic `budget_tokens`,
  `sendReasoning` toggles) — capture what the provider emits; don't configure it.
- Shared-project reasoning visibility / access control (no shared chats yet).
- A reasoning UI redesign — reuse the existing `MessageReasoning`.

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial). Fixes: **flush
  the reasoning buffer before EVERY `tool.call`, not just terminals**
  (adversarial P0 — otherwise reasoning lands after tool events in replay; the
  implementation already does this, proven by the reasoning-loop integration
  test asserting `reasoning.delta` precedes `tool.call`). Stated the ephemeral/
  reload-vanish consequence explicitly (P1). Noted that text-only capture drops
  provider signatures and forecloses the naive same-model re-feed follow-up
  (P1). Impl status: the capture seam (both clients + `onReasoningDelta`) and
  the bridge reopening state machine were built alongside this spec.
- **v1 (2026-07-02):** Initial.
