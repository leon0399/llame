# Stop actually cancels the durable run

## Objective

In the durable-run model (#48/#50 — the worker executes the run, the client
subscribes to the run-event log over SSE), the chat UI's "stop" button is wired
only to `useChat`'s `stop()`, which aborts the CLIENT's SSE fetch. The
server-side run keeps generating in the worker until it finishes naturally or
the deadman timeout fires — so "stop" doesn't stop: it burns tokens/cost
(acutely under BYOK, where the user pays) and leaves a phantom run running.

Fix: make stop CANCEL the run. The backend is already complete — this is a
web-only gap.

## Backend (already built — no change)

- `PATCH /api/v1/runs/:id` `{ status: 'cancelled' }` — the only client-writable
  transition. Stamps `cancel_requested_at` (durable cross-process signal: a
  queued run is settled at pickup) AND aborts the in-process AbortController via
  `RunAbortRegistry` (mid-flight stop); the worker wires that `abortSignal` into
  the model call. Idempotent (re-cancel → 200); 404 not-found/cross-tenant; 409
  already-terminal. RLS-scoped to the owner.

## Research (ai-chatbot, opencode, open-webui)

All three converge on the same pattern and validate this design:
- **Cancellation is keyed by a stable, server-known id the client already
  has** — never a bespoke id threaded through stream metadata. ai-chatbot keys
  off `chatId` (server resolves "most recent stream"); opencode off `sessionId`
  (server tracks "the active fiber", `POST /session/:id/interrupt`); open-webui
  off `task_id` with a `chat_id` fallback. llame's run id is *more* precise than
  any of them — a real, durable, unique row, not an inferred "latest".
- **ai-chatbot has NO cancel at all** — its `stop` is the raw useChat value and
  generation is deliberately decoupled from the socket (survives refresh). It's
  the exact gap llame has now; the reference confirms the gap, doesn't solve it.
- **`stop()` has no `onStop` hook** (AI SDK v6, `stop: () => void`) — the click
  must be wrapped to fire both the client abort AND the cancel; don't gate one
  on the other (independent concerns). opencode/open-webui bind interrupt as a
  plain fire-and-forget POST.
- **Stop-after-finish is a normal race, not a failure** (opencode: silent
  no-op; open-webui: soft-fail). llame's backend is the most rigorous (200
  idempotent re-cancel, 409 terminal, 404 cross-tenant/missing) — so the client
  swallows 404/409 and only surfaces genuine errors.

## The client's handle on the run id

The AI SDK UI-message stream's `start` chunk carries `messageId = run.id`: the
bridge emits `{ type: 'start', messageId }` (`run-stream-bridge.ts:86`) from a
translator constructed with the run id
(`createRunEventTranslator(input.runId)`, `run-stream-bridge.ts:233`; the
docstring at :224 calls it "a client-side surrogate"). So while a run streams,
the assistant message useChat is building has `id === the run id`. That is the
id to PATCH.

## Design (web only)

1. **`cancelRun(runId)` service** (`lib/services/chat/runs.ts`, ky): `PATCH
   /api/v1/runs/:id` with `{ status: 'cancelled' }`. Best-effort — swallow 404
   (run gone) and 409 (already terminal); the point of stop is moot in both.
   Other errors propagate (the caller decides). Return void.
2. **`handleStop` in `chat-page`:** compute the run id via the pure
   `runIdToCancel(messages)` helper — while a run streams the last message is
   the assistant turn whose id is the run id (null in the submitted window). If
   non-null, fire `cancelRun(id)` (non-blocking; its `.catch` logs AND toasts on
   a genuine failure so the stop UX never breaks but a still-running run isn't
   silently missed — see "Failed cancel is surfaced"), THEN call `stop()` to
   abort the client stream. No ref/effect needed: the id is only needed at click
   time, and the last message is authoritative then. `runIdToCancel` is pure so
   the role-based branching (most likely to regress under a refactor) is unit
   tested.
3. **Wire** the existing stop button's `onClick` to `handleStop`.

## Worker vs inline mode

- **Worker mode (default):** the run is decoupled from the socket, the UI-stream
  `messageId = runId`, so `cancelRun` does the real work — this is where the fix
  matters.
- **Inline mode (`RUN_EXECUTION_MODE=inline`, deprecated):** `executeRun`
  returns the AI SDK result directly, so the streaming message id is the SDK's
  own generated id, NOT the run id → `cancelRun` PATCHes a non-existent id and
  gets a swallowed 404. Harmless, because inline runs on the REQUEST THREAD:
  `stop()`'s client abort trips the request `abortSignal`, which already stops
  generation. So stop is correct in both modes; the inline 404 is a no-op.

## Failed cancel is surfaced (BYOK footgun)

`cancelRun` swallows the normal 404/409 races. If it throws anything else (500,
network, the api unreachable) in worker mode, the run may still be generating —
so `handleStop` shows a toast ("Couldn't confirm the response was stopped…")
rather than let the user believe stop saved tokens when it may not have.
`stop()` still fires regardless (client teardown is independent).

## Edge cases (named)

- **Submitted window** (run enqueued, first `start` chunk not yet received → no
  message id = run id yet): the run id is not client-known, so stop only aborts
  the client fetch. Usually brief, but NOT guaranteed narrow — under worker-queue
  backpressure the enqueue→pickup delay can stretch it, so a stop during that
  window won't cancel server-side. A subsequent turn supersedes prior active
  runs (`cancelActiveRunsForMessage`) and the deadman settles an orphan.
  Accepted for the MVP; a fully-robust fix would expose the run id at enqueue
  (follow-up).
- **Double-stop / stop-after-finish:** idempotent server-side (200 on
  re-cancel; 409 on terminal → swallowed). No client-side guard needed beyond
  swallowing those statuses.
- **Resume/reconnect:** after a refresh, the resumed stream's assistant message
  id is again the run id (same bridge), so stop works post-resume too.

## Testability

- vitest unit (`cancelRun`): asserts `PATCH /api/v1/runs/:id` with
  `{ status: 'cancelled' }`; resolves (no throw) on 404 and 409; propagates
  other errors. Mock the api client like the existing chat service tests.
- vitest unit (`runIdToCancel`): returns the last message id when it's the
  streaming assistant turn; null in the submitted window (last = user turn) and
  for an empty list — covers the role-based branching (verifier P1).
- Build/lint/tsc green. The backend cancellation path is already covered by the
  runs integration/e2e suites (mid-flight cancel + 404/409), unchanged.

## Non-goals

- Exposing the run id at enqueue for the submitted-window case (follow-up).
- A "regenerate"/"edit message" flow (separate feature).
- Any backend change — cancellation is complete.

## Revision history

- **v3 (2026-07-03):** Review round (verifier + adversarial) — both converged,
  no P0/P1. Verifier confirmed the worker/inline analysis + abort→token-save
  chain against primary source; its P1 (untested branching) is closed by
  extracting the pure `runIdToCancel` helper and unit-testing it. Adversarial
  converged (multi-run/stale-id clean via status-gating, closure fresh per
  render, throttle-429 surfaces via toast). P2 fixes: cite the code lines
  (`:86`/`:233`) not the comment; caveat the submitted window under queue
  backpressure.
- **v2 (2026-07-03):** Research folded in (references converge on cancel-by-
  stable-server-id; `stop()` has no hook; stop-after-finish is a normal race).
  Added the worker-vs-inline analysis (inline: `messageId ≠ runId` but the
  request-thread abort already stops it, so cancelRun 404s harmlessly) and a
  toast surfacing a genuine (non-404/409) cancel failure so a silently-still-
  running run doesn't read as "stopped". Aligned the design with the shipped
  code (click-time `messages.at(-1)` read, no ref).
- **v1 (2026-07-03):** Initial (pre-review draft).
