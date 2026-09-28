Delivery stack:

```text
master <- read-representations/proposal <- read-representations/parser <- read-representations/outline <- read-representations/finalize
```

This change is plane 3 of the three-plane read architecture. Plane 1
(`file-locator`) and plane 2 (`web-read-adapters`) are archived on `master`;
this change consumes both and must not duplicate their authority or network
policy. The `outline` layer modifies the rendered web adapter outcome (a
required media-type label), so it touches `apps/api/src/tools/web-read/adapters`
alongside `native-files.ts`, `read.md`, and docs.

The review budget is about 2,000 authored added-plus-deleted lines against the
immediate parent, including tests, specs, docs, and lockfile hand-authored
changes. Lockfile churn is generated and reported separately. Re-estimate each
layer before publication; split or request an exception before a layer exceeds
budget. `parser` has no operator-facing source authority or user behavior and
therefore owns no operator documentation or ROADMAP removal. `outline` owns the
user-facing documentation and dated changelog entry because it is the layer
that ships #572.

## 1. Proposal layer

Branch `read-representations/proposal`, parent `master`, owns `proposal.md`,
`design.md`, the `native-file-tools` delta, and this task ledger. Estimated
about 1,500 authored lines, measured against `master`. It closes no issue.
The branch was initialized by gh-stack before the change scaffold was written.

- [x] 1.1 Confirm with `$gh-stack` that `read-representations/proposal` is based on `master`, then confirm the proposal, design, delta spec, and task ledger contain no application code; verify with `git status --short` and an artifact listing.
- [x] 1.2 Verify every implementation claim and file:line citation in the four artifacts against the current worktree, including selector precedence, Knowledge/Skill/web splitters, the web ladder's Markdown methods, native line model, source bounds, package manifests, parser metadata, and the closed native error union; record any conflict in the proposal Open questions for stack reconciliation.
- [x] 1.3 Verify that the MODIFIED selector, Knowledge, and web-locator requirements reproduce every canonical sentence and scenario with only the recorded representation changes, and that every ADDED requirement has at least one `#### Scenario:` with positive and negative authority/content cases; use a bounded script or manual comparison against `openspec/specs/native-file-tools/spec.md`.
- [x] 1.4 Run `pnpm exec openspec validate read-representations --strict`, `pnpm exec prettier --write openspec/changes/read-representations/proposal.md openspec/changes/read-representations/design.md openspec/changes/read-representations/specs/native-file-tools/spec.md openspec/changes/read-representations/tasks.md`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; retain the command results as proposal-layer evidence.
- [x] 1.5 Commit the complete initial draft as one commit with `docs(openspec): propose read-representations`, a body naming #572, #801, and #544, and trailer `Co-authored-by: Claude <noreply@anthropic.com>`; verify the commit contains only proposal-owned artifacts.
- [x] 1.6 Complete the first adversarial review round with at least two independent reviewers over proposal, design, delta specs, and tasks; verify findings against code, canonical specs, and issues, fix accepted findings in a new commit, and record the round separately.
- [x] 1.7 Complete a second independent adversarial review round with at least two reviewers, covering selector split precedence, frontmatter/line model, source authority, web Markdown methods, bounds/error vocabulary, and MODIFIED-block preservation; verify convergence, fix accepted findings in a separate commit, and rerun affected checks.
- [x] 1.8 Complete proposal self-review against `REVIEW_GUIDE.md` and the approved issue scope, with attention to selector precedence, frontmatter/line model, source authority, web Markdown methods, bounds/error vocabulary, and MODIFIED-block preservation; fix accepted findings in new commits and rerun affected checks before draft -> ready.
- [x] 1.9 Rebase the proposal onto the `master` that archived `file-locator`, `web-read-adapters`, and `run-permission-modes`, then revise the change with Leo: media-type-keyed reader table, verbatim prefixed output, scope-with-ancestors, unparsed frontmatter key lines, streaming scanner with a differential oracle, and the adapter media-type label; rebuild the MODIFIED web-locator block from the current canonical text and add the MODIFIED adapter-contract block; rerun 1.3 and 1.4 and commit as a separate review round.
- [ ] 1.10 Complete Leo's own review of the revised proposal, then one independent adversarial review round over the revision covering the reader table, adapter labeling, scope/ancestor semantics, scanner conformance plan, frontmatter key rule, and MODIFIED-block preservation; fix accepted findings in a new commit and rerun affected checks.
- [ ] 1.11 After publication authorization and draft -> ready, run the proposal PR's GitHub review/CI loop to completion on the current head before creating `parser`.

## 2. Parser layer

Branch `read-representations/parser`, parent `read-representations/proposal`,
owns the shared Markdown structure scanner, its primitive, the dev-only oracle
dependency, and the differential and unit suites. Estimated about 1,100
authored lines plus generated lockfile churn, measured against the proposal
branch. It closes no issue and has no user-facing operator docs or ROADMAP
removal because `outline` is not advertised until the next layer.

- [ ] 2.1 Add `mdast-util-from-markdown` as a dev dependency of `packages/native-file-tools` (pinned to the lockfile's version, MIT), update the lockfile, and add a differential test harness that parses the CommonMark spec examples and the repository fixtures with mdast and extracts root-heading start lines under the native LF line model; verify the harness runs under the package's focused test command and adds no runtime dependency.
- [ ] 2.2 Implement `packages/native-file-tools/src/markdown-structure.ts` with the design D5 API: a one-pass block-level scanner over an iterable of native lines yielding root-level heading and frontmatter spans (`kind`, `depth`, `line`, `headEnd`, `endLine`, verbatim `label`) with early stop, covering ATX and setext headings, fenced and indented code, the seven HTML block kinds, blockquote and list-item containment with content-offset continuation, thematic break versus setext, and the closed line-one frontmatter span; verify with focused unit fixtures.
- [ ] 2.3 Add scanner tests for exact ATX/setext boundaries and `headEnd`, multi-line setext headings, duplicate headings, code/HTML/container exclusions, closed malformed frontmatter, CRLF frontmatter delimiters, unclosed opener behavior, Unicode, lone CR/CRLF/trailing LF, two headings on one native line (section-end clamp), empty/no-heading input, early stop, and deterministic repeated output; verify with the native package's focused test command.
- [ ] 2.4 Make the differential suite pass: the scanner's root-heading start lines equal mdast's over every CommonMark spec example and fixture; record any spec example excluded and why in the test file; verify the suite is part of the package's focused test command.
- [ ] 2.5 Prove the parser layer with affected package focused tests, typecheck/lint where defined, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; do not run unrelated project-wide suites.
- [ ] 2.6 Complete parser-layer self-review against `REVIEW_GUIDE.md`, checking dependency scope (dev-only), scanner memory (open-heading stack and block state only), source-coordinate preservation, and the absence of authority or index coupling; fix accepted findings in new commits and rerun focused checks before draft -> ready.
- [ ] 2.7 After ready, complete the GitHub review/CI loop for the parser layer on the current head with zero actionable unresolved feedback before creating `outline`.

## 3. Outline layer

Branch `read-representations/outline`, parent `read-representations/parser`,
owns representation selection, media-type derivation including the adapter
label, the Markdown outline reader across admitted sources, reader/result
integration, focused tests, `read` instructions, operator docs, and the dated
changelog entry. Estimated about 1,800 authored lines, measured against
`parser`. This is the functionality-completing layer and its PR body owns
`Closes #572`; it does not close #801, #544, or any sibling issue.

- [ ] 3.1 Add the compile-time reader table keyed by media type and member, with the `raw` and `outline` members and their `:` output class, after source resolution and content acquisition and before shared paging/result bounds; pass admitted decoded text, source identity, and scope only; preserve envelopes and no-authority behavior; verify ordinary reads remain unchanged in focused native/API tests.
- [ ] 3.2 Extend host, Knowledge, Skill, and web selector parsing for `:outline` and `:outline:<range>` (one `N`, `N-M`, or `N+K`) with outline matching after the raw form, after host literal probing, and before the web/host last-colon fallback; a comma list after `outline` is `invalid_selector` on host and web and `invalid_path` on Knowledge and Skill; preserve query/fragment/port rules, numeric ranges, and `:outline:raw` raw precedence on host/web; verify each splitter with positive and malformed/ambiguous cases.
- [ ] 3.3 Add media-type derivation: the file extension table (`.md`, `.markdown`, `.mdown`, `.mkd`; `.mdx` excluded), the web ladder stage labels, and a required `mediaType` on the rendered adapter outcome produced by the GitHub adapter (renders `text/markdown`, blobs by extension) and forwarded by the rewrite adapter from its inner render; verify unsupported JSON, PDF, binary, plain-text, raw-HTML, XML, `.mdx`, and JSON-blob cases return the member-specific `invalid_selector` while ordinary reads and adapter reads retain their current behavior.
- [ ] 3.4 Implement the Markdown outline reader over the scanner: verbatim prefixed lines for frontmatter delimiters and column-zero keys with the 32-key elision line, the root excerpt, each root heading's lines (setext underline included) and first body line, the 120-code-unit cut with `…`, the headingless and empty cases, scope restriction with the direct-ancestor chain of line `N`, early stop after the scope or budget, and `nextOffset` as the first omitted entry's source line; verify output against the delta-spec scenarios.
- [ ] 3.5 Apply `:outline` after web adapters over the labeled document, fail `representation_too_large` when the web plane truncated the adapter document, and fail `invalid_selector` for a directory result; verify with the adapter contract tests and the GitHub adapter integration fixtures.
- [ ] 3.6 Preserve source-specific envelopes and permissions end to end: admission denies the submitted suffix-bearing locator before any scan, directories fail `invalid_selector`, `catalogWindow` rejects `skill://:outline`, Knowledge keeps its Space identity and notice, Skill keeps path fields, and web keeps `path`, `finalUrl`, `method`, `adapter`, and `notes`; verify host/`kb://` structural equivalence and negative isolation scenarios.
- [ ] 3.7 Update `apps/api/src/prompts/tools/read.md` with one sentence for `:outline`, `docs/native-files.md` with the representation grammar, exact output examples, frontmatter and line-ending rules, scope/ancestor semantics, error vocabulary, unsupported-type behavior, the stale-coordinate warning, and source/security boundaries, and name the existing ±1 behavior "context lines"; add the dated `CHANGELOG.md` entry; document that host permission rules see the submitted `:outline` suffix and add a `kb://` projection test; verify with `pnpm lint:markdown`.
- [ ] 3.8 Add focused native/API tests for ordinary text/raw regression, host and Knowledge equivalence, Skill resources and `catalogWindow`, exact web ladder and adapter eligibility, source permissions, directories, unsupported types, fenced/list/blockquote code, setext boundaries, frontmatter variants, duplicate headings, native line endings, scope and ancestors, truncation and `nextOffset`, and stale-selection semantics; verify with the narrowest affected test commands and a local smoke script for one host, one `kb://`, and one adapter outline.
- [ ] 3.9 Prove the outline layer with affected package/API lint, typecheck, and focused tests where defined, `pnpm exec openspec validate read-representations --strict`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; measure the parent-relative authored diff before publication and report generated lockfile churn separately.
- [ ] 3.10 Complete outline-layer self-review against `REVIEW_GUIDE.md`, including permission-before-parse, envelope preservation, adapter label coverage, selector collision, untrusted-content framing, and error vocabulary; fix accepted findings in new commits and rerun affected checks before draft -> ready.
- [ ] 3.11 After ready, complete the GitHub review/CI loop for the issue-closing outline layer on the current head, verify the PR body contains `Closes #572` and explicitly says #801 remains open, and resolve all actionable feedback before creating `finalize`.

## 4. Finalize layer

Branch `read-representations/finalize`, parent `read-representations/outline`,
owns spec synchronization, checked task history, and archive movement only.
Estimated under 200 authored lines with rename-detected archive movement. It
closes no issue and MUST NOT repair application code.

- [ ] 4.1 Use `$gh-stack` to enter `read-representations/finalize` from the published, reviewed, CI-green `outline` head; verify all parser and outline tasks are checked and the immediate parent is correct before any spec synchronization.
- [ ] 4.2 Run `$openspec-sync-specs` for `native-file-tools`; if a later change on `master` modified the web-locator or adapter-contract requirement, reconcile by hand first, preserving both complete canonical scenario sets, then verify the synchronized canonical diff and the representation grammar.
- [ ] 4.3 Verify archive readiness with `pnpm exec openspec status --change read-representations --json`, `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; stop on any incomplete artifact or unchecked pre-archive task.
- [ ] 4.4 Run `$openspec-archive-change` only after readiness is proved, then verify the archive preserves checked task history, the final specs contain the synchronized representation requirements, and no application fix entered the finalize diff.

Post-archive gates, not pre-archive prerequisites: publish the finalize draft
with `$gh-stack` under existing authorization, self-review its actual
parent-relative diff (SR), mark ready, complete the GitHub-bot review/CI loop
(GR), recheck terminal CI, approvals, threads, and stack bases, and request
explicit merge permission. Merge only through `$gh-stack`.
