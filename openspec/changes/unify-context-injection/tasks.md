Task groups map one-to-one onto stacked branches, bottom to top:
`context-injection/spec` → `rail` → `cutover` → `receipt` → `prompt` → `close`.
Every layer must be green on its own: because no compatibility layer is retained,
the shape change in `cutover` is atomic and cannot be split further.

## 1. context-injection/spec — planning artifacts only

- [ ] 1.1 Commit the OpenSpec change (`proposal.md`, `design.md`, `specs/**`, `tasks.md`) and verify `openspec validate unify-context-injection --strict` passes
- [ ] 1.2 Commit `docs/research/harness-transparency/2026-08-21-context-form-design-space.md` and verify `pnpm lint:markdown` passes
- [ ] 1.3 Verify this layer changes no file under `apps/` or `packages/`

## 2. context-injection/rail — envelope and part primitives, not yet wired

- [ ] 2.1 Add one part module defining the `data-context` envelope (`v`, `producer`, `form`, `runId`, `payload`) with a single shared validation kernel, and verify unit tests cover envelope acceptance, exact-key-set rejection of extra fields, the `notice`/`snapshot`/`checkpoint` vocabulary, and that an unrecognized form is treated as absent
- [ ] 2.2 Implement unknown-producer tolerance — parses, is recorded, renders nothing — and verify a part naming an unregistered producer neither throws nor reaches the rendered request
- [ ] 2.3 Implement the envelope renderer: `<system-reminder producer="…" form="…">` with the one-line system-owned provenance statement and safely escaped attributes, and verify a unit test asserts the rendered shape and attribute escaping
- [ ] 2.4 Implement the fixed producer precedence order (`effective-context-change` → `tool-availability` → `recency-digest` → user text) as a shared ordering function, and verify a unit test asserts the order for every subset of producers
- [ ] 2.5 Implement one-text-block-per-item assembly and verify a test asserts the `ModelMessage` content array shape, including that a turn with no item still collapses to a single block
- [ ] 2.6 Verify this layer wires no producer: `rg` finds no call from `context-builder.ts` into the new module yet, and the existing suites pass unchanged

## 3. context-injection/cutover — atomic shape change

- [ ] 3.1 Move model-switch authoring to `producer: 'effective-context-change'`, `form: 'notice'`, with a closed single-valued `cause` whose only member is `model`, and verify the `model-system-prompts` switch scenarios pass against the new envelope
- [ ] 3.2 Move availability authoring to `producer: 'tool-availability'`, dropping the `<runtime-tool-availability>` delimiter while retaining epoch semantics, group headings, and closed reason codes, and verify the `tool-calling` availability suites pass unchanged apart from the envelope
- [ ] 3.3 Move digest deltas to `form: 'notice'` and the supersession marker to `form: 'snapshot'` under `producer: 'recency-digest'`, and verify the digest delta and supersession scenarios pass
- [ ] 3.4 Render the compaction checkpoint through the shared envelope with `form: 'checkpoint'`, keeping the `compactions` table and its standalone leading-message placement, and verify compaction integration tests assert the new envelope and unchanged supersession-by-`uptoSeq` behavior
- [ ] 3.5 Add the precedence statement to items whose payload carries content llame did not author, and verify a test asserts it is present on digest items and absent from items rendered only from ids and reason codes
- [ ] 3.6 Apply `sanitizeAuthoredText` when projecting visible user text and tool results into model context, shrink `RESERVED_TAG_NAMES` to the single rail delimiter, and verify negative tests that a forged envelope in user text and in a tool result is escaped while the stored rows are unchanged
- [ ] 3.7 Verify by test that replayed assistant text is byte-identical, including an assistant turn containing the delimiter name inside a code sample
- [ ] 3.8 Delete `model-context-part.ts`, `tool-availability-part.ts`, and `recency-digest-part.ts` with their duplicated `UUID_PATTERN`/`isExactRecord` copies, and verify `rg` finds no remaining duplicate of either helper in `apps/api/src`
- [ ] 3.9 Replace `apps/web/lib/services/chat/history.ts`'s `data-model-context` type, guard, and its own copies of `UUID_PATTERN`/`isExactRecord` with the shared part shape, and verify `pnpm --filter web lint` and its unit tests pass
- [ ] 3.10 Replace the per-part-type branches in `apps/web/app/(chat)/components/chat-page.tsx` with one branch keyed on the unified part type rendering nothing, and verify a test asserts no `unsupported part type` text appears for an unknown producer
- [ ] 3.11 Verify the shipped model-switch boundary still renders from the reshaped part and that no new context is surfaced in the UI by this layer
- [ ] 3.12 Author the hand-authored cleanup migration stripping legacy `data-model-context`, `data-tool-availability`, and `data-recency-digest` parts from `messages.parts`, and record it in the `apps/api/AGENTS.md` migration exception ledger with its regeneration and verification requirements
- [ ] 3.13 Verify by integration test that no legacy context part remains after the migration, and that a chat predating the cutover loads without error despite losing its context parts

## 4. context-injection/receipt — per-run record of injected items

- [ ] 4.1 Add the additive `runs.context_items` jsonb column with a generated migration, and verify a schema test asserts it inherits `runs_owner` RLS and appears in no public-read path
- [ ] 4.2 Record each Run's rendered items with producer, form, and residency at bind time, and verify an integration test asserts the record matches the request actually sent
- [ ] 4.3 Verify by test that two Runs reusing one content-addressed effective-context snapshot each record their own distinct items
- [ ] 4.4 Verify by test that the record is absent from public-share responses, transcript exports, and search projections

## 5. context-injection/prompt — packaged prompt and operator documentation

- [ ] 5.1 Add the detailed envelope-describing section to `apps/api/src/prompts/chat-default.md` covering all six points the spec enumerates, and verify `chat-default.test.ts` asserts each point is present
- [ ] 5.2 Verify by test that an operator `systemPromptFile` override removes the prompt section while injected items remain self-identifying and still carry precedence where required
- [ ] 5.3 Record the residency decision procedure and the receipt non-erasure disclosure in `apps/api/AGENTS.md`, and verify `pnpm lint:markdown` passes
- [ ] 5.4 Add the coordinated rollout entry to `apps/api/AGENTS.md` and `docs/scaling.md` matching design.md's Migration Plan, including that stripped parts are not recoverable by rollback
- [ ] 5.5 Add the dated `CHANGELOG.md` entry and verify `ROADMAP.md` needs no removal for this change
- [ ] 5.6 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api build`, `pnpm --filter web build`, `pnpm lint`, and `pnpm lint:markdown`, and verify all pass with no suite silently skipped

## 6. context-injection/close — sync and archive

- [ ] 6.1 Run `/opsx:sync` to fold the delta specs into `openspec/specs/` and verify `openspec validate --strict` passes for every touched capability
- [ ] 6.2 Run `/opsx:archive` and verify the change moves under `openspec/changes/archive/` with its dated prefix
- [ ] 6.3 Verify `SPEC.md` indexes the new `context-injection` capability and that its cross-references from `model-system-prompts`, `tool-calling`, and `chat-recency-digest` resolve
