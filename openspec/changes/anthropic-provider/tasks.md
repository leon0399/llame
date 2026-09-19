## 1. Proposal layer

Delivery stack:

```text
master <- anthropic-provider/proposal <- anthropic-provider/provider-options <- anthropic-provider/messages <- anthropic-provider/finalize
```

This change follows the merged and archived `openai-compatible-provider`
change (PRs #883, #886, #890), which owns the wire-named `openai-responses` /
`openai-completions` types, the `@ai-sdk/provider` 3.0.16 /
`@ai-sdk/provider-utils` 4.0.51 pair in the lockfile, and the
per-reasoning-part provider-metadata channel in `reasoning-output`. No layer of
this change may duplicate or reverse those, and no layer re-declares that
channel: this change is its second producer.

The proposal layer owns this ledger, the proposal, the design, and the five
delta specs. The provider-options layer owns `models[].providerOptions` and the
refactor of the three existing clients onto it. The messages layer owns
`type: "anthropic-messages"` end to end and is the only layer that closes an
issue: its delivery owner closes #208 after its acceptance evidence is
recorded. The finalize layer owns canonical spec synchronization and archive
movement only. Issues #754, #882, #810, #593, #82, #808, #809, #37, and #18
are not closed by any layer.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create the provider-options layer only after explicit
proposal-PR approval; publication and merge each require their own
authorization.

- [ ] 1.1 [proposal] Complete two independent adversarial reviews of the proposal, design, and delta specs; verify each finding against the repository, the adapter's built source, and Anthropic's documentation; commit each substantive revision separately; verify convergence with no new substantive findings.
- [ ] 1.2 [proposal] Verify the artifacts record the merged dependency correctly: every `instance-config`, `provider-api-selection`, `available-models`, and `reasoning-output` MODIFIED block reproduces master's requirement text and every shipped scenario name; the metadata channel is consumed, not re-declared; the thinking requirement covers persistence on the part, complete and ordered unmodified replay across turns, no llame-side pruning, no model-switch coercion, withheld-text blocks, and the drop-on-prefix-mismatch invariant.
- [ ] 1.3 [proposal] Validate with `pnpm exec openspec validate anthropic-provider --strict`, `pnpm lint:markdown`, `pnpm exec prettier --check openspec/changes/anthropic-provider`, and `git diff --check`; inspect the actual artifact diff and obtain publication authorization plus explicit approval of the published revision before implementation starts.

## 2. Provider-options layer

Owns `models[].providerOptions` and the composition every client uses. Branch:
`anthropic-provider/provider-options`.

- [ ] 2.1 [provider-options] Add the optional `providerOptions` object to the `models[]` schema and loader: verify with focused configuration tests that an object with unrecognized keys loads verbatim, that a non-object value fails boot naming the model id and field, that `{env:…}` or `{path:…}` syntax anywhere inside it fails boot naming the model id and field before resolution and without exposing a value, and that the public model catalog and DTO never carry it.
- [ ] 2.2 [provider-options] Add the request-options composition shared by every client — invariants over the run's effort over the operator's object over client defaults, key-by-key merge for object values, `null` removing a default and unable to remove an invariant — and verify each precedence rule with unit tests, including a `null` beneath an invariant.
- [ ] 2.3 [provider-options] Move the Responses client onto the composition with `reasoningSummary: 'auto'` as a default and `reasoningEffort` from the run, keep the codex client's `store: false` as an invariant, and move the completions client onto it under the `openaiCompatible` namespace; verify from request fixtures that an entry without `providerOptions` sends exactly the bodies sent before this layer, that an operator `reasoningSummary` replaces the default, that an operator `store` on codex is not sent, and that unknown keys reach the completions body verbatim.
- [ ] 2.4 [provider-options] Document the field for operators (what it is, the precedence, `null`, the no-boot-validation ceiling, that the OpenAI adapters drop unknown keys and the completions adapter forwards them) and add the changelog entry.
- [ ] 2.5 [provider-options] Run affected API lint, typecheck, coverage, and build checks plus Markdown lint, formatting, and diff checks; publish the authorized layer and verify terminal checks and resolved actionable feedback before creating the messages layer.

## 3. Messages layer

Owns provider type `anthropic-messages` and the closure of #208. Branch:
`anthropic-provider/messages`.

- [ ] 3.1 [messages] Add `"anthropic-messages"` to the `providerType` schema enum, the `ProviderConfig` union, and loader normalization (`key`, optional `baseUrl` defaulting to the Anthropic API, empty key resolves keyless); verify with focused configuration tests that an entry without `baseUrl` and one with a non-Anthropic `baseUrl` both load as authored, that a bare `"anthropic"` still fails at boot naming the entry, that an embedding model referencing the type fails startup, and that no endpoint is contacted at boot.
- [ ] 3.2 [messages] Add the Anthropic model client (`streamText`/`generateObject`, context window, pricing, compaction threshold) on the shared composition and its `model-client-factory` case; verify dispatch follows `type` alone — any provider `id` routes to the Messages client, an entry with a custom `baseUrl` uses it unchanged, two same-type providers each use their own credential and endpoint, and a keyless entry constructs with the placeholder key and sends `x-api-key` only when a credential resolved.
- [ ] 3.3 [messages] Resolve the credential once at startup through existing interpolation; verify with canary tests that resolved values appear in no log, error, or telemetry output and that load errors name only the entry `id` and field.
- [ ] 3.4 [messages] Persist each thinking block's signature (and redacted payload) as opaque provider metadata on its reasoning part, reading metadata from delta parts as well as start and end parts; replay the blocks complete and in their original order on later requests; send `thinking.blockBinding.prefixMismatchBehavior: 'drop_block'` on every request as an invariant, alone when no thinking mode is configured; never prune or coerce blocks; verify with fixtures that a tool continuation carries the signed block, a later request replays it, a compaction-rewritten prefix (including mid-run) continues instead of failing, consecutive blocks keep their order and bytes, a model switch replays them unchanged, a withheld-text block persists with its signature and replays, an operator `providerOptions` setting the binding to `error` or `null` is not sent, a part carrying Responses-wire metadata produces no thinking block, and a response with no thinking output still completes.
- [ ] 3.5 [messages] Forward the run's effort as `providerOptions.anthropic.effort`; default `thinking` to `{ type: 'adaptive', display: 'summarized' }` when the entry declares `reasoning` and send no thinking mode and no effort otherwise; verify from request fixtures that a declared level reaches `output_config.effort` verbatim, that the default thinking shape is sent only with a declaration, that an operator `thinking` value replaces the default while the drop invariant remains, that an effort the model does not declare still fails with the existing 422 before any provider call, and that no llame-owned level vocabulary or model table exists.
- [ ] 3.6 [messages] Default the top-level ephemeral cache control on every request; verify from a recorded request fixture that it is a top-level `cache_control` field, that no llame-authored content block carries a cache marker, that an operator `cacheControl: null` omits it and a longer-lifetime value replaces it, and in the live proof that a reused cacheable prefix reports cache-read tokens.
- [ ] 3.7 [messages] Add the optional cache-write rate to the model pricing shape and the public DTO, carry it through price resolution, persist provider-reported cache-write tokens in usage telemetry, and price them; verify cost tests cover the declared rate, the fallback to the input rate when absent, `costUsd: null` when no pricing is declared, and zero cache-write tokens recorded when the provider reports none.
- [ ] 3.8 [messages] Implement `generateObject` through the AI SDK JSON response format; verify from request fixtures that a model with native structured output receives `output_config.format` and no forced tool choice, that a rejected structured request fails explicitly and the title service's plain-text fallback runs, and that no request for structured output ever carries a named or required tool choice; edit the `ModelClient.generateObject` doc comment so it no longer claims a forced tool call for every client.
- [ ] 3.9 [messages] Skip rendering a Thinking panel for a reasoning segment whose grouped text is empty while leaving persistence, replay, export, and search unchanged; verify with a component test that an empty-text segment renders no panel and a segment with text still renders one, and run the affected Storybook story tests.
- [ ] 3.10 [messages] Verify the failure boundaries: authentication failure, unknown model, rate limit, and a recognized-but-invalid `providerOptions` value each fail the affected request with sanitized diagnostics, with recorded parts and tool effects retained, no automatic retry, no credential substitution, and no fallback to another provider or type; verify an unrecognized `providerOptions` key neither fails boot nor rewrites or retargets the request.
- [ ] 3.11 [messages] Add `@ai-sdk/anthropic@3.0.118`; verify the resolved lockfile carries `@ai-sdk/provider@3.0.16` and `@ai-sdk/provider-utils@4.0.51` and adds no further pair; document the `anthropic-messages` entry — default endpoint, gateway `baseUrl`, keyless semantics, the thinking and caching defaults and how `providerOptions` replaces or removes them, and the cache-write price field.
- [ ] 3.12 [messages] Run the bounded live proof with a real API credential against a current adaptive-thinking model: streaming text, visible summarized reasoning, an authorized tool round trip, cancellation, a structured title through the native output format, a reused cacheable prefix, cache-write cost in persisted telemetry, and a compaction-rewritten prefix continuing under the drop instruction; record model, versions, and outcomes without secrets, including whether `display` is accepted on a 4.6-generation model if one is available; stop for proposal revision if required behavior cannot be met.
- [ ] 3.13 [messages] Run affected API and web lint, typecheck, coverage, integration and build checks plus focused product E2E, Markdown lint, formatting, and diff checks; add the changelog entry covering the provider type, the thinking and caching defaults, the cache-write cost reporting, and the hidden empty Thinking panel; close #208 with explicit authorization after verifying every acceptance addition is met and recorded — a configured model completes a real run with streaming text, supported reasoning, tool-call/result round trips, cancellation, and persisted observations; structured auxiliary generation and usage metadata are verified; missing credentials, invalid models, authentication failures, and rate limits produce bounded errors without secret disclosure or silent fallback — and record that #754, #882, and #751 stay open; publish and verify terminal checks and resolved actionable feedback before creating the finalize layer.

## 4. Finalize layer

Branch: `anthropic-provider/finalize`. Spec synchronization and archive only.

- [ ] 4.1 [finalize] Use `$openspec-sync-specs` to synchronize the new `anthropic-messages-provider` capability and the `instance-config`, `provider-api-selection`, `available-models`, and `reasoning-output` deltas; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass and that the canonical specs carry every requirement and scenario from the deltas with every shipped scenario name preserved.
- [ ] 4.2 [finalize] Verify every implementation and proposal task is complete and that no layer re-declared the reasoning metadata channel, then use `$openspec-archive-change`; verify the archive preserves checked history and passes strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm exec prettier --check`, and `git diff --check`.
- [ ] 4.3 [finalize] Delivery: after archive, publish only with authorization, complete the required review and CI monitoring, and verify stack bases and terminal checks immediately before requesting explicit merge permission for each layer.
