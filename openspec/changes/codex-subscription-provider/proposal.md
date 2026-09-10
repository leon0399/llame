## Why

The personal operator needs to use an existing ChatGPT/Codex subscription through llame's system model catalog while retaining llame's tool loop and durable Run ownership. This implements the agreed direct-inference alpha slice of [#753](https://github.com/leon0399/llame/issues/753), informed by [#752](https://github.com/leon0399/llame/issues/752).

## What Changes

- D1: Add an explicit `openai-codex` provider using the fixed Codex Responses backend.
- D2: Read access token and account ID through existing configuration interpolation at process startup; the operator owns `codex login` and API/worker restarts.
- D3: Support streaming tool-capable Runs and compaction, with optional title generation where supported. Preserve llame prompt, history, authorization, cancellation, and persistence contracts.
- D4: Fail startup on invalid credential configuration; fail affected Runs on authentication errors without automatic restart or paid fallback. Report sanitized authentication and quota failures.
- D5: Keep manual model configuration and existing unknown-cost telemetry.

## Capabilities

### New Capabilities

- `codex-subscription-provider`: Direct subscription inference, credential lifecycle, execution compatibility, and failure containment.

### Modified Capabilities

- `instance-config`: Extend provider configuration with a discriminated Codex provider and mandatory access token/account ID.

## Impact

API configuration schema and normalization, model client dispatch and transport, focused runtime/integration tests, and operator setup documentation. No database migration or web UI change is required. All API and worker processes share one operator-managed host deployment.

## Non-goals

Per-user linking, llame OAuth/login UI, token refresh or credential writes, hot reload, automatic model discovery, custom endpoints/headers, Codex-owned execution, Claude subscriptions, embeddings, and media generation are deferred. Automatic model discovery is a named follow-up, not an implementation task in this slice.

Existing #753 acceptance includes per-user account selection, which this agreed system-provider slice deliberately defers. Shipping this slice must not close #753 or the broader two-provider assessment #752 until their remaining acceptance is reconciled explicitly.
