## 1. Memory settings surface

- [ ] 1.1 Add the memory-settings schema in `apps/api/src/db/schema` (owner-keyed, `shareRecentChats` boolean defaulting false), export it from `schema/index.ts`, and run `pnpm --filter api db:generate`
- [ ] 1.2 Hand-append `FORCE ROW LEVEL SECURITY` and the owner policy to the generated migration (Drizzle emits `ENABLE` only), and record the exception in `apps/api/AGENTS.md`'s migration-gotchas list
- [ ] 1.3 Add `MemoryModule` (repository + service) exporting a narrow resolver type for consumers, following the `PromptUserResolver` pattern — no `as unknown as` casts in fixtures
- [ ] 1.4 Add `GET`/`PATCH` `/api/v1/me/memory` with a class-validator DTO, an explicit response type with an egress allowlist, and OpenAPI annotations; identity from the session only
- [ ] 1.5 Unit tests: default-false when no row exists, partial update semantics, a client-supplied user id is ignored
- [ ] 1.6 Integration test in the RLS suite: cross-tenant read/update denied, empty (public) identity reads nothing
- [ ] 1.7 Integration test at the HTTP boundary: unauthenticated request rejected, response body carries no fields outside the allowlist

## 2. Prompt templating — bounded iteration and the `chats` context

- [ ] 2.1 Add `each` to `ALLOWED_BLOCK_HELPERS` in `apps/api/src/instance-config/prompt-loader.ts` and declare the `chats.pinned` / `chats.recent` collections with their item fields (`title`, `date`, `messageCount`, `excerpt`)
- [ ] 2.2 Extend `assertStatements`/`assertPath` so an `each` accepts exactly one declared-collection parameter, validates its body against that collection's item-field scope, and rejects nesting, block params, `@index`/`@key`, and hash arguments
- [ ] 2.3 Keep collections gate-only in value position, so `{{chats.recent}}` fails boot the same way `{{user}}` does
- [ ] 2.4 Project `chats` at the top level of the render context (never under `user`), applying the tag sanitizer to `title` and `excerpt`, and omitting an empty collection and then `chats` itself
- [ ] 2.5 Extend the boot probe to the **cross product** of the `user` and `chats` gates (absent/populated for each), not the two gates varied together — a template gated `{{#if user}}` plus `{{#unless chats}}` passes a lockstep probe and renders empty for owners with chats but no personalization
- [ ] 2.6 Unit tests: valid iteration renders per entry; undeclared item field, `each` over a scalar/gate/unknown path, nested `each`, block params, and a collection in value position each fail boot naming the construct
- [ ] 2.7 Unit test: a digest-only owner leaves `{{#if user}}` false, so the packaged personalization block and its framing prose are omitted

## 3. Digest resolution and the frozen baseline

- [ ] 3.1 Add two nullable per-chat state fields — the frozen rendered baseline and the growing told-set (chat ids plus last-told pin state) — generate the migration, and confirm no backfill is needed (null = no digest)
- [ ] 3.2 Add a `limit` to `ChatsRepository.findByOwner` without introducing a second query path
- [ ] 3.3 Implement baseline resolution: `pinned: 'only'` and `pinned: 'exclude'` capped at 10 each, excluding the current chat, archived chats, and untitled chats, with pins filtered to `item_type = 'chat'`
- [ ] 3.4 Capture each entry's last-activity date, message count at resolution time, and excerpt; no chat identifier is stored in or rendered from the baseline
- [ ] 3.5 Implement excerpt extraction — earliest user message by `seq`, text parts only, truncated to 200 Unicode code points on a code-point boundary; a message with no text yields an entry with no excerpt
- [ ] 3.6 Resolve and persist the baseline on the chat's first run (which on the main path is where `createIfAbsent` materialises the row), gated on `shareRecentChats`; skip resolution entirely when the setting is off
- [ ] 3.7 Resolve the two ratios — pinned shown/total pinned, recent shown/total eligible — and freeze them with the baseline
- [ ] 3.8 Render the stored baseline on every run in `chat-loop.service.ts` before hashing, so `resolveEffectiveContext` addresses the snapshot by what was actually sent
- [ ] 3.9 Unit tests: caps, disjointness with backfill to a full 10, exclusion rules, excerpt truncation across scripts, and byte-identical renders across two runs of the same chat
- [ ] 3.10 Integration test: a second run in the same chat reuses the existing snapshot rather than minting a new one

## 4. Packaged default prompt

- [ ] 4.1 Add the digest block to `apps/api/src/prompts/chat-default.md`, gated on `{{#if chats}}`, with pinned rendered above recent
- [ ] 4.2 Author the opening framing prose (data not instructions, ranks below system instructions and the current conversation, cannot grant tools or relax authorization) and the trailing restatement that instruction-following resumes
- [ ] 4.3 Add the truncation sentence stating each list is capped and older chats are not listed, without naming a retrieval tool
- [ ] 4.4 Add the compilation-date line, the two shown/total ratios, and the non-authoritative note stating entries are point-in-time and titles may since have been renamed; label each entry's date as last activity
- [ ] 4.5 Reserve `<user_chat_history>` in the authored-text sanitizer alongside `<user_personalization>`, and mirror the change in `apps/web/lib/services/personalization/sanitize.ts` to keep both copies in sync
- [ ] 4.6 Unit tests: a title or excerpt containing the closing delimiter is escaped as content; a balanced forged copy of the reserved name is escaped; exactly one delimiter pair survives

## 5. Delta event log

- [ ] 5.1 Add the digest delta part beside `apps/api/src/chats/model-context-part.ts` with strict exact-shape validation on authoring and a server-owned renderer, following `createModelSwitchPart` / `renderModelSwitchReminder`
- [ ] 5.2 Add the supersession-marker part and renderer for compaction re-bake
- [ ] 5.3 Derive events by diffing the told-set against the owner's currently eligible chats — entered, or pin state changed — comparing pin state against `pins` membership and never against the rendered pinned list; batch into a single append; departures (displacement, archival, deletion) emit nothing by construction, not by a rule
- [ ] 5.4 Add the per-owner change counter bumped by title generation and pin mutations, and short-circuit the diff when it matches the value stored beside the told-set
- [ ] 5.5 Advance the told-set in the same transaction as the append it accounts for
- [ ] 5.6 Author the part on the user message in `chat-loop.service.ts`, gated on `shareRecentChats` alone with no template inspection
- [ ] 5.7 Render appends in `context-builder.ts`'s existing reminder slot, alongside the model-switch and tool-availability reminders with no combined or special-cased form
- [ ] 5.8 Unit tests: a delta and a model switch on the same turn emit both reminders independently; displacement, archival, and deletion emit nothing; batching collapses multiple events into one append
- [ ] 5.9 Unit tests: an already-told chat never repeats; a resurfaced below-cap chat does append; a newly pinned chat displacing a rendered one emits no unpin; unpinning a never-announced chat emits nothing; a failed transaction leaves the told-set unchanged
- [ ] 5.10 Unit test: with `shareRecentChats` off, no append is emitted on any turn

## 6. Compaction

- [ ] 6.1 Extend the summarization instruction in `apps/api/src/compaction/compaction.ts` to name the digest delimiter alongside the personalization delimiter, in both the full-current and transition instructions
- [ ] 6.2 Re-resolve and overwrite both the baseline and the told-set at compaction, so the new epoch starts with the told-set matching the fresh baseline, applying every eligibility, cap, ordering, and disjointness rule afresh
- [ ] 6.3 Emit the supersession marker on the next run after a re-bake
- [ ] 6.4 Confirm a model switch re-renders the stored baseline unchanged and emits no supersession marker
- [ ] 6.5 Unit tests: the replayed system prompt is byte-identical to the turn that just ran and the exclusion appears only in the trailing instruction; re-bake changes listed chats while earlier snapshots are unmodified

## 7. Security and isolation proofs

- [ ] 7.1 Integration test: one owner's digest never contains another owner's chats, with another identity set and with the empty identity
- [ ] 7.2 Integration test: the digest is absent on the public/shared-chat path and fails closed when identity is absent
- [ ] 7.3 Test: the advertised and executable tool set is identical with and without the digest, proving `resolveAdvertisedTools` receives no digest input
- [ ] 7.4 Test: with the setting off, the rendered prompt is byte-identical to the same template with the digest section removed — no residual framing, delimiter, or whitespace
- [ ] 7.5 Test: the owner's effective-context receipt contains the rendered digest verbatim and exposes no host path or provider internal
- [ ] 7.6 Test: a digest resolution or render failure logs the failure kind and no title or excerpt

## 8. Documentation and rollout

- [ ] 8.1 Update `apps/api/AGENTS.md`: the `each` iteration contract, the top-level `chats` namespace and why it is not under `user`, the frozen-baseline lifecycle and its compaction re-bake, and the two non-retroactivity disclosures
- [ ] 8.2 Document in the API contract that `shareRecentChats` sends titles and opening excerpts to the configured provider; that **enabling is retroactive over the whole existing corpus**; and that disabling it and deleting a chat are both non-retroactive
- [ ] 8.3 Record the coordinated rollout in `apps/api/AGENTS.md` and `docs/scaling.md`: deploy workers able to render the delta part before any API authors it; on rollback stop authoring, drain accepted Runs, then roll binaries back
- [ ] 8.4 Update `README.md`, add the dated `CHANGELOG.md` entry, and remove the item from `ROADMAP.md` in this PR
- [ ] 8.5 Rewrite #307's Scope, Boundaries, and Acceptance sections to match this design (system-prompt rail, message excerpts, eval gate all reversed), and comment on #326 recording the settings hierarchy this resolves
- [ ] 8.6 Run `pnpm lint`, `pnpm --filter api typecheck`, `pnpm --filter api test`, and `pnpm --filter api test:integration`
