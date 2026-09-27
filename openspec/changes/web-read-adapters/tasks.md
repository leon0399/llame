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
requirements. `file-locator` MODIFIES `tool-call-permissions`
"Match submitted string values without serialization artifacts";
`read-representations` MODIFIES the web locator requirement that enumerates
selector grammar (currently "Web locators are fetched by the native read tool").
Whichever sibling finalizes second reconciles all clauses and scenarios by
requirement, not by taking one whole delta. If `read.md`, `docs/web-read.md`, `CHANGELOG.md`, or example
configuration overlaps, the layer landing second resolves the textual conflict
against both approved contracts and keeps one runbook. Finalize names the
reconciliation before spec sync.

## 1. Proposal layer

Branch `web-read-adapters/proposal`, parent `master`. Owns `proposal.md`,
`design.md`, the three delta spec files, and this task ledger. Estimated about
2,040 authored lines after round two (2,042 including generated metadata); measure
the actual parent-relative diff before publication. This exceeds the
approximately 2,000-line target by about 40 authored lines because each MODIFIED block reproduces canonical requirement text and all
scenarios. Record that named budget exception in task 1.3 and request Leo's explicit approval of the exception before publication. It closes no issue.

- [ ] 1.1 [proposal] Complete two independent adversarial review rounds over the proposal, design, and all three delta specs. Verify the adapter order, `:raw` bypass, full derived-locator admission, address pinning, credential stripping, rate-limit classification, the 8-adapter/shared-redirect budget, config replacement semantics, GitHub endpoints, Telegram scope, rewrite encoding, and every negative permission/secret scenario against repository code, canonical specs, the live spikes, and `agent://OmpReadPrior/report`; commit each review round separately rather than amending.
- [ ] 1.2 [proposal] Re-run the canonical-requirement preservation check: for every MODIFIED requirement, compare canonical and delta bodies by a word-level diff, verify every canonical scenario is present exactly once, inspect every intentional adapter insertion, and reject lost words or hyphen splits. Verify changed files cite the re-read line ranges in this worktree and the rechecked OMP checkout.
- [ ] 1.3 [proposal] Prove the proposal layer with `pnpm exec openspec validate web-read-adapters --strict`, `pnpm exec prettier --write <changed proposal/design/spec/task files>`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record authored line counts and the exact commands in the draft PR body, and request Leo's explicit approval of the named approximately 22-line budget exception before publication.
- [ ] 1.4 [proposal] Perform self-review (SR) on the actual parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings in a new commit, and obtain Leo's explicit approval of the published proposal revision before implementation branches are created.
- [ ] 1.5 [proposal] After SR, publish the draft through `$gh-stack`, run the configured GitHub review/CI (GR) loop to completion, and create `web-read-adapters/contract` only from the approved, current proposal head.

## 2. Contract layer

Branch `web-read-adapters/contract`, parent `web-read-adapters/proposal`.
Owns the adapter seam in `apps/api/src/tools/web-read/`, static contract and
provenance, shared request/deadline/redirect accounting, `tools.webAdapters`
schema/loader and boot validation for code-owned `fxembed` and `rewrite`, the
x.com runbook examples, the packaged read description, and focused contract
fixtures. Estimated about 1,900 authored lines. This layer starts with absent
`tools.webAdapters` => `[]`; it is the functionality completing #708 layer
and its PR body carries `Closes #708` after the narrowing comment below. It
adds no GitHub or Telegram default before those adapters exist.

- [ ] 2.1 [contract] Add typed static adapter entries with pure matching, route kinds, explicit matched-failure fallthrough, `adapter` result provenance, and `:raw` bypass; verify unit cases prove matching performs no I/O and a refusal/non-2xx/parse/empty result reaches the next candidate without returning an error body.
- [ ] 2.2 [contract] Extend the existing web session so adapter requests use the same header/body/deadline/redirect/address admission, an eight-request adapter budget including redirects, and the existing shared 20-hop/30-second bounds; verify a fixture server proves adapter budget exhaustion falls through and generic ladder quotas remain unchanged.
- [ ] 2.3 [contract] Extend derived admission and trusted provenance with the `adapter` kind, while preserving source, hop, probe, and address semantics; verify a domain allow for the source does not admit `api.github.com` or a declared service, and a rejected adapter target is not requested.
- [ ] 2.4 [contract] Scope credential/header attachment to the declared origin and strip it across origin-changing redirects; verify a fixture redirect captures no GitHub token or rewrite secret at the second origin, and no token appears in notes, errors, decisions, or result content.
- [ ] 2.5 [contract] Add the closed `tools.webAdapters` shape to `LlameConfig`, the published JSON Schema, raw-shape validation, interpolation/redaction, reserved-header checks, and resolver defaults; verify contract-layer absent means `[]`, explicit arrays replace rather than merge, duplicate/unknown/invalid entries fail boot, non-secret interpolation fails, and an interpolated secret is value-free in diagnostics. Do not claim GitHub or Telegram defaults until their layers land.
- [ ] 2.6 [contract] Implement the opt-in FxEmbed protocol and source-preserving adapter rendering from the observed JSON mapping; add its code-owned `use` value, base-origin validation, docs, and CHANGELOG entry; verify host/path variants, base-origin reduction, `new URL(`/status/${id}`, baseOrigin)` routing to `https://api.fxtwitter.com/status/20`, author/timestamp/text/quoted/media notes, no fabricated reply thread, service-origin provenance, and no contact when undeclared.
- [ ] 2.7 [contract] Implement validated literal-origin rewrite matching, canonical path/query/url placeholder encoding (including `https://x.com/a&admin=1`), and literal-query handling, per-call same-origin revalidation, target admission, one-request local negotiated/text/Readability rendering without probes, and origin-scoped headers; add its code-owned config validation, docs, and CHANGELOG entry; verify the x.com fixture route, delimiter-containing data, userinfo/non-http/malformed boot failures, redirect secret stripping, budget fallthrough, and `finalUrl` source identity.
- [ ] 2.8 [contract] Update `docs/web-read.md`, the example config, the packaged `read` description, dated `CHANGELOG.md`, and any relevant `ROADMAP.md` removal for the shipped contract. Document contract-layer absent `[]`, `api.fxtwitter.com` and declared-origin allowlist clauses, x.com FxEmbed and `x.pcstyle.dev` rewrite leaks, threat model, and the absent/explicit-replacement distinction; leave GitHub token tenancy to the GitHub layer; verify Markdown and schema examples against the loader.
- [ ] 2.9 [contract] Extend `apps/api/src/tools/web-read.integration.test.ts` using the existing local fixture-server approach for raw bypass, adapter fallthrough, derived permission refusal, address refusal, request accounting, FxEmbed, and rewrite behavior; run the focused integration test and the adapter/config focused tests.
- [ ] 2.10 [contract] Before closing #708, post a narrowing comment stating that FxEmbed exposes no llame-owned reply thread and that a rewrite delegates any thread and reply bound to the operator's service; link the accepted scope and keep `Closes #708` blocked until the comment exists.
- [ ] 2.11 [contract] Re-measure the layer against the 2,000-line budget, self-review the actual draft PR diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop before creating `github`; only after acceptance evidence is recorded use `Closes #708`.

## 3. GitHub layer

Branch `web-read-adapters/github`, parent `web-read-adapters/contract`.
Owns the native GitHub matcher, REST/GraphQL request and renderer, token
scoping, rate-limit classification, bounded pagination, README/blob/commit/
issue/PR output, and fixture coverage. Estimated about 1,500 authored lines.
This layer carries `Closes #939` only after its narrowed acceptance is recorded.

- [ ] 3.1 [github] Implement the exact GitHub grammar and native API routes using JSON contents objects (`Accept: application/vnd.github+json`), base64 decoding and binary/invalid-UTF-8/too-large fallthrough: repo README, contents blob with ref, commit summary, issue metadata/comments, PR base/head/merge/check-runs/review comments, and token-only GraphQL `reviewThreads`; add the `github` use value, absent-default `[github]`, boot validation, token-tenancy docs, and CHANGELOG entry. Verify every route against a local fixture and assert no `raw.githubusercontent.com` or Enterprise request is introduced.
- [ ] 3.2 [github] Implement line-preserving UTF-8 blob rendering, structured issue/PR thread rendering, bounded comment/review pagination, omission notes, and commit/README formatting; verify rendered lines remain addressable by `:N-M`, path segments cannot traverse or alter API paths, pagination cannot exceed the adapter budget, and no unsupported GitHub shape is claimed.
- [ ] 3.3 [github] Implement unauthenticated public default and optional interpolated operator token with instance-wide authority; verify public requests omit `Authorization`, private visibility requires the token, the token is sent only to `api.github.com`, and redirect/delegated requests never receive it.
- [ ] 3.4 [github] Extend the transport for the fixed GraphQL POST/body, admit both the GraphQL endpoint and REST resource locator, and treat any 3xx as an adapter status failure without following it. Classify `429`, `403` with `x-ratelimit-remaining: 0`, and `403` with `retry-after` as rate-limit fallthrough notes; `x-ratelimit-reset` alone does not classify. Verify each status and reset-note case against the fixture server.
- [ ] 3.5 [github] Add focused integration and renderer tests for root, blob, commit, issue, pull, GraphQL resolution availability, private/no-token fallthrough, API-origin permission refusal, and rate limits; run the focused GitHub test commands and capture request counts.
- [ ] 3.6 [github] Before closing #939, post the required #939 comment linking #927 and explicitly move the original `#L10-L40` acceptance row to #927; retain line-for-line blob output and `:N-M` selectors in the narrowed #939 acceptance. Update the GitHub-layer dated `CHANGELOG.md`/`ROADMAP.md` records for the `[github]` default and token-tenancy scope before the closure PR.
- [ ] 3.7 [github] Re-measure the layer, self-review its actual parent-relative diff (SR), fix accepted findings with new commits, publish with `$gh-stack`, and complete the GitHub review/CI (GR) loop; only then use `Closes #939` in the PR body.

## 4. Telegram layer

Branch `web-read-adapters/telegram`, parent `web-read-adapters/github`.
Owns the first-party public single-post Telegram adapter, `linkedom` parser,
reserved-channel grammar, claimed-empty semantics, quoted-forward/media-note
rendering, private/feed exclusions, and fixture coverage. Estimated about 800
authored lines. This layer adds Telegram to the absent default, so the final
state is `[github, telegram]`, and carries `Closes #940` after the narrowing
comment below.

- [ ] 4.1 [telegram] Run and record the bounded Telegram embed spike against `https://t.me/durov/300?embed=1&mode=tme` with installed `linkedom`, including the observed author/date/text/media selectors; keep the implementation test fixture local and never make a live site a test dependency.
- [ ] 4.2 [telegram] Implement the pure match grammar for `t.me`/`telegram.me`, reserved segments, numeric ids, and query rules; add the `telegram` use value, final default member, boot validation, docs, and CHANGELOG entry. Derive the first-party embed, parse author/date/text/forward/media, and preserve source provenance; verify the local HTML fixture matches the spike's fields and does not fetch media or comments.
- [ ] 4.3 [telegram] Reject or fall through for `t.me/c/...`, feeds, channel roots, search, comments, malformed/empty embeds, and any credential route; distinguish unclaimed shapes from claimed `empty` widgets, preserve media-only posts, and verify request counters show no private or media request and generic fallback remains available.
- [ ] 4.4 [telegram] Add focused integration/parser tests and the Telegram runbook/dated changelog or roadmap text required by the shared docs; post a narrowing comment on #940 moving channel reads and `t.me/s/` paging to a linked follow-up before `Closes #940`; run the focused fixture test and recheck the no-credential negative cases.
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
