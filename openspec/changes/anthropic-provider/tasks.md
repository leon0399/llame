## 1. Proposal layer

Delivery stack: `master <- anthropic-provider/proposal <- anthropic-provider/native <- anthropic-provider/compatible <- anthropic-provider/finalize`.

This change stacks on `openai-compatible-provider`, which merges first: it owns
the `openai`/`openai-compatible` split, the `@ai-sdk/provider` 3.0.16 /
`@ai-sdk/provider-utils` 4.0.51 bump, the per-reasoning-part provider-metadata
channel from #883, and the `reasoning-output` amendments that make a persisted
thinking signature lawful. No layer of this change may duplicate or reverse those,
and no layer may write a `reasoning-output` delta of its own: this change is the
channel's first producer.

The proposal layer owns this ledger, the proposal, the design, and the two delta
specs. The native layer owns `type: "anthropic"`. The compatible layer owns
`type: "anthropic-compatible"` and is the only layer that closes an issue: the
compatible layer's delivery owner closes #208 after its acceptance evidence is
recorded. The finalize layer owns canonical spec synchronization and archive
movement only, and no layer closes #754, #882, #810, #593, #82, #808, #809, #37,
or #18.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create the native layer only after explicit proposal-PR approval;
publication and merge each require their own authorization.

- [ ] 1.1 [proposal] Complete two independent adversarial reviews of the proposal, design, and delta specs; verify each finding against the repository, commit each substantive revision separately, and verify convergence with no new substantive findings.
- [ ] 1.2 [proposal] Verify the artifacts record the dependency correctly: the per-part metadata channel and the `reasoning-output` amendments belong to `openai-compatible-provider`, this change writes no `reasoning-output` delta, and the thinking requirement covers persistence on the part, complete and ordered unmodified replay across turns, no llame-side pruning, no model-switch coercion, and the explicit drop-on-prefix-mismatch behavior.
- [ ] 1.3 [proposal] Validate with `pnpm exec openspec validate anthropic-provider --strict`, `pnpm lint:markdown`, `pnpm exec prettier --check openspec/changes/anthropic-provider`, and `git diff --check`; inspect the actual artifact diff and obtain publication authorization plus explicit approval of the published revision before implementation starts.

## 2. Native layer

Owns provider type `anthropic` against Anthropic's own Messages API. Branch:
`anthropic-provider/native`.

- [ ] 2.1 [native] Add `"anthropic"` to the `providerType` schema enum, the `ProviderConfig` union, and loader normalization (`key`, optional `baseUrl`, empty key resolves keyless); verify with focused configuration tests that a valid entry loads, that an unknown `type` still fails at boot naming the offending entry, that `anthropic-compatible` is still rejected until the next layer, and that no endpoint is contacted at boot.
- [ ] 2.2 [native] Add the Anthropic model client (`streamText`/`generateObject`, context window, pricing, compaction threshold) and its `model-client-factory` case; verify dispatch follows `type` alone — any provider `id` routes to the Anthropic client, an entry with a custom `baseUrl` uses it, and two same-type providers each use their own credential and endpoint.
- [ ] 2.3 [native] Resolve the credential once at startup through existing interpolation; verify with canary tests that resolved values appear in no log, error, or telemetry output, that load errors name only the entry `id` and field, and that an empty key does not fail client construction.
- [ ] 2.4 [native] Persist each thinking block's signature (and redacted payload) as opaque provider metadata on its reasoning part through the sibling change's channel, replay the blocks complete and in their original order on later requests for the same chat, set the block-binding prefix-mismatch behavior to drop explicitly rather than inherit the account default, and do not prune thinking or coerce blocks on a model switch; verify with fixtures that a tool continuation carries the signed block, a later request replays the persisted blocks, a compaction-rewritten prefix (including mid-run) continues instead of failing with a 400, consecutive blocks keep their order and bytes, a model switch replays them unchanged, and a response with no thinking output still completes.
- [ ] 2.5 [native] Map the resolved effort onto the adapter's thinking option; verify a declared level reaches the request, an effort the model does not declare still fails with the existing 422 behavior before any provider call, and no new configuration field or llame-owned level vocabulary is introduced.
- [ ] 2.6 [native] Set the top-level ephemeral cache control on every `anthropic` request; verify from a recorded request fixture that it is a top-level field, that no llame-authored content block carries a cache marker, and that no 1-hour lifetime is requested; verify in the live proof that a reused cacheable prefix reports cache-read tokens.
- [ ] 2.7 [native] Add the optional cache-write rate to the model pricing shape, carry it through price resolution, and consume provider-reported cache-write tokens in cost computation; verify cost tests cover the declared rate, the fallback to the input rate when absent, and `costUsd: null` when no pricing is declared, and that cache-write tokens are reported in usage telemetry.
- [ ] 2.8 [native] Use the adapter's native forced tool choice for schema-constrained generation; verify bound-object generation and title generation succeed and that no fallback path exists, with an unsupported combination failing explicitly instead of degrading silently.
- [ ] 2.9 [native] Verify the failure boundaries: authentication failure, unknown model, rate limit, and unsupported option each fail the affected request with sanitized diagnostics, with recorded parts and tool effects retained, no automatic retry, no credential substitution, and no fallback to another provider or type.
- [ ] 2.10 [native] Add `@ai-sdk/anthropic@3.0.118`; verify the resolved lockfile carries `@ai-sdk/provider@3.0.16` and `@ai-sdk/provider-utils@4.0.51` (converging with change 1) and that no zod change is required; document the `anthropic` entry — proxy `baseUrl`, keyless semantics, request-level caching, and the cache-write price field.
- [ ] 2.11 [native] Run the bounded live proof with a real API credential: streaming text, reasoning, an authorized tool round trip, cancellation, a reused cacheable prefix, and cache-write cost in persisted telemetry; record model, versions, and outcomes without secrets; stop for proposal revision if required behavior cannot be met.
- [ ] 2.12 [native] Run affected API lint, typecheck, coverage, integration and build checks plus focused product E2E, Markdown lint, formatting, and diff checks; add the changelog entry covering the two provider types and the cache-write cost reporting; publish the authorized layer and verify terminal checks and resolved actionable feedback before creating the compatible layer.

## 3. Compatible layer

Owns provider type `anthropic-compatible` and the closure of #208. Branch:
`anthropic-provider/compatible`.

- [ ] 3.1 [compatible] Add `"anthropic-compatible"` to the schema enum, the `ProviderConfig` union, and loader normalization with a required `baseUrl`; verify a valid entry loads, a missing `baseUrl` fails at boot naming the entry and field, a mismatched host is accepted without a warning or reinterpretation, and an embedding model referencing either new type fails startup.
- [ ] 3.2 [compatible] Dispatch the compatible type through the shared client against the operator's base URL; verify requests reach that destination in the Messages wire format, a keyless gateway entry constructs and executes, and no host inference or fallback exists.
- [ ] 3.3 [compatible] Verify parity with the native type: same cache-control option, effort mapping, thinking round-trip, and structured-output path, with request fixtures proving the bodies differ only by destination; verify a gateway that rejects cache control fails at request time while one that ignores it completes.
- [ ] 3.4 [compatible] Run the bounded live proof against an operator-supplied Messages-compatible endpoint; if none is available, verify against recorded wire fixtures and record the limitation; verify streaming, reasoning, a tool round trip, cancellation, and sanitized failures.
- [ ] 3.5 [compatible] Close #208: verify every acceptance addition is met and recorded — a configured model completes a real run with streaming text, supported reasoning, tool-call/result round trips, cancellation, and persisted observations; structured auxiliary generation and usage metadata are verified; missing credentials, invalid models, authentication failures, and rate limits produce bounded errors without secret disclosure or silent fallback — then close the issue with explicit authorization and record that #754, #882, and #751 stay open.
- [ ] 3.6 [compatible] Run affected checks, update operator documentation for the gateway `baseUrl` and rollback path, record the compatible-layer changelog entry, and publish; verify terminal checks and resolved actionable feedback before creating the finalize layer.

## 4. Finalize layer

Branch: `anthropic-provider/finalize`. Spec synchronization and archive only.

- [ ] 4.1 [finalize] Verify the `instance-config` delta still applies cleanly against the merged `openai-compatible-provider` wording rather than assuming it: read back the amended `Provider list configuration` requirement and confirm the type enum carries the split `openai`/`openai-compatible` types plus both Anthropic types, both new variant shapes, the extended embedding sentence, and all seven pre-existing scenarios; rebase the delta if the merged base drifted, then verify `pnpm exec openspec validate anthropic-provider --strict`.
- [ ] 4.2 [finalize] Use `$openspec-sync-specs` to synchronize the new `anthropic-messages-provider` capability and the `instance-config` delta; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass and that the canonical specs carry every requirement and scenario from the deltas.
- [ ] 4.3 [finalize] Verify every implementation and proposal task is complete, and that `openai-compatible-provider`'s metadata channel and its `reasoning-output` amendments are merged and are the ones this change's specs rely on (no duplicated delta, no re-declared channel), then use `$openspec-archive-change`; verify the archive preserves checked history and passes strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm exec prettier --check`, and `git diff --check`.
- [ ] 4.4 [finalize] Delivery: after archive, publish only with authorization, complete the required review and CI monitoring, and verify stack bases and terminal checks immediately before requesting explicit merge permission for each layer.
