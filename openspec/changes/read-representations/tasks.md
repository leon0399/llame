# Tasks

Delivery stack:

```text
master <- read-representations/proposal <- read-representations/parser <- read-representations/outline <- read-representations/finalize
```

This change is plane 3 of the three-plane read architecture. The sibling
`read-file-locator` proposal owns plane 1 and the `file://` alias. The sibling
`read-web-adapters` proposal owns plane 2 and web adapter/render provenance.
Each stack remains independently reviewable from `master`; no branch may assume
that a sibling's application layer has merged. If a sibling and this change
touch the same `native-files.ts`, `read.md`, or documentation lines, the later
landing stack reconciles the files while retaining both approved contracts. If
the sibling changes a requirement named by this delta, the later finalize layer
reconciles the complete MODIFIED requirement and all scenarios before syncing.

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
about 1,300 authored lines, measured against `master`. It closes no issue.
The branch was initialized by gh-stack before the change scaffold was written.

- [ ] 1.1 Confirm with `$gh-stack` that `read-representations/proposal` is based on `master`, then confirm the proposal, design, delta spec, and task ledger contain no application code; verify with `git status --short` and an artifact listing.
- [ ] 1.2 Verify every implementation claim and file:line citation in the four artifacts against the current worktree, including the host selector parser, Knowledge/Skill/web splitters, source result bounds, web Markdown render labels, package manifests, and parser metadata; record any conflict with shipped code or canonical specs in the proposal's Open questions and message `Main` before commit.
- [ ] 1.3 Verify that the MODIFIED selector and Knowledge requirements reproduce every canonical sentence and scenario with only the recorded representation changes, and that every ADDED requirement has at least one `#### Scenario:` with positive and negative authority/content cases; use a bounded script or manual comparison against `openspec/specs/native-file-tools/spec.md`.
- [ ] 1.4 Run `pnpm exec openspec validate read-representations --strict`, `pnpm exec prettier --write openspec/changes/read-representations/proposal.md openspec/changes/read-representations/design.md openspec/changes/read-representations/specs/native-file-tools/spec.md openspec/changes/read-representations/tasks.md`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; retain the command results as proposal-layer evidence.
- [ ] 1.5 Complete proposal self-review against `REVIEW_GUIDE.md` and the approved issue scope, with particular attention to selector precedence, no-authority readers, stale coordinates, parser choice, and the #572/#801 non-framework boundary; fix findings in a new commit and rerun affected checks before draft -> ready.
- [ ] 1.6 After publication authorization, run the proposal PR's GitHub review/CI loop to completion on the current head; record any quota-exhausted reviewer skip, resolve actionable findings, and carry approval of the published revision before creating `parser`.
- [ ] 1.7 Commit the complete initial draft as one commit with `docs(openspec): propose read-representations`, a body naming #572, #801, and #544, and trailer `Co-authored-by: Claude <noreply@anthropic.com>`; verify the commit contains only proposal-owned artifacts.

## 2. Parser layer

Branch `read-representations/parser`, parent `read-representations/proposal`,
owns the shared Markdown structure parser and its focused tests. Estimated
about 700 authored lines plus generated lockfile churn, measured against the
proposal branch. It closes no issue and has no user-facing operator docs or
ROADMAP removal because `outline` is not advertised until the next layer.

- [ ] 2.1 Run the bounded throwaway parser spike from design D5 before adding a dependency: cover ATX, setext, duplicate headings, fenced and indented code, HTML blocks, valid and malformed line-one frontmatter, inline links, and Unicode; verify heading depth/text/positions, section ends, frontmatter span, and expected exclusion behavior, and record the command/result in the implementation PR rather than a tracked artifact.
- [ ] 2.2 Add the selected direct Markdown parser dependency to `packages/native-file-tools`, update the lockfile, and verify the package resolves the pinned version and MIT license; if the spike fails, stop and revise D5 before changing manifests.
- [ ] 2.3 Implement `packages/native-file-tools/src/markdown-structure.ts` with the design D5 API: one-based heading depth/text/start/section-end lines and a line-one frontmatter span, preserving source line offsets and excluding fenced/indented code, HTML blocks, and valid frontmatter from headings; verify with focused unit fixtures.
- [ ] 2.4 Add parser tests for ATX and setext headings, nested section boundaries, duplicate headings, code and HTML exclusions, malformed frontmatter continuation, valid frontmatter span, Unicode and inline text, empty/no-heading input, and deterministic repeated output; verify with the native package's focused test command.
- [ ] 2.5 Record the parser layer's no-op operator-doc and ROADMAP assessment in the draft PR, then prove the layer with the affected package's focused tests, typecheck/lint where defined, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; do not run unrelated project-wide suites.
- [ ] 2.6 Complete parser-layer self-review against `REVIEW_GUIDE.md`, checking dependency scope, parser bounds, source-coordinate preservation, and the absence of authority or index coupling; fix accepted findings in new commits and rerun the focused checks before draft -> ready.
- [ ] 2.7 After ready, complete the GitHub review/CI loop for the parser layer on the current head with zero actionable unresolved feedback before creating `outline`.

## 3. Outline layer

Branch `read-representations/outline`, parent `read-representations/parser`, owns
representation selection, the Markdown outline reader across admitted sources,
reader/result integration, focused tests, `read` instructions, operator docs,
and the dated changelog entry. Estimated about 1,500 authored lines, measured
against `parser`. This is the functionality-completing layer and its PR body
owns `Closes #572`; it does not close #801, #544, or any sibling issue.

- [ ] 3.1 Add the static representation selection seam after source resolution and before shared paging/result bounds; preserve the text default, `raw` behavior, source envelopes, abort behavior, and no-authority reader contract, and verify ordinary reads remain unchanged in focused native/API tests.
- [ ] 3.2 Extend host, Knowledge, Skill, and web selector parsing for `:outline` and `:outline:<ranges>` while preserving literal host precedence, scheme split order, encoded-colon behavior, web port/query/fragment rules, numeric multi-ranges, and refusal of `:raw:outline` and `:outline:raw`; verify each splitter with positive and malformed/ambiguous cases.
- [ ] 3.3 Add source-aware content-type selection for `.md`, `.markdown`, `.mdown`, and `.mkd`, explicitly exclude `.mdx`, and accept web outline only for an adapter/ladder result marked Markdown; verify unsupported JSON, PDF, binary, plain-text, raw-HTML, XML, and `.mdx` cases return `invalid_selector` while ordinary reads retain their current behavior.
- [ ] 3.4 Implement the Markdown outline reader over the parser layer: exact authored title/description lines, malformed-frontmatter note, heading indentation/text/range formatting, no-heading minimal output, equal-or-higher section boundaries, duplicate-range navigation, source-coordinate trust framing, and untrusted heading text; verify output against the delta-spec fixtures.
- [ ] 3.5 Enforce the 5 MiB decoded-input representation bound and `representation_too_large` failure without partial output, then pass generated outline lines through the existing result serializer for the 2,000-line/serialized cap, outline-line paging, truncation, and zero-based `nextOffset`; verify a large source, long outline, continuation, and oversized line behavior.
- [ ] 3.6 Preserve source-specific envelopes and permissions end to end: denied paths fail before parsing with the ordinary `permission_denied`, directories fail `invalid_selector` without listing reinterpretation, Knowledge keeps its Space identity and notice, Skill keeps path fields, and web keeps `path`, `finalUrl`, method, and notes; verify host/`kb://` structural equivalence and negative isolation scenarios.
- [ ] 3.7 Update `apps/api/src/prompts/tools/read.md`, `docs/native-files.md`, and the dated `CHANGELOG.md` entry with the representation grammar, frontmatter/output examples, bounds, unsupported-type behavior, stale-coordinate warning, and source/security boundaries; verify links, selector examples, and wording with `pnpm lint:markdown`.
- [ ] 3.8 Add focused native/API tests for ordinary text/raw regression, host and Knowledge equivalence, Skill and rendered-web eligibility, source permissions, directories, unsupported types, fenced code, setext headings, frontmatter, duplicate headings, paging, truncation, and stale-selection semantics; verify with the narrowest affected test commands and a local smoke script for one host and one `kb://` outline.
- [ ] 3.9 Prove the outline layer with affected package/API lint, typecheck, and focused tests where defined, `pnpm exec openspec validate read-representations --strict`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; measure the parent-relative authored diff before publication and report generated lockfile churn separately.
- [ ] 3.10 Complete outline-layer self-review against `REVIEW_GUIDE.md`, including permission-before-parse, envelope preservation, parser bounds, selector collision, untrusted-content framing, and sibling conflict handling; fix accepted findings in new commits and rerun affected checks before draft -> ready.
- [ ] 3.11 After ready, complete the GitHub review/CI loop for the issue-closing outline layer on the current head, verify the PR body contains `Closes #572` and explicitly says #801 remains open, and resolve all actionable feedback before creating `finalize`.

## 4. Finalize layer

Branch `read-representations/finalize`, parent `read-representations/outline`,
owns spec synchronization, checked task history, and archive movement only.
Estimated under 200 authored lines with rename-detected archive movement. It
closes no issue and MUST NOT repair application code.

- [ ] 4.1 Use `$gh-stack` to enter `read-representations/finalize` from the published, reviewed, CI-green `outline` head; verify all parser and outline tasks are checked and the immediate parent is correct before any spec synchronization.
- [ ] 4.2 Run `$openspec-sync-specs` for `native-file-tools`; if a sibling has modified the same requirement or selector wording, reconcile by hand first, preserving the complete canonical scenarios, plane ownership, and this change's explicit representation contract, then verify the synchronized canonical diff.
- [ ] 4.3 Verify archive readiness with `pnpm exec openspec status --change read-representations --json`, `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; stop on any incomplete artifact or unchecked pre-archive task.
- [ ] 4.4 Run `$openspec-archive-change` only after readiness is proved, then verify the archive preserves checked task history, the final specs contain the synchronized representation requirements, and no application fix entered the finalize diff.

Post-archive gates, not pre-archive prerequisites: publish the finalize draft
with `$gh-stack` under existing authorization, self-review its actual
parent-relative diff (SR), mark ready, complete the GitHub-bot review/CI loop
(GR), recheck terminal CI, approvals, threads, and stack bases, and request
explicit merge permission. Merge only through `$gh-stack`.
