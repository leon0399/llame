# Tasks

## 1. Proposal layer

Delivery stack:

```text
master <- file-locator/proposal <- file-locator/implementation <- file-locator/finalize
```

The proposal branch is already initialized from `master` with `gh-stack`. It
owns only `proposal.md`, `design.md`, the two delta spec files, and this task
ledger. The implementation layer is intentionally one layer because the source
table, alias parser, permission projection, tests, and docs are one safety
boundary and are estimated below the roughly 2,000 authored-line review
budget. `web-read-adapters` and `read-representations` are independent sibling
stacks from `master`; neither is a dependency of this proposal.

- [ ] 1.1 [proposal] Complete two independent adversarial review rounds over the proposal, design, and both delta specs. Review authority smuggling, WHATWG/fileURLToPath edge cases, selector preservation, mutation fencing, submitted/projected permission precedence, canonical MODIFIED requirement preservation, and the three-plane ownership boundary. Verify findings against the current repository, the issue, the Node spike, the OMP checkout, and the shared architecture report; commit each review round separately after the initial draft. Exit evidence is two review commits with no unresolved substantive finding and Leo's explicit approval of the published revision. Closes no issue.
- [ ] 1.2 [proposal] Verify every cited source line against the proposal branch and programmatically compare each MODIFIED requirement with its canonical counterpart. The comparison SHALL report canonical scenario count, delta scenario count, and missing scenario names for `native-file-tools` requirements "Native tools operate on absolute local regular files", "Exact edit replaces one current unique match", and "Write creates or explicitly replaces", plus the two `tool-call-permissions` requirements. Exit evidence is recorded in the implementation PR body or review record, not a new change artifact. Closes no issue.
- [ ] 1.3 [proposal] Prove the proposal layer with `pnpm exec openspec validate file-locator --strict`, `pnpm exec prettier --write openspec/changes/file-locator/proposal.md openspec/changes/file-locator/design.md openspec/changes/file-locator/tasks.md openspec/changes/file-locator/specs/native-file-tools/spec.md openspec/changes/file-locator/specs/tool-call-permissions/spec.md`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`. Do not run application builds, typechecks, or full test suites on this planning branch.
- [ ] 1.4 [proposal] Self-review the actual proposal diff against `REVIEW_GUIDE.md` and the approved scope before publication, fix accepted findings in separate commits, rerun the proposal proof commands, and mark the draft ready only after SR is complete.
- [ ] 1.5 [proposal] Publish/refresh the draft with `gh-stack` only after Leo's approval and publication authorization, then complete the GitHub review and current-head CI loop with no actionable unresolved feedback before creating `file-locator/implementation`.

## 2. Implementation layer

Branch `file-locator/implementation`, parent `file-locator/proposal`. Estimated
about 900 authored changed lines against the proposal branch, including focused
tests and docs. This is the functionality-completing layer and the only layer
that closes #929. It owns the static source table, `file://` normalization and
refusal boundary, projected permission identity, host delegation, prompt and
operator docs, the three-plane `SPEC.md` paragraph, the changelog entry, and
focused verification.

- [ ] 2.1 [implementation] After proposal approval, create `file-locator/implementation` with `gh-stack` and run `$openspec-apply-change`. Add the five-entry source table for host, `file`, `kb`, `skill`, and HTTP(S), with supported operations, projection, and executor; make native dispatch and `locator-projection.ts` consume the same table; preserve existing scheme behavior and the exact unknown-scheme result. Exit evidence: focused source dispatch and projection unit assertions plus `git diff --check`. Closes no issue.
- [ ] 2.2 [implementation] Implement the local `file://` alias using WHATWG URL parsing and `fileURLToPath` semantics with explicit validation for empty paths, non-local authority, query, fragment, malformed escapes, encoded `/`, NUL, and POSIX drive-form behavior. Normalize before the existing host selector/parser so literal-path precedence, selectors, directories, real paths, suggestions, bounds, and host result shapes remain unchanged. Bind and fence aliases exactly as host operations, and make `edit` and `write` accept them. Exit evidence: `packages/native-file-tools/src/path.test.ts`, `packages/native-file-tools/src/read.test.ts`, `packages/native-file-tools/src/mutate.test.ts`, and `apps/api/src/tools/native-files.test.ts` cover host/file equivalence, `file://localhost`, selectors, POSIX `file:///C:/x`, mutations, authority/query/fragment/encoded-slash/NUL refusals, and executor-unavailable behavior.
- [ ] 2.3 [implementation] Extend the native permission projection so submitted-text admission remains first, valid file aliases project to decoded normalized host text plus selector, invalid aliases remain unchanged, and all-fields rejection uses the same projection. Exit evidence: `apps/api/src/tools/permissions/locator-projection.test.ts` and `apps/api/src/tools/permissions/permissions.test.ts` cover a host-path reject catching `%70`, a host-path allow admitting `file://`, a submitted `^file://` reject, selector preservation, invalid remote authority, and MCP pass-through; `apps/api/src/runs/native-files-acceptance.integration.test.ts` or `apps/api/src/tools/native-files.integration.test.ts` covers the end-to-end permission and authority boundary where database-backed setup is required.
- [ ] 2.4 [implementation] Update `apps/api/src/prompts/tools/read.md`, `docs/native-files.md`, and the native-file section of `SPEC.md` to document the alias, authority/refusal rules, selectors, normalized result `path`, POSIX drive behavior, mutation acceptance, and the three read planes with sibling owners. Add the dated `CHANGELOG.md` entry. Do not add configuration, credentials, a tool id, or remote behavior. Exit evidence: Product Markdown lint and a manual diff review against the delta specs.
- [ ] 2.5 [implementation] Record the acceptance evidence for #929 in the implementation PR body, including equivalent host/file read metadata, localhost authority, selector after URL, edit/write, remote authority refusal before access, query/fragment refusal, encoded slash/NUL refusal, host reject and allow projection cases, and unchanged unknown-scheme text. Put `Closes #929` on this layer's PR only after those rows are verified. Closes #929.
- [ ] 2.6 [implementation] Prove the implementation layer with the focused tests named above, `pnpm exec openspec validate file-locator --strict`, `pnpm exec prettier --write` on all changed files, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; measure authored diff against the immediate parent and report generated churn separately. Complete SR against the actual draft diff, then publish/refresh with `gh-stack`, mark ready, and complete the GR/current-head CI loop before creating `file-locator/finalize`.

Shared-file rule: if `web-read-adapters` or `read-representations` lands before
this layer, rebase this branch and reconcile `apps/api/src/tools/native-files.ts`,
`apps/api/src/prompts/tools/read.md`, relevant docs, and `SPEC.md` while
preserving all three planes. If this layer lands first, the sibling that lands
second rebases those files and keeps the source-table and architecture changes.
If a sibling also MODIFIES the native-file-tools top requirement, the later
finalize step reconciles both complete requirement texts and their scenario
sets rather than dropping either plane's clauses.

## 3. Finalize layer

Branch `file-locator/finalize`, parent `file-locator/implementation`. It owns
only canonical spec synchronization, task records, and archive movement, with
an estimated authored size below 200 lines. It never repairs application code.
Its SR and GR gates occur after archive movement.

- [ ] 3.1 [finalize] Confirm with `gh-stack` that `file-locator/finalize` is checked out on top of the reviewed, CI-green implementation layer and that every prior task is checked. Enter this branch before running `$openspec-sync-specs`.
- [ ] 3.2 [finalize] Run `$openspec-sync-specs` for `native-file-tools` and `tool-call-permissions`. If either sibling has archived first, reconcile the shared MODIFIED requirement and `SPEC.md` architecture paragraph by retaining the complete file-alias source contract, the sibling's plane clauses, all scenarios, and the source/adapter/representation ownership order. Verify `openspec status --change file-locator --json` and the checked task ledger before archive movement.
- [ ] 3.3 [finalize] Run `$openspec-archive-change` only after readiness is proved. Verify archive preservation and `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`. Do not add implementation fixes on finalize.
- [ ] 3.4 [finalize] After archive movement, self-review the actual finalize diff (SR), publish the draft with `gh-stack`, mark ready only after SR, run the GitHub review/current-head CI loop (GR), and request explicit merge permission. Finalize closes no issue; #929 remains closed by the implementation layer.
