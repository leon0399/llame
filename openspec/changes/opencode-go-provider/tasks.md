## 1. Proposal layer

Delivery stack:

```text
master <- opencode-go-provider/proposal <- opencode-go-provider/chat-key <- opencode-go-provider/go-provider <- opencode-go-provider/finalize
```

This change follows the merged and archived `openai-compatible-provider`
change (PRs #884, #886, #888, #889, #890, closing issue #883), which owns the
wire-named `openai-responses` / `openai-completions` types, the type-dispatch
factory, and `@ai-sdk/openai-compatible@2.0.75`, and the merged and archived
`anthropic-provider` change, which owns `anthropic-messages`, the per-model
`providerOptions` composition, and the reasoning-part provider-metadata
channel. No layer of this change duplicates or reverses either, and no layer
adds a dependency: the Chat Completions adapter is already installed. The
research the design cites lives in one standalone docs PR (#906, branch
`research/opencode-family-go-handling`) that is not part of this stack and
gates nothing here.

Layers, each with its branch, parent, ownership, authored-size estimate against
its parent (tests, specs, and docs included; no generated output is involved),
exit evidence, and issue responsibility:

- `opencode-go-provider/proposal` (parent `master`): this ledger, the proposal,
  the design, and the three delta specs. Measured 1,673 authored lines at
  publication (`git diff --shortstat master`, insertions plus deletions). Exit:
  the OpenSpec proposal, Product Markdown, and Any change verification rows,
  two adversarial review rounds committed separately, and Leo's approval of
  the published revision. Closes no issue.
- `opencode-go-provider/chat-key` (parent `proposal`): the `chat` field on
  both model-client input contracts, the derivation at every call site, the
  test doubles, the version read at boot, and the `User-Agent` on the four
  existing clients. Estimated about 800 authored lines. Exit: the Workspace
  TypeScript and Any change rows locally, current-head CI green after ready.
  Closes no issue.
- `opencode-go-provider/go-provider` (parent `chat-key`): `type: "opencode-go"`
  end to end, the example configuration, the runbook, the README and
  `apps/api/AGENTS.md` rows, the `docs/scaling.md` sentence, the changelog, and
  the live proof. Estimated about 1,200 authored lines. Exit: the Workspace
  TypeScript, Product Markdown, and Any change rows locally, the live proof
  recorded, current-head CI green after ready. The only layer that closes an
  issue: its delivery owner closes #809 after its acceptance evidence is
  recorded.
- `opencode-go-provider/finalize` (parent `go-provider`): canonical spec
  synchronization, task records, and archive movement only. Estimated about
  300 authored lines (archive movement measured with rename detection). Exit:
  the Final OpenSpec, Product Markdown, and Any change rows. Closes no issue.

No layer closes issues #903, #904, #908, #808, #881, #810, #593, #751, #754, #18, #82, or #37.
Re-estimate each layer's authored size at its boundary and before
publication; split a growing concern or request a named exception before
publishing an oversized layer.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create the `chat-key` layer only after explicit proposal-PR
approval; publication and merge each require their own authorization. Every
layer has a self-review (SR) checkpoint before draft -> ready and a GitHub
review (GR) checkpoint after ready; for finalize both follow archive movement
as post-archive gates.

- [x] 1.1 [proposal] Complete two independent adversarial reviews of the proposal, design, and delta specs; verify each finding against the repository, the AI SDK's built types, the pinned adapters' built source, the gateway's open-source handler, and the peer-harness findings digests; commit each substantive revision separately; verify convergence with no new substantive finding.
- [x] 1.2 [proposal] Verify the artifacts record the substrate and the dependency correctly: every claim about the factory, the client input contracts, the four production calls in three modules, the loader, the embedding allowlist, the per-call header support, and the SDK's own per-call `User-Agent` on structured requests cites a real file and line; the design carries every decision D1-D15 with its rationale and rejected alternatives, the accepted risks, and the deferred items with their issue numbers; and both MODIFIED blocks reproduce master's requirement text and scenarios losslessly. Recorded programmatic diff (master versus delta, scenario names and scenario bullets): `instance-config` "Provider list configuration" 11 master scenarios, 0 missing, 4 added (`OpenCode Go provider loads by shape`, `OpenCode Go provider rejects a base URL`, `OpenCode Go provider requires a non-empty key`, `OpenCode Go provider cannot back embeddings`), master order preserved, every master bullet preserved in place; `provider-api-selection` "Provider type selects the wire API" 9 master scenarios, 0 missing, 1 added (`An OpenCode Go-typed provider uses Chat Completions at the fixed endpoint`), master order preserved, every master bullet preserved in place; the requirement-paragraph edits are exactly four in `instance-config` (the enum clause, the variant clause with its rejected fields, the exclusion list, and the phrase "all three wire types" replaced by the three variant names it counted) and one insertion in `provider-api-selection` (the Go wire clause), with every other paragraph byte-identical.
- [x] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate opencode-go-provider --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain Leo's explicit approval of the final revision, then publication authorization, and publish the draft with `$gh-stack`.
- [x] 1.4 [proposal] SR: self-review the published draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, rerun the row checks, and mark the PR ready.
- [x] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop to completion on the current head with zero actionable unresolved feedback, and carry the resulting approval of the published revision forward as the gate for creating `chat-key`.

## 2. Chat-key layer

Branch `opencode-go-provider/chat-key`, parent `opencode-go-provider/proposal`.
Owns the required `chat` field, its derivation at every call site, the version
read at boot, and llame's `User-Agent` on the four existing clients. Estimated
about 800 authored lines; measured 1,182 authored lines against the parent
at publication (`git diff --shortstat opencode-go-provider/proposal`,
insertions plus deletions), within the review budget.
Closes no issue.

- [x] 2.1 [chat-key] Add `ChatIdentity` and `ChatLane` to `apps/api/src/models/model-client.ts` and the required `chat` field to `ModelStreamInput` and `ModelObjectInput`, with the doc comments stating that call sites supply facts, that a client renders the identity in its provider's own form or ignores it, and that the value is never a credential and never reaches model context or owner output; verify with `pnpm --filter api typecheck` that the field's requirement makes the compiler enumerate every construction site, and with a focused unit test that a client receives the identity it was given.
- [x] 2.2 [chat-key] Derive the identity at every production call site: the run loop's streaming call in `apps/api/src/runs/run-execution.service.ts` sends `{ id: input.chatId, lane: 'main' }`, the shared summarization call in `apps/api/src/compaction/compaction.service.ts` sends the same lane and id for both `maybeCompact` and `compactForTransition`, and `apps/api/src/titles/title.service.ts` sends `{ id: input.chatId, lane: 'title' }` on both its structured and its text path; verify with focused tests that a recorded streaming call, a recorded compaction call, and a recorded title call each carry the expected `{ id, lane }`, that the compaction value equals the turn's, that the title value differs only by lane, and that the identity appears in no request body, system prompt, or persisted message part of a run that carried it; stability across retries and worker restarts follows by construction from `chats.id` and is recorded, not tested.
- [x] 2.3 [chat-key] Update every test double and client test the compiler reports, including the doubles in `apps/api/src/testing/fake-streaming-model-client.ts`, `apps/api/src/runs/scripted-model-client.ts`, and `apps/api/src/worker-mode.integration.test.ts`, and every client test that constructs an input for `streamText` or `generateObject`; verify with `pnpm --filter api typecheck` clean and the affected unit and integration projects green, and confirm no call site was given a default value to make it compile.
- [x] 2.4 [chat-key] Send `User-Agent: llame/<version>` on every language-model request from all four existing clients: read the version from `apps/api/package.json` once at boot inside instance-config loading (resolved two directories above `src/instance-config/`, which `dist/` mirrors under `nest-cli.json`'s `sourceRoot`), failing startup as an `InstanceConfigError` that names the logical requirement (`apps/api/package.json` beside `dist/`) and never the resolved absolute path when the manifest is unreadable; thread the product token from `model-client-factory.ts` into every client config; carry it as a lowercase `user-agent` on the per-call `headers` of every `streamText`, `generateText`, and `generateObject` call the clients make, widening `generateToolBoundObject`'s call-settings pick to `headers` and passing headers into the Anthropic client's `generateObject` dependency, so the SDK's own per-call `User-Agent` on structured requests appends to llame's instead of replacing it; extend the post-build contract to check the manifest is beside `dist/`; verify with one focused test per client type asserting, on one streaming and one structured request each, that the value begins with `llame/<version>` and is never the SDK identifier alone, with no constraint on any other token.
- [x] 2.5 [chat-key] Prove the field is required by type rather than by convention: verify that omitting `chat` at a construction site fails `pnpm --filter api typecheck`, and that the title lane reaches a client as `title` while the turn and compaction lanes reach it as `main`; keep both as focused tests, with the compile-level check expressed as a type-level assertion or a documented typecheck probe rather than a runtime default.
- [x] 2.6 [chat-key] Add the changelog entry for the layer: llame now identifies itself on every language-model request, and every model request carries its Chat's identity and lane; embedding requests are unchanged.
- [x] 2.7 [chat-key] Prove the layer locally with the affected API `lint`, `typecheck`, and `test:coverage`, `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; measure the parent-relative authored diff against the budget; publish or refresh the draft with `$gh-stack` within the existing publication authorization.
- [x] 2.8 [chat-key] SR: self-review the draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, with an independent subagent on the header and call-site changes; verify every finding, fix accepted ones with new commits, rerun the affected checks, update the PR body, and mark ready.
- [x] 2.9 [chat-key] GR: after ready, run the Ready-PR monitoring loop to completion on the current head (terminal passing CI, every expected reviewer complete, zero actionable unresolved feedback) before creating `go-provider`.

## 3. Go-provider layer

Branch `opencode-go-provider/go-provider`, parent `opencode-go-provider/chat-key`.
Owns provider type `opencode-go` end to end, its operator documentation, the
changelog entry, the live proof, and the closure of #809. Estimated about
1,200 authored lines; measured 2,040 authored lines against the parent at
publication (`git diff --shortstat opencode-go-provider/chat-key`, insertions plus
deletions), at the review budget's line — 745 of them the Go client's own
focused test file and 208 the operator runbook.

- [x] 3.1 [go-provider] Add `"opencode-go"` to the `providerType` schema enum with its description, the `providerEntry` conditional (`key` required, `baseUrl` and `accountId` rejected), the `OpenCodeGoProviderConfig` type and `ProviderConfig` union, the `RawProviderEntry` variant, and one loader case resolving `key` through the existing required-non-blank path; verify with focused configuration tests that an entry with a nonblank key loads as authored with no endpoint field, that an entry declaring `baseUrl` fails boot naming the offending path, that an entry whose key is omitted or resolves empty fails boot naming the entry and field, and that no endpoint is contacted at boot.
- [x] 3.2 [go-provider] Add `apps/api/src/models/opencode-go-model-client.ts` exporting the fixed endpoint constant and a client composed over the Chat Completions module with that base URL, the entry's credential, the `opencode-go` provider name (a new optional `provider` override on the completions client, passed to `createOpenAICompatible({ name })`, reported as the client's `provider`, and used to derive the `providerOptions` composition key that `completionsProviderOptions` hardcodes today), Go's fixed headers, and the redirect-rejecting `fetch` the Codex client uses, plus the factory case dispatching on `type`; verify with focused factory and client tests that a `type: "opencode-go"` provider routes to the Go client whatever its `id`, that the request base URL is the fixed endpoint, that the client reports `provider: 'opencode-go'`, that a redirect response fails without a second request, that operator `providerOptions` reach the request body under the namespace the adapter derives from `opencode-go` with the wire's reserved paths stripped, and that no other type's dispatch changed.
- [x] 3.3 [go-provider] Render the Chat identity as the gateway's session header on every language-model request the Go client makes, including the structured-generation path, by adding to the Chat Completions client an optional session-header renderer that names one header and returns its value from the `chat` identity, merged into the per-call headers of both its streaming and its structured requests; verify with focused tests that a main-lane request sends the Chat id verbatim, a title-lane request sends `title:<id>`, a structured request (the title path) carries the header too, a compaction request carries the same value as the turn, and a client with no renderer configured sends no session header at all.
- [x] 3.3a [go-provider] Snapshot the full header set of one Go request per path: verify with a focused test that a streaming and a structured Go request carry `User-Agent` beginning with `llame/<version>`, `x-opencode-client: llame`, and `x-opencode-session`, and carry no `x-opencode-request`, `x-opencode-project`, `X-Session-Id`, or `x-session-affinity`; and that the request body carries no cache-control field or cache-breakpoint marker.
- [x] 3.3b [go-provider] Pin the failure surface: verify with a focused test using a canary workspace id placed in the gateway's `metadata.workspace`, a canary in `error.message`, a canary in the request body, and a canary credential in the request's `Authorization` header, against a 401 `ModelError` body, a 429 `GoUsageLimitError` body, a non-envelope HTML 502 body, and a malformed mid-stream chunk, that the run's failure message and the logged error carry the parsed message (the status text for the non-envelope body; the SDK's parse error quoting only that one chunk for the malformed stream) and nothing else: no `metadata` value, no response body, no response header, no request body, and no credential; and that the 429 path fails after the SDK's retries without a fallback request to another model.
- [x] 3.3c [go-provider] Verify cost: a focused test that an `opencode-go` model without `pricingUsdPer1M` records usage with `costUsd: null`, and one with declared rates prices the reported usage at those rates and nothing else.
- [x] 3.4 [go-provider] Verify the embedding exclusion needs no code change and is enforced: the loader and the embedding worker already allow only the two OpenAI wire types; verify with a focused configuration test that an `embeddingModels[]` entry referencing an `opencode-go` provider fails startup identifying the unsupported binding, and with the same test at the backend-construction path.
- [x] 3.5 [go-provider] Add the `opencode-go` provider and its two models to `apps/api/llame.config.json.example`, both chat-accepted, with `reasoning` declared where the model reasons and no `pricingUsdPer1M`, and leave the Contributor models out; verify the example still parses and boots by loading it through the configuration loader in a focused test and asserting both models resolve against the provider.
- [x] 3.6 [go-provider] Write `docs/opencode-go.md` with the named sections: obtaining and configuring the subscription key, the fixed endpoint and the Chat Completions route ceiling with its owning issue, the accepted upstream failure shapes (the "not supported for format" message and its remedy; usage-limit rejection after the SDK's retries; the unverified third-party report of a generic 400 for a missing session header, which llame cannot produce), the per-model privacy divergence with the excluded models named, the subscription usage windows, what a declared `pricingUsdPer1M` means, and the upstream "Use balance" toggle llame can neither observe nor set; verify against the new capability's runbook requirement scenario by scenario.
- [x] 3.7 [go-provider] Document the type where operators and agents look for it: the README provider section, the `apps/api/AGENTS.md` wire matrix, whose row set currently omits `anthropic-messages` as well, so the table enumerates every executable type again, and one sentence in `docs/scaling.md` beside the `node dist/main.js` example stating that `apps/api/package.json` must be deployed beside `dist/` because boot reads the version from it; verify each matrix row matches the schema enum and the factory switch.
- [x] 3.8 [go-provider] Run the bounded live proof against the real gateway with an operator key and record it as `live-proof.md` in this change directory: streaming text, an authorized tool round trip, cancellation, a title request, a compaction request, a second request over a reused prefix reporting the gateway's cache reuse where the gateway exposes it, and the observed status, body class, and message text (with any workspace value redacted) of a usage-limit rejection if one occurs (recording whether a monthly-window rejection arrives as a 429 `GoUsageLimitError` or a 401 `MonthlyLimitError`, and whether the message text names a workspace), with the model, versions, and outcomes recorded and no credential, workspace, or account value printed; stop for a proposal revision if required behavior cannot be met.
- [x] 3.9 [go-provider] Add the changelog entry covering the provider type, the Chat identity on every provider request, and llame's client identity; then close #809 with explicit authorization after verifying every acceptance addition is met and recorded: an eligible model completes a real run with streaming, tool round trips, cancellation, and persisted observations; the fixed endpoint, the required key, the rejection of a destination field, the redirect rejection, the provider identifier, the session header on the main, compaction, and title requests, the negative header set, the absence of cache control, the User-Agent on every client type, the failure surface, cost, and the embedding exclusion are all covered by tests; and missing keys, unsupported models, exhausted quota, and upstream errors surface as the gateway's parsed message with no raw body, header, request body, or credential.
- [x] 3.10 [go-provider] Prove the layer locally with the affected API `lint`, `typecheck`, and `test:coverage`, the focused integration tests the layer touched, `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; measure the parent-relative authored diff against the budget; publish or refresh the draft with `$gh-stack` within the existing publication authorization.
- [x] 3.11 [go-provider] SR: self-review the draft PR's actual parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, with independent subagents on the configuration boundary and the failure surface; verify every finding, fix accepted ones with new commits, rerun the affected checks, update the PR body, and mark ready.
- [ ] 3.12 [go-provider] GR: after ready, run the Ready-PR monitoring loop to completion on the current head (terminal passing CI, every expected reviewer complete, zero actionable unresolved feedback) before creating `finalize`.

## 4. Finalize layer

Branch `opencode-go-provider/finalize`, parent `opencode-go-provider/go-provider`.
Spec synchronization, task records, and archive movement only; never an
application fix. Estimated about 300 authored lines. Enter the branch with
`$gh-stack` from the implementation top **before** `$openspec-sync-specs`
writes any canonical spec.

- [ ] 4.1 [finalize] Confirm with `$gh-stack` that `opencode-go-provider/finalize` is checked out on top of the published, reviewed, and CI-green `go-provider` layer, and that every proposal and implementation task above is checked, before any synchronization runs.
- [ ] 4.2 [finalize] Use `$openspec-sync-specs` to synchronize the new `opencode-go-provider` capability and the `instance-config` and `provider-api-selection` deltas; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass and that the canonical specs carry every requirement and scenario from the deltas with every shipped scenario name and bullet preserved, checking MODIFIED requirements and cross-capability wording for semantic consistency, not only strict validation.
- [ ] 4.3 [finalize] Verify archive readiness: `openspec status --change opencode-go-provider --json` reports every artifact complete, every tracked task above is checked, and no layer added a dependency, a compiled model or route table, or a Go-specific error type; then use `$openspec-archive-change`; verify the archive preserves checked history and passes strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

Post-archive gates, not pre-archive checklist tasks: publish the finalize
draft with `$gh-stack` under the existing publication authorization, self-review
its actual parent-relative diff (SR) and mark ready, run the Ready-PR
monitoring loop (GR) to completion, recheck stack bases and terminal checks,
and request explicit merge permission for each layer; merge only through
`$gh-stack`.
