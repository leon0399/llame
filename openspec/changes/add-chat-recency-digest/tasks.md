## Stack shape

Seven layers, following the `mcp-tools/*` precedent where the openspec change is its own bottom
layer and each implementation layer above it is one reviewable concern.

```text
(master) <- recency-digest/spec
         <- recency-digest/templating
         <- recency-digest/settings
         <- recency-digest/baseline
         <- recency-digest/deltas
         <- recency-digest/compaction
         <- recency-digest/activation
```

**The summarization exclusion lands in `baseline`, below every layer that can expose digest content.**
Two paths reach the model, not one: `activation` renders the digest into the system prompt, and
`deltas` renders appends into the message rail — the latter needs no prompt block at all, so digest
content becomes model-visible at `deltas`, one layer earlier than the prompt does. Placing the
exclusion above either path would let an opted-in owner's titles and excerpts be summarized into a
permanent `conversation-checkpoint` in an intermediate merge state, which is the defect design.md R3
exists to prevent.

`activation` is still last, matching `mcp-tools/enable`, because it is what turns the feature on for
the packaged prompt.

| Layer        | Concern, in one sentence                                                            | Migration | Observable |
| ------------ | ----------------------------------------------------------------------------------- | --------- | ---------- |
| `spec`       | The proposal, capability specs, design, and supporting research.                    | -         | no         |
| `templating` | Bounded `each` iteration and the top-level `chats` context in the prompt validator. | -         | no         |
| `settings`   | The owner-scoped `memory` surface carrying `shareRecentChats`.                      | yes       | API only   |
| `baseline`   | Resolve and store the frozen per-chat digest state.                                 | yes       | no         |
| `deltas`     | Append digest events derived from the told-set.                                     | yes       | no         |
| `compaction` | Re-resolve at compaction and exclude the digest from summarization.                 | -         | no         |
| `activation` | Render the digest into the packaged default prompt.                                 | -         | **yes**    |

`templating` and `settings` are mutually independent; both must land before `baseline`. Ordering
between them is by review risk — the template validator changes a shipped security-sensitive
surface and deserves the cleanest isolated diff.

**Rules for every layer:**

- Tests ship with the code they cover. There is no trailing test layer, so no layer merges with its
  isolation unproven.
- Docs ship with the change they describe. There is no trailing docs layer.
- Each layer must pass `pnpm lint`, `pnpm --filter api typecheck`, `pnpm --filter api test`, and
  `pnpm --filter api test:integration` before `gh stack submit`. This is a definition of done, not a
  task.
- **Two layers add migrations** (`settings` and `baseline`; `deltas` adds a server-authored message-part schema, which is a coordinated API/worker boundary but not a database migration), **and rebasing one is not a journal edit.** drizzle-kit chains meta
  snapshots by `prevId`, and `apps/api/src/db/migration-journal.test.ts` pins strictly increasing
  `when` because the migrator **silently skips** an entry whose `when` predates one already applied —
  exactly the shape a rebase produces once a lower layer or master gains a newer migration. After any
  rebase that moves a migration, regenerate it and its snapshot on top of the new base (or re-stamp
  `when` so it sorts last), then verify with `drizzle-kit check`, the journal test, a clean
  `pnpm db:migrate`, and an upgrade from the previous schema. Renumbering `idx` alone leaves forked
  snapshot ancestry and a migration that never runs on existing databases.

Nothing renders for any owner who has not opted in, and the setting defaults off. Digest content
first becomes model-visible at `deltas`, not at `activation` — the message rail does not depend on the
packaged prompt — which is precisely why the summarization exclusion sits below it.

## 1. `recency-digest/templating`

- [x] 1.0 Declare the digest's scalar metadata paths (`chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, `chats.compiledOn`) alongside the collections, escaped as model-class values, rejected as `each` subjects, and covered by the omission rules
- [x] 1.1 Add `each` to `ALLOWED_BLOCK_HELPERS` in `apps/api/src/instance-config/prompt-loader.ts` and declare the `chats.pinned` / `chats.recent` collections with their item fields (`title`, `date`, `messageCount`, `excerpt`)
- [x] 1.2 Extend `assertStatements`/`assertPath` so an `each` accepts exactly one declared-collection parameter, validates its body against that collection's item-field scope, and rejects nesting, block params, `@index`/`@key`, and hash arguments
- [x] 1.3 Keep collections gate-only in value position, so `{{chats.recent}}` fails boot the same way `{{user}}` does
- [x] 1.4 Project `chats` at the top level of the render context (never under `user`), applying the tag sanitizer to `title` and `excerpt`, and omitting an empty collection and then `chats` itself
- [x] 1.5 Reserve `<user_chat_history>` in the authored-text sanitizer alongside `<user_personalization>`, and mirror the change in `apps/web/lib/services/personalization/sanitize.ts` to keep both copies in sync — the reservation must precede any layer that renders digest values
- [x] 1.6 Extend the boot probe to the **cross product** of the `user` and `chats` gates (absent/populated for each), not the two gates varied together — a template gated `{{#if user}}` plus `{{#unless chats}}` passes a lockstep probe and renders empty for owners with chats but no personalization
- [x] 1.7 Unit tests: valid iteration renders per entry; undeclared item field, `each` over a scalar/gate/unknown path, nested `each`, block params, `@index`/`@key` references, a hash argument on `each`, and a collection in value position each fail boot naming the construct
- [x] 1.8 Unit tests: a title or excerpt containing the closing delimiter is escaped as content; a balanced forged copy of the reserved name is escaped; exactly one delimiter pair survives
- [x] 1.9 Unit test against a synthetic fixture template (not the packaged default, which gains no digest block until layer 6): a digest-only owner leaves `{{#if user}}` false, so a personalization block and its framing prose are omitted
- [x] 1.10 Document the iteration contract and the top-level `chats` namespace — including why it is not under `user` — in `apps/api/AGENTS.md`

## 2. `recency-digest/settings`

- [x] 2.1 Add the memory-settings schema in `apps/api/src/db/schema` (owner-keyed, `shareRecentChats` boolean defaulting false), export it from `schema/index.ts`, and run `pnpm --filter api db:generate`
- [x] 2.2 Hand-append `FORCE ROW LEVEL SECURITY` and the owner policy to the generated migration (Drizzle emits `ENABLE` only), and record the exception in `apps/api/AGENTS.md`'s migration-gotchas list
- [x] 2.3 Add `MemoryModule` (repository + service) exporting a narrow resolver type for consumers, following the `PromptUserResolver` pattern — no `as unknown as` casts in fixtures
- [x] 2.4 Add `GET`/`PATCH` `/api/v1/me/memory` with a class-validator DTO, an explicit response type with an egress allowlist, and OpenAPI annotations; identity from the session only
- [x] 2.5 Unit tests: default-false when no row exists, partial update semantics, a client-supplied user id is ignored
- [x] 2.6 Test: `shareRecentChats` is never inferred — pinning, searching, or otherwise using history features leaves it unchanged, and only the PATCH endpoint can alter it
- [x] 2.7 Integration test in the RLS suite: cross-tenant read/update denied, empty (public) identity reads nothing
- [x] 2.8 Integration test at the HTTP boundary: unauthenticated request rejected, response body carries no fields outside the allowlist
- [x] 2.9 Document in the API contract that `shareRecentChats` sends titles and opening excerpts to the configured provider; that **enabling is retroactive over the whole existing corpus**; and that disabling it and deleting a chat are both non-retroactive

## 3. `recency-digest/baseline`

- [ ] 3.1 Add two nullable per-chat state fields — the frozen rendered baseline and the growing told-set (chat ids plus last-told pin state) — generate the migration, and confirm no backfill is needed (null = no digest)
- [ ] 3.2 Add a `limit` to `ChatsRepository.findByOwner` without introducing a second query path, plus an exact-count read for the ratio denominators — the count must not be capped by the same limit, or an owner with 247 chats renders `10 of 10`
- [ ] 3.3 Implement baseline resolution: `pinned: 'only'` and `pinned: 'exclude'` capped at 10 each, excluding the current chat, archived chats, and untitled chats, with pins filtered to `item_type = 'chat'`
- [ ] 3.4 Capture each entry's last-activity date, message count at resolution time, and excerpt; no chat identifier is stored in or rendered from the baseline
- [ ] 3.5 Implement excerpt extraction — earliest user message by `seq`, text parts only, truncated to 200 Unicode code points on a code-point boundary; a message with no text yields an entry with no excerpt
- [ ] 3.6 Resolve the two ratios — pinned shown/total pinned, recent shown/total eligible — and freeze them with the baseline
- [ ] 3.7 Commit baseline and told-set initialization atomically with the first accepted Run's binding transaction; a failed bind or a losing concurrent first send leaves no baseline
- [ ] 3.8 Resolve and persist the baseline on the chat's **first run for which `shareRecentChats` is enabled** — on the main path that is the run where `createIfAbsent` materialises the row, but for a chat whose earlier runs happened while the setting was off it is the first run after re-enabling. While the setting is off, skip resolution entirely and leave the chat baseline-less rather than marking it permanently ineligible
- [ ] 3.9 Render the stored baseline on every run in `chat-loop.service.ts` before hashing, so `resolveEffectiveContext` addresses the snapshot by what was actually sent
- [ ] 3.10 Unit tests: caps, disjointness with backfill to a full 10, exclusion rules, excerpt truncation across scripts, and byte-identical renders across two runs of the same chat
- [ ] 3.11 Integration test: a second run in the same chat reuses the existing snapshot rather than minting a new one
- [ ] 3.12 Integration test: one owner's digest never contains another owner's chats, with another identity set and with the empty identity
- [ ] 3.13 Integration test: the digest is absent on the public/shared-chat path and fails closed when identity is absent
- [ ] 3.14 Test: a digest resolution or render failure logs the failure kind and no title or excerpt
- [ ] 3.15 Test: the advertised and executable tool set is identical with and without a resolved digest, proving `resolveAdvertisedTools` receives no digest input
- [ ] 3.16 Integration test: a chat whose first runs happened while the setting was off receives its baseline on the first run after re-enabling, and emits no append before that baseline exists
- [ ] 3.17 Integration test: two concurrent initializing sends for the same chat leave exactly one baseline epoch and no divergent snapshots, and a send whose binding transaction fails leaves no baseline behind
- [ ] 3.18 Extend the summarization instruction in `apps/api/src/compaction/compaction.ts` to name the digest delimiter alongside the personalization delimiter, in both the full-current and transition instructions. This lands **here**, below every layer that can put digest content where the summarizer sees it — the message rail in `deltas` as well as the system prompt in `activation` — so no intermediate merge state can freeze digest content into a checkpoint
- [ ] 3.19 Document the frozen-baseline lifecycle and its compaction re-bake in `apps/api/AGENTS.md`

## 4. `recency-digest/deltas`

- [ ] 4.1 Add the digest delta part beside `apps/api/src/chats/model-context-part.ts` with strict exact-shape validation on authoring and a server-owned renderer, following `createModelSwitchPart` / `renderModelSwitchReminder`
- [ ] 4.2 Add the supersession-marker part and renderer for compaction re-bake
- [ ] 4.3 Derive events from two distinct candidate sets: **new entries** from the freshly resolved capped views (top 10 pinned + top 10 recent) minus the told-set — never from the whole eligible corpus, which would append hundreds of chats for a large owner — and **pin-state changes** over already-told ids only, against `pins` membership rather than the rendered pinned list; batch into a single append; departures (displacement, archival, deletion) emit nothing by construction, not by a rule
- [ ] 4.4 Advance the told-set in the same transaction as the append it accounts for
- [ ] 4.5 Author the part on the user message in `chat-loop.service.ts`, gated on `shareRecentChats` **and the existence of a baseline** (per `specs/chat-recency-digest/spec.md`), never on template inspection — a baseline-less chat must not receive an append before its initialization commits
- [ ] 4.6 Render appends in `context-builder.ts`'s existing reminder slot, alongside the model-switch and tool-availability reminders with no combined or special-cased form
- [ ] 4.7 Unit tests: a delta and a model switch on the same turn emit both reminders independently; displacement, archival, and deletion emit nothing; batching collapses multiple events into one append
- [ ] 4.8 Unit tests: an already-told chat never repeats; a chat that resurfaces through ordinary activity alone (no title change, no pin change) does append never repeats; a resurfaced below-cap chat does append; a newly pinned chat displacing a rendered one emits no unpin; unpinning a never-announced chat emits nothing; a failed transaction leaves the told-set unchanged
- [ ] 4.9 Unit test: with `shareRecentChats` off, no append is emitted on any turn
- [ ] 4.10 Document the delta event log in `apps/api/AGENTS.md`, and record the coordinated rollout there and in `docs/scaling.md`: this layer adds a server-authored message-part schema, so deploy workers able to render it before any API authors it, and on rollback stop authoring, drain accepted Runs, then roll binaries back

## 5. `recency-digest/compaction`

- [ ] 5.1 Re-resolve and overwrite both the baseline and the told-set at compaction, so the new epoch starts with the told-set matching the fresh baseline
- [ ] 5.2 Emit the supersession marker on the next run after a re-bake
- [ ] 5.3 Confirm a model switch re-renders the stored baseline unchanged and emits no supersession marker
- [ ] 5.4 Unit tests: the replayed system prompt is byte-identical to the turn that just ran and the exclusion appears only in the trailing instruction; re-bake changes listed chats while earlier snapshots are unmodified
- [ ] 5.5 Unit test: a run carrying **both** personalization and a digest excludes both delimiters under full-current **and** transition compaction — the transition instruction is a separate code path and a regression there freezes other chats' excerpts into a permanent checkpoint
- [ ] 5.6 Unit test: compaction of a chat whose owner has since disabled the setting leaves the baseline and told-set untouched

## 6. `recency-digest/activation`

The only layer that changes observable behavior. Everything it switches on has already landed,
been tested, and been excluded from summarization.

- [ ] 6.1 Add the digest block to `apps/api/src/prompts/chat-default.md`, gated on `{{#if chats}}`, with pinned rendered above recent
- [ ] 6.2 Author the opening framing prose (data not instructions, ranks below system instructions and the current conversation, cannot grant tools or relax authorization) and the trailing restatement that instruction-following resumes
- [ ] 6.3 Add the truncation sentence stating each list is capped and older chats are not listed, without naming a retrieval tool
- [ ] 6.4 Add the compilation-date line, the two shown/total ratios, and the non-authoritative note stating entries are point-in-time and titles may since have been renamed; label each entry's date as last activity
- [ ] 6.5 Test, both halves of the gate: with the setting off **and no baseline**, the rendered prompt is byte-identical to the same template with the digest section removed; with the setting off **and a baseline already bound**, the chat keeps rendering it unchanged while emitting no appends and no re-bake
- [ ] 6.6 Test: the owner's effective-context receipt contains the rendered digest verbatim and exposes no host path or provider internal
- [ ] 6.7 End-to-end test: an opted-in owner's chat renders the digest, a delta appends on the next turn, and compaction re-bakes it without carrying digest content into the checkpoint
- [ ] 6.8 Update `README.md`, add the dated `CHANGELOG.md` entry, and remove the item from `ROADMAP.md` — this is the PR that ships the user-visible work, so the changelog entry belongs here rather than on an inert lower layer
- [ ] 6.9 Restrict rendered-markdown egress before activation ships — `allowedImagePrefixes`/`urlTransform` on the markdown renderer and an `img-src`/`connect-src` CSP — or record explicitly that activation shipped without it. The digest does not create this channel but raises what leaks through it
- [ ] 6.10 Rewrite #307's Scope, Boundaries, and Acceptance sections to match this design (system-prompt rail, message excerpts, eval gate all reversed), and comment on #326 recording the settings hierarchy this resolves
