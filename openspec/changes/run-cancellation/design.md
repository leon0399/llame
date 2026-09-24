## Context

See proposal.md for motivation. Observed at `master` 028b4d0c with `ai` 6.0.256 and `sonner` 2.0.5:

- `RunStreamBridgeService.createUiMessageStreamResponse` polls `run_events` and translates each event. `RunEventTranslatorImpl.prelude()` emits `{type:'start', messageId: runId}` only when the first event yielding a UI chunk arrives (`run-stream-bridge.ts:139-145`); `run.created`, `run.started`, `model.requested`, and `tool.started` yield none.
- `writeWebResponse` sets headers and pipes the body without flushing (`chats.controller.ts:508-528`). Express commits headers on the first body write, so the browser's `fetch()` for `POST /chats/:id/messages` stays pending until that first chunk.
- The web client derives the Run id from the last message's id: `runIdToCancel` (`lib/services/chat/runs.ts:67-72`) for Stop and `streamingRunId` (`lib/services/chat/run-notifications.ts:66-71`) for background-completion tracking. Before the `start` chunk the last message is the user's, so Stop only calls `useChat().stop()`.
- In `ai` 6.0.256, a `start` chunk with a `messageId` sets the message id and calls `write({ updateStatus: false })` (`ai/dist/index.mjs:6257-6264`): the assistant message is pushed with no parts and the chat status stays `submitted` until the first content chunk (`:14089-14105`).
- Cancellation (`RunsController.updateRun`, `RunsRepository.requestCancel`) stamps `cancel_requested_at` only on a non-terminal, not-yet-requested owned Run and aborts the in-process controller. The worker checks the stamp at pickup and again after registering its abort controller (`runs-worker.service.ts:163-217`); `executeRun` claims atomically and settles a cancellation that wins the claim (`run-execution.service.ts:541-581`). Settlement before output persists no assistant message (`finishRunInTransaction` persists nothing when no turn and no durable parts exist).
- The composer shows a spinning icon during `submitted` and a Stop icon during `streaming`, both calling the same handler (`chat-composer.tsx:31-49`).
- `<Toaster />` mounts once in `components/providers.tsx` with Sonner's default `bottom-right`, 24 px inset and 356 px width, full width below 600 px. The composer is a centred `max-w-3xl` column beside the 24rem chat sidebar, so the toast covers the Send/Stop button at 1280, 1440, and 1680 px widths and at every mobile width (computed from the CSS, not measured). The chat and admin headers hold only left-aligned content.

## Goals / Non-Goals

**Goals:**

- The Run id reaches every client of the owner's stream at acceptance, with no new endpoint or wire field.
- A web Stop at any point after Send ends the Run `cancelled`, co-located.
- No composer control is covered by a notification.

**Non-Goals:**

- Server-side cancellation of a request that has not been accepted.
- Cross-process mid-flight cancellation (#207).
- Measuring time to first token or adding progress phases.

## Decisions

### M1: Emit the identifying frame when the bridge subscribes

The bridge emits the translator's prelude before the first poll, for both the message stream and the resume stream, and the translator keeps emitting it at most once. The first body write then also commits the response headers, so the browser request resolves at acceptance.

Alternatives: a Run id response header plus `flushHeaders()` needs a second id source beside `messages`, because `useChat` exposes no response headers, and a side channel through the transport's `fetch` wrapper that `trackRun` would also need. A client-minted Run id in the request body adds an API contract and a cross-tenant existence oracle on primary-key conflict. Prior art converges on the ack pattern: Codex app-server returns `turn.id` in the synchronous `turn/start` response and interrupts by `threadId` plus `turnId`; OpenClaw returns `{ runId }` in the `chat.send` acknowledgement. OpenCode aborts by session only and Open WebUI stops by task or chat; none records a cancellation for an unaccepted turn.

### M2: Hold a Stop pressed before the id arrives

The client's Stop runs one of two paths:

- **Id known** (the last message is the placeholder assistant row): unchanged, `cancelRun(id)` fire-and-forget, then `stop()`.
- **Id unknown** (request in flight, not yet accepted): set a pending-stop flag and keep the request open. When the placeholder row appears, issue `cancelRun(id)`, then `stop()`, and clear the flag. When the request fails or finishes, clear the flag and take the existing send-failed or finish path.

There is no timeout: a hung accept is an infrastructure failure, and reload recovers through the `?draft=sent` path (#49). A timer would reintroduce the orphaned Run on a slow but healthy accept. Server-side alternatives were rejected: cancelling a Run whose request disconnected before its first frame would break first-send recovery on reload, and a pending-cancel record needs new durable state for a window of milliseconds.

`cancelRun` failures keep today's handling: 404 and 409 are silent, anything else shows the existing "Couldn't confirm the response was stopped" toast.

### M3: Composer control states

| State | Condition                     | Control            |
| ----- | ----------------------------- | ------------------ |
| S1    | request in flight, id unknown | Stop icon, enabled |
| S2    | id known, no visible output   | Stop icon, enabled |
| S3    | streaming output              | Stop icon, enabled |
| S4    | pending stop (M2)             | spinner, disabled  |

The spinner then means only "stopping". Stop is operable from Send onward because M1 and M2 make it effective from Send onward.

### M4: Pending indicator and settled empty rows

While the chat is in flight and the live assistant row has no visible content, the row renders the existing `Shimmer` "Thinking…" from `@workspace/ui/components/ai-elements/shimmer`. Visible content uses the same rule `MessageSegments` already applies: text, tool, and notice parts are visible, and a reasoning run whose text is blank renders nothing (`chat-message-row.tsx:234`). Gating on `parts.length === 0` would blank the row as soon as a provider that withholds reasoning text sends its signed reasoning part. The indicator ignores S4.

Once the chat is no longer in flight, an assistant row with no visible content and no persisted sequence (`metadata.seq`) is not rendered. That row is the placeholder of a Run stopped before output; the server persists nothing for it, so the live view matches the next reload, and its fork action (which would send a Run id as a message id) cannot be clicked.

The Run id stays in the `start` frame's `messageId`; both readers keep their documented derivation.

### M5: Toasts top-right

The shared `Toaster` in `packages/ui/src/components/sonner.tsx` defaults `position` to `top-right`, and DESIGN.md records the placement. A toast can then cover header content on mobile for its lifetime; it never covers the composer, and the user can dismiss it. Keeping bottom-right with a bottom offset that tracks the composer's measured height needs a resize observer and a CSS variable on every route for a placement nothing requires.

The E2E workaround in `model-context-transparency.spec.ts:59-69`, which clicks a toast's View action before using the model picker, is removed. The notification race it masked was fixed by #402 and is covered by `active-runs-context.test.tsx:282`.

### M6: Deterministic browser proof

Stop E2E: a marker-gated model-server fixture answers the provider request with headers and then writes nothing until the request closes. The Run therefore reaches S2 and stays there until a real cancellation aborts the provider call. The spec waits for the indicator and the enabled Stop control, clicks Stop, polls the Run until `cancelled`, reloads, and expects the user message as the last row. It contains no sleeps; if cancellation regresses, the Run never settles and the test fails by timeout every run. The S1 to S4 branch lasts about one accept transaction and is proven by unit tests, not in the browser.

Toast E2E: a background completion (a `SLOW` prompt followed by navigation to a new chat) produces a real "Reply ready" toast at 1280×720 and at a 390×844 mobile viewport. The spec hovers the toast, which pauses Sonner's timer, asserts its box does not intersect the composer's, and follows its View action. No forced clicks and no timing assumptions.

## Risks / Trade-offs

- [The first frame now arrives before any content, so the live list holds an assistant message with no parts during `submitted`] → M4 renders the indicator for it; unit tests cover the visible-content rule and the settled-row rule.
- [Committing headers earlier changes when an accept-time failure can still become an HTTP error] → the frame is written only after the Run is accepted and enqueued; earlier failures (validation, model, single-flight conflict) still throw before any body write and keep their status codes.
- [Split deployment still cannot stop an executing Run] → the spec states the boundary and names #207; `docs/scaling.md` already warns operators.
- [A background toast now covers mobile header controls for up to 4 s] → accepted; it is dismissible and never covers the composer.
- [Rollback] → no data or schema change. Reverting the bridge restores lazy `start`; the client's pending-stop path then waits until first output, the same outcome as today.
