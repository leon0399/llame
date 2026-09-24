## 1. Proposal layer

Delivery stack:

```text
master <- web-read-address-policy/proposal <- web-read-address-policy/admission <- web-read-address-policy/finalize
```

This change modifies the shipped `native-file-tools` and
`tool-call-permissions` capabilities; the web-read change that introduced
their web requirements is merged and archived, so there is no native blocker.
The in-flight `tool-search` and `knowledge-submit` changes touch neither
modified requirement. No layer closes #942, #915, or #916.

Layers, each with its branch, parent, ownership, authored-size estimate
against its parent, exit evidence, and issue responsibility. The review budget
is about 2,000 authored added-plus-deleted lines against the immediate parent
(`git diff --shortstat <parent>`; tests, specs, and docs included). The
lockfile churn from adding `undici` counts zero and is reported separately.
Re-estimate at each layer boundary and before publication.

- `web-read-address-policy/proposal` (parent `master`): the proposal, the
  design, and the two delta specs. Estimated about 1,300 authored lines;
  measured at publication. Exit: the OpenSpec proposal, Product Markdown, and
  Any change verification rows, one adversarial review round with two
  independent reviewers committed separately (the round count Leo set), and Leo's approval of the published revision. Closes no issue.
- `web-read-address-policy/admission` (parent `proposal`): resolution,
  reject-only address admission, pinned per-request connections,
  unreserved-escape normalization, the `address` provenance kind and the
  refused-address message, the recommended rows with their boundary test, the
  runbook, the changelog, and the README line. Estimated about 900 authored
  lines. Closes #914.
- `web-read-address-policy/finalize` (parent `admission`): canonical spec
  synchronization, task records, and archive movement only. Estimated under
  200 authored lines (archive movement measured with rename detection).
  Closes no issue.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create `admission` only after explicit approval of the
published proposal revision. Publication and merge each require their own
authorization. Every layer has a self-review (SR) checkpoint before
draft -> ready and a GitHub review (GR) checkpoint after ready; for
`finalize` both follow archive movement as post-archive gates.

- [x] 1.1 [proposal] Complete one adversarial review round (the scope Leo set) with two independent reviewers over the proposal, the design, and both delta specs, covering the reject-only rule against the documented domain allowlist, the pinning mechanism and its IP-literal gap, connection reuse, the canonical address text, the F5a–F5f complement and its hostname-text exclusion, escape normalization, the provenance bound, and the MODIFIED blocks' losslessness; verify each finding against the repository, Node and undici behavior, and primary sources, and commit the revision separately with its revision-history entry.
- [x] 1.2 [proposal] Verify the artifacts cite the substrate correctly (every file, symbol, and line claim in the design's Context and Decisions) and that each MODIFIED requirement reproduces `master`'s text and scenarios losslessly apart from the intended edits; record a programmatic per-requirement diff (canonical scenario count, delta scenario count, missing scenarios) in the PR body.
- [x] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate web-read-address-policy --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain Leo's explicit approval of the final revision, then publication authorization, and publish the draft with `$gh-stack`.
- [x] 1.4 [proposal] SR: self-review the published draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, rerun the row checks, update the PR body, and mark the PR ready.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop to completion on the current head with zero actionable unresolved feedback, and carry the resulting approval of the published revision forward as the gate for creating `admission`.

## 2. Admission layer

Branch `web-read-address-policy/admission`, parent
`web-read-address-policy/proposal`. Owns everything the delta specs require at
runtime, the recommended rows, the operator runbook, the changelog, and the
closure of #914. Estimated about 900 authored lines; re-measure against the
parent before publication.

- [x] 2.1 [admission] Normalize path and query escapes to a fixed point inside `canonicalHref` (`apps/api/src/tools/web-read/locator.ts`): encode a `%` that begins no valid escape as `%25`, decode unreserved escapes, keep every other escape with uppercase hex, and re-serialize through the URL parser; verify in `locator.test.ts` that `/%70rivate`, `%7E`, and `%2d` decode, `/%%370rivate` becomes `/%2570rivate`, `%2f` becomes `%2F`, `%20` survives, a decoded `%2E%2E` segment resolves as the parser resolves it, and normalizing the output again changes nothing; and in `apps/api/src/tools/permissions/locator-projection.test.ts` that a reject naming `/private` refuses `/%70rivate` (native-file-tools "An encoded unreserved character cannot slip past a path reject").
- [x] 2.2 [admission] Add `undici` 8.x to `apps/api/package.json` and move the web fetch session to undici's own `fetch` with a per-request `Agent({ allowH2: false, connect: { lookup } })` whose hook returns only the request's admitted addresses in the shape Node asked for (array when `all` is set, single address otherwise) and fails closed for any other host, with no environment proxy, closing every agent at session dispose; add a `resolve` dependency (default `dns.promises.lookup(host, { all: true, order: 'verbatim' })`) memoized per host per call, started after `requestStarted` and raced against the call signal, with a resolution failure mapped to `network_error` and a fixed message; verify with `pnpm install --frozen-lockfile` after the lockfile update and focused `http-client.test.ts` cases for one resolution per host across a hop and a probe, resolution counted against the header bound, a failure message that names no host, and a hook called without `all`.
- [x] 2.3 [admission] Build the address locator (exactly the requested URL with only the host replaced; no selector; dotted IPv4, bracketed WHATWG IPv6, IPv4-mapped written as dotted IPv4 from both the parser's hex form and the resolver's dotted form, zone dropped, `0.0.0.0` and `::` as written) and judge it reject-only through the existing `evaluatePermission` and `read` projection (`explicit_reject` and `input_limit` refuse; `allow` and `no_allow` admit; a context without a compiled policy refuses every address before mapping), for IP-literal hosts before the request and for resolved hosts before the dispatcher is built; an empty admitted set issues no request; verify in `http-client.test.ts` and `admission.test.ts` the native-file-tools scenarios "An address reject holds for every name", "A refused address is skipped", "An address needs no allow of its own", "An IP literal is judged in its address form", "A resolved IPv4-mapped answer is judged as IPv4", "A selector is not part of the address locator", and "A hop to a private address is admitted by its text", tool-call-permissions "An address locator is judged by rejects only", an `input_limit` refusal, and the no-policy refusal.
- [x] 2.4 [admission] Add the refused-address message to `apps/api/src/tools/permissions/messages.ts` and return it with `permission_denied` when every address of the call's own request chain is refused, with `rejectedUrl` from `rejectedHopUrl` on a hop and none on the submitted locator, while a probe's refusal, on its first request or a hop of its own chain, disqualifies only its candidate through the existing `CANDIDATE_FAILURES` path; verify in `http-client.test.ts` and `pipeline.test.ts` that the message is byte-identical, carries no address, host, rule text, or clause reference, that the three chains behave as "No resolved address reaches the model" and "Every address refused is an error the model can continue from" state, and that a connect timeout's transport failure echoes no attempted address.
- [x] 2.5 [admission] Add `address` to `DerivedLocatorKind` and `KIND_NAMES`, exclude it from `pipeline.ts`'s `ProbeKind`, report an address only when refused and never its text, and in run execution keep one record per distinct refused address and decision per call under a separate bound of 16 beside the unchanged 26 for hops and probes, updating the bound rationale comments in `run-execution.service.ts` and `assistant-transcript.ts`; verify in `apps/api/src/runs/run-execution.service.test.ts` and `apps/api/src/runs/assistant-transcript.test.ts` that a skipped address produces one `address` record with the call's policy-instance ID and its static reason and clause reference, the same address refused on a later request adds none, 30 refused addresses keep 16 records and leave a later hop rejection recorded, an admitted address produces none, the records survive a history reload, and no address text is stored ("A refused address is recorded without its text").
- [x] 2.6 [admission] Extend `apps/api/src/tools/web-read.integration.test.ts` with a scripted resolver and fixture listeners on both `127.0.0.1` and `127.0.0.2` that record accepted sockets: a host resolving to `127.0.0.2` (refused) and `127.0.0.1` (admitted) is served from `127.0.0.1` and the `127.0.0.2` listener accepts no socket; a resolver that changes its answer after the first query is never re-queried and never dialed at the new address ("The checked answer is the one dialed"); a host resolving to both addresses whose page connects over one and whose suffix probe refuses that one opens a distinct socket to the other ("A connection is not reused across paths"); a public-to-refused redirect ends with the refused-address message and hostname `rejectedUrl` ("A hop is judged by the address it resolves to"); and under the recommended example policy a loopback cleartext host is fetched while a host scripted to a public address is refused with no socket ("Cleartext stays open to internal addresses only"); verify with `pnpm --filter api exec vitest run --project integration src/tools/web-read.integration.test.ts`.
- [x] 2.7 [admission] Replace F5 with F5a–F5f and add F7 in `apps/api/llame.config.json.example` and `apps/api/src/testing/portable-tool-policy.ts`, with the exact text from the tool-call-permissions delta; add a unit test that compiles each row with `compileRegexMatcher` and compares their union against a `net.BlockList` of the internal ranges over generated boundary address locators (every IPv4 first × second octet at third/fourth-octet boundaries, IPv6 boundary first hextets, with and without a port), that no hostname text matches, and that F7 matches every listed endpoint on both schemes; in `apps/api/src/instance-config/tool-permissions-config.test.ts` change the existing `http://example.test/page` row from `EXPLICIT_REJECT` to allow at the text level and add the address-locator rows of the example matrix.
- [x] 2.8 [admission] Update `docs/web-read.md`: replace the "No address is inspected" threat-model paragraph and the #914 deferral with the address-admission behavior, the reject-only rule and why allows never see an address, the address-locator format with worked examples, the fixed-point escape normalization in the normalization table and the hop-form wording, path-scoped address rules with `(?i)` and the advice to scope a sensitive address by origin, the F5a–F5f/F7 rows and the internal ranges, the widening that copying F5a–F5f brings and keeping the old F5 to avoid it, and the residual risks the design lists (proxying hosts, other addresses of a protected server, `0.0.0.0` and `::`, server-side path normalization, DNS lookups before address decisions, no environment proxy, NAT64 under HTTPS, host `bash`); verify with `pnpm lint:markdown` and by checking every example against the unit tests' matrix.
- [x] 2.9 [admission] Add the dated `CHANGELOG.md` entry (address admission and pinning, the `address` provenance kind, the refused-address message, fixed-point escape normalization and the clauses it makes unmatchable, and the F5 replacement with an instruction to copy F5a–F5f and F7 and the cleartext widening it brings) and extend the README web-read line with resolved-address admission; verify with `pnpm lint:markdown` and by checking every named row and message against the example and `messages.ts`.
- [x] 2.10 [admission] Record #914's acceptance evidence in the PR body and an issue comment: the owner's `10.67.88.60/private` rule refusing a direct, resolved, redirected, and probed read while `/data` is served; the skip case; the rebinding case; the localhost, LAN, public-cleartext, and metadata rows under the example; the domain allowlist still admitting its host; and the `/%70rivate` refusal with `/%%370rivate` requested as `/%2570rivate`. Close #914 with `Closes #914` on this layer's PR only after every row is verified against the running build.
- [x] 2.11 [admission] Prove the layer locally with the affected API `lint`, `typecheck`, and `test:coverage`, the focused permissions and instance-config tests, the integration file from 2.6, `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; measure the parent-relative authored diff against the review budget, reporting lockfile churn separately; publish or refresh the draft with `$gh-stack`.
- [x] 2.12 [admission] SR: self-review the draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, with an independent `security-reviewer` subagent on pinning, the IP-literal path, connection reuse, and message leakage; verify every finding, fix accepted ones with new commits, rerun the affected checks, update the PR body, and mark ready.
- [ ] 2.13 [admission] GR: after ready, run the Ready-PR monitoring loop to completion on the current head (terminal passing CI, every expected reviewer complete, zero actionable unresolved feedback) before creating `finalize`.

## 3. Finalize layer

Branch `web-read-address-policy/finalize`, parent
`web-read-address-policy/admission`. Spec synchronization, task records, and
archive movement only; never an application fix. Enter the branch with
`$gh-stack` from the implementation top **before** `$openspec-sync-specs`
writes any canonical spec.

- [ ] 3.1 [finalize] Confirm with `$gh-stack` that `web-read-address-policy/finalize` is checked out on top of the published, reviewed, and CI-green `admission` layer, and that every proposal and admission task above is checked, before any synchronization runs.
- [ ] 3.2 [finalize] Use `$openspec-sync-specs` to synchronize the `native-file-tools` and `tool-call-permissions` deltas; if another change archived first and edited any of the six modified requirements, reconcile by hand before sync and record the reconciliation in the PR body; verify each synchronized requirement against its delta and that the "A hop to a private address is admitted by its text" scenario carries its revised body.
- [ ] 3.3 [finalize] Verify archive readiness: `openspec status --change web-read-address-policy --json` reports every artifact complete and every task above is checked; then use `$openspec-archive-change`; verify the archive preserves checked history and passes `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

Post-archive gates, not pre-archive checklist tasks: publish the finalize draft
with `$gh-stack` under the existing publication authorization, self-review its
actual parent-relative diff (SR) and mark ready, run the Ready-PR monitoring
loop (GR) to completion, recheck stack bases and terminal checks, and request
explicit merge permission for each layer; merge only through `$gh-stack`.
