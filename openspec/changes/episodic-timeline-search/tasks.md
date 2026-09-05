Implementation is a single `gh stack` rooted on `master`, one PR per layer, bottom to top. The
bottom layer is this change itself — proposal, specs, design, and this task list — so the design is
reviewed and merged before any code builds on it. Every layer is published with
`gh stack submit --auto`, implemented with `$openspec-apply-change`, and monitored per
`CONTRIBUTING.md`; the finalize layer closes #198.

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

- [ ] 1.1 Extend `ChatsRepository.searchByOwner` with an optional `timeRange: { after?: Date; before?: Date; constraint: 'required' | 'preferred' }` parameter; for `required`, compose `first_message_at < before` / `last_message_at >= after` (each half only when its bound is present) into `scope.document` and an `EXISTS` over eligible messages in range (reusing the SQL eligibility mirror from `messages-repository.ts`) into `scope.parent`; verify by unit test that the emitted SQL with `timeRange` undefined is byte-identical to today's
- [ ] 1.2 Add an optional `rangePreference: { predicate: SQL; bonus: number }` block to `HybridSearchConfig` in `search/core/fusion.ts` that adds `bonus` to `doc_fused` rows matching the predicate; wire `preferred` to it with `bonus = 1 / (rrfK + 1)`; verify by unit test that the emitted SQL without the block is byte-identical to today's and that `rrfScore`-level arithmetic puts a near-tied in-range document ahead of an out-of-range one while a clear out-of-range winner stays first
- [ ] 1.3 Integration test for `required`: seed one owner with dated messages so that an exact match exists inside and outside `[after, before)`; verify the out-of-range Chat is absent from `searchByOwner`, the in-range Chat is present, a title-only Chat is present only when it has an eligible message in range, and a one-sided `after` or `before` applies exactly one clause
- [ ] 1.4 Integration test for `preferred`: seed an exact out-of-range match and a weak in-range match; verify the exact match ranks first, and that two seeded near-ties order in-range first
- [ ] 1.5 Add `ChatsRepository.timelineByOwner(ownerUserId, { after?, before?, limit })` returning `{ chatId, title, firstActivityAt, lastActivityAt, messageCount, firstSeq, lastSeq }` rows ordered `lastActivityAt DESC, chatId`, fetching `limit + 1`, under `SET LOCAL statement_timeout = 3000`, qualifying only eligible messages (user rows; assistant rows with `usage.status` absent or `completed`) with the explicit owner predicate inside the statement; verify by integration test on a dated corpus that regions, counts, and boundary sequences match the seeded data and that a Chat whose only in-range rows are system, tool, or retryable assistant rows is absent
- [ ] 1.6 Integration test that `messageCount`, `firstSeq`, and `lastSeq` ignore Chat `created_at`/`updated_at` — a Chat retitled inside the range with all eligible messages outside it is absent
- [ ] 1.7 Extend the RLS negatives: user B's required-range search and timeline request over a period in which only user A had activity (private and `visibility = 'public'`), and the empty-identity case for both; verify each fails when the owner policy is removed and passes with it
- [ ] 1.8 **Exit:** verify `pnpm --filter api typecheck`, `lint`, `test`, and `test:integration` pass, the web palette's `ChatsService.searchChats` call site is unchanged, and `RUN_SEARCH_EVAL=1` without a provider reproduces `BASELINE.md` byte-identically

## 2. `episodic-timeline-search/tool` — the two-mode contract (design D2, D3, D6, D11, D13)

- [ ] 2.1 Replace the `search_conversations` input schema with the flat strict object from design D11 (`mode`, optional `query`/`after`/`before`/`constraint`/`limit`) and its `superRefine` rules; verify by unit test that every invalid combination in the spec scenario "Invalid mode and field combinations never reach retrieval" is rejected with an invalid-argument observation and that no repository method is called
- [ ] 2.2 Verify by unit test that the admitted JSON Schema has root `type: "object"`, `additionalProperties: false`, no root `anyOf`/`oneOf`/`allOf`/`not`, and that both few-shot calls in the tool description parse successfully
- [ ] 2.3 Implement content mode: parse bounds to `Date`, embed the query before `runAs` as today, pass `timeRange` to `searchByOwner`, and for `required` omit any hydrated passage (lexical or vector-only) whose message timestamp is outside `[after, before)`; verify by unit test with a stubbed hydrator that an overlapping chunk resolving to an out-of-range message is dropped and an in-range one is kept with its own timestamp
- [ ] 2.4 Implement timeline mode over `timelineByOwner`: no embedding, no projection read, regions shaped exactly as the spec's activity-pointer requirement; verify by unit test that a region carries no excerpt, snippet, score, or generated text and that `firstSeq` parses under `conversationSourceMessageSeqSchema`
- [ ] 2.5 Add `appliedRange` (echoing only the bounds and constraint received) and `truncated` (from the `limit + 1` row) to the success envelope for both modes; verify by unit test that an omitted bound is absent from `appliedRange` and that rows carry no new fields
- [ ] 2.6 Keep `matchedBy`, per-leg ranks, scores, and omission reasons out of the result; move them to the existing `search_conversations` log line; verify by unit test over a serialized success that none of those keys appear
- [ ] 2.7 Update `apps/api/src/prompts/chat-default.md` with the temporal-guidance paragraph from the spec's "Temporal interpretation" requirement, placed after the existing recall paragraph, and verify the boot-time template validation passes for every probe combination
- [ ] 2.8 Update every scripted-model and integration test that emits `{ query, limit }` (`scripted-model-client.ts`, `run-execution-tools.integration.test.ts`, compaction and tool-observation tests) to the new shape; verify `test` and `test:integration` pass
- [ ] 2.9 Scripted-model integration test: a Run whose script calls timeline mode with an absolute day range, then `conversation_read` with the returned `firstSeq`, persists both observations and a final answer; and a script that calls timeline with no bound receives the invalid-argument observation and the Run continues
- [ ] 2.10 Verify by integration test that a vector-only winner outside a required range is omitted (known limitation, design D4) and that the same winner is returned with no range
- [ ] 2.11 **Exit:** verify `pnpm --filter api build` regenerates `openapi.json` with no unexpected diff, `typecheck`, `lint`, `test`, `test:integration` pass, and a manual dev-stack Run for "what did I discuss yesterday" produces a timeline call, reads, and a recap that reports `truncated` honestly when the range is over-full

## 3. `episodic-timeline-search/eval` — fixtures and documentation (design D8)

- [ ] 3.1 Add `range-required`, `range-preferred`, and `timeline` categories and dated fixtures to `apps/api/src/search/chat/eval/dataset.ts`, extending the harness to run them in CI against the lexical configuration with the assertions named in the spec scenario "Range and timeline fixtures are asserted"; verify `test:integration` passes and the existing floors are untouched
- [ ] 3.2 Record in `BASELINE.md` the `preferred` bonus constant as a hypothesis with its observed effect on the new fixtures, without tuning it
- [ ] 3.3 Update `docs/conversation-recall.md` (contract section: both modes, ranges, envelope, timeline pointer flow), `SPEC.md` §20 search sentence, `apps/api/AGENTS.md` tool note, add the dated `CHANGELOG.md` entry, and remove the #198 line from `ROADMAP.md`'s deferred backlog; verify `pnpm lint:markdown` and `pnpm format:check` pass
- [ ] 3.4 **Exit:** verify `pnpm lint`, `pnpm --filter api test:integration`, and `git diff --check` pass

## 4. `episodic-timeline-search/finalize` — spec sync and archive

Documentation and spec promotion only; never application fixes.

- [ ] 4.1 Run `$openspec-sync-specs` to promote the `chat-search` delta into `openspec/specs/chat-search/spec.md`; verify `pnpm exec openspec validate --specs --strict` passes
- [ ] 4.2 Confirm every task above is `- [x]` and `openspec status --change episodic-timeline-search --json` reports every artifact complete; stop if not
- [ ] 4.3 Run `$openspec-archive-change`; verify `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass
- [ ] 4.4 **Exit:** the finalize PR body carries `Closes #198`, and the stack is merged only with Leo's explicit permission via `gh stack merge`
