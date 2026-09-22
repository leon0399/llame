## 1. Proposal layer

Delivery stack:

```text
master <- web-read/proposal <- web-read/fetch <- web-read/policy <- web-read/finalize
```

This change follows the merged and archived `tool-call-permissions` and
`native-file-tools` capabilities it modifies; both are shipped specs on
`master`, so no layer of this change restates or reverses them. One value is
consumed from an unmerged sibling: the boot-time version read that the
`opencode-go-provider` change places in instance config, which
`User-Agent: llame/<version>` uses. No layer implements a second version read,
and no layer of this change closes #914, #915, #916, or #917.

Layers, each with its branch, parent, ownership, authored-size estimate
against its parent, exit evidence, and issue responsibility. The review budget
is about 2,000 authored added-plus-deleted lines against the immediate parent
(`git diff --shortstat <parent>`, tests, specs, and docs included; no generated
output is involved). Re-estimate at each layer boundary and before publication;
split a growing concern or request a named exception before publishing an
oversized layer.

- `web-read/proposal` (parent `master`): this ledger, the proposal, the design,
  and the three delta specs. Estimated about 1,600 authored lines; measured at
  publication. Exit: the OpenSpec proposal, Product Markdown, and Any change
  verification rows, two adversarial review rounds committed separately, and
  Leo's approval of the published revision. Closes no issue.
- `web-read/fetch` (parent `proposal`): locator parsing and dispatch, `read`
  admission on the allowlist, the HTTP client with its bounds, negotiation,
  the local render with the quality gate, the `text` and `raw` outcomes, the
  result shape, the `read.md` description block, unit tests, and one
  integration test against a local HTTP fixture server. Estimated about 1,000
  authored lines. This layer fetches no derived locator: a 3xx answer fails
  the call with `http_status`, and the alternate, suffix, and `llms.txt`
  adapters do not exist yet, so `master` never carries a server-chosen
  request without its admission between merges. Closes no issue.
- `web-read/policy` (parent `fetch`): derived locators (redirect hops,
  announced alternates, suffix candidates, `llms.txt` candidates) with their
  admission and provenance, `rejectedUrl` on the shared error variant, the
  example configuration's two new rejects, the `docs/web-read.md` operator
  runbook, the `CHANGELOG.md` entry, and the README/AGENTS "what runs today"
  line. Estimated about 1,000 authored lines. The only layer that closes an
  issue: its delivery owner closes #913, writing `Closes #913` in the PR
  body, after the acceptance evidence is recorded. Closes no other issue.
- `web-read/finalize` (parent `policy`): canonical spec synchronization, task
  records, and archive movement only. Estimated under 200 authored lines
  (archive movement measured with rename detection). Exit: the Final OpenSpec,
  Product Markdown, and Any change rows. Closes no issue.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create the `fetch` layer only after explicit proposal-PR
approval and after the `opencode-go-provider` layer that adds the boot-time
version read to instance config has merged to `master`, with
`web-read/proposal` rebased onto that `master`; should that stack be
abandoned, add the same instance-config read as the first `fetch` task
instead. Publication and merge each require their own authorization. Every
layer has a self-review (SR) checkpoint before draft -> ready and a GitHub
review (GR) checkpoint after ready; for `finalize` both follow archive
movement as post-archive gates.

- [x] 1.1 [proposal] Complete two independent adversarial review rounds over the proposal, the design, and the three delta specs (`native-file-tools`, `tool-call-permissions`, and `tool-calling`, the last colliding with the in-flight `knowledge-submit` change), covering the adapter order against llmstxt.org v2 and Cloudflare Markdown for Agents, the quality gate's thresholds, the per-hop permission path, the MODIFIED blocks' losslessness, and the four deferrals; verify each finding against the repository, the cited primary sources, and the two research reports, commit each round separately, and verify convergence with no new substantive finding.
- [x] 1.2 [proposal] Verify the artifacts record the substrate and the contract correctly: every claim about `executeNative`'s dispatch, `projectNativeFilePath`'s pass-through, the read result object, the trailing-selector split, the packaged `read.md` template, the runtime's `fetch`, and the version seam cites a real file and line; the design carries D1-D13 with alternatives and consequences, the pipeline order, the dependency list with licenses and the linkedom spike, and the prior-art citations; and every MODIFIED requirement reproduces `master`'s text and scenarios losslessly. Record a programmatic diff (per requirement: canonical scenario count, delta scenario count, missing scenarios) in the PR body.
- [x] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate web-read --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain Leo's explicit approval of the final revision, then publication authorization, and publish the draft with `$gh-stack`.
- [x] 1.4 [proposal] SR: self-review the published draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, rerun the row checks, update the PR body, and mark the PR ready.
- [x] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop to completion on the current head with zero actionable unresolved feedback, and carry the resulting approval of the published revision forward as the gate for creating `fetch`.

## 2. Fetch layer

Branch `web-read/fetch`, parent `web-read/proposal`. Owns the locator surface,
the bounded HTTP client without redirects or probes, negotiation and the
local render with the quality gate, the result shape, and the `read`
description. Estimated about 1,000 authored lines; re-measure against the
parent before publication. Closes
no issue.

- [x] 2.1 [fetch] Run the proposal-time spike before committing a DOM dependency: parse a fixture HTML document with `linkedom`, run `@mozilla/readability`'s extraction over it, and verify the article's text and title come back; if Readability does not run on that document, switch the design's dependency line to `jsdom` and record the change in Dependencies and the changelog draft before any adapter code is written. Verify by recording the spike's fixture, its command, and its output in the PR body.
- [x] 2.2 [fetch] Add `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, and the spike's DOM package to `apps/api/package.json`; verify with a focused unit test in `apps/api/src/tools/web-read/pipeline.test.ts` that imports all four and converts a fixture fragment to Markdown with a GFM table, and with `pnpm install --frozen-lockfile` after the lockfile update.
- [x] 2.3 [fetch] Add the web branch to `executeNative` and the locator parser: `http://` and `https://` only, userinfo rejected as `invalid_path` before any request, a locator that is not its own WHATWG serialization rejected as `invalid_path` naming the canonical form, `edit` and `write` rejected with `invalid_path`, no executor identity required or bound, a trailing separator kept inside the URL, and the existing scheme-then-trailing-selector split reused unchanged; make `read` eligible for advertisement whenever it is allowlisted while `edit` and `write` keep the authority condition (D13) in `apps/api/src/knowledge/knowledge-tool-candidate-resolver.ts`; verify with `apps/api/src/tools/web-read/locator.test.ts`, additions to `apps/api/src/tools/native-files.test.ts`, and a case in `apps/api/src/knowledge/knowledge-tool-candidate-resolver.test.ts` for a process with neither native authority nor a Knowledge root nor skill sources, including that a pathless host reads its own port (`https://example.test:8080` is requested as `https://example.test:8080/`) while the same digits after the path separator are a line (`https://example.test:8080/:88`, `https://example.test/report:10`), and that the accepted range forms select (`https://example.test/docs/2024:10-20` reads `https://example.test/docs/2024`), that `Special:Search` fails `invalid_selector` while `Special%3ASearch` is fetched, and that `https://g%72okipedia.com/page`, `HTTPS://Example.test/guide`, and `https://example.test:443/guide` are refused naming their canonical spelling.
- [x] 2.4 [fetch] Implement the HTTP client in `apps/api/src/tools/web-read/fetch.ts` over the runtime's `fetch` with `redirect: "manual"`, sending no cookie or credential: `User-Agent: llame/<version>` from the instance-config value, `headers_timeout` at 10 s, `call_timeout` at 30 s across every request of the call, the streamed 5 MiB cap with `body_too_large`, no retries, and `http_status` for every non-2xx first response including 3xx (no derived locator is fetched in this layer) with `Retry-After` carried on 429; verify with `apps/api/src/tools/web-read/fetch.test.ts` against an injected fetch double for the bounds, headers, and status handling.
- [x] 2.5 [fetch] Implement negotiation, the text-body allowlist with the three-step charset resolution, the Readability and Turndown render with the quality gate, the raw fallback with its note, the challenge-page note, and `:raw`; verify with `apps/api/src/tools/web-read/pipeline.test.ts` asserting the winning `method` and the request count for each of: negotiated Markdown, negotiated plain text, a JSON body (`text`), a Readability render, a Readability miss, a gated render returning `raw` with a note, a challenge page, `:raw`, and a refused content type. The alternate, suffix, and `llms.txt` adapters are the `policy` layer's 3.1b.
- [x] 2.6 [fetch] Assemble the web result as the native read success object plus `finalUrl`, `method`, and `notes` only when non-empty, with `path` as the locator with its selector stripped (as a local read reports it), no `realPath`, no `url`/`contentType`/`markdownTokens`, no text header and no frontmatter, the envelope reserved before the native result bound truncates rendered text, and line selectors applied to the rendered text with the existing context and range rules; verify with `apps/api/src/tools/web-read/result.test.ts` covering a paged selector read, a repeated read issuing a new request, and a rendered text that exceeds the bound.
- [x] 2.7 [policy] Update `apps/api/src/prompts/tools/read.md`: rewrite the summary line so it no longer says the tool reads only a local file, add the web locator as a fourth target bullet with no `{{#if}}` guard, state that redirects are followed and `finalUrl` reports where the content came from, state that the URL is normalized to what the request uses and that a colon is a selector only after the path separator (so `https://example.test:88/` is the root page on port 88 and `https://example.test/:88` is line 88 of it), and add the encoded-colon note, and note that line selectors address the rendered text; landed on the `policy` layer rather than `fetch`, because the redirect and probe-method guidance it must carry is only true once that layer's derived locators exist; verify with focused cases in `apps/api/src/instance-config/prompt-loader.test.ts`, where `createToolPromptRenderer` renders a packaged description, that a rendered `read` description carries the redirect, `finalUrl`, and untrusted-content sentences, that every locator example it gives parses the way the sentence around it claims, and that the template still renders for a catalog without `knowledge_search`.
- [x] 2.8 [fetch] Add the fixture-server integration test at `apps/api/src/tools/web-read.integration.test.ts`: a server that negotiates Markdown, serves plain text, serves JSON, serves an HTML article, serves a nav-only page, serves a 6 MiB body, serves a PDF, and answers 302 (failing `http_status` in this layer); verify the acceptance cases end to end with `pnpm --filter api exec vitest run --project integration src/tools/web-read.integration.test.ts`, counting requests per case. The `policy` layer extends the same server with the alternate, suffix, `llms.txt`, and redirect cases.
- [x] 2.9 [fetch] Prove the layer locally with the affected API `lint`, `typecheck`, and `test:coverage`, `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; measure the parent-relative authored diff against the review budget; publish or refresh the draft with `$gh-stack` within the existing publication authorization.
- [x] 2.10 [fetch] SR: self-review the draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, with an independent subagent on the bounds and the quality gate; verify every finding, fix accepted ones with new commits, rerun the affected checks, update the PR body, and mark ready.
- [x] 2.11 [fetch] GR: after ready, run the Ready-PR monitoring loop to completion on the current head (terminal passing CI, every expected reviewer complete, zero actionable unresolved feedback) before creating `policy`.

## 3. Policy layer

Branch `web-read/policy`, parent `web-read/fetch`. Owns derived-locator
admission and provenance (hops, alternates, suffix, `llms.txt`), the
example configuration's new rejects, the operator runbook, the changelog
entry, the README/AGENTS line, and the closure of #913. Estimated about
1,000 authored lines; re-measure against the parent before publication.

- [x] 3.1 [policy] Add derived-locator admission and the hop loop: follow 301/302/303/307/308 up to 20 redirects per call, resolve each `Location` against the redirecting request's URL with the WHATWG parser and use its `href` as the hop locator, fail `invalid_redirect` on a missing or unparsable `Location`, userinfo, or a non-web scheme without repeating the target, evaluate the `read` permission group against every derived locator before its request through the same evaluator and the same `nativeFileProjection` the call used, end a rejected-hop call with `type: "permission_denied"`, the fixed hop message, and `rejectedUrl` carrying the locator's origin and path only (query and fragment removed) bounded to 2,048 characters with control characters removed (adding the optional `rejectedUrl` to the `ToolResult` error variant in `packages/runtime-safety/src/types.ts`), disqualify a rejected probe candidate without failing the call, fail `too_many_redirects` when the budget is exhausted, and report `finalUrl` as the last response's URL; verify with focused cases in `apps/api/src/tools/permissions/permissions.test.ts` and `apps/api/src/tools/web-read/fetch.test.ts` for a rejected cross-host hop, a hop that matches no allow although the call was admitted, a relative `Location`, a credentialed `Location`, a bare 302, a 21st redirect (`too_many_redirects`), an admitted hop whose body is served with `finalUrl`, and a refused alternate that is skipped.
- [x] 3.1b [policy] Add the alternate (`Link` header and head `<link>`), suffix, and `llms.txt` adapters in pipeline order with the per-call request budget (one alternate, one suffix, four `llms.txt`), `llms.txt` judged on length and shape only, and a probe's own failure — its non-2xx status, a refused content type, an oversized body, a headers timeout, an unfollowable redirect, or a transport failure — disqualifying only that candidate while a spent call bound, the abort, or a refused hop ends the call; verify in `apps/api/src/tools/web-read/pipeline.test.ts` the winning `method` and request count for an announced alternate, a suffix hit, a suffix 404 followed by the render, a gated render followed by `llms.txt`, and a probe that redirects past the budget, and extend the fixture server accordingly.
- [x] 3.2 [policy] Add a trusted derived-locator decision callback to the tool context that `apps/api/src/runs/run-execution.service.ts` constructs, have the web executor call it per derived locator, and record the collected decisions beside the call decision in the completion payload at settlement so tool activity, the stored tool-part metadata, and `assistant-transcript.ts` reconstruction carry them, each entry with the same policy-instance ID as the call decision plus the locator's own decision, static reason, and bounded clause reference, never through the model-visible `ToolResult`; verify with focused assertions in `apps/api/src/runs/run-execution.service.test.ts` and `apps/api/src/runs/assistant-transcript.test.ts` and a history-reload case proving the records stay out of model replay, public shares, exports, and search.
- [x] 3.3 [policy] Add the fixed hop-rejection message to `apps/api/src/tools/permissions/messages.ts` with no interpolation; verify with a focused test that the message is byte-identical across hops, contains no URL, rule text, matched fragment, clause reference, or policy ID, that `rejectedUrl` carries the locator's origin and path with its bound and control-character stripping and drops a signed query string, and that a subsequent independently allowed call still executes.
- [x] 3.4 [policy] Add the two `read.path` rejects to `apps/api/llame.config.json.example` and mirror them in `apps/api/src/testing/portable-tool-policy.ts`; verify with `apps/api/src/instance-config/tool-permissions-config.test.ts` extended by the F5 and F6 matrix rows including the trailing-dot host, the grokipedia subdomain case, the noncanonical spellings refused by the tool, and the domain-allowlist case in which a policy whose only allow is `^https://docs\.example\.com/` rejects another host, a local absolute path, and a `kb://` locator.
- [x] 3.5 [policy] Write `docs/web-read.md` as the operator runbook: what `read` now accepts, the adapter order with its `method` values, derived-locator admission with the note that policy matches canonical locator text (lowercase punycode host, no default port, percent-encoded path, no fragment: a submitted fragment is refused, and a derived hop's fragment is dropped before admission and before its request) because the tool refuses noncanonical submitted spellings and derives hops in that form, the domain-allowlist recipe that replaces `read`'s whole-tool allow, the threat model in both directions (inbound injection from fetched text; outbound exfiltration through a model-authored query string) plus the missing address check and #914, the bounds and error codes, what stays refused (#916), and the absence of a cache (#915); verify by walking the delta specs' scenarios against the runbook and running `pnpm lint:markdown`.
- [x] 3.6 [policy] Add the dated `CHANGELOG.md` entry covering web locators, the per-hop permission rule, the two example rejects, and the new error codes, and the README plus `apps/api/AGENTS.md` "what runs today" line for web reads; verify with `pnpm lint:markdown` and by checking each new error code and configuration key named in the entry against the schema and the example.
- [x] 3.7 [policy] Record the acceptance evidence for #913 in the PR body and an issue comment rather than a new change-directory file: the fixture-server integration run, the Cloudflare Markdown-for-Agents negotiation with `method: "negotiated"` and one request, the llmstxt.org `md-suffix` result, the Wikipedia `readability` render, the llmstxt.org `:raw` body, the rejected-hop case with its recorded decision and `rejectedUrl`, the domain-allowlist rejection case, the oversized-body and PDF failures; verify each row against the running build, not a recorded transcript.
- [x] 3.8 [policy] Close #913 with `Closes #913` on this layer's PR after every acceptance row above is recorded and verified, and confirm no other issue is closed by the stack; verify the issue cannot close before the acceptance comment exists.
- [x] 3.9 [policy] Prove the layer locally with the affected API `lint`, `typecheck`, and `test:coverage`, the focused permissions and instance-config tests, `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; measure the parent-relative authored diff against the review budget; publish or refresh the draft with `$gh-stack`.
- [x] 3.10 [policy] SR: self-review the draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, with an independent subagent on the hop evaluation and the example policy; verify every finding, fix accepted ones with new commits, rerun the affected checks, update the PR body, and mark ready.
- [x] 3.11 [policy] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `finalize`.

## 4. Finalize layer

Branch `web-read/finalize`, parent `web-read/policy`. Spec synchronization,
task records, and archive movement only; never an application fix. Estimated
under 200 authored lines. Enter the branch with `$gh-stack` from the
implementation top **before** `$openspec-sync-specs` writes any canonical spec.

- [x] 4.1 [finalize] Confirm with `$gh-stack` that `web-read/finalize` is checked out on top of the published, reviewed, and CI-green `policy` layer, and that every proposal, fetch, and policy task above is checked, before any synchronization runs.
- [x] 4.2 [finalize] Use `$openspec-sync-specs` to synchronize the `native-file-tools`, `tool-call-permissions`, and `tool-calling` deltas; if the `knowledge-submit` change has archived first, its edit of "Tool registry with mandatory safety classification" and this change's contradict on the resolver sentence, so reconcile by hand before sync: keep `knowledge-submit`'s wording for `edit` and `write` admission, its native-set sentence naming `knowledge_submit` as `write_low_risk`, its "Knowledge submit executes only in its native capability" scenario, and its other scenario edits; keep this change's "`read` whenever `tools.allowed` names it" sentence and its "Read is admitted by the allowlist alone" scenario; and keep the canonical "only when the executing process's call-permission policy also allows the invocation" clause that the older `knowledge-submit` block predates; if this change archives first, post the same three-part reconciliation on the `knowledge-submit` proposal PR and its tracking issue before this finalize PR is marked ready, so its later sync does not overwrite the `read` admission sentence, and link that comment from this PR's body; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass, and that the canonical specs carry every requirement and scenario from the deltas with every shipped scenario name and bullet preserved, checking the MODIFIED requirements and the cross-capability hop wording for semantic consistency, not only strict validation.
- [x] 4.3 [finalize] Verify archive readiness: `openspec status --change web-read --json` reports every artifact complete, every task above is checked, and no layer added a tool id, a configuration key, a cache, or a dependency beyond the four the design lists; then use `$openspec-archive-change`; verify the archive preserves checked history and passes strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

Post-archive gates, not pre-archive checklist tasks: publish the finalize draft
with `$gh-stack` under the existing publication authorization, self-review its
actual parent-relative diff (SR) and mark ready, run the Ready-PR monitoring
loop (GR) to completion, recheck stack bases and terminal checks, and request
explicit merge permission for each layer; merge only through `$gh-stack`.
