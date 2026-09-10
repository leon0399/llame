# Codex subscription provider

`openai-codex` lets one trusted personal llame instance use an operator's
ChatGPT/Codex subscription for manually declared system models. It does not
add per-user account linking, refresh tokens, automatic model discovery,
embeddings, or Claude subscription support.

Run `codex login` with file credential storage before configuring llame. Set
`cli_auth_credentials_store = "file"` in Codex configuration so `CODEX_HOME`
contains `auth.json`; keyring-only login cannot supply llame's startup
snapshot.

Add a provider and at least one model to `apps/api/llame.config.json`:

```jsonc
{
  "providers": [
    {
      "id": "personal-codex",
      "type": "openai-codex",
      "key": "{path:/run/secrets/codex-auth.json|json:/tokens/access_token}",
      "accountId": "{path:/run/secrets/codex-auth.json|json:/tokens/account_id}",
    },
  ],
  "models": [
    {
      "id": "system:codex:gpt-5.4",
      "provider": "personal-codex",
      "providerModelId": "gpt-5.4",
      "name": "Personal Codex",
      "contextWindowTokens": 400000,
    },
  ],
}
```

`key` and `accountId` must resolve to nonblank strings. `baseUrl` and custom
headers are rejected. The fixed transport uses the Codex Responses endpoint;
llame reads these fields once at API/worker startup and never reads refresh or
ID tokens or writes the credential file. Omit `pricingUsdPer1M` when the cost
is unknown: completed Run telemetry retains token counts and latency with
`costUsd: null`.

Stop every API and Run worker before re-login. Run `codex login`, replace the
same credential file atomically, then start every process again. A running
process retains its startup snapshot after logout or revocation. Authentication
and quota failures end the affected Run; llame does not refresh credentials,
select a paid fallback, or retry the Run. Retry manually after re-login and
restart.

To disconnect, remove the provider and its model entries, restore any affected
defaults, and restart API/workers. Existing Chats and Run history remain.

## Live verification

On 2026-09-11, a file-backed ChatGPT login on the operator machine completed a
bounded proof with `codex-cli 0.154.0`, Node `v22.23.2`, `ai 6.0.256`, and
`@ai-sdk/openai 3.0.97`. The manually configured `gpt-5.6-terra` model passed
streaming, an authorized tool continuation, cancellation, compaction, and
text-based title generation. The entitlement accepted these requests; no quota
limit was observed. Synthetic 401/403/429 fixtures cover revocation, re-login,
restart, and manual retry behavior because deliberately revoking a live
operator credential would disrupt normal access.

Automatic model discovery, per-user account selection, and Claude subscription
acceptance remain follow-ups. This alpha serves #753 and the OpenAI portion of #752;
it does not close either issue.
