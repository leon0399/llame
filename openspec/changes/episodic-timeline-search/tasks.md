Implementation is a single `gh stack` rooted on `master`, one PR per layer, bottom to top. The
bottom layer is this change itself — proposal, specs, design, and this task list — so the design is
reviewed and merged before any code builds on it. Every layer is published with
`gh stack submit --auto` through `$gh-stack`, implemented with `$openspec-apply-change`, and monitored per
`CONTRIBUTING.md`; the finalize layer closes #198. Only the proposal branch exists now: `sql`, `tool`, and `eval` are each created with `gh stack add` one at a time after Leo's explicit proposal approval and the previous layer's gates, and `finalize` only after every implementation layer is published and verified.

```text
(master) <- episodic-timeline-search/proposal
         <- episodic-timeline-search/sql
         <- episodic-timeline-search/tool
         <- episodic-timeline-search/eval
         <- episodic-timeline-search/finalize
```

Every layer leaves the repository shippable: after `sql` merges, both search surfaces behave exactly
as today because the new repository parameters are optional and unused; after `tool` merges, the new
contract is live. Each layer's final task is its exit criterion.

## 1. `episodic-timeline-search/sql` — range predicates, preferred term, timeline query (design D4, D5, D7, D9)

Owns the repository and the shared fusion kernel only. No tool, prompt, or schema change.

- [x] 1.1 Extract the inline message-eligibility SQL from `MessagesRepository.findConversationMessage` (user rows; assistant rows with `usage.status` absent or `completed`) into one shared fragment used by the reader and by every new `messages` predicate below; verify the reader's existing tests pass unchanged
- [x] 1.2 Fold `searchByOwner`'s trailing parameters into one options object (`{ limit, vector?, timeRange? }`, keeping the 4-parameter trip-wire) where `timeRange` is `{ after?: Date; before?: Date; constraint: 'required' | 'preferred' }`; for `required`, compose `first_message_at < before` / `last_message_at >= after` (each half only when its bound is present) into `scope.document` and an `EXISTS` over eligible messages in range into `scope.parent`, with the reader's identity guard (throw on empty owner id; `current_setting('app.current_user_id', true) = <owner>` inside the EXISTS); verify by unit test that the emitted SQL with `timeRange` undefined is byte-identical to today's and that `ChatsService.searchChats` is updated mechanically
- [x] 1.3 Add an optional `rangePreference: { predicate: SQL; weight: number }` block to `HybridSearchConfig` in `search/core/fusion.ts`: when present, `doc_fused` joins back to the document table and adds `weight / (rrfK + 1)` to rows whose span overlaps the range (the same overlap predicate as 1.2); wire `preferred` with `weight = 0.25` and a comment naming it a hypothesis for #600; verify by unit test that the emitted SQL without the block is byte-identical to today's, and by arithmetic test over `rrfScore` that with the shipped leg weights an in-range fts document about twenty ranks below an out-of-range one overtakes it while one a hundred ranks below does not
- [x] 1.4 Integration test for `required`: seed one owner with dated messages so that an exact match exists inside and outside `[after, before)`; verify the out-of-range Chat is absent from `searchByOwner`, the in-range Chat is present, a title-only Chat is present only when it has an eligible message in range, and a one-sided `after` or `before` applies exactly one clause
- [x] 1.5 Integration test for `preferred`: seed an exact out-of-range match and a weak in-range match; verify the exact match stays within the returned rows, and that an in-range document seeded to rank moderately below an out-of-range one overtakes it
- [x] 1.6 Add `ChatsRepository.timelineByOwner(ownerUserId, { after?, before?, limit })` returning `{ chatId, title, firstActivityAt, lastActivityAt, messageCount, firstSeq, lastSeq }` rows with `firstSeq`/`lastSeq` as `MIN(seq)`/`MAX(seq)` over in-range eligible rows, ordered `lastActivityAt DESC, chatId`, fetching `limit + 1`, under `SET LOCAL statement_timeout = 3000`, using the shared eligibility fragment, the explicit owner predicate, and the reader's identity guard (throw on empty owner id; `current_setting('app.current_user_id', true) = <owner>` inside the statement); verify by integration test on a dated corpus that regions, counts, and boundary sequences match the seeded data and that a Chat whose only in-range rows are system, tool, or retryable assistant rows is absent
- [x] 1.7 Integration test that `messageCount`, `firstSeq`, and `lastSeq` ignore Chat `created_at`/`updated_at` — a Chat retitled inside the range with all eligible messages outside it is absent
- [x] 1.8 Extend the RLS negatives: user B's required-range search and timeline request over a period in which only user A had activity (private and `visibility = 'public'`); and the empty-identity case for both **with user A's id passed as the owner parameter while A has a public chat** (the `messages_public_read` path), which must return zero regions and no metadata row; verify each fails when the owner policy or the in-statement identity guard is removed and passes with them
- [ ] 1.9 **Exit:** verify `pnpm --filter api typecheck`, `lint`, `test`, and `test:integration` pass (existing eval floors and `baseline.test.ts` counts included), and that the web palette's `ChatsService.searchChats` passes no `timeRange` so its results are unchanged

## 2. `episodic-timeline-search/tool` — the two-mode contract (design D2, D3, D6, D11, D13)

Owns the tool declaration, its executor, the packaged prompt paragraph, and the tests that exercise them. No repository or SQL change.

- [ ] 2.1 Replace the `search_conversations` input schema with the flat strict object from design D11 (`mode`, optional `query`/`after`/`before`/`constraint`/`limit`) and its `superRefine` rules, and re-parse the arguments with that Zod schema at the top of `execute` (as `conversation_read` does) returning `invalid_input` on failure; verify by unit test through `execute` that every combination in the spec scenario "Invalid mode and field combinations never reach retrieval" — including `constraint` with no bound in content mode — is rejected and that no repository method is called
- [ ] 2.2 Verify by unit test that the admitted JSON Schema has root `type: "object"`, `additionalProperties: false`, no root `anyOf`/`oneOf`/`allOf`/`not`, and that both few-shot calls in the tool description parse successfully
- [ ] 2.3 Implement content mode: parse bounds to `Date`, embed the query before `runAs` as today, pass `timeRange` to `searchByOwner`, and for `required` restrict the canonical-line matcher to the hydrated document's in-range messages before passage selection and omit a vector-only winner whose first-message anchor is outside `[after, before)`; verify by unit test with a stubbed hydrator that a chunk whose earliest match is out of range but whose later match is in range returns the in-range passage, and that a vector-only anchor outside the range is dropped
- [ ] 2.4 Implement timeline mode over `timelineByOwner`: no embedding, no projection read, regions shaped exactly as the spec's activity-pointer requirement with `kind: "timeline"` and only its allowlisted fields; verify by unit test that a region carries no excerpt, snippet, score, or generated text and that `firstSeq` parses under `conversationSourceMessageSeqSchema`
- [ ] 2.5 Add `appliedRange` (echoing only the bounds and constraint received) and `truncated` (candidate overflow: the `limit + 1` row is discarded before hydration) to the success envelope for both modes; verify by unit test that an omitted bound is absent from `appliedRange`, that `truncated: true` can accompany fewer than `limit` rows when hydration drops one, that content and metadata rows carry no new fields, and that the existing assertions on the single closed notice, the 500-code-point excerpt cap, and complete `{ chatId, messageSeq, offset, limit }` coordinates still pass for content results in both range constraints
- [ ] 2.6 Keep `matchedBy`, per-leg ranks, scores, and omission reasons out of the result and add no log line for them; verify by unit test over a serialized success that none of those keys appear
- [ ] 2.7 Update `apps/api/src/prompts/chat-default.md` with the temporal-guidance paragraph from the spec's "Temporal interpretation" requirement, placed after the existing recall paragraph, and verify the boot-time template validation passes for every probe combination
- [ ] 2.8 Update every scripted-model and integration test that emits `{ query, limit }` (`scripted-model-client.ts`, `run-execution-tools.integration.test.ts`, compaction and tool-observation tests) to the new shape; verify `test` and `test:integration` pass
- [ ] 2.9 Scripted-model integration test: a Run whose script calls timeline mode with an absolute day range, then `conversation_read` with the returned `firstSeq`, persists both observations and a final answer, and that after the Run terminalizes the reloaded assistant message part carries `appliedRange`, `truncated`, and every timeline region verbatim (no reshaping on replay); and a script that calls timeline with no bound receives the invalid-argument observation and the Run continues
- [ ] 2.10 Verify by integration test that a vector-only winner outside a required range is omitted (known limitation, design D4) and that the same winner is returned with no range
- [ ] 2.11 **Exit:** verify `pnpm --filter api build` regenerates `openapi.json` with no unexpected diff, `typecheck`, `lint`, `test`, `test:integration` pass, and a manual dev-stack Run for "what did I discuss yesterday" produces a timeline call, reads, and a recap that reports `truncated` honestly when the range is over-full

## 3. `episodic-timeline-search/eval` — fixtures and documentation (design D8)

Owns the eval dataset, `BASELINE.md`, and product documentation. No application code.

- [ ] 3.1 Add `range-required`, `range-preferred`, and `timeline` categories to `apps/api/src/search/chat/eval/dataset.ts`, extend the fixture shape with per-message `createdAt` (the dataset carries no timestamps today) and the seeder to honor it, add the dated fixtures, and extend the harness to run them in CI against the lexical configuration with the assertions named in the spec scenario "Range and timeline fixtures are asserted"; verify `test:integration` passes and the existing floors are untouched
- [ ] 3.2 Record in `BASELINE.md` `w_pref = 0.25` as a hypothesis with its observed effect on the new fixtures, without tuning it, and verify `baseline.test.ts` still agrees with the dataset counts
- [ ] 3.3 Update `docs/conversation-recall.md` (contract section: both modes, ranges, envelope, timeline pointer flow), `SPEC.md` §20 search sentence, `apps/api/AGENTS.md` tool note, add the dated `CHANGELOG.md` entry, and remove the #198 line from `ROADMAP.md`'s deferred backlog; verify `pnpm lint:markdown` and `pnpm format:check` pass
- [ ] 3.4 **Exit:** verify `pnpm lint`, `pnpm --filter api test:integration`, and `git diff --check` pass

## 4. `episodic-timeline-search/finalize` — spec sync and archive

Documentation and spec promotion only; never application fixes.

- [ ] 4.1 Run `$openspec-sync-specs` to promote the `chat-search` delta into `openspec/specs/chat-search/spec.md`; verify `pnpm exec openspec validate --specs --strict` passes
- [ ] 4.2 Confirm every task above is `- [x]` and `openspec status --change episodic-timeline-search --json` reports every artifact complete; stop if not
- [ ] 4.3 Run `$openspec-archive-change`; verify `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass
- [ ] 4.4 **Exit:** the finalize PR body carries `Closes #198`, and the stack is merged only with Leo's explicit permission via `gh stack merge`
