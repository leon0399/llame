# E2E: edit & resubmit the last message (regression protection)

## Objective

Edit-and-resubmit (last iteration) is the riskiest recent chat feature — a
DESTRUCTIVE mutation (rewrites message content, deletes the reply) spanning the
inline editor → the AI SDK transport → the regenerate endpoint → the DB. Its
review caught a P0 where the transport SILENTLY DROPPED `editUserMessage` (an
allowlist, not a passthrough), which no unit/integration test would surface — only
a real cross-layer, browser-driven test. The chat E2E suite (#80) covers the core
create→stream→render flow but NONE of the 21 newer features. Add an E2E that
drives the edit flow end-to-end AND proves the server actually applied the edit.

## Approach (reuses the existing E2E infra)

The suite runs the full stack against a deterministic mock model server
(`e2e/model-server.ts`, canned `ANSWER`), worker execution mode, throwaway
Postgres, authenticated via the worker-scoped fixture. Mirror
`e2e/chat/chat-flow.spec.ts`'s patterns (`getByPlaceholder`, `getByRole("button",
{ name: "Send message" })`, `getByRole("log").getByText(ANSWER)`).

## Design (`e2e/chat/edit-message.spec.ts`)

1. Send a message with a deliberate typo; wait for the mock `ANSWER`; wait for the
   `/chat/:id` deep link (turn persisted).
2. Click the `Edit message` BUTTON; assert the `Edit message` TEXTBOX is prefilled
   with the original text (role disambiguates the two same-named elements);
   `fill` a corrected message; click `Save & submit`.
3. Wait for a fresh `ANSWER` (the turn re-ran).
4. **RELOAD** — the reloaded transcript comes from the SERVER (DB), so it proves
   what actually persisted:
   - the corrected text is visible in the log (server applied the edit);
   - the original typo text has count 0 (it was overwritten, not appended);
   - exactly one `ANSWER` reply is present (the old reply was superseded, not
     duplicated — `getByText(ANSWER)` resolves uniquely under strict mode).
   This reload step is what makes the test catch the transport-drop P0: a dropped
   `editUserMessage` leaves the OLD content server-side, so the reload would show
   the typo — a client-only assertion (before reload) would falsely pass because
   `setMessages` updates the bubble locally regardless.

## Testability / flakiness

- Generous timeouts matching `chat-flow.spec.ts` (20s stream, 15s nav/reload).
- The edit button appears only when `status` is ready/error — guaranteed after
  the `ANSWER` wait (the turn completed). Playwright auto-waits for actionability.
- No dependence on the mock VARYING its reply: correctness is proven by the
  user-message text change surviving a reload, not by the reply content.

## Caveats (review P2s — non-blocking)

- The reload proves the edit PERSISTED, but "reload proves persistence"
  isn't unconditional: `recordAssistantTurn` swallows a `persistAssistantMessage`
  failure (catch-log-continue) and still emits `run.completed`, so a real
  DB-write failure would show "ready" with no row — a production edge this E2E
  (mock DB never fails) can't catch. The USER-message edit, by contrast, commits
  inside the `runAs` transaction before the run streams, so the FIXED-text /
  TYPO-gone assertions are unconditional.
- The mid-edit `ANSWER` re-wait's diagnostic value leans on the AI SDK's
  `regenerate({messageId})` synchronously stripping the old assistant message
  from client state before the new stream (verified in `ai@6` source). If a
  future SDK bump changes that, this wait degrades to a no-op — harmless, because
  the reload assertions are independently sufficient.

## Non-goals (named)

- E2E for other newer features (regenerate-with-model, sharing, prompts,
  palette) — separate specs; this targets the riskiest (destructive) one first.
- Asserting the mock echoes the edited prompt (it's canned) — the reload proof is
  model-agnostic. Editing an EARLIER (non-last) message (unsupported by design).
- Multi-worker/concurrency races on the edit pin (unit-covered server-side).

## Revision history

- **v2 (2026-07-03):** Round-1 review — both reviewers ship. The verifier
  confirmed every selector matches the implementation, and that `page.reload()`
  re-runs the SSR fetch (`cache: "no-store"`, no client cache) so it genuinely
  re-derives server state and defeats the optimistic `setMessages` (truly catches
  the transport-drop P0). The adversarial verified via primary source (the `ai@6`
  `regenerate` strips the old reply synchronously; the API emits "ready" only
  AFTER the DB write is awaited) that there is no reload-before-persist race —
  which also validates the added "wait for the edit button to reappear"
  completion gate. Added the two P2 caveats above; no P0/P1.
- **v1 (2026-07-03):** Initial.
