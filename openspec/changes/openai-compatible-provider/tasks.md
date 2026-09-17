# Tasks

## 1. Proposal layer

Delivery stack: `master <- openai-compatible-provider/proposal <- openai-compatible-provider/types <- openai-compatible-provider/reasoning-parts <- openai-compatible-provider/finalize`.

This change is the first of two provider changes: the sibling
`anthropic-provider` merges after it and rebases its `instance-config` delta
onto this change's merged wording. The proposal layer owns this ledger, the
proposal, the design, and the delta specs. The types layer owns the
`openai`/`openai-compatible` split and closes #339 — its delivery owner closes
that issue after the layer's acceptance evidence is recorded. The
reasoning-parts layer owns #883 and its delivery owner closes it the same way.
The finalize layer owns canonical spec synchronization and archive movement
only, and closes no issue.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for
implementation. Create the types layer only after explicit proposal-PR
approval; publication and merge each require their own authorization.

- [ ] 1.1 [proposal] Complete two independent adversarial reviews of the proposal, design, and delta specs, verifying each finding against the repository; confirm the review converged with no new substantive findings, that no artifact re-opens the settled type split, that the amended `reasoning-output` third-party requirement still carries the prohibition on llame-authored reasoning parsers, raw SSE parsing, tag extraction, and middleware, and that all seven pre-existing `instance-config` scenario names are intact.
- [ ] 1.2 [proposal] Verify the durable-metadata decision is expressed consistently: the metadata requirement states persistence with the part, same-Chat replay, and the never-rendered/exported/indexed/shared boundary; the two amended privacy requirements reproduce every pre-existing scenario name and narrow exactly one exclusion; no artifact introduces a model-switch coercion rule or producer-specific metadata semantics; and the prefix-mismatch constraint is recorded as a risk whose mitigation belongs to the `anthropic-provider` change.
- [ ] 1.3 [proposal] Validate with `pnpm exec openspec validate openai-compatible-provider --strict`, `pnpm lint:markdown`, `pnpm exec prettier --check openspec/changes/openai-compatible-provider`, and `git diff --check`; name-diff the delta's scenario names against the shipped `instance-config` requirement; inspect the artifact diff and obtain publication authorization plus explicit approval of the published revision before implementation starts.

## 2. Types layer

Owns provider type `openai-compatible` and the `openai` surface split, and
closes #339. Branch: `openai-compatible-provider/types`.

- [ ] 2.1 [types] Add `"openai-compatible"` to the `providerType` schema enum, the `ProviderConfig` union, and loader normalization (`key` optional, `baseUrl` optional, `{env:…}`/`{path:…}` interpolation, empty key resolves keyless); verify with focused configuration tests that a valid keyless entry at a base URL loads, that an out-of-enum `type` still fails at boot naming the entry and value, that duplicate ids still fail, and that no endpoint is contacted at boot.
- [ ] 2.2 [types] Verify the embedding binding gate is unchanged: an `embeddingModels[]` entry still requires an `openai`-typed provider and an `openai-compatible` provider is rejected for embeddings at load time; record that the embedding backend is not routed by provider surface.
- [ ] 2.3 [types] Add `@ai-sdk/openai-compatible@2.0.75`; verify the resolved lockfile carries `@ai-sdk/provider@3.0.16` and `@ai-sdk/provider-utils@4.0.51` — the pair the sibling `anthropic-provider` change also requires — and that no zod change is required.
- [ ] 2.4 [types] Add the compatible model client (streaming, structured generation, context window, pricing, compaction threshold) constructed with `supportsStructuredOutputs: true`; verify from recorded request fixtures that requests use the Chat Completions shape at the provider's own base URL, that a schema-constrained request carries the schema rather than an unconstrained JSON mode, and that a keyless provider constructs without a missing-credential error.
- [ ] 2.5 [types] Delete `nativeOpenAI` and the `provider.id === 'openai'` check and pass the surface from `type`; keep the Codex transport on Responses by construction; verify dispatch tests cover a `type: "openai"` provider with a custom id, a `type: "openai-compatible"` provider whose id is literally `openai`, two `openai` providers resolving independently, and that no code path derives the surface from an `id`, a `baseUrl`, or host matching.
- [ ] 2.6 [types] Wire reasoning on the compatible surface through the adapter's own normalization and re-injection; verify with a fixture-driven multi-step exchange that normalized reasoning reaches the persisted reasoning part and that the turn's follow-up request carries the prior assistant reasoning back to the endpoint, that a response with no reasoning completes normally, and that no llame-authored vendor parser, raw SSE parser, tag extraction, or middleware was added.
- [ ] 2.7 [types] Run the bounded live smoke against a directly-billed reasoning-capable compatible endpoint (a DeepSeek or GLM key; not OpenCode Go, which depends on this change): verify the request shape, the normalized stream output, a follow-up request within the same turn carrying the prior reasoning back, and a zero-reasoning response recorded as a success — recording model, versions, and outcomes without secrets — and stop for proposal revision if a required behavior cannot be met.
- [ ] 2.8 [types] Document the surface matrix in `apps/api/AGENTS.md` beside the provider/model config contract and the operator-facing behavior in the README provider section: which surface each `type` uses, where reasoning renders, the accepted differences listed in design.md D7, and the migration for an existing `openai` entry that points at a compatible endpoint.
- [ ] 2.9 [types] Add the CHANGELOG entry, including the breaking note.
- [ ] 2.10 [types] Close #339: verify every acceptance criterion of the amended issue body is met and recorded — surface selected by `type` alone, a `type: "openai"` provider surfacing reasoning whatever its id, two same-type providers resolving independently, a compatible provider surfacing reasoning from a backend that streams `reasoning_content`, the within-turn outbound carry, structured output not silently downgraded, boot failure for an out-of-enum `type`, the documentation, and the changelog — then close the issue with explicit authorization and record that #883, #208, #882, #82, #808, #809, #810, #593, and #866 stay open.
- [ ] 2.11 [types] Run the affected API lint, typecheck, focused tests, and build checks; publish the layer; verify terminal checks and resolved actionable feedback before creating the reasoning-parts layer.

## 3. Reasoning-parts layer

Owns #883's reasoning-part work and its closure. Branch:
`openai-compatible-provider/reasoning-parts`.

- [ ] 3.1 [reasoning-parts] Persist one reasoning part per adapter-supplied identity, and one concatenated part when the adapter supplies none; verify with fixtures that a Responses stream whose identity changes yields one part per identity in order, that an identity-less stream yields one part, and that an identity change no adapter emits does not split or merge parts differently between live output, reconnect replay, and replayed history.
- [ ] 3.2 [reasoning-parts] Separate a heading glued onto the preceding text with a paragraph break at persist, render, and markdown export, including for reasoning persisted before identities existed; verify `**One****Two**` renders as two bold titles, prose butting directly onto a heading splits, and `the **signature** field` stays inline.
- [ ] 3.3 [reasoning-parts] Group consecutive persisted reasoning parts into one Thinking panel, with a tool or visible text part splitting panels and no reasoning hoisted above a tool; verify live output and a reloaded chat show the same panel boundaries with the persisted part order unchanged.
- [ ] 3.4 [reasoning-parts] Apply the reasoning bound across the turn's reasoning instead of per part; verify a turn that emits several parts cannot persist more than the bound in total, that a turn within the bound persists in full, and that the existing truncation behavior is preserved.
- [ ] 3.5 [reasoning-parts] Persist opaque provider metadata with the reasoning part that carries it (`messages.parts`), keeping it out of every owner-facing surface: verify that a part persisted with metadata round-trips through a reload, and that rendered chat, markdown export, search indexing, and a public share payload contain no provider metadata; verify a part without metadata keeps its existing shape.
- [ ] 3.6 [reasoning-parts] Replay a persisted reasoning part and its metadata to the provider when model context is built for the same Chat, and keep state that is not part-bound transient: verify a same-Chat follow-up request carries the persisted part with its metadata, that the parts remain excluded from compaction input, chat search, and public shares, and that opaque state not bound to a persisted part is deleted when the run reaches a terminal status.
- [ ] 3.7 [reasoning-parts] Add no model-switch coercion rule and no producer-specific metadata semantics: llame passes blocks back unchanged and the provider ignores or drops blocks the target model cannot read; verify no artifact, comment, or test introduces coercion, signature rewriting, or a prefix-rebinding rule, and record that the prefix-mismatch mitigation belongs to the `anthropic-provider` change.
- [ ] 3.8 [reasoning-parts] Verify the two amended `reasoning-output` requirements read as amended: the ordering requirement excludes reasoning from compaction input, chat search, and public shares while returning parts to the same Chat's provider requests, and the opaque-state requirement keeps non-part-bound state transient while provider metadata bound to a persisted part is durable.
- [ ] 3.9 [reasoning-parts] Run the affected API and web lint, typecheck, focused tests, and build checks, and add the layer's changelog entry; close #883 with explicit authorization after verifying each acceptance item — per-identity persistence, glue repair at persist/render/export, panel grouping, the per-turn bound, the negative case for a transition no adapter emits, the durable provider-metadata channel with its privacy boundary, and the same-Chat replay — and record that #208 remains the first producer of that metadata.
- [ ] 3.10 [reasoning-parts] Publish the layer; verify terminal checks and resolved actionable feedback before creating the finalize layer.

## 4. Finalize layer

Branch: `openai-compatible-provider/finalize`. Spec synchronization and archive
only; this layer closes no issue.

- [ ] 4.1 [finalize] Re-read the merged `instance-config` `Provider list configuration` requirement and record the name-diff proving it carries the split `openai` / `openai-compatible` enum with `openai-codex` unchanged, the compatible variant shape, the rebased duplicable-providers example, and all seven pre-existing scenario names. Note for the sibling change: `anthropic-provider` rebases its `instance-config` delta onto this change's merged wording, so that requirement is the base its two added types extend — do not adjust this change's text for the sibling's types.
- [ ] 4.2 [finalize] Use `$openspec-sync-specs` to synchronize the `instance-config` and `reasoning-output` deltas and the new `openai-provider-surfaces` capability; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass, that the canonical specs carry every requirement and scenario from the deltas, that the amended third-party requirement's parser prohibition is intact after sync, and that the two amended privacy requirements and the durable-metadata requirement match the deltas verbatim.
- [ ] 4.3 [finalize] Verify every implementation and proposal task is complete and that the resolved durable-metadata decision is reflected in the canonical `reasoning-output` requirements after sync; then use `$openspec-archive-change`; verify the archive preserves checked history and passes strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm exec prettier --check`, and `git diff --check`.
- [ ] 4.4 [finalize] Delivery: after archive, publish only with authorization, complete the required review and CI monitoring, and verify stack bases and terminal checks immediately before requesting explicit merge permission for each layer.
