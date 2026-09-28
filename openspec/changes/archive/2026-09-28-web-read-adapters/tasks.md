# Tasks

Delivery is a linear gh-stack. The proposal branch already exists and contains
planning artifacts only:

```text
master <- web-read-adapters/proposal <- web-read-adapters/contract
       <- web-read-adapters/github-threads <- web-read-adapters/github-code
       <- web-read-adapters/finalize
```

Each implementation layer is created only after the proposal revision is
approved and its parent is the current stack top. Estimates are authored
changed lines against the immediate parent, including tests, specs, and docs;
each stays within the approximately 2,000-line review budget. Generated output
is not budgeted, but any generated churn is reported and verified. Use
`$gh-stack` for stack operations and `$openspec-apply-change` for implementation.

The sibling changes are `file-locator` (plane 1 and the three-plane
architecture section, archived on `master` in #994) and `read-representations`
(plane 3). All three modify `native-file-tools`. This stack is rebased on the
archived `file-locator`: its MODIFIED copy of `tool-call-permissions` "Match
submitted string values without serialization artifacts" carries the
file-alias clause and scenarios, and none of the web requirements this change
modifies were touched. `read-representations` MODIFIES the web locator
requirement that enumerates selector grammar (currently "Web locators are
fetched by the native read tool").
Whichever sibling finalizes second reconciles all clauses and scenarios by
requirement, not by taking one whole delta. If `read.md`, `docs/web-read.md`,
`CHANGELOG.md`, or example configuration overlaps, the layer landing second
resolves the textual conflict against both approved contracts and keeps one
runbook. Finalize names the reconciliation before spec sync.

Follow-ups this change does not own: issue and pull request lists (#995),
GraphQL review-thread resolution state and `reviewDecision` (#996), `#L10-L40`
anchors (#927), a `json` representation (#833), Telegram (#940).

## 1. Proposal layer

Branch `web-read-adapters/proposal`, parent `master`. Owns `proposal.md`,
`design.md`, the three delta spec files, and this task ledger. Measured at
about 2,240 authored lines against `master`, about 240 over the approximately
2,000-line target, because the MODIFIED blocks reproduce 1,041 lines of
canonical requirement text and scenarios; the PR body carries the exact count
for its head. That
named budget exception needs Leo's explicit approval before publication.
Re-measure the actual parent-relative diff before publication. It closes no
issue.

- [x] 1.1 [proposal] Complete two independent adversarial review rounds over the proposal, design, and all three delta specs. Verify the adapter order, `:raw` bypass, full derived-locator admission, address pinning, token scoping, rate-limit classification, the primary/secondary failure rule, the no-cap load-everything bounds, config absent-means-none semantics, the GitHub endpoints and layouts, ref resolution, the two-level tree listing, rewrite template encoding, and every negative permission/secret scenario against repository code, canonical specs, the live probes recorded in `design.md`, and `agent://OmpReadPrior/report`; commit each review round separately rather than amending.
- [x] 1.2 [proposal] Re-run the canonical-requirement preservation check: for every MODIFIED requirement, compare canonical and delta bodies by a word-level diff, verify every canonical scenario is present exactly once, inspect every intentional adapter insertion, and reject lost words or hyphen splits. Verify changed files cite the re-read line ranges in this worktree and the rechecked OMP checkout.
- [x] 1.3 [proposal] Prove the proposal layer with `pnpm exec openspec validate web-read-adapters --strict`, `pnpm exec prettier --write <changed proposal/design/spec/task files>`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record authored line counts and the exact commands in the draft PR body, and request Leo's explicit approval of the named budget exception for the measured overage before publication.
- [x] 1.4 [proposal] Perform self-review (SR) on the actual parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings in a new commit, and obtain Leo's explicit approval of the published proposal revision before implementation branches are created.
- [x] 1.5 [proposal] After SR, publish the draft through `$gh-stack`, run the configured GitHub review/CI (GR) loop to completion, and create `web-read-adapters/contract` only from the approved, current proposal head.

## 2. Contract layer

Branch `web-read-adapters/contract`, parent `web-read-adapters/proposal`.
Owns the adapter seam in `apps/api/src/tools/web-read/`, static contract and
provenance, shared deadline/redirect accounting for adapter requests,
`tools.webAdapters` schema/loader and boot validation, the `rewrite` adapter,
the x.com runbook example, the packaged read description, and focused
contract fixtures. Estimated about 1,700 authored lines. This layer accepts
only `use: "rewrite"`; it is the functionality completing #708 and its PR
body carries `Closes #708` after the narrowing comment below.

- [x] 2.1 [contract] Add typed static adapter entries with pure matching, route kinds `native` and `rewrite`, claimed/unclaimed dispatch, the primary-failure fallthrough note and the secondary-failure per-section omission note, `adapter` result provenance, and `:raw` bypass; verify unit cases prove matching performs no I/O, an unclaimed URL produces no note, and a refusal/non-2xx/parse/empty primary result reaches the next candidate without returning an error body.
- [x] 2.2 [contract] Extend the existing web session so adapter requests use the same header/body/deadline/redirect/address admission and the shared 30-second and 20-hop bounds, with a 5 MiB bound on the rendered adapter document; verify a fixture server proves that reaching the deadline after a primary success renders partial content with a note and that generic ladder quotas remain unchanged.
- [x] 2.3 [contract] Extend derived admission and trusted provenance with the `adapter` kind, while preserving source, hop, probe, and address semantics; verify a domain allow for the source does not admit a rewrite origin, and a rejected adapter target is not requested.
- [x] 2.4 [contract] Add the closed `tools.webAdapters` shape to `LlameConfig`, the published JSON Schema, raw-shape validation, and resolver defaults; verify absent means `[]`, explicit arrays are exact lists, duplicate ids, unknown uses, unknown fields (including `headers`), invalid `pathPattern`, invalid targets, and non-secret interpolation fail boot naming the entry and field.
- [x] 2.5 [contract] Implement validated literal-origin rewrite matching, `{path}` and `{query}` placeholder encoding (including `https://x.com/a&admin=1`), literal-query handling, per-call same-origin revalidation, target admission, one-request local negotiated/text/Readability rendering without probes, and no credential on any rewrite request; add docs and the CHANGELOG entry; verify the x.com fixture route, delimiter-containing data, userinfo/non-http/placeholder-in-host/`{path}`-in-query/unknown-placeholder/malformed boot failures, and `finalUrl` source identity.
- [x] 2.6 [contract] Update `docs/web-read.md`, the example config, the packaged `read` description, dated `CHANGELOG.md`, and any relevant `ROADMAP.md` removal for the shipped contract. Document absent-means-none, the declared-origin allowlist clause, the `x.pcstyle.dev` rewrite leak, the threat model, and the exact-list semantics; leave GitHub token tenancy to the GitHub layers; verify Markdown and schema examples against the loader.
- [x] 2.7 [contract] Extend `apps/api/src/tools/web-read.integration.test.ts` using the existing local fixture-server approach for raw bypass, claimed and unclaimed dispatch, adapter fallthrough, derived permission refusal, address refusal, and rewrite behavior; run the focused integration test and the adapter/config focused tests.
- [x] 2.8 [contract] Before closing #708, post a narrowing comment stating that no code-owned third-party protocol ships, that a rewrite delegates rendering to the operator's declared origin, and that per-entry headers are not supported; link the accepted scope and keep `Closes #708` blocked until the comment exists.
- [x] 2.9 [contract] Re-measure the layer against the 2,000-line budget, self-review the actual draft PR diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop before creating `github-threads`; only after acceptance evidence is recorded use `Closes #708`.

## 3. GitHub threads layer

Branch `web-read-adapters/github-threads`, parent `web-read-adapters/contract`.
Owns the native `github` matcher for `/issues/{n}` and `/pull/{n}`, the typed
issue/pull/comment/review/review-comment document and its renderer, load-all
pagination, the `Checks:` and `Diff:` lines, token scoping, rate-limit
classification, the `use: "github"` config value with `token`, and fixture
coverage. Estimated about 1,700 authored lines. It references #939 and
closes nothing.

- [x] 3.1 [github-threads] Implement the exact `github.com` grammar for issue and pull request URLs, leaving lists, `.diff`, `.patch`, `/files`, Actions, Projects, Discussions, search, gists, and Enterprise hosts unclaimed; add the `github` use value, `token` interpolation, boot validation, and the `api.github.com` domain-allowlist runbook clause (the adapter falls through with `permission` when it is omitted); state that `patch-diff.githubusercontent.com` is not requested by the adapter and is needed only when the model separately reads the rendered `Diff:` URL through the generic ladder, whose `.diff` URL 302-redirects there. Verify unclaimed shapes produce no request and no note.
- [x] 3.2 [github-threads] Implement the typed document and the `pr://`-shaped renderer: metadata lines, `## Body`, `## Files`, `## Reviews`, `## Review Comments`, `## Comments`, flat `### author · timestamp` items with `ID`, `Reply to`, `Location`, `Side`, and `URL` lines, `Reviews:` per-reviewer counts, `Merge state` as returned, `Checks:` from all check-runs pages requested with `filter=latest&per_page=100`, including the `total_count` remainder when a later page fails or answers unparsably, `Checks: unavailable` when the first page fails, answers unparsably, or has no numeric `total_count`, and an omission note naming check runs with `parse` for the unparsable cases, and the `Diff:` line; verify the rendered text against a fixture and that `:N-M` pages it like a file.
- [x] 3.3 [github-threads] Implement load-all pagination for comments, reviews, review comments, files, and check runs (requested with `filter=latest&per_page=100`) under the shared deadline and the 5 MiB document bound with per-section omission notes; verify a fixture proves a secondary page failure renders the primary content with a note, a failed later check-runs page renders loaded counts with the `total_count` remainder, a failed first check-runs page renders `Checks: unavailable`, an unparsable later page renders the remainder with a `parse` omission note, a first page without a numeric `total_count` renders `Checks: unavailable` with a `parse` omission note, and a primary failure falls through.
- [x] 3.4 [github-threads] Implement the unauthenticated public default and the optional interpolated operator token with instance-wide authority; verify public requests omit `Authorization`, the token is sent only to `api.github.com`, and a redirect to another origin or a rewrite request never receives it.
- [x] 3.5 [github-threads] Classify `429`, `403` with `x-ratelimit-remaining: 0`, and `403` with `retry-after` as rate-limit notes; `x-ratelimit-reset` alone does not classify. Verify each status and reset-note case against the fixture server, for both primary and secondary requests.
- [x] 3.6 [github-threads] Add focused integration and renderer tests for issue, pull request, partial render, private/no-token fallthrough, API-origin permission refusal, and rate limits; update `docs/web-read.md` with token tenancy, the 60-per-hour shared-egress note, and the long-thread recommendation; add the dated `CHANGELOG.md` entry.
- [x] 3.7 [github-threads] Re-measure the layer, self-review its actual parent-relative diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop before creating `github-code`.

## 4. GitHub code layer

Branch `web-read-adapters/github-code`, parent
`web-read-adapters/github-threads`. Owns the repository root, `/tree`,
`/blob`, and `/commit` shapes, ref resolution through `matching-refs`, the
recursive tree fetch and two-level listing renderer, the adapter
directory-result seam (a pure `renderCollectedDirectory` export from
`@workspace/native-file-tools` and the `WebRender.directory` branch in
`apps/api/src/tools/web-read/result.ts`), blob decoding and binary/size
fallthrough, the commit view, and fixture coverage. Estimated
about 1,500 authored lines. This layer carries `Closes #939` only after its
narrowed acceptance is recorded.

- [x] 4.1 [github-code] Extend the grammar to `/o/r`, `/tree/{ref}[/path]`, `/blob/{ref}/path`, and `/commit/{sha}`; implement the contents blob request with base64 decoding, line-for-line rendering without a heading, and `binary`/`too_large` fallthrough; verify `:N-M` addresses source lines, path segments cannot traverse or alter API paths, and `raw.githubusercontent.com` is never requested.
- [x] 4.2 [github-code] Implement ref resolution: first segment tried as the ref, `matching-refs/heads` then `/tags` on a `404` with segments remaining, the segment-boundary rule, longest match, the 40-hex SHA shortcut, and `status` fallthrough with nothing left to split; verify the `feature/foo` branch and tag fixtures, the request counts in `design.md` D11, and the documented tag-shadows-branch scenario.
- [x] 4.3 [github-code] Implement the one-request recursive tree fetch for directories and the root, local filtering to two levels, and rendering in the host directory listing shape with `… N more`, `… N entries`, truncation, and range-selector rules; verify a fixture directory renders identically to the equivalent host directory listing, mode `120000` and `160000` entries render as `- name@` and `- name?`, an over-budget root renders metadata and README with the `tree omitted: too_large` note, an over-budget non-root directory ends with `directory_too_large` without a listing or fall-through (this layer builds the directory-result seam named in its ownership paragraph: the `renderCollectedDirectory` export and the `result.ts` directory branch), and a response over 5 MiB falls through as `too_large`.
- [x] 4.4 [github-code] Implement the repository root (metadata lines, root listing, decoded README) and the commit view (message, author, timestamp, file list loaded in pages of 100 with a `files omitted: too_large` note once GitHub's 3,000-file limit is reached, `Diff:` line, no patches); verify request counts, the note at exactly 3,000 files and its absence below, and that `/commit/{sha}.diff` stays unclaimed and readable through the generic ladder.
- [x] 4.5 [github-code] Add focused integration and renderer tests for root, tree, blob, commit, slash refs, and binary/too-large; update `docs/web-read.md` and the dated `CHANGELOG.md`/`ROADMAP.md` records.
- [x] 4.6 [github-code] Before closing #939, post the narrowing comment that moves `#L10-L40` to #927, review-thread resolution state and `reviewDecision` to #996, and list URLs to #995, and records the REST shape as the shipped acceptance; keep `Closes #939` blocked until the comment exists.
- [x] 4.7 [github-code] Re-measure the layer, self-review its actual parent-relative diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop; only then use `Closes #939` in the PR body.

## 5. Finalize layer

Branch `web-read-adapters/finalize`, parent `web-read-adapters/github-code`.
Owns only canonical spec synchronization, task records, and archive movement;
never application fixes. Estimated under 200 authored lines with rename
detection. Enter this branch before any sync command.

- [x] 5.1 [finalize] Use `$gh-stack` to create `web-read-adapters/finalize` from the reviewed, CI-green `github-code` layer; verify every implementation task and issue-closing PR is complete and no sibling conflict remains before synchronization.
- [x] 5.2 [finalize] Run `$openspec-sync-specs` for `native-file-tools`, `instance-config`, and `tool-call-permissions`; reconcile any sibling edits requirement-by-requirement, preserving all approved adapter scenarios, the file-locator architecture ownership, and the read-representations representation boundary. Verify `pnpm exec openspec status --change web-read-adapters --json` reports all artifacts complete.
- [x] 5.3 [finalize] Verify archive readiness: every task is checked, MODIFIED requirements still contain the canonical scenarios plus approved edits, no application/docs fix is being smuggled into finalize, and authored size is within budget; run `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [x] 5.4 [finalize] Run `$openspec-archive-change` only after readiness, then verify the archive preserves checked history and passes the final OpenSpec, Product Markdown, and Any change rows: strict specs/all validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

Post-archive gates, not checklist tasks: self-review the actual finalize diff
(SR), publish the draft with `$gh-stack`, mark it ready only after SR, run the
GitHub review/current-head CI loop (GR), recheck stack bases and terminal
checks, and request Leo's explicit merge permission. Finalize closes no issue.
