# Tasks

Tracks #1025 (parent #701; related #705, #572, #1018). The commented drafts in
the read description are owned by issues #935, #849, #937, #933, #934, #936,
and #801, #1072, #1073, #1074.

Delivery stack:

```text
master <- read-selector-members/proposal <- read-selector-members/grammar <- read-selector-members/sources <- read-selector-members/permissions <- read-selector-members/prompt-docs <- read-selector-members/finalize
```

`read-selector-members/proposal` owns the four planning artifacts and no
application code. It is estimated at about 1,300 authored lines against
`master`, most of it the canonical MODIFIED requirement reproductions in two
delta specs, and closes no issue.

`read-selector-members/grammar` owns `packages/native-file-tools`: the member
grammar, the order-insensitive raw split with canonical `raw:` output,
unresolved members on the read target, the forward line-count pass and
resolution for regular files, listings, and in-memory sources, the shared
`invalid_selector` message builder, and the package's focused tests. It is
estimated at 900-1,300 authored lines against the proposal layer and closes no
issue.

`read-selector-members/sources` owns the API sources: the web split and
messages, raw detection, the cut-document refusal for `-K`, the `kb://` and
`skill://` locator error type and messages, the catalog window and its
message, the native-files dispatch results, and their focused tests. It is
estimated at 900-1,400 authored lines against the grammar layer and closes no
issue.

`read-selector-members/permissions` owns the selector-free host and web
projection, its tests, and the operator permission runbook. It is estimated at
150-300 authored lines against the sources layer and closes no issue.

`read-selector-members/prompt-docs` is the functionality-completing layer. It
owns the restructured `read` description with every draft tagged, the
selector and locator reference pages, the dated `CHANGELOG.md` entry, and any
completed `ROADMAP.md` removal. It is estimated at 400-700 authored lines
against the permissions layer. Its PR owns `Closes #1025`.

`read-selector-members/finalize` owns only canonical spec synchronization for
`native-file-tools` and `tool-call-permissions`, checked task history, and
archive movement. It is estimated at about 1,000 authored lines against the
prompt-docs layer, using rename detection for archive movement, and closes no
issue. It MUST NOT repair application code.

Use `$gh-stack` for every branch, parent, publication, replay, and merge
operation. Use `$openspec-apply-change` only after proposal approval and only
for the current owning layer. Checked tasks record completed work but never
grant approval or publication permission. Keep each layer within the
approximately 2,000-authored-line review budget against its immediate parent
and report reproducible generated churn separately. Delivery policy:
[CONTRIBUTING.md](../../../CONTRIBUTING.md).

## 1. Proposal layer

Branch `read-selector-members/proposal`, parent `master`, owns `proposal.md`,
`design.md`, `specs/native-file-tools/spec.md`,
`specs/tool-call-permissions/spec.md`, and this ledger. Exit evidence is the
canonical delta proof, strict OpenSpec validation, Product Markdown lint, and a
clean parent-relative proposal diff. The branch was initialized before the
scaffold was written.

- [ ] 1.1 Confirm with `$gh-stack` that `read-selector-members/proposal` is based on `master` and that the branch contains only proposal-owned artifacts, verified with `git status --short` and an artifact listing
- [ ] 1.2 Verify every implementation claim and file:line citation in the four artifacts against `master` at `77e91506`, including the grammar gate, both splitters, the streaming window, the in-memory selectors, the catalog page, the permission projection, and the draft prompt; record any conflict in the proposal before review
- [ ] 1.3 Run a sentence-level diff of every MODIFIED requirement against canonical and prove that every canonical scenario heading remains, every difference is an intended edit named in `design.md`, and no requirement outside the proposal's Modified Capabilities list changed
- [ ] 1.4 Run `pnpm exec prettier --write openspec/changes/read-selector-members/`, `pnpm exec openspec validate read-selector-members --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; fix any artifact-only failure
- [ ] 1.5 Commit the complete initial proposal layer as one conventional commit, `docs(openspec): propose read-selector-members`, naming #1025 and #701 with a `Co-Authored-By` trailer; verify the commit contains only proposal-owned artifacts
- [ ] 1.6 Publish the proposal draft with `$gh-stack`, set the PR body (concern, issues served, stack position, decisions to review, commands run), self-review the parent-relative diff, and leave the PR for Leo's check at his direction; review rounds run only if he requests them
- [ ] 1.7 Obtain Leo's explicit approval of the published revision as a GitHub Approval or a top-level comment naming the revision; carry that approval forward and do not create `read-selector-members/grammar` before it

## 2. Grammar layer

Branch `read-selector-members/grammar`, parent `read-selector-members/proposal`,
owns `packages/native-file-tools` only. Use `$openspec-apply-change` for this
layer after proposal approval and after `$gh-stack` confirms the parent.

- [ ] 2.1 Extend the selector shape gate and member parser to `N`, `N-M`, `N+K`, `N-`, and `-K` in bare lists, `raw:` lists, and the outline member, keeping the 64-member cap and the positive safe-integer rules, with `-0` rejected; verify with focused path tests for each member alone and in comma lists, and flip the negative pins for `-1-3` and `1-`
- [ ] 2.2 Make the host split accept `:<list>:raw` and emit the canonical `raw:<list>` suffix, keeping literal-path precedence and the `:outline` ordering; verify with split tests for both orders, a literal file named `x:60-64:raw`, and `:outline:raw` unchanged
- [ ] 2.3 Carry unresolved end-relative members on the read target and add one resolution step that maps `N-` and `-K` against a supplied count with clipping, so every reader receives absolute members; verify with unit tests for clipping, `N-` past EOF, empty sources, and mixed lists such as `50-,-10`
- [ ] 2.4 Add the forward LF count pass for regular files, run before the ordinary read whenever a selector carries an end-relative member, matching the native line model for files with and without a trailing LF and for empty files; verify with stream tests on single, multi-range, raw, Markdown-ancestor, and outline reads including `:-20`, `:50-`, `:1-5,-20:raw`, and `:outline:-200`
- [ ] 2.5 Resolve end-relative members against the requested-level entry count for directory flat slices; verify with listing tests for `:-20` and `:5-`
- [ ] 2.6 Add the shared `invalid_selector` message builder naming the working forms and use it for every host grammar failure in place of the bare type string; verify with read tests asserting the message on `:nonsense`, `:-0`, and `:outline:1,3`
- [ ] 2.7 Run the package's focused tests, `lint`, and `typecheck`, then measure the parent-relative authored diff against the budget, complete SR of the actual diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings in new commits, and keep the PR draft until SR is complete
- [ ] 2.8 Publish the grammar draft with `$gh-stack`, mark it ready, and complete the GitHub-bot review, current-head CI, and monitoring loop with no actionable unresolved feedback before creating `read-selector-members/sources`

## 3. Sources layer

Branch `read-selector-members/sources`, parent `read-selector-members/grammar`,
owns `apps/api` read sources and their tests.

- [ ] 3.1 Make the web split accept `:<list>:raw` with canonical `raw:` output, replace the `:12-` hint with the shared forms message, and keep the `%3A` hint for a non-numeric suffix; verify with locator tests for `:12-` reading to the end, `:12+` naming the forms, `Special:-5` as a tail read, and `Special:Search` unchanged
- [ ] 3.2 Resolve end-relative members against the web render's line count, make raw detection see only the canonical suffix, and return `representation_too_large` naming the cut for a `-K` member on an adapter document cut at the document bound while `N-`, ordinary, and raw reads are unchanged; verify with result tests for `:-40` on a cut and an uncut render
- [ ] 3.3 Change the `kb://` and `skill://` locator parsers so a suffix outside the grammar on a locator that parses returns `invalid_selector` with the shared message, keeping `invalid_path` for a malformed locator part; verify with locator and native-files tests for `a:b.md`, `:5-10,,20-30`, `:raw:outline`, and `:5-`
- [ ] 3.4 Resolve end-relative members against the skill catalog's entry count and update the catalog's accepted-forms message; verify with native-files tests for `skill://:-10` and `skill://:95-`
- [ ] 3.5 Run the affected API focused tests, `lint`, and `typecheck`, measure the parent-relative authored diff, complete SR, fix accepted findings in new commits, and keep the PR draft until SR is complete
- [ ] 3.6 Publish the sources draft with `$gh-stack`, mark it ready, and complete the GitHub-bot review, current-head CI, and monitoring loop before creating `read-selector-members/permissions`

## 4. Permissions layer

Branch `read-selector-members/permissions`, parent
`read-selector-members/sources`, owns the admission projection and its runbook.

- [ ] 4.1 Project direct host paths and web locators with their split-off read selector removed before matching, text-only with no probe, and keep file-alias decoding and Workspace projection; verify with projection tests for `/tmp/file:1-2` admitted by an exact allow, `/home/u/.ssh/id_rsa:1-5` refused by a `$`-anchored reject, `https://example.test/guide:raw` matched as the canonical URL, and a clause written against `:raw:` matching nothing
- [ ] 4.2 Update `docs/product/operator/tool-call-permissions.md` so host and web clauses are documented as matching the resource without its selector, naming the literal-filename case; verify `pnpm lint:markdown`
- [ ] 4.3 Run the affected tests, `lint`, and `typecheck`, measure the diff, complete SR, and keep the PR draft until SR is complete
- [ ] 4.4 Publish the permissions draft with `$gh-stack`, mark it ready, and complete the GitHub-bot review, current-head CI, and monitoring loop before creating `read-selector-members/prompt-docs`

## 5. Prompt and documentation layer

Branch `read-selector-members/prompt-docs`, parent
`read-selector-members/permissions`, completes #1025.

- [ ] 5.1 Commit the restructured `apps/api/src/prompts/tools/read.md` with `:N-` and `:-K` live, both raw orders stated, the grammar stated once in `## Selectors`, the elision-footer rule removed, the document-extraction line commented, percent-encoding scoped to `kb://` and web, and every commented draft tagged `TODO(#N)` with its owning issue; verify the prompt rendering tests and that no uncommented form fails against the shipped grammar
- [ ] 5.2 Update `docs/product/reference/selectors.md`, `docs/product/reference/locators/{index,host-path,kb,skill,web}.md`, and `docs/product/reference/tools/read.md` with the member grammar, both raw orders, the unified error and message, the count pass, the cut-document refusal, and listing and catalog behavior; verify `pnpm lint:markdown`
- [ ] 5.3 Add the dated `CHANGELOG.md` entry naming both breaking changes and complete any `ROADMAP.md` removal; verify `pnpm lint:markdown` and `git diff --check`
- [ ] 5.4 Measure the diff, complete SR, publish the draft with `$gh-stack`, ensure the PR body carries `Closes #1025`, mark it ready, and complete the GitHub-bot review, current-head CI, and monitoring loop before creating `read-selector-members/finalize`

## 6. Finalize layer

Branch `read-selector-members/finalize`, parent
`read-selector-members/prompt-docs`, owns canonical synchronization, task
history, and archive movement only. Entry requires every implementation layer
to be published, reviewed, CI-green, and every task above checked.

- [ ] 6.1 Use `$gh-stack` to enter `read-selector-members/finalize` from the published prompt-docs head; verify the parent, complete task checkoffs, and archive readiness before any `$openspec-sync-specs` command writes canonical specs
- [ ] 6.2 Run `$openspec-sync-specs` for `native-file-tools` and `tool-call-permissions`, reconcile post-proposal canonical drift by hand before syncing, and verify every MODIFIED requirement retains its complete canonical sentence and scenario set plus only the approved edits
- [ ] 6.3 Run `pnpm exec openspec status --change read-selector-members --json`, `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; stop on any incomplete artifact, unchecked task, unsynced requirement, or application change in the finalize diff
- [ ] 6.4 Run `$openspec-archive-change` only after readiness is proved, then verify the moved archive preserves checked task history and the synchronized requirements, and that the finalize diff contains no application change

Post-archive gates, not pre-archive checkbox prerequisites: publish the
finalize draft with `$gh-stack`, self-review its parent-relative archive diff,
mark it ready, complete the GitHub-bot review and current-head CI loop,
recheck CI, approvals, threads, and stack bases, and request Leo's explicit
merge permission. Merge only through `$gh-stack`.
