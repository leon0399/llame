## 1. Proposal layer

Delivery stack: `master <- codex-subscription-provider/proposal <- codex-subscription-provider/provider <- codex-subscription-provider/finalize`.

The proposal layer owns proposal, design, delta specs, and this task ledger. The provider layer owns configuration, transport, runtime acceptance, operator documentation, and shipped chronology. The finalize layer owns canonical spec synchronization and archive movement only. Use `$gh-stack` for every stack operation and `$openspec-apply-change` for implementation. Create the provider layer only after explicit proposal-PR approval; publication and merge require their own authorization.

This slice serves #753 and the OpenAI part of #752. No layer owns closing either issue under their current broader acceptance. The provider layer records remaining acceptance and automatic model discovery as follow-ups before completion.

- [x] 1.1 [proposal] Complete two independent adversarial reviews, verify findings, and commit each substantive revision separately; verify convergence with no new substantive findings.
- [x] 1.2 [proposal] Validate with `pnpm exec openspec validate codex-subscription-provider --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; inspect the actual proposal diff and obtain publication authorization and explicit approval of the published revision before implementation.

## 2. Provider layer

- [x] 2.1 [provider] Add discriminated configuration/schema and normalization for `openai-codex` credentials; verify nonblank requirements, pointer errors, forbidden endpoint/headers, rejected embedding bindings, credential redaction, and unchanged keyless OpenAI behavior with focused configuration tests.
- [x] 2.2 [provider] Add explicit client dispatch and fixed Responses transport using startup snapshots; verify arbitrary provider IDs, transport-owned headers, `store: false`, streaming, redirect rejection, and absence of refresh or credential file writes using synthetic credentials and transport fixtures.
- [x] 2.3 [provider] Integrate llame instructions, tools, persisted effort, continuation and private transient reasoning; verify self-contained wire input without remote item references, exact function call/result pairing, an active multi-step exchange and a later Run from persisted history, stored part ordering, no peer prompt injection, no opaque reasoning persistence, and existing context replay invariants.
- [x] 2.4 [provider] Integrate cancellation and local execution bounds; verify abort propagation, terminal settlement, already-recorded effects, and no automatic replacement Run in focused runtime tests.
- [x] 2.5 [provider] Support compaction and optional titles through the provider; verify source-model/effort inheritance, title effort omission, direct same-provider text title generation with optional `generateObject` absent, and title failure leaving the answer intact.
- [x] 2.6 [provider] Sanitize authentication and quota failures; verify expired/revoked credential fixtures, no authentication retry or paid fallback, retained parts/effects, and secret canaries absent from owner/public output, persisted errors, logs, telemetry, and model input.
- [x] 2.7 [provider] Preserve manual catalog metadata and unknown pricing; verify catalog exposes no provider/account details, absent pricing yields null cost, and usage/latency remain available without invented values.
- [x] 2.8 [provider] Add authenticated integration coverage with two owners sharing a system model; verify the second owner cannot read or mutate the first owner's Chats, Runs, or scoped tool data, while existing catalog policy remains unchanged.
- [x] 2.9 [provider] Run the bounded real personal-account proof with one explicitly configured supported model: streaming, authorized tool continuation, cancellation, compaction, and failure followed by operator re-login/restart/manual retry. Record versions, model, outcomes, entitlement/limit observations, and title support without secrets; synthetic fixtures cover quota/revocation cases unavailable live. Stop for proposal revision if required behavior cannot be met.
- [x] 2.10 [provider] Document file-backed `codex login`, credential references, stable-file startup, stop/re-login/restart, disconnect/revocation limits, manual catalog, unknown pricing, and rollback. Record automatic discovery and deferred per-user/Claude acceptance as follow-ups; verify examples against the published schema and keep #752/#753 open unless their scope is explicitly reconciled.
- [x] 2.11 [provider] Run affected API lint, typecheck, coverage, integration and build checks plus focused product E2E, Markdown lint, formatting, and diff checks per `CONTRIBUTING.md`; record actual evidence and add the shipped changelog entry, updating only the completed roadmap slice.
- [x] 2.12 [provider] Publish the authorized provider layer and complete self-review, CI, and automated-review monitoring per `CONTRIBUTING.md`; verify terminal checks and resolved actionable feedback before creating finalize.

## 3. Finalize layer

- [ ] 3.1 [finalize] Use `$openspec-sync-specs` to synchronize the two capabilities; verify strict canonical spec validation and that the delta retains all existing provider scenarios.
- [ ] 3.2 [finalize] Verify every implementation/proposal task and artifact is complete, record finalization completion, then use `$openspec-archive-change`; verify the archive preserves checked history and passes strict `--specs` and `--all` validation, Markdown lint, formatting, and diff checks.
      After archive, the finalize layer delivery owner publishes only with authorization, completes the required review/CI monitoring, and requests explicit merge permission. Verify stack bases and terminal checks immediately before any authorized merge; these delivery gates do not claim pre-archive completion.
