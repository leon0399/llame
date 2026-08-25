## 1. Versioned Context-Part Contract

- [ ] 1.1 Add failing API unit tests for a v2 `data-context` part carrying complete `data.text`, strict core-shape validation, opaque unknown producer/form replay, producer-metadata validation for machine consumers, and inert v1 data-only replay; verify the focused tests fail for the intended missing behavior.
- [ ] 1.2 Implement the v1/v2 types, validators, and generic literal replay path without changing writers; verify the focused context-item tests pass and existing v1 producer tests remain green during the preparation phase.
- [ ] 1.3 Add failing context-builder tests proving v2 blocks replay verbatim after producer-renderer wording changes, preserve stored part order without the current producer sort, occupy one content block each, and record empty contributions for v1 parts; verify those regressions fail before the builder change.
- [ ] 1.4 Update context assembly to copy v2 text and stored order directly into model content and `RunContextItem` records while retaining the preparation-phase v1 behavior behind an explicit cutover boundary; verify the focused context-builder and context-item suites pass.

## 2. Render-Once Producer Cutover

- [ ] 2.1 Add failing producer tests that require model-switch, availability, recency-digest delta/supersession, and temporal factories to persist the complete canonical envelope plus metadata, including author-time neutralization and truthful `Message received` temporal formatting; verify every producer case fails before writer changes.
- [ ] 2.2 Refactor producer factories to validate semantic input and render complete v2 text exactly once, retaining the existing payloads only as non-rendering metadata; verify all focused producer tests pass.
- [ ] 2.3 Add failing chat-binding tests for atomic v2 part persistence, canonical author-time producer order, one temporal row per accepted user turn, and rejection of client-authored v2 parts; verify the tests fail before binder changes.
- [ ] 2.4 Cut chat binding over to v2 factories and stored order, then switch v1 message parts from preparation compatibility to inert legacy behavior; verify chat-loop unit and integration tests pass for all four attached producers.
- [ ] 2.5 Add regression coverage proving a private owner fork copies v2 parts byte-for-byte, including original temporal text and Run linkage, while v1 parts remain stored but inert; verify the focused fork integration suite passes.

## 3. Immutable Compaction Checkpoints

- [ ] 3.1 Add `compactions.model_text` as a nullable text column through the default Drizzle generation path, update schema snapshots/types, and verify `pnpm --filter api db:generate` produces no additional uncommitted schema delta after the migration is applied.
- [ ] 3.2 Add failing repository and compaction tests requiring every new ordinary and transition compaction to persist non-empty raw `summary` and complete `modelText` atomically while existing rows may remain null; verify the focused tests fail before implementation.
- [ ] 3.3 Render and persist complete checkpoint text when a compaction row is created, retain raw summary for UI/lineage/later summarization, and verify repository plus full-current and transition-compaction tests pass.
- [ ] 3.4 Add failing context-builder tests proving non-null `modelText` replays verbatim after checkpoint-renderer changes and null legacy rows continue through the legacy renderer until superseded; verify both paths fail before the read change.
- [ ] 3.5 Update compaction reads and context assembly to prefer persisted `modelText` with the explicit null fallback, and verify checkpoint placement, retained-history, re-compaction, and Run-record tests pass.
- [ ] 3.6 Extend migration integration coverage to prove existing compactions remain null and readable, new compactions persist text, no backfill occurs, and tenant RLS remains enforced; verify the focused database integration suite passes.

## 4. Execution, Receipts, and Privacy Boundaries

- [ ] 4.1 Add failing run-execution tests proving transition-compaction detection still uses validated model-switch metadata while the provider request and `runs.context_items` copy persisted v2 text exactly; verify the tests fail before execution-path changes.
- [ ] 4.2 Update transition gating and final-request recording for v2 metadata, rebuilt requests, legacy empty contributions, and persisted checkpoint text; verify focused run-execution and context-receipt suites pass.
- [ ] 4.3 Add failing API projection tests proving owner message responses retain v2 private parts, public shares and shared forks strip all context-item text/metadata, ordinary exports omit them, and list/search projections index only visible text; verify the intended boundary failures before mapper changes.
- [ ] 4.4 Update API mappers and search/export/fork projections only where the v2 shape requires it, preserving the existing owner/private and datastore isolation boundaries; verify DTO, public-share, fork, search, and cross-tenant negative tests pass.

## 5. Web Compatibility

- [ ] 5.1 Add failing web history tests for generic v1/v2 `data-context` swallowing, validated v2 model-switch metadata, original `runId` inspection, and no rendering of persisted reminder text as ordinary content; verify the focused web tests fail before parser changes.
- [ ] 5.2 Update web types, history merging, and model-switch boundary parsing for v2 while treating every context-part version as hidden control content; verify the focused history and chat-page tests pass.
- [ ] 5.3 Regenerate Orval bindings from the updated API contract if generation output changes, and verify generated files are clean after a second generation run and the web typecheck passes.

## 6. Rollout Contract and Product Records

- [ ] 6.1 Update the API deployment runbook and `docs/scaling.md` with the compatible-reader deployment, worker-first rollout, writer quiesce/drain, v2 cutover, post-cutover database invariants, and rollback behavior; verify `pnpm lint:markdown` passes.
- [ ] 6.2 Update code comments and tests that currently claim semantic payload re-rendering or whole-message byte identity, narrowing them to persisted context-block text and stored order; verify `rg` finds no stale claim that v2 text is regenerated from payload.
- [ ] 6.3 Add a dated `CHANGELOG.md` entry describing immutable post-cutover context-item replay, the intentional v1 reminder loss, and the legacy checkpoint fallback; verify `pnpm lint:markdown` passes. This is unplanned corrective work, so do not add it to `ROADMAP.md`.

## 7. Verification

- [ ] 7.1 Run `openspec validate persist-rendered-context-items --strict`, `pnpm lint:markdown`, `pnpm --filter api lint`, `pnpm --filter api typecheck`, and `pnpm --filter api test`; record and fix every failure before proceeding.
- [ ] 7.2 Run the affected API integration projects covering context-item cutover, chat binding, compaction, run execution, receipts, forks, public shares, search, migrations, and RLS; record the exact command and confirm no suite skipped for missing Postgres.
- [ ] 7.3 Run `pnpm --filter web lint`, `pnpm --filter web typecheck`, and `pnpm --filter web test`; record and fix every failure.
- [ ] 7.4 Build affected workspaces sequentially with `pnpm --filter api build` followed by `pnpm --filter web build`, then run `pnpm format:check`; do not substitute the unbounded root build, and report any environment failure separately from repository failures.
