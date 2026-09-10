## Context

See [proposal.md](proposal.md) for scope. `InstanceConfigService` loads once; `ModelsService` resolves the system catalog and caches clients. `model-client-factory.ts` is the provider dispatch boundary. The existing OpenAI client selects native Responses using the provider ID and uses Chat Completions for object generation; neither behavior can be assumed suitable for Codex.

## Goals / Non-Goals

Preserve the existing `ModelClient` execution contract and configuration interpolation grammar. Add only provider-specific transport and configuration behavior. No credential database, schema migration, runtime subprocess, or generic authentication framework.

## Decisions

### D1: Explicit provider dispatch

Introduce `type: "openai-codex"`, independent of operator-chosen provider ID. Use `key` for the access token and a required `accountId` string for the account header. Keep the existing `openai` variant unchanged. Reject `baseUrl` and arbitrary headers for the new variant. Reject embedding catalog references to this provider at boot.

The destination is `https://chatgpt.com/backend-api/codex/responses`; send bearer authorization and `ChatGPT-Account-ID`. Reject redirects so credentials cannot follow an endpoint-controlled redirect. Prefer the installed AI SDK Responses implementation with a narrow transport adapter over a second streaming parser. Do not import the OpenCode plugin as a dependency or reuse its prompt/history transformations.

### D2: Operator-managed credential snapshot

Use existing whole-value interpolation, for example provider fields:

```json
{
  "id": "personal-codex",
  "type": "openai-codex",
  "key": "{path:/run/secrets/codex-auth.json|json:/tokens/access_token}",
  "accountId": "{path:/run/secrets/codex-auth.json|json:/tokens/account_id}"
}
```

The operator runs `codex login` with file credential storage (`cli_auth_credentials_store = "file"`) and mounts/references the resulting `CODEX_HOME/auth.json`. Keyring-only storage does not satisfy this setup. llame neither reads refresh/id tokens nor writes this file. Stop API/workers before re-login, then restart all with the same stable credential file; concurrent file replacement during startup is outside the deployment procedure. No startup network probe or local JWT-expiry inference is required. Nonblank tokens can still be expired and fail at request time.

This is the agreed alpha alternative to llame-managed OAuth, refresh locking, and dynamic file rereads. Removing configuration and restarting disconnects llame; Codex logout/revocation remains operator-owned. A running process keeps its snapshot until stopped, including after external logout.

### D3: llame-owned inference and continuation

Use streaming Responses with `store: false`, llame's effective system instructions, model identity, persisted effort, and authorized tool declarations. Carry cancellation and existing step/duration limits through the adapter. Preserve ordered tool calls/results and reasoning display behavior. Encrypted reasoning, when required for an active multi-step inference, stays transient and private; do not add it to persisted history, owner output, or later Run context.

Do not silently strip meaningful unsupported request fields: implement their semantics or fail with a sanitized unsupported-operation error. Preserve local output/run bounds if the endpoint cannot accept a corresponding request field. Compaction uses the same provider transport and existing source-model/effort rules. Titles use the existing optional title flow and no inherited effort; unsupported structured output can use its text fallback on the same provider. Title failure must not invalidate a completed answer.

### D4: Failure and security boundary

Authentication failure is terminal for the affected Run without automatic credential refresh, Run restart, or provider fallback. Preserve already recorded parts and tool effects under existing durability rules. Quota/rate-limit failure reports a sanitized limit state without billing assertions or paid fallback. Do not expose upstream response bodies, request headers, account IDs, credential values, or resolved host paths to owners, public views, model context, logs, or telemetry. Operator startup diagnostics identify the configured field and may identify its configured file location under the existing interpolation contract, never file contents.

System catalog access remains the existing authenticated instance policy. This provides one operator's subscription to that instance; it does not add account-specific catalog filtering. Other owners still cannot read or mutate the operator's Chats, Runs, or tool data. Deployment acceptance is a trusted personal instance; a hosted multi-user subscription service requires a separate access-policy decision.

### D5: Manual catalog and unknown cost

Operators declare model IDs, context limits, and effort levels. Do not assume every Codex model or entitlement works. Omit `pricingUsdPer1M` for unknown cost; literal null remains invalid. Preserve available token counts, latency, and `costUsd: null`. Automatic catalog discovery is deferred and must be recorded as follow-up work during delivery; no automatic API-price lookup or subscription-cost allocation.

## Evidence and acceptance boundary

Local evidence: `apps/api/src/instance-config/instance-config.service.ts`, `apps/api/src/models/model-client-factory.ts`, `apps/api/src/models/openai-model-client.ts`, `apps/api/src/chats/turn-telemetry.ts`, and `packages/config-interpolation/src/interpolation.ts`.

Source inspection supports the protocol shape, not a successful llame integration:

- E1: [Codex credential storage](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/login/src/auth/storage.rs) defines file-backed access token and account ID data; [authentication](https://learn.chatgpt.com/docs/auth) documents operator login/storage.
- E2: [OpenCode plugin transport](https://github.com/numman-ali/opencode-openai-codex-auth/blob/bec2ad69b252ef4ad7dd33b9532ff8b4fdb6d016/lib/request/fetch-helpers.ts) supplies protocol reference; its OpenCode-owned OAuth/refresh and prompt rewrites are outside this design.
- E3: [OpenClaw Responses adapter](https://github.com/openclaw/openclaw/blob/a348d94c35e5c1191b3d3a7da2d08c9e1169eb00/packages/ai/src/providers/openai-chatgpt-responses.ts) provides independent direct-transport evidence.

A real personal-account proof remains mandatory before declaring implementation accepted: streaming, authorized tool continuation, cancellation, compaction, and manual reauthentication after failure. Record model, versions, result, and limitations without secrets. Synthetic quota/revocation fixtures exercise failures that cannot be induced safely. If the endpoint cannot satisfy these contracts, stop and revise the proposal; do not substitute a Codex executor silently. This change does not complete the Claude assessment in #752.

## Risks / Trade-offs

- R1: Private backend behavior can change. Pin inspected evidence, add protocol fixtures, and require the real proof before release.
- R2: Expired snapshots stop Runs. Document the accepted re-login/restart procedure and test preservation of prior effects.
- R3: Shared instance credentials can be mistaken for per-user entitlement. Document the personal deployment boundary and test datastore isolation independently of catalog visibility.
- R4: Provider errors or redirects can disclose secrets. Use value-free diagnostics, reject redirects, and test credential canaries across failure/output surfaces.

## Migration Plan

Add the provider alongside existing types without changing existing configuration. Configure the manual model entry after file-backed login, restart API/workers, and perform the bounded proof. Roll back by removing the provider and its models, restoring any affected defaults, and restarting all processes. Do not delete Chats or rewrite stored model IDs; historical records remain, and queued work naming removed models follows the existing unavailable-model failure contract.

## Revision history

- v1 (2026-09-10): Initial proposal from the confirmed alpha scope; live compatibility remains an implementation acceptance gate.
