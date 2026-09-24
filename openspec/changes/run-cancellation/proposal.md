## Why

The chat Stop button cancels the durable Run only after the first model output arrives. Until then the client does not know the Run id, so Stop only closes the browser stream and the Run keeps executing and billing until it finishes ([#139](https://github.com/leon0399/llame/issues/139)). That window covers queue pickup, attempt preparation (including a possible transition compaction, which is itself a model call), and time to first token, which can take tens of seconds for a reasoning model that streams no summary. The Run id travels only in the stream's `start` frame, which the bridge emits lazily with the first translated event, and the API commits response headers only on the first body write, so the browser's request itself stays pending for the whole window.

Owner cancellation shipped in #48 and #128 before OpenSpec. `durable-runs` names the user-cancelled terminal state and `tool-calling` settles open tool calls when a cancellation is observed, but no capability specifies the owner's request, its scoping, when a recorded cancellation takes effect, or how a client learns which Run to cancel. The fix depends on exactly those rules.

The same change moves notifications off the composer. The global toast host sits bottom-right, where it covers the Send/Stop control at common desktop widths and at every mobile width, including the cancel-failure toast this change's Stop path can raise ([#262](https://github.com/leon0399/llame/issues/262)).

## What Changes

- D1: Owner cancellation, as shipped, becomes the `run-cancellation` capability: the single client-writable transition, owner scoping, idempotent repeat requests, conflict on a terminal Run, settlement of a Run cancelled before a worker claims it without any model request, in-process abort after the claim, and what a cancelled Run persists. A Run executing in a different process from the one that receives the cancellation request is outside the mid-flight guarantee until [#207](https://github.com/leon0399/llame/issues/207) ships; this covers split deployments and multi-replica co-located ones.
- D2: The UI message stream for an owner's message, and the resume stream for an active Run, begin with a `start` frame whose `messageId` is the Run id, delivered as soon as the Run is accepted rather than with its first model output. Any client can then cancel from the moment of acceptance.
- D3 (web, tasks only): Stop in the chat composer cancels the Run from submission. A Stop pressed before the Run id arrives is held and issued when the `start` frame arrives, while the control shows a disabled spinner. The composer shows the Stop control for the whole in-flight period.
- D4 (web, tasks only): The in-flight assistant row shows a "Thinking…" indicator until its first visible content. A live-only assistant row with no visible content renders nothing once it is no longer the in-flight row. A persisted empty cancelled turn keeps rendering as it does today, with its "stopped" usage label.
- D5 (web and E2E, tasks only): Toasts render top-right. The E2E workaround that clicks away a toast before using the composer is removed.

What a cancelled Run persists does not change. A Run cancelled before its model request is sent persists no assistant message; one cancelled after it persists its partial turn, empty when no output arrived. The usage recorded on that turn stays with `run-usage-accounting`, which changes it for cancellation with an open tool call (#594). No endpoint, request body, database schema, or OpenAPI document changes. The earlier `start` frame is a valid AI SDK UI message stream; clients that ignore it are unaffected.

## Capabilities

### New Capabilities

- `run-cancellation`: The owner's cancellation request, when a recorded cancellation takes effect and what the cancelled Run persists, and the stream frame that tells a client which Run to cancel. Browser presentation stays out of the spec.

### Modified Capabilities

None. `durable-runs` keeps ownership of lifecycle, liveness, partial-output retention, and replay; `tool-calling` keeps settlement of open tool calls on termination; `run-cancellation` references both instead of restating them.

## Non-goals

- Cross-process cancellation of a Run already claimed by another process ([#207](https://github.com/leon0399/llame/issues/207)); the spec states the boundary.
- Cancelling a Run whose request the server has not yet accepted. The web client holds such a Stop until acceptance; no server-side pending-cancel state is added.
- Changing what a cancelled attempt persists, including the empty turn, or the usage recorded on it.
- Cancellation keyed by Chat, or a client-chosen Run id.
- Phase-aware progress labels such as queued or preparing.
- Carrying the Run id in message metadata instead of the `start` frame's `messageId`.
- The foreground-completion notification race in #262, already fixed by #402 (viewed-chat registration and its regression test).

## Assumptions

- Mid-flight cancellation is relied on only where one process serves both the cancel request and the Run's execution, as `docs/scaling.md` already states for the split topology.
- Sonner 2.0.5 and `ai` 6.0.256 behave as inspected: a `start` chunk with a message id adds the message without leaving `submitted`, hovering a toast pauses its timer, and `position="top-right"` places toasts over header space on every route.

## Impact

API: the Run stream bridge emits its `start` frame before polling the event log, which also commits the response headers for `POST /api/v1/chats/:id/messages` and `GET /api/v1/chats/:id/stream`. Web: the Stop handler, composer control states, live transcript row rendering, and the toast host's position at its app mount. E2E: a model-server hold keyed per test that ends on abort or on release, a Stop-from-submission spec, a toast-placement spec, and removal of one workaround. No durable data, authorization, or tenancy boundary changes: the frame carries only the requesting owner's own Run id on a stream that is already owner-scoped, and the cancel endpoint's scoping is unchanged.
