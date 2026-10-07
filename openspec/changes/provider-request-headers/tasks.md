## 1. Proposal layer

Tracks issue #881. Delivery stack:

```text
master <- provider-request-headers/proposal <- provider-request-headers/headers <- provider-request-headers/finalize
```

The Chat identity channel this change renders shipped with the archived
`opencode-go-provider` change (#809); no layer changes a model-client input or
a call site. Process: [CONTRIBUTING](../../../CONTRIBUTING.md).

Layers, each with its branch, parent, ownership, authored-size estimate against
its parent (tests, specs, and docs included; no generated output is involved),
exit evidence, and issue responsibility:

- `provider-request-headers/proposal` (parent `master`): this ledger, the
  proposal, the design, and the four delta specs. Estimated about 700 authored
  lines. Exit: the OpenSpec proposal, Product Markdown, and Any change rows,
  review rounds committed separately, and Leo's approval of the published
  revision. Closes no issue.
- `provider-request-headers/headers` (parent `proposal`): the `headers`
  schema, loader, defaults, operator precedence, template resolution, the
  startup control-character check, per-call rendering in all five clients,
  tests, operator docs, and the changelog. Estimated about 1,300 authored lines
  (comparable layers: #909 1,251 and #941 1,186). Exit: the
  Workspace TypeScript, Product Markdown, and Any change rows locally, and
  current-head CI green after ready. Its delivery owner closes #881.
- `provider-request-headers/finalize` (parent `headers`): canonical spec
  synchronization, task records, and archive movement only. Estimated about
  300 authored lines (archive movement measured with rename detection). Exit:
  the Final OpenSpec, Product Markdown, and Any change rows. Closes no issue.

No layer closes #765, #1096, #754, #753, or #751. Re-estimate each layer's
authored size at its boundary and before publication; split a growing concern
or request a named exception before publishing an oversized layer.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create the `headers` layer only after explicit proposal-PR
approval; publication and merge each require their own authorization. Every
layer has a self-review (SR) checkpoint before draft -> ready and a GitHub
review (GR) checkpoint after ready; for finalize both follow archive movement
as post-archive gates.

- [x] 1.1 [proposal] Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and the cited upstream sources; commit each round separately. Recorded: one round (spec consistency, feasibility, ponytail), applied in `328dbf75`; Leo requested no further round.
- [x] 1.2 [proposal] Verify every MODIFIED block reproduces master's requirement text and scenario headings, with only the edits the proposal names, by a recorded sentence-level diff against `openspec/specs`. Recorded 2026-10-07 after review round 1: `instance-config` "Provider list configuration" 15 of 15 scenario headings kept, changed sentences are four variant shapes, the `headers` cross-reference, the Codex headers clause, and one Codex scenario body; `provider-api-selection` "Every provider request identifies llame" 2 of 2 kept, changed sentences are the opening `User-Agent` clause, the override clause, the product-token clause, and two scenario conditions; "Language-model requests carry the Chat identity" 4 of 4 kept, changed sentences are the rendering clause and two scenario bodies; `opencode-go-provider` "Requests identify llame as the client" 2 of 2 kept, changed sentences are the request-identifier and identity clauses, the added override sentence, the default-value clause, and two scenario bodies; "Every request for a Chat carries its session identity" 4 of 4 kept, one sentence added.
- [x] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate provider-request-headers --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain Leo's approval of the final revision. Approved at `328dbf75` (recorded on #1097, 2026-10-07).
- [x] 1.4 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, rerun the row checks, and mark the PR ready. Recorded: self-review was the round-1 review (`328dbf75`); the PR was ready from its first GitHub round.
- [x] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop to completion on the current head with zero actionable unresolved feedback before creating `headers`. Recorded: GitHub round processed in `81d7bf71`, `07d3d4c0`, and `efa8678b`; all 11 threads replied to and resolved, with the redaction finding tracked in #1098; CI not awaited for this docs-only layer, per Leo (2026-10-07).

## 2. Headers layer

Branch `provider-request-headers/headers`, parent
`provider-request-headers/proposal`. Owns the operator header map end to end
and the closure of #881.

- [x] 2.1 [headers] Add `headers` to `$defs.providerEntry` in `llame.config.schema.json` (object of non-empty names to `string | null`, allowed on every type), the raw entry types in `llame-config.ts`, and a resolved header map on every resolved provider config; update the `config-loader.test.ts` cases that pin a Codex or Go entry rejecting any extra field; verify with schema and loader tests that each provider type accepts the key, a non-string non-null value fails, and a Codex entry with `baseUrl` still fails.
- [x] 2.2 [headers] Implement one header resolver in `config-loader.ts`, called by all five provider resolvers: ASCII case-fold collision rejection, the per-type default map and case-folded overlay with `null` removal (D2), the unknown-token check and `interpolateStringWithSubstitutions` resolution (D5), and CR/LF/NUL rejection of resolved values (D8); verify with focused loader tests for every scenario of "Provider entries accept an operator header map" except the models-endpoint one, "Provider types supply default headers under the operator map", "Header values are templates resolved at startup", and "Interpolated header values get the provider key's non-disclosure", including that no error prints a resolved value; and with a models-controller test that a provider `headers` map appears nowhere in `GET /api/v1/models`.
      Header validation uses Node's own `Headers` acceptance rule, and focused tests cover an invalid name plus a `__proto__` key retained as an own property of the null-prototype resolved map.
- [x] 2.3 [headers] Move the Go client's `renderSessionValue` to one shared export used by `{session:id}`, pass each entry's resolved map from `model-client-factory.ts` into every client, and overlay the rendered map on each client's per-call headers, deleting case-folded matches first and skipping values that render empty (D7); verify with focused renderer tests for "The session variable renders the Chat identity per lane".
- [x] 2.4 [headers] Prove the requests at the serialized request (real fetch capture, as `opencode-go-model-client.test.ts` does) in the Responses, Completions, Messages, Codex, and Go clients: each default-on type sends `X-Session-Id` on a main-lane stream, a compaction-shaped request carries the same value, a title-lane structured request carries `title:<id>`, Codex sends nothing by default and the header when configured, a custom header reaches both paths, an operator `User-Agent` and an operator `x-opencode-client` replace the client's own, and `null` or an empty render on `x-opencode-session` leaves Go's session header in place; flip the Go negative header snapshot so `x-session-id` is expected and `x-session-affinity`, `x-opencode-request`, and `x-opencode-project` stay absent.
- [x] 2.5 [headers] Document the map: the `headers` description in the schema, an example entry in `apps/api/llame.config.jsonc.example`, the README provider section, `docs/product/operator/providers/litellm-gateway.md` (the default `X-Session-Id` and what LiteLLM does with it), `opencode-go.md` (replace the sentence saying `X-Session-Id` is never sent, qualify the claim at lines 171-176 that llame cannot send a request without the session header, and warn that an `openai-completions` entry pointed at Go fails runs, design D9), and `codex-subscription.md` (the opt-in); say in each that an override of a credential or identity header is the operator's responsibility; verify the example loads through the configuration loader in a focused test and `pnpm lint:markdown` passes.
      The LiteLLM runbook names the gateway-side `router_settings.optional_pre_call_checks: ["session_affinity"]` setting required for prompt-cache pinning (off by default) and says `title:<chatId>` requests are not grouped because LiteLLM rejects that session-id grammar.
- [x] 2.6 [headers] Add a dated `CHANGELOG.md` entry: the new `headers` map, the default `X-Session-Id` on four provider types and how to remove it, the Codex opt-in, and that operator values override llame's own headers including `User-Agent`; then close #881 with authorization after verifying each acceptance item in `proposal.md` is covered by a test.
- [x] 2.7 [headers] Prove the layer locally with `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; measure the parent-relative authored diff against the budget; publish or refresh the draft with `$gh-stack`. Recorded 2026-10-07: `pnpm --filter api lint` and `typecheck` pass; focused unit run of `src/instance-config`, `src/models`, `src/runs/run-execution.service.test.ts`, `src/titles`, and the two search unit files 1,152 passed (2 `resolveConfigPath` failures from an untracked local `apps/api/llame.config.json`, pass on a clean checkout); the three touched integration files 16 passed; `pnpm --filter api build`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass; full `test:coverage` left to CI. Authored diff against `proposal`: 1,138 lines (1,051 added, 87 deleted), within budget.
- [x] 2.8 [headers] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, with an independent subagent on the configuration boundary and the header precedence; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready. Recorded: one code-review and one ponytail-review subagent; accepted the `{path:}` file-location error, identifier-only token names (JSON values load verbatim), anthropic-beta and Go null-header tests, the single `withRequestHeaders` helper, and the simpler overlay, split, and tests; kept the `RequestHeaders` alias the anti-slop lint rule needs.
- [ ] 2.9 [headers] GR: after ready, run the Ready-PR monitoring loop to completion on the current head (terminal passing CI, every expected reviewer complete, zero actionable unresolved feedback) before creating `finalize`.

## 3. Finalize layer

Branch `provider-request-headers/finalize`, parent
`provider-request-headers/headers`. Spec synchronization, task records, and
archive movement only; never an application fix. Enter the branch with
`$gh-stack` from the implementation top **before** `$openspec-sync-specs`
writes any canonical spec.

- [ ] 3.1 [finalize] Confirm with `$gh-stack` that `provider-request-headers/finalize` sits on the published, reviewed, CI-green `headers` layer and that every task above is checked.
- [ ] 3.2 [finalize] Use `$openspec-sync-specs` to create the `provider-request-headers` capability and apply the `instance-config`, `provider-api-selection`, and `opencode-go-provider` deltas; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass and every shipped scenario heading survives.
- [ ] 3.3 [finalize] Verify archive readiness with `openspec status --change provider-request-headers --json` and every tracked task checked; then use `$openspec-archive-change` and verify strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Publish the finalize draft with `$gh-stack`, self-review its diff (SR) and mark ready, run the Ready-PR monitoring loop (GR), recheck stack bases and checks, and request merge permission for each layer; merge only through `$gh-stack`.
