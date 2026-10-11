## 1. Proposal layer

Tracks issue #891. Delivery stack:

```text
master <- bounded-reasoning-replay/proposal <- bounded-reasoning-replay/bound <- bounded-reasoning-replay/finalize
```

Process: [CONTRIBUTING](../../../CONTRIBUTING.md). Use `$gh-stack` for every
stack operation and `$openspec-apply-change` for implementation. Create the
implementation layer only after proposal approval. Publication and merge each
need their own authorization. Every layer has a self-review (SR) checkpoint
before draft -> ready and a GitHub review (GR) checkpoint after ready. For
finalize, both checkpoints follow archive movement as post-archive gates.

Each layer below lists its branch, parent, ownership, authored-size estimate
against its parent (tests, specs, and docs included; generated output counted
separately), exit evidence, and issue responsibility:

- `bounded-reasoning-replay/proposal` (parent `master`): this ledger, the
  proposal, the design, and three delta specs. Measured at about 1,000
  authored lines for the initial draft, about a third of them verbatim
  MODIFIED blocks. Exit: the OpenSpec
  proposal, Product Markdown, and Any change rows; review rounds committed
  separately; and approval of the published revision. References #891 and
  closes no issue.
- `bounded-reasoning-replay/bound` (parent `proposal`): the per-client wire
  declaration, the `buildContext` reasoning floor, the oldest-first floor
  computation, its wiring ahead of compaction selection, the measured D11
  trigger, the live smoke, and the README, `SPEC.md`, and CHANGELOG updates
  (design D1-D9). Estimated about 900 authored lines, with no generated
  output. Exit: the Workspace TypeScript, Product Markdown, and Any change rows,
  plus current-head CI green after ready. Its PR body carries `Closes #891` once
  every acceptance item in `proposal.md` is covered by a test or a recorded
  measurement, so the issue closes when this layer merges; nobody closes it by
  hand.
- `bounded-reasoning-replay/finalize` (parent `bound`): canonical spec
  synchronization, task records, and archive movement only. References #891
  and closes no issue.

Re-estimate each layer's authored size at its boundary and before
publication. Split a growing concern, or request a named exception, before
publishing an oversized layer.

- [ ] 1.1 [proposal] Obtain Leo's answers to the four questions in `proposal.md` ("Open for Leo"). Revise the delta specs, design, and tasks for any answer that differs from the recommendation, in its own commit.
- [ ] 1.2 [proposal] Run the review rounds on the proposal, design, and delta specs with `$iterative-review-refinement` (at least two independent reviewers per round). Verify each finding against the repository and the cited provider documentation, and commit each round separately.
- [ ] 1.3 [proposal] Verify, with a recorded sentence-level diff against `openspec/specs`, that every MODIFIED block reproduces master's requirement text and scenario headings, with only the edits the proposal names (`$openspec-delta-canonical-check`).
- [ ] 1.4 [proposal] Prove the layer with `pnpm exec openspec validate bounded-reasoning-replay --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, and obtain Leo's approval of the final revision.
- [ ] 1.5 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.6 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head until no actionable feedback is unresolved, before creating `bound`.

## 2. Bound layer

Branch `bounded-reasoning-replay/bound`, parent
`bounded-reasoning-replay/proposal`. Owns the oldest-first reasoning bound
and its evidence. Its PR body carries `Closes #891`.

- [ ] 2.1 [bound] Record the trigger D11 names (design D9). Run read-only SQL against the operator's database for: reasoning text bytes and `providerMetadata` bytes per assistant reply (p50, p95, max) from `messages.parts`; reasoning's share of `messages` storage, and `pg_total_relation_size` of `messages`; and the count of Runs whose `error->>'code'` is `context_incompatible` since #884 merged. Then make a one-off timing of `prepareAttemptForFirstStep`'s request assembly for the chat with the most reasoning. Commit no script. Verify by recording the queries and the numbers in this task and in the PR body.
- [ ] 2.2 [bound] Add the required wire declaration to the model-client contract (`model-client.ts`, design D6). Set it true in the Messages, Responses, and Codex clients, and false in the completions and OpenCode Go clients. Verify with `pnpm --filter api typecheck` and a factory unit test that asserts the declaration for every provider `type`.
- [ ] 2.3 [bound] Add the optional continuation floor to `buildContext` (design D3). Below the floor, a reply emits no reasoning parts and keeps its text, tool pairs, and context items, and a reasoning-only reply contributes nothing. With the option omitted, output is byte-identical to today. Update the file's header invariant. Verify with `context-builder.test.ts` cases for a multi-part Responses item, signed and redacted Anthropic parts, a reasoning-only reply, a reply split by a tool call, and the omitted option.
- [ ] 2.4 [bound] Add the floor computation beside `requestFitsContextWindow` in `compaction.ts` (design D3, D4, D5). Weigh each earlier reply's reasoning text once, take the smallest floor that fits, build once, confirm, and advance one reply until the request fits or the floor reaches its cap. The cap is the triggering message, or the most recent prior reply when that reply ends on a tool call and its result. Verify with unit tests: a fitting request gets no floor; the older reply goes first; a reply goes whole; a still-over request returns the capped floor; a latest reply ending on a tool pair is never below the floor while older replies are; a large-metadata, short-text part is weighed by its text, and a 40k-character metadata value leaves the result unchanged; the triggering message and anything after it are never below the floor.
- [ ] 2.5 [bound] Apply the floor in request assembly ahead of `evaluateCompactionTrigger`, on both passes of `prepareAttemptForFirstStep`, only for a client that declares the bound (design D1, D6). Verify with integration tests in `compaction-context.integration.test.ts`; record that each new case fails with the wiring removed. The cases:

  - (a) Default config: `runs.maxOutputTokens` null, no explicit `compactionThresholdTokens`. A request is over the window only through replayed reasoning, and its source model can no longer execute. The bound leaves out the oldest replies' reasoning, the threshold variant publishes a checkpoint summarized by the target model's client, the source model is never invoked, the target model is invoked, and the Run does not fail `context_incompatible`.
  - (a') The same setup with an explicit threshold above the bounded estimate. The target is invoked once with the bounded request, with the oldest reply's reasoning absent and the newest reply's reasoning and metadata present, and no checkpoint is published.
  - (b) The same setup on a completions client still fails `context_incompatible`.
  - (c) A switch to a smaller-window model that fits once older reasoning is left out never invokes the source model. Under the default config it is summarized by the target model; with an explicit threshold above the bounded estimate, it publishes no checkpoint.
  - (d) A request still over the window with every droppable reply's reasoning left out takes the window variant, as today.
  - (e) After (a'), the stored parts are byte-identical, and the history read and the markdown export include the reasoning that was left out.
  - (f) When the latest prior reply ends on a tool call and its result, that reply's reasoning is replayed while older replies' reasoning is left out.

  Also add a Messages-wire request-shape test showing the kept thinking blocks are an unbroken suffix with their signatures, and that the adaptive drop instruction is still present.

- [ ] 2.6 [bound] Run a bounded live smoke on a prefix-checking Anthropic model with adaptive thinking, and on an `openai-codex` model. For each, continue a chat that has at least three reasoning replies, under a model entry whose configured `contextWindowTokens` forces the floor above the first reply (design D2 risk). Verify and record that each request succeeds, that the Anthropic response's `inputTransformations` lists no `prefix_binding_mismatch` for a kept block, and that the stored parts are unchanged. On Anthropic, also probe the D4 [INFERENCE]: send a request whose latest prior reply ends on a tool pair with that reply's thinking removed, and record whether the API rejects it or disables thinking. If credentials are unavailable, record that and ask Leo before marking the PR ready.
- [ ] 2.7 [bound] Documentation. In the README's Messages-wire section, state that the oldest-first reasoning bound is the one llame-side removal of thinking, and that the bound does not apply to the completions wire. Correct `SPEC.md` §28.2's "persisted reasoning parts are excluded from replayed context" to the D15/D16 replay and the bound. Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 2.8 [bound] Prove the layer with `pnpm --filter api lint`, `typecheck`, the focused unit and integration suites from 2.2-2.5 (including `reasoning-metadata-replay.integration.test.ts` as a regression check), `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`. Measure the authored diff against the 900-line estimate. Once every acceptance item in `proposal.md` is covered, put `Closes #891` in the PR body, then publish the draft with `$gh-stack`.
- [ ] 2.9 [bound] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md` with one code-review and one ponytail-review subagent. Fix accepted findings with new commits, rerun the affected checks, update the PR body, and mark the PR ready.
- [ ] 2.10 [bound] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `finalize`.

## 3. Finalize layer

Branch `bounded-reasoning-replay/finalize`, parent
`bounded-reasoning-replay/bound`. This layer does spec synchronization, task
records, and archive movement only, and never an application fix. Enter the
branch with `$gh-stack` from the implementation top **before**
`$openspec-sync-specs` writes any canonical spec.

- [ ] 3.1 [finalize] Confirm with `$gh-stack` that `finalize` sits on the published, reviewed `bound` layer and that every task above is checked.
- [ ] 3.2 [finalize] Use `$openspec-sync-specs` to apply the three deltas. Verify with `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`, and check that every shipped scenario heading survives.
- [ ] 3.3 [finalize] Verify archive readiness with `openspec status --change bounded-reasoning-replay --json` and confirm every tracked task is checked. Then use `$openspec-archive-change`, and verify with strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Publish the finalize draft with `$gh-stack`, self-review its diff (SR), and mark it ready. Run the Ready-PR monitoring loop (GR), recheck stack bases and checks, and request merge permission. Merge only through `$gh-stack`.
