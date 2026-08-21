## 1. Producer

- [ ] 1.1 Append `temporal` to `CONTEXT_ITEM_PRODUCERS` in `apps/api/src/chats/context-item.ts`; verify by extending the ordering test in `context-item.test.ts` that a `temporal` item sorts last among attached producers and that an unrecognized producer still sorts after it.
- [ ] 1.2 Add the `temporal` payload type and its strict validator to `apps/api/src/chats/context-item-producers.ts` — the stored instant and IANA timezone, exact-key-set matched like the existing payloads; verify with unit tests that a well-formed payload validates and that an extra field, a missing field, a malformed instant, and an unknown timezone are each rejected.
- [ ] 1.3 Add the renderer: one line in the anchor's shape (`<label>: YYYY-MM-DD HH:MM±HH:MM (Zone)`), receipt-worded and identical for the newest and oldest turn; verify by test that it renders from the payload alone, reading neither the clock nor `process.env`, and that an unrenderable payload yields nothing rather than throwing.

## 2. Authoring the row

- [ ] 2.1 In `apps/api/src/chats/chat-loop.service.ts`, create the temporal item in `buildTurnContextAndParts` from the turn's acceptance instant and the instance timezone already resolved there for the anchor, attaching it to the user message's parts beside the existing producers' items; verify with a unit test that the assembled parts carry exactly one temporal item with the expected payload.
- [ ] 2.2 Verify by integration test that a persisted user message carries the item, that the stored payload holds the instant and zone, and that a client-submitted part shaped like a temporal item is discarded rather than persisted.

## 3. Rendering into context

- [ ] 3.1 Verify by test that `buildContext` requires no change: every user message in a replayed conversation renders its row ahead of that message's visible text, and assistant messages carry none.
- [ ] 3.2 Verify by test that two builds of the same conversation, separated in time and run with a different `TZ` in the environment, produce byte-identical output — the property that keeps the prefix cache-stable.
- [ ] 3.3 Verify by test that each run's `runs.context_items` record lists the temporal items that run injected, with producer, form, and residency.

## 4. Lifecycle

- [ ] 4.1 Verify by test that a compaction checkpoint supersedes the rows on the turns it absorbs, that turns after the checkpoint keep theirs, and that `COMPACTION_INSTRUCTION` is unchanged.
- [ ] 4.2 Verify by test that a forked chat's copied turns carry their original rows unchanged.
- [ ] 4.3 Verify by test that a shared-chat read, its fork projection, and a search projection contain no temporal row, and that the instance timezone is not disclosed through them.
- [ ] 4.4 Verify by test that a conversation whose turns predate this change renders exactly as before, with no row and no failure.

## 5. Consistency with the anchor

- [ ] 5.1 Add a test asserting a turn's row and the same request's anchor are mutually consistent: same rendered shape, same timezone, anchor phrased as a reference point that is not the present, row phrased as receipt.
- [ ] 5.2 Verify by test that adding rows does not change the rendered system prompt and does not cause a new effective-context snapshot to be minted for an otherwise unchanged turn.

## 6. Documentation

- [ ] 6.1 Update `apps/api/AGENTS.md` with the `temporal` producer: its place in the rail order, its persisted payload, and why its wording is receipt rather than present; verify `pnpm lint:markdown` passes.
- [ ] 6.2 Add the dated `CHANGELOG.md` entry in the same PR that ships the work; verify `pnpm lint:markdown` passes.

## 7. Verification

- [ ] 7.1 Run `pnpm --filter api lint`, `pnpm --filter api test`, and `pnpm --filter api build`; verify all pass with no new unused-disable directives.
- [ ] 7.2 Run `pnpm --filter api test:integration`; verify the persistence, replay, fork, and share suites pass against a real Postgres.
