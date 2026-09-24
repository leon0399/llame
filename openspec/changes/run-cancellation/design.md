## Context

See proposal.md for motivation. Observed at `master` 028b4d0c with `ai` 6.0.256 and `sonner` 2.0.5:

- `RunStreamBridgeService.createUiMessageStreamResponse` polls `run_events` and translates each event. `RunEventTranslatorImpl.prelude()` emits `{type:'start', messageId: runId}` only when the first event yielding a UI chunk arrives (`run-stream-bridge.ts:139-145`); `run.created`, `run.started`, `model.requested`, `tool.started`, and empty reasoning deltas (`:229-237`) yield none.
- `writeWebResponse` sets headers and pipes the body without flushing (`chats.controller.ts:508-528`). Express commits headers on the first body write, so the browser's `fetch()` for `POST /chats/:id/messages` stays pending until that first chunk. Validation, model, and single-flight failures throw before the bridge is created, so they keep their HTTP status.
- The web client derives the Run id from the last message's id: `runIdToCancel` (`lib/services/chat/runs.ts:67-72`) for Stop and `streamingRunId` (`lib/services/chat/run-notifications.ts:66-71`) for background-completion tracking. Before the `start` chunk the last message is the user's, so Stop only calls `useChat().stop()`. The transport sends only the last message (`lib/services/chat/transport.ts:40-57`).
- In `ai` 6.0.256, a `start` chunk with a `messageId` sets the message id and calls `write({ updateStatus: false })` (`ai/dist/index.mjs:6257-6264`): the assistant message is pushed with no parts and the chat status stays `submitted` until the first content chunk (`:14089-14105`).
- Cancellation (`RunsController.updateRun`, `RunsRepository.requestCancel`) stamps `cancel_requested_at` only on a non-terminal, not-yet-requested owned Run and aborts the controller registered in the process serving the request. The worker checks the stamp at pickup and again after registering its own controller (`runs-worker.service.ts:163-217`), and `markStarted` refuses to claim a stamped Run (`runs-repository.ts:302-323`). After the claim, only the local abort signal stops the attempt.
- What a cancelled Run persists depends on where the cancellation lands. Before the claim and during preparation, settlement writes no assistant message. Once the provider request is in flight with no tool call open, the client's abort reaches `onError`, which finishes the Run with the collected parts, possibly none, and usage status `aborted` (`run-execution.service.ts:1367-1388`); `chats-messages.integration.test.ts:776-821` pins the empty case. With a tool call open, parent-abort settlement persists the parts with no usage today (#594), which `run-usage-accounting` changes.
- `adoptServerHistory` keeps every trailing live-only message that the refetched history does not carry (`lib/services/chat/history.ts:403-430`), so a placeholder row whose Run persisted nothing survives adoption and later moves behind newer turns.
- The composer shows a spinning icon during `submitted` and a Stop icon during `streaming`, both calling the same handler (`chat-composer.tsx:31-49`).
- `<Toaster />` mounts once in `components/providers.tsx:21` with Sonner's default `bottom-right`, 24 px inset and 356 px width, full width below 600 px. The composer is a centred `max-w-3xl` column beside the 24rem chat sidebar, so the toast covers the Send/Stop button at 1280, 1440, and 1680 px widths and at every mobile width (computed from the CSS, not measured). The chat and admin headers hold only left-aligned content. `packages/ui/src/components/` is shadcn-generated and overwritten on regeneration (`packages/ui/AGENTS.md:9-15`).

## Goals / Non-Goals

**Goals:**

- The Run id reaches every client of the owner's stream at acceptance, with no new endpoint or wire field.
- A web Stop at any point after Send ends the Run `cancelled` wherever one process serves the cancel request and executes the Run.
- No composer control is covered by a notification.

**Non-Goals:**

- Server-side cancellation of a request that has not been accepted.
- Cross-process cancellation after the claim (#207).
- Measuring time to first token or adding progress phases.

## Decisions

### M1: Emit the start frame when the bridge subscribes

The bridge emits the translator's prelude before the first poll, for both the message stream and the resume stream, and the translator keeps emitting it at most once. The first body write then also commits the response headers, so the browser request resolves at acceptance.

Alternatives: a Run id response header plus `flushHeaders()` needs a second id source beside `messages`, because `useChat` exposes no response headers, and a side channel through the transport's `fetch` wrapper that `trackRun` would also need. A client-minted Run id in the request body adds an API contract and a cross-tenant existence oracle on primary-key conflict. Prior art converges on the acknowledgement pattern: Codex app-server returns `turn.id` in the synchronous `turn/start` response and interrupts by `threadId` plus `turnId`; OpenClaw returns `{ runId }` in the `chat.send` acknowledgement. OpenCode aborts by session only and Open WebUI stops by task or chat; none records a cancellation for an unaccepted turn.

### M2: Hold a Stop pressed before the id arrives

The client's Stop runs one of two paths:

- **Id known** (the last message is the placeholder assistant row): unchanged, `cancelRun(id)` fire-and-forget, then `stop()`.
- **Id unknown** (request in flight, not yet accepted): set a pending-stop flag and keep the request open. When the placeholder row appears, issue `cancelRun(id)`, then `stop()`, and clear the flag. When the request fails or finishes, clear the flag and take the existing send-failed or finish path.

There is no timeout: a hung accept is an infrastructure failure, and reload recovers through the `?draft=sent` path (#49). A timer would reintroduce the orphaned Run on a slow but healthy accept. Server-side alternatives were rejected: cancelling a Run whose request disconnected before its first frame would break first-send recovery on reload, and a pending-cancel record needs new durable state for a window of milliseconds.

`cancelRun` failures keep today's handling: 404 and 409 are silent, anything else shows the existing "Couldn't confirm the response was stopped" toast. The hold logic lives in a hook and is tested headless.

### M3: Composer control states

| State | Condition                     | Control            |
| ----- | ----------------------------- | ------------------ |
| S1    | request in flight, id unknown | Stop icon, enabled |
| S2    | id known, no visible output   | Stop icon, enabled |
| S3    | streaming output              | Stop icon, enabled |
| S4    | pending stop (M2)             | spinner, disabled  |

The spinner then means only "stopping". Stop is operable from Send onward because M1 and M2 make it effective from Send onward. A `chat-composer` story's play function asserts the four states, per `docs/testing.md` rule 5.

### M4: Pending indicator and live-only empty rows

Visible content uses the rule `MessageSegments` already applies: text, tool, and notice parts are visible; a reasoning run whose text is blank renders nothing (`chat-message-row.tsx:234`). Live reasoning parts always carry text because the bridge drops empty reasoning deltas, but a whitespace-only delta still yields an invisible part.

- While the chat is in flight, the last message, when it is an assistant message with no visible content, renders the existing `Shimmer` "Thinking…" from `@workspace/ui/components/ai-elements/shimmer`. The indicator ignores S4.
- Any other assistant message with no visible content and no persisted sequence (`metadata.seq`) renders nothing. This covers the placeholder of a Run stopped before its model request, which persists no assistant message and which history adoption keeps in the live list, wherever later turns move it. Its fork action, which would send a Run id as a message id, is not rendered either.
- A persisted assistant turn with no parts, the Run cancelled during its model request, has a `seq` and renders as today, with its usage status shown as "stopped". The client cannot tell that case from a Stop before the model request: both leave a live placeholder without `seq` or usage, which the previous rule stops rendering as soon as `stop()` settles the chat. The persisted turn, when the server writes one, appears through history adoption. `onFinish` refetches history on the abort, and because the aborted stream leaves the Run tracked, the active-runs poll refetches it again when the Run turns terminal (`use-chat-engine.ts:228-235`, `active-runs-context.tsx:308-321`; a `cancelled` Run raises no notification). A refetch that lands before settlement, or fails, is therefore followed by one that finds the turn. Between Stop and that refetch the row is briefly absent. Deferring stream teardown until the terminal event would make Stop wait for worker settlement, and synthesizing a "stopped" row client-side would show a turn that a Stop before the model request never persists.

The Run id stays in the `start` frame's `messageId`; both readers keep their documented derivation.

### M5: Toasts top-right

The single mount in `apps/web/components/providers.tsx` passes `position="top-right"`, and DESIGN.md records the placement next to its Sonner entry. The generated primitive in `packages/ui` stays untouched, so regeneration cannot silently restore bottom-right. A toast can then cover header content on mobile for its lifetime; it never covers the composer, and the user can dismiss it. Keeping bottom-right with a bottom offset that tracks the composer's measured height needs a resize observer and a CSS variable on every route for a placement nothing requires.

The E2E workaround in `model-context-transparency.spec.ts:59-69`, which clicks a toast's View action before using the model picker, is removed. The notification race it masked was fixed by #402 and is covered by `active-runs-context.test.tsx:282`.

### M6: Deterministic browser proof

`e2e/support/model-server.ts` gains a hold keyed by a per-test token embedded in the prompt, because Playwright runs specs in parallel. A held request answers with response headers and then writes nothing until either the client closes the connection or the test releases the hold. The server records arrival and close per token, observing close on the response (`res.on('close')`), since the request's own `close` can fire once its body is consumed. A small control endpoint on the model server reports that state and releases a hold. Nothing in either spec waits on a timer.

- **Stop E2E:** send a held prompt, wait until the hold reports arrival (the Run's model request is in flight), check the indicator and the enabled Stop control, click Stop, and wait until the hold reports close. Then poll the Run until `cancelled` and, without reloading, wait for the persisted empty turn labelled "stopped" to appear as the last row through history adoption; reload and expect the same row. If cancellation regresses, the hold never closes and the test fails by timeout on every run. The S1 to S4 branch lasts about one accept transaction and is proven by the hook test, not in the browser.
- **Toast E2E:** send a held prompt in one chat and wait until the hold reports arrival, so the Run exists and is active before the page unloads. Then load `/` with a full navigation so the active-run provider remounts and rehydrates from the owner's active Runs; this layer sits below M1, so the held Run has sent no `start` frame and is tracked only through rehydration. Wait until that chat's sidebar row shows its processing state, which proves the Run is tracked; at 390×844 the chat list lives in the closed mobile sheet, so the spec opens the sheet, waits for the state, and closes it. Then release the hold and wait for the "Reply ready" toast. At both 1280×720 and 390×844, hover the toast (which pauses Sonner's timer), assert its box does not intersect the composer's, and follow its View action.

This extends the hold-until-abort fixture decided for the Stop proof with a release path, which the toast proof needs so that completion happens after navigation instead of racing a timed drip.

## Risks / Trade-offs

- [The first frame now arrives before any content, so the live list holds an assistant message with no parts during `submitted`] → M4 renders the indicator for it; unit tests cover the visible-content and live-only-row rules, including Stop before output, adoption, and a following send.
- [Committing headers earlier changes when an accept-time failure can still become an HTTP error] → the frame is written only after the Run is accepted and enqueued; earlier failures still throw before any body write.
- [A Stop at different moments leaves different history: nothing before the model request, an empty "stopped" turn after it] → accepted and specified; this is shipped persistence that `run-usage-accounting` depends on, and changing it is a non-goal. After a Stop with no output the row is absent until history adoption brings the persisted turn, if any, at most one active-runs poll after settlement (M4).
- [Multi-process deployments cannot stop a claimed Run] → the spec states the boundary and names #207; `docs/scaling.md` already warns operators.
- [A background toast now covers mobile header controls for up to 4 s] → accepted; it is dismissible and never covers the composer.
- [Rollback] → no data or schema change. Reverting the bridge restores lazy `start`; the client's pending-stop path then waits until first output, the same outcome as today.
