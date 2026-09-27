# Tasks

Delivery is a linear gh-stack. The proposal branch already exists and contains
planning artifacts only:

```text
master <- web-read-adapters/proposal <- web-read-adapters/contract
       <- web-read-adapters/github <- web-read-adapters/telegram
       <- web-read-adapters/finalize
```

Each implementation layer is created only after the proposal revision is
approved and its parent is the current stack top. Estimates are authored
changed lines against the immediate parent, including tests, specs, and docs;
each stays within the approximately 2,000-line review budget. Generated output
is not budgeted, but any generated churn is reported and verified. Use
`$gh-stack` for stack operations and `$openspec-apply-change` for implementation.

The sibling changes are `file-locator` (plane 1 and the three-plane
architecture section) and `read-representations` (plane 3). All three modify
`native-file-tools`; they remain independent from `master`. If a sibling lands
first, rebase this stack and reconcile only the overlapping canonical
requirements. If `read.md`, `docs/web-read.md`, `CHANGELOG.md`, or example
configuration overlaps, the layer landing second resolves the textual conflict
against both approved contracts and keeps one runbook. Finalize names the
reconciliation before spec sync.

## 1. Proposal layer

Branch `web-read-adapters/proposal`, parent `master`. Owns `proposal.md`,
`design.md`, the three delta spec files, and this task ledger. Estimated about
1,800 authored lines; measure the actual parent-relative diff before
publication. It closes no issue.

- [ ] 1.1 [proposal] Complete two independent adversarial review rounds over the proposal, design, and all three delta specs. Verify the adapter order, `:raw` bypass, full derived-locator admission, address pinning, credential stripping, rate-limit classification, the 27-request/8-adapter budget, config replacement semantics, GitHub endpoints, Telegram scope, rewrite encoding, and every negative permission/secret scenario against repository code, canonical specs, the live spikes, and `agent://OmpReadPrior/report`; commit each review round separately rather than amending.
- [ ] 1.2 [proposal] Re-run the canonical-requirement preservation check: for every MODIFIED requirement, compare the canonical block and delta block by heading and scenario name, verify that every canonical scenario is present once, and inspect each intentional edit. Verify the changed files cite the re-read line ranges in this worktree and the rechecked OMP checkout.
- [ ] 1.3 [proposal] Prove the proposal layer with `pnpm exec openspec validate web-read-adapters --strict`, `pnpm exec prettier --write <changed proposal/design/spec/task files>`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record authored line counts and the exact commands in the draft PR body.
- [ ] 1.4 [proposal] Perform self-review (SR) on the actual parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings in a new commit, and obtain Leo's explicit approval of the published proposal revision before implementation branches are created.
- [ ] 1.5 [proposal] After SR, publish the draft through `$gh-stack`, run the configured GitHub review/CI (GR) loop to completion, and create `web-read-adapters/contract` only from the approved, current proposal head.

## 2. Contract layer

Branch `web-read-adapters/contract`, parent `web-read-adapters/proposal`.
Owns the adapter seam in `apps/api/src/tools/web-read/`, static contract and
provenance, shared request accounting, `tools.webAdapters` schema/loader and
boot validation, the `fxembed` protocol, rewrite validation/rendering, the
x.com runbook examples, the packaged read description, and focused contract
fixtures. Estimated about 1,900 authored lines. This is the functionality
completing #708 layer and its PR body carries `Closes #708`; the layer also
records the x.com instance without closing #939 or #940.

- [ ] 2.1 [contract] Add typed static adapter entries with pure matching, route kinds, explicit matched-failure fallthrough, `adapter` result provenance, and `:raw` bypass; verify unit cases prove matching performs no I/O and a refusal/non-2xx/parse/empty result reaches the next candidate without returning an error body.
- [ ] 2.2 [contract] Extend the existing web session so adapter requests use the same header/body/deadline/redirect/address admission and an explicit shared 27-request counter, with an eight-request adapter sub-budget; verify a fixture server counts requests across adapters and generic probes and proves an exhausted bound is not reset.
- [ ] 2.3 [contract] Extend derived admission and trusted provenance with the `adapter` kind, while preserving source, hop, probe, and address semantics; verify a domain allow for the source does not admit `api.github.com` or a declared service, and a rejected adapter target is not requested.
- [ ] 2.4 [contract] Scope credential/header attachment to the declared origin and strip it across origin-changing redirects; verify a fixture redirect captures no GitHub token or rewrite secret at the second origin, and no token appears in notes, errors, decisions, or result content.
- [ ] 2.5 [contract] Add `tools.webAdapters` to `LlameConfig`, the published JSON Schema, raw-shape validation, interpolation/redaction, and resolver defaults; verify absent means exactly GitHub plus Telegram, explicit `[]` disables them, explicit arrays replace rather than merge, duplicate/unknown/invalid entries fail boot, and an interpolated secret is value-free in diagnostics.
- [ ] 2.6 [contract] Implement the opt-in FxEmbed protocol and source-preserving adapter rendering from the observed JSON mapping; verify the local fixture covers author, timestamp, text, quoted/media notes, no fabricated reply thread, service-origin provenance, and no contact when undeclared.
- [ ] 2.7 [contract] Implement validated rewrite matching, placeholder encoding, target admission, generic-ladder rendering, and origin-scoped headers; verify the x.com fixture route, delimiter-containing path/query data, userinfo/non-http/malformed boot failures, redirect secret stripping, and `finalUrl` source identity.
- [ ] 2.8 [contract] Update `docs/web-read.md`, the example config, the packaged `read` description, dated `CHANGELOG.md`, and any relevant `ROADMAP.md` removal for the shipped contract. Document built-in-only defaults, `api.github.com` and declared-origin allowlist clauses, x.com FxEmbed and `x.pcstyle.dev` rewrite leaks, token tenancy, threat model, and the absent/explicit-replacement distinction; verify Markdown and schema examples against the loader.
- [ ] 2.9 [contract] Extend `apps/api/src/tools/web-read.integration.test.ts` using the existing local fixture-server approach for raw bypass, adapter fallthrough, derived permission refusal, address refusal, request accounting, FxEmbed, and rewrite behavior; run the focused integration test and the adapter/config focused tests.
- [ ] 2.10 [contract] Re-measure the layer against the 2,000-line budget, self-review the actual draft PR diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop before creating `github`; only after acceptance evidence is recorded use `Closes #708`.

## 3. GitHub layer

Branch `web-read-adapters/github`, parent `web-read-adapters/contract`.
Owns the native GitHub matcher, REST/GraphQL request and renderer, token
scoping, rate-limit classification, bounded pagination, README/blob/commit/
issue/PR output, and fixture coverage. Estimated about 1,500 authored lines.
This layer carries `Closes #939` only after its narrowed acceptance is recorded.

- [ ] 3.1 [github] Implement the exact GitHub URL-shape matcher and native API routes: repo README, contents blob with raw media and ref, commit summary, issue metadata/comments, PR base/head/merge/check-runs/review comments, and token-only GraphQL `reviewThreads`; verify each route against a local fixture and assert no `raw.githubusercontent.com` or Enterprise request is introduced.
- [ ] 3.2 [github] Implement line-preserving blob rendering, structured issue/PR thread rendering, bounded comment/review pagination, omission notes, and commit/README formatting; verify rendered lines remain addressable by `:N-M`, pagination cannot exceed the adapter budget, and no unsupported GitHub shape is claimed.
- [ ] 3.3 [github] Implement unauthenticated public default and optional interpolated operator token with instance-wide authority; verify public requests omit `Authorization`, private visibility requires the token, the token is sent only to `api.github.com`, and redirect/delegated requests never receive it.
- [ ] 3.4 [github] Classify `403` with `x-ratelimit-remaining: 0`, `429`, and `retry-after`/`x-ratelimit-reset` as rate-limit fallthrough notes without retries or response bodies; verify each status and reset-note case against the fixture server.
- [ ] 3.5 [github] Add focused integration and renderer tests for root, blob, commit, issue, pull, GraphQL resolution availability, private/no-token fallthrough, API-origin permission refusal, and rate limits; run the focused GitHub test commands and capture request counts.
- [ ] 3.6 [github] Before closing the issue, post the required #939 comment linking #927 and explicitly move the original `#L10-L40` acceptance row to #927; retain line-for-line blob output and `:N-M` selectors in the narrowed #939 acceptance. Update the GitHub-layer dated `CHANGELOG.md`/`ROADMAP.md` records only if the contract layer's shared documentation requires a GitHub-specific addition.
- [ ] 3.7 [github] Re-measure the layer, self-review its actual parent-relative diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop; only then use `Closes #939` in the PR body.

## 4. Telegram layer

Branch `web-read-adapters/telegram`, parent `web-read-adapters/github`.
Owns the first-party public single-post Telegram adapter, `linkedom` parser,
quoted-forward/media-note rendering, private/feed exclusions, and fixture
coverage. Estimated about 800 authored lines. This layer carries `Closes #940`.

- [ ] 4.1 [telegram] Run and record the bounded Telegram embed spike against `https://t.me/durov/300?embed=1&mode=tme` with installed `linkedom`, including the observed author/date/text/media selectors; keep the implementation test fixture local and never make a live site a test dependency.
- [ ] 4.2 [telegram] Implement matching for one public numeric `t.me/<channel>/<id>` post, derive the first-party embed, parse author/date/text/forward/media, and preserve source provenance; verify the local HTML fixture matches the spike's fields and does not fetch media or comments.
- [ ] 4.3 [telegram] Reject or fall through for `t.me/c/...`, feeds, channel roots, search, comments, malformed/empty embeds, and any credential route; verify request counters show no private or media request and generic fallback remains available.
- [ ] 4.4 [telegram] Add focused integration/parser tests and the Telegram runbook/dated changelog or roadmap text required by the shared docs; run the focused fixture test and recheck the no-credential negative cases.
- [ ] 4.5 [telegram] Re-measure the layer, self-review its actual parent-relative diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop; only then use `Closes #940` in the PR body.

## 5. Finalize layer

Branch `web-read-adapters/finalize`, parent `web-read-adapters/telegram`.
Owns only canonical spec synchronization, task records, and archive movement;
never application fixes. Estimated under 200 authored lines with rename
detection. Enter this branch before any sync command.

- [ ] 5.1 [finalize] Use `$gh-stack` to create `web-read-adapters/finalize` from the reviewed, CI-green Telegram layer; verify every implementation task and issue-closing PR is complete and no sibling conflict remains before synchronization.
- [ ] 5.2 [finalize] Run `$openspec-sync-specs` for `native-file-tools`, `instance-config`, and `tool-call-permissions`; reconcile any sibling edits requirement-by-requirement, preserving all approved adapter scenarios, the file-locator architecture ownership, and the read-representations representation boundary. Verify `pnpm exec openspec status --change web-read-adapters --json` reports all artifacts complete.
- [ ] 5.3 [finalize] Verify archive readiness: every task is checked, MODIFIED requirements still contain the canonical scenarios plus approved edits, no application/docs fix is being smuggled into finalize, and authored size is within budget; run `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 5.4 [finalize] Run `$openspec-archive-change` only after readiness, then verify the archive preserves checked history and passes the final OpenSpec, Product Markdown, and Any change rows: strict specs/all validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] 5.5 [finalize] After archive movement, self-review the actual finalize diff (SR), publish the draft with `$gh-stack`, complete the post-archive GitHub review/CI (GR) monitoring loop, recheck stack bases and terminal checks, and request Leo's explicit merge permission; finalize closes no issue.
