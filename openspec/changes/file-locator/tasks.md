## 1. Proposal layer

Delivery stack:

```text
master <- file-locator/proposal <- file-locator/implementation <- file-locator/finalize
```

The proposal branch is already initialized from `master` with `gh-stack`. It
owns only `proposal.md`, `design.md`, the two delta spec files, and this task
ledger. The implementation layer is intentionally one layer because the shared alias
classifier, its dispatch and projection call sites, tests, and docs are one
safety boundary and are estimated well below the roughly 2,000 authored-line
review budget. `web-read-adapters` and `read-representations` are independent sibling
stacks from `master`; neither is a dependency of this proposal.

- [ ] 1.1 [proposal] Complete two independent adversarial review rounds over the proposal, design, and both delta specs. Review authority smuggling, strict submitted-text parser cases, the rejected WHATWG/fileURLToPath alternative, selector preservation, mutation fencing, submitted/projected permission precedence, canonical MODIFIED requirement preservation, and the deferral of the source table to #936. Verify findings against the current repository, the issue, the parser spike, the OMP checkout, and the shared architecture report; commit each review round separately after the initial draft. Exit evidence is two review commits with no unresolved substantive finding and Leo's explicit approval of the published revision. Closes no issue.
- [ ] 1.2 [proposal] Verify every cited source line against the proposal branch and programmatically compare each MODIFIED requirement with its canonical counterpart. The comparison SHALL report canonical scenario count, delta scenario count, and missing scenario names for `native-file-tools` requirements "Native tools operate on absolute local regular files", "Exact edit replaces one current unique match", and "Write creates or explicitly replaces", plus the two `tool-call-permissions` requirements. Exit evidence is recorded in the implementation PR body or review record, not a new change artifact. Closes no issue.
- [ ] 1.3 [proposal] Prove the proposal layer with `pnpm exec openspec validate file-locator --strict`, `pnpm exec prettier --write openspec/changes/file-locator/proposal.md openspec/changes/file-locator/design.md openspec/changes/file-locator/tasks.md openspec/changes/file-locator/specs/native-file-tools/spec.md openspec/changes/file-locator/specs/tool-call-permissions/spec.md`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`. Do not run application builds, typechecks, or full test suites on this planning branch.
- [ ] 1.4 [proposal] Self-review the actual proposal diff against `REVIEW_GUIDE.md` and the approved scope before publication, fix accepted findings in separate commits, rerun the proposal proof commands, and mark the draft ready only after SR is complete.
- [ ] 1.5 [proposal] Publish/refresh the draft with `gh-stack` only after Leo's approval and publication authorization, then complete the GitHub review and current-head CI loop with no actionable unresolved feedback before creating `file-locator/implementation`.

## 2. Implementation layer

Branch `file-locator/implementation`, parent `file-locator/proposal`. Estimated
about 600 authored changed lines against the proposal branch, including focused
tests and docs. This is the functionality-completing layer and the only layer
that closes #929. It owns the shared `file:` classifier and decoder, the
`file://` decoding and refusal boundary, projected permission identity,
host delegation, prompt and operator docs, the `SPEC.md` §13.7 alias sentence,
the changelog entry, and focused verification.

- [ ] 2.1 [implementation] After proposal approval, create `file-locator/implementation` with `gh-stack` and run `$openspec-apply-change`. Add one pure module beside `apps/api/src/tools/permissions/locator-projection.ts`, importing no executor, that exports the ASCII-case-insensitive `file:` classifier and the strict decoder; call it before `parsePathScheme` in both `executeNative` and `projectNativeFilePath`, leave the existing `kb`, `skill`, and web branches unchanged, and retain the exact unknown-scheme result. Exit evidence: focused dispatch and projection unit assertions, a check that `native-files.ts` gains no import cycle, and `git diff --check`. Closes no issue.
- [ ] 2.2 [implementation] Implement a strict total local parser over submitted text, not WHATWG normalization or `fileURLToPath`: accept case-insensitive `file://<authority>/absolute`, `file:/absolute`, and reject `file:x`; allow only empty or case-insensitive `localhost` authority; reject missing paths, literal `?`, `#`, backslash, C0/DEL controls, malformed/non-UTF-8 escapes, `%2F`, and `%00`; decode each escape once, preserve `.` and `..`, retain spaces, and decode `%3A` before host selector handling. Decode before the existing literal-path probe and selector parser so directories, real paths, suggestions, bounds, and host result shapes remain unchanged. Bind and fence aliases exactly as host operations, and make `edit` and `write` accept them. Invalid aliases fail `invalid_path` at dispatch, before the executor check, without binding the Run; tests pin `file:////x` as `//x`, `file://%6Cocalhost/x` and `file://C|/x` as remote authorities, and authority refusal before literal-character refusal. Exit evidence: `packages/native-file-tools/src/path.test.ts`, `packages/native-file-tools/src/read.test.ts`, `packages/native-file-tools/src/mutate.test.ts`, and `apps/api/src/tools/native-files.test.ts` cover host/file equivalence, `file://localhost`, root listing, minimal form, selectors and `%3A`, POSIX `C:`/`C|` paths, remote authorities, empty query/fragment, controls, `%FF`, `%zz`, `%2F`, `%00`, and executor-unavailable behavior.
- [ ] 2.3 [implementation] Extend the native permission projection so submitted-text admission remains first, valid file aliases project to decoded host text plus selector while preserving dot segments, invalid aliases remain unchanged, and all-fields rejection uses the same pure function. Exit evidence: `apps/api/src/tools/permissions/locator-projection.test.ts` and `apps/api/src/tools/permissions/permissions.test.ts` cover a host-path reject catching `%70`, a minimal-form `file:/etc/%70asswd` refused by a `^/etc/` reject, a host-path allow admitting `file://`, an inert URL-form allow, a submitted `^file://` reject and case-insensitive `(?i)^file:` guidance, selector preservation, invalid-alias `no_allow` versus whole-tool `invalid_path`, remote authority, and MCP pass-through; `apps/api/src/runs/native-files-acceptance.integration.test.ts` or `apps/api/src/tools/native-files.integration.test.ts` covers the end-to-end permission and authority boundary where database-backed setup is required.
- [ ] 2.4 [implementation] Update `apps/api/src/prompts/tools/read.md`, `apps/api/src/prompts/tools/edit.md`, `apps/api/src/prompts/tools/write.md`, `docs/native-files.md`, and the native-file section of `SPEC.md` to document alias forms, host-only permission allows, authority/refusal rules, selectors, `%3A` with no escaped literal-colon form, decoded result `path`, POSIX drive and dot-segment behavior, mutation acceptance, and and one `SPEC.md` §13.7 sentence naming the alias and its host-path permission identity; do not describe the unshipped adapter or reader layers in `SPEC.md`. Add the dated `CHANGELOG.md` entry. Do not add configuration, credentials, a tool id, or remote behavior. Exit evidence: Product Markdown lint and a manual diff review against the delta specs.
- [ ] 2.5 [implementation] Record the acceptance evidence for #929 in the implementation PR body, including equivalent host/file read metadata, localhost authority, root listing, minimal form, selector after URL, `%3A`, edit/write, remote authority refusal before access, query/fragment and control refusal, encoded slash/NUL/non-UTF-8 refusal, host reject and allow projection cases, inert URL-form allow, and unchanged unknown-scheme text. Put `Closes #929` on this layer's PR only after those rows are verified. Closes #929.
- [ ] 2.6 [implementation] Prove the implementation layer with the focused tests named above, `pnpm exec openspec validate file-locator --strict`, `pnpm exec prettier --write` on all changed files, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; measure authored diff against the immediate parent and report generated churn separately. Complete SR against the actual draft diff, then publish/refresh with `gh-stack`, mark ready, and complete the GR/current-head CI loop before creating `file-locator/finalize`.

Shared-file rule: if `web-read-adapters` or `read-representations` lands before
this layer, rebase this branch and reconcile `apps/api/src/tools/native-files.ts`,
`apps/api/src/prompts/tools/read.md`, `apps/api/src/prompts/tools/edit.md`,
`apps/api/src/prompts/tools/write.md`, relevant docs, and `SPEC.md` while
preserving both changes. If this layer lands first, the sibling that lands
second rebases those files and keeps the alias classifier and its `SPEC.md` sentence.
If a sibling also MODIFIES the native-file-tools top requirement, the later
finalize step reconciles both complete requirement texts and their scenario
sets rather than dropping either change's clauses. `web-read-adapters` also
MODIFIES `tool-call-permissions` requirement "Match submitted string values
without serialization artifacts"; whichever sibling finalizes second
reconciles both clauses and all scenarios.

## 3. Finalize layer

Branch `file-locator/finalize`, parent `file-locator/implementation`. It owns
only canonical spec synchronization, task records, and archive movement, with
an estimated authored size below 200 lines. It never repairs application code.
Its SR and GR gates occur after archive movement.

- [ ] 3.1 [finalize] Confirm with `gh-stack` that `file-locator/finalize` is checked out on top of the reviewed, CI-green implementation layer and that every prior task is checked. Enter this branch before running `$openspec-sync-specs`.
- [ ] 3.2 [finalize] Run `$openspec-sync-specs` for `native-file-tools` and `tool-call-permissions`. If either sibling has archived first, reconcile the shared MODIFIED requirement and `SPEC.md` §13.7 by retaining the complete file-alias contract, the sibling's clauses, and all scenarios. `web-read-adapters` also MODIFIES `tool-call-permissions` requirement "Match submitted string values without serialization artifacts"; whichever finalizes second reconciles both clauses and all scenarios. Verify `openspec status --change file-locator --json` and the checked task ledger before archive movement.
- [ ] 3.3 [finalize] Run `$openspec-archive-change` only after readiness is proved. Verify archive preservation and `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`. Do not add implementation fixes on finalize.

Post-archive gates, not checklist tasks: self-review the actual finalize diff
(SR), publish the draft with `gh-stack`, mark ready only after SR, run the
GitHub review/current-head CI loop (GR), and request explicit merge permission.
Finalize closes no issue; #929 remains closed by the implementation layer.
