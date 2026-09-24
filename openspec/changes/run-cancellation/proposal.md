## Why

The chat Stop button cancels the durable Run only after the first model output arrives. Until then the client does not know the Run id, so Stop only closes the browser stream and the Run keeps executing and billing until it finishes ([#139](https://github.com/leon0399/llame/issues/139)). That window covers queue pickup, attempt preparation (including a possible transition compaction, which is itself a model call), and time to first token, which can take tens of seconds for a reasoning model that streams no summary. The Run id travels only in the stream's `start` frame, which the bridge emits lazily with the first translated event, and the API commits response headers only on the first body write, so the browser's request itself stays pending for the whole window.

Owner cancellation shipped in #48 and #128 before OpenSpec and no capability specifies it, so nothing guards the contract this fix depends on. The same change moves notifications off the composer: the global toast host sits bottom-right, where it covers the Send/Stop control at common desktop widths and at every mobile width, including the cancel-failure toast this change's Stop path can raise ([#262](https://github.com/leon0399/llame/issues/262)).

## What Changes

- D1: Owner cancellation, as shipped, becomes the `run-cancellation` capability: the single client-writable transition, owner scoping, idempotent repeat requests, conflict on a terminal Run, settlement of a queued Run without any model request, in-process abort of an executing Run, and the split-deployment boundary tracked by [#207](https://github.com/leon0399/llame/issues/207).
- D2: The UI message stream for an owner's message, and the resume stream for an active Run, begin with a frame that identifies the Run, delivered as soon as the Run is accepted rather than with its first model output. Stop in any client can then cancel from the moment of acceptance.
- D3 (web, tasks only): Stop in the chat composer cancels the Run from submission. A Stop pressed before the Run id arrives is held and issued when the identifying frame arrives, while the control shows a disabled spinner. The composer shows the Stop control for the whole in-flight period.
- D4 (web, tasks only): The live assistant row shows a "Thinking…" indicator until its first visible content, and a settled live row with no visible content and no persisted sequence is not rendered.
- D5 (web, tasks only): Toasts render top-right. The E2E workaround that clicks away a toast before using the composer is removed.

No endpoint, request body, database schema, or OpenAPI document changes. The earlier `start` frame is a valid AI SDK UI message stream; clients that ignore it are unaffected.

## Capabilities

### New Capabilities

- `run-cancellation`: Owner cancellation of a durable Run, from acceptance through settlement, and the stream contract that tells a client which Run to cancel. Browser presentation stays out of the spec.

### Modified Capabilities

None. `durable-runs` keeps ownership of lifecycle, liveness, and replay; `tool-calling` keeps settlement of open tool calls on termination; `run-cancellation` references both instead of restating them.

## Non-goals

- Cross-process cancellation of a Run executing in another process ([#207](https://github.com/leon0399/llame/issues/207)); the spec states the boundary.
- Cancelling a Run whose request the server has not yet accepted. The web client holds such a Stop until acceptance; no server-side pending-cancel state is added.
- Cancellation keyed by Chat, or a client-chosen Run id.
- Phase-aware progress labels such as queued or preparing.
- Carrying the Run id in message metadata instead of the stream message id.
- The foreground-completion notification race in #262, already fixed by #402 (viewed-chat registration and its regression test).

## Assumptions

- The co-located deployment (API and worker in one process) is the supported topology for mid-flight cancellation, as `docs/scaling.md` already states.
- A Run cancelled before any model output persists no assistant message (observed in `settleCancelledBeforeStart` and the claim path of `RunExecutionService.executeRun`); implementation verifies the same holds for cancellation during attempt preparation and before the first provider chunk.
- Sonner 2.0.5 and `ai` 6.0.256 behave as inspected: a `start` chunk with a message id adds the message without leaving `submitted`, and `position="top-right"` places toasts over the header area on every route.

## Impact

API: the Run stream bridge emits its identifying frame before polling the event log, which also commits the response headers for `POST /api/v1/chats/:id/messages` and `GET /api/v1/chats/:id/stream`. Web: the Stop handler, composer button states, live transcript row rendering, and the shared toast host's position. E2E: a model fixture that holds its response until the request is aborted, a Stop-from-submission spec, a toast-placement spec, and removal of one workaround. No durable data, authorization, or tenancy boundary changes: the frame carries only the requesting owner's own Run id on a stream that is already owner-scoped, and the cancel endpoint's scoping is unchanged.
