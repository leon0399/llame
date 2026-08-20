## 1. Anchor formatting

- [ ] 1.1 Add a **pure** formatting helper taking `(instant, timeZone)` and returning `{ systemTime, systemTimezone }`, reading the timestamp, the numeric UTC offset, and the IANA identifier off a **single** `Intl.DateTimeFormat` result so the offset and the zone name cannot disagree
- [ ] 1.2 Render `systemTime` at minute precision with the offset appended (no seconds); expose the IANA identifier separately as `systemTimezone`
- [ ] 1.3 Unit-test a non-UTC zone, a UTC instance (zero offset), and a fractional-hour zone (`Asia/Kathmandu`, `+05:45`) that would fail an hours-only assumption
- [ ] 1.4 Test the degenerate-zone fallback: an absent or `Etc/Unknown` zone renders `+00:00 (UTC)` and never emits `undefined` or a placeholder identifier
- [ ] 1.5 Assert the rendered identifier is ICU's canonical zone spelling rather than assuming the configured spelling round-trips (`Asia/Kathmandu` resolves to `Asia/Katmandu`)
- [ ] 1.6 Unit-test two instants on either side of a daylight-saving transition in one zone, proving the offset tracks the date rather than the zone name

## 2. Template vocabulary

- [ ] 2.1 Add `context.systemTime` and `context.systemTimezone` to `PROMPT_CONTEXT_PATHS` in `apps/api/src/instance-config/prompt-loader.ts`
- [ ] 2.2 Leave `context` out of `PROMPT_GATE_KEYS`, so a bare `{{#if context}}` is rejected; test that boot fails naming the model id and the construct without printing prompt contents
- [ ] 2.3 Project both values unconditionally with model-class escaping (`&`, `<`, `>`), deliberately bypassing the absent-or-empty omission rule that applies to `user` and `chats`
- [ ] 2.4 Convert `renderSystemPromptTemplate` to a single options object (`{ template, model, anchor, user?, chats? }`) with `anchor` required, so required and optional inputs no longer depend on position
- [ ] 2.5 Supply a fixed representative anchor to every existing boot probe; confirm the probe set stays at the current `user` × `chats` cross product and gains no dimension
- [ ] 2.6 Test that both paths render, that an undeclared `context.*` path is rejected at boot, and that `{{#each context.systemTime}}` is rejected as a non-collection

## 3. Render service and call sites

- [ ] 3.1 Convert `SystemPromptsService.render` to the same options-object shape, with `anchor` required
- [ ] 3.2 Update `apps/api/src/instance-config/prompt-built-runtime.contract.ts` to supply an anchor
- [ ] 3.3 Update remaining call sites: `prompt-loader.test.ts`, `config-loader.test.ts`, `chat-default.test.ts`, `compaction-context.integration.test.ts`, and `recency-digest.service.test.ts`
- [ ] 3.4 Replace the positional type references — `Parameters<SystemPromptsService['render']>[1]` in `chat-loop.service.ts` and `Parameters<typeof renderSystemPromptTemplate>[2]` in `prompt-loader.test.ts` — with named field types read off the options object
- [ ] 3.5 Confirm the compaction path needs no change: it replays `state.sourceSnapshot.systemPrompt` rather than re-rendering

## 4. Run assembly and compaction

- [ ] 4.0 Resolve the instance zone per render, falling back to `UTC` when it resolves to `undefined` (invalid `TZ`) or `Etc/Unknown` (empty `TZ`), and log that condition once via `Intl.DateTimeFormat().resolvedOptions().timeZone` at the point the anchor is assembled, rather than caching it at module load
- [ ] 4.1 In `buildTurnContextAndParts` (`apps/api/src/chats/chat-loop.service.ts`), derive the anchor as the latest compaction's `createdAt` falling back to `chat.createdAt`, reading the latest compaction **unconditionally** for this purpose rather than inheriting the `previousRun`-gated read, so a chat that was compacted can never silently fall back to its creation time
- [ ] 4.2 Pass the anchor into `systemPrompts.render` so it is substituted before `resolveEffectiveContext` hashes the rendered prompt
- [ ] 4.3 Integration-test that a never-compacted chat anchors on its creation time and a compacted chat anchors on its most recent compaction, including a chat that carries a compaction but no prior run
- [ ] 4.4 Integration-test that a model switch leaves the anchor unchanged while the prompt text may change only because the template differs
- [ ] 4.5 Integration-test that two runs between compactions render a byte-identical prompt and reuse the effective-context snapshot rather than minting a new one
- [ ] 4.6 Integration-test that the first run after a compaction renders a changed anchor and mints a new snapshot
- [ ] 4.7 Extend `STANDING_CONTEXT_EXCLUSION` in `apps/api/src/compaction/compaction.ts` so the summarizer does not carry the anchor line into the checkpoint, worded to target the system-supplied line specifically
- [ ] 4.8 Test that the checkpoint omits the anchor **and** that a date or deadline established within the conversation still survives compaction

## 5. Packaged default prompt

- [ ] 5.1 Add a **basis-neutral** line to `apps/api/src/prompts/chat-default.md` referencing `{{context.systemTime}}` and `{{context.systemTimezone}}` — context _as of_ the anchor, explicitly not the current time — worded so it stays true whether the anchor came from chat creation or from a compaction, positioned **before** the chat-history block so digest dates are already anchored when read
- [ ] 5.2 Test that the rendered default carries an absolute timestamp with a numeric offset and an IANA identifier, and asserts no present-tense claim
- [ ] 5.3 Test that a never-compacted chat and a compacted chat render identical wording, so no phrasing asserts a start date the conversation never had
- [ ] 5.4 Test the digest-plus-anchor example: a rendered prompt containing both a digest entry date and the anchor expresses them on the same absolute, timezone-explicit basis, and still renders `chats.compiledOn` unchanged

## 6. Documentation

- [ ] 6.1 Document the two new paths wherever the prompt authoring vocabulary is described for operators (`apps/api/AGENTS.md`, and `README.md` if it enumerates paths)
- [ ] 6.2 Add the dated `CHANGELOG.md` entry in this change's own diff
- [ ] 6.3 Remove the item from `ROADMAP.md` if it is listed there
- [ ] 6.4 Add `temporal-anchor` to `SPEC.md`'s authority index if it enumerates capabilities
- [ ] 6.5 Document that the `TZ` environment variable governs the anchor's timezone, and that an unset or invalid `TZ` both yield UTC, wherever operator deployment is documented

## 7. Verification

- [ ] 7.1 `pnpm --filter api lint`
- [ ] 7.2 `pnpm --filter api build`
- [ ] 7.3 `pnpm --filter api test`
- [ ] 7.4 `pnpm --filter api test:integration`
- [ ] 7.5 `pnpm lint:markdown` for the edited Markdown
