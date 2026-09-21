# OpenCode Go provider

`opencode-go` lets one llame instance use an OpenCode Go subscription: a
key-only provider entry whose endpoint is fixed in llame's code, executing the
gateway's Chat Completions route under llame's existing configuration,
execution, telemetry, and failure contracts. It adds no per-user account
linking, no model discovery, no embeddings, and no route selection.

## Obtaining and configuring the key

OpenCode Go is a monthly subscription sold in the OpenCode console, which is
the only issuer of a Go credential; the console's catalogue and usage windows
are visible once you are signed in. Create a subscription key there, then
store it for llame like any other provider credential.

Add one provider entry and one model entry per model to
`apps/api/llame.config.json`:

```jsonc
{
  "providers": [
    {
      "id": "opencode-go",
      "type": "opencode-go",
      "key": "{env:OPENCODE_GO_API_KEY}",
    },
  ],
}
```

The entry declares `{ id, type, key }` and nothing else. `id` is the
operator-chosen name model entries reference; `type` selects the transport;
`key` accepts the same `{env:...}` and `{path:...}` interpolation as every
other credential and is resolved once at startup. The resolved value never
reaches a log, error, telemetry record, model context, or owner-visible
output, and an error about the entry names its `id` and field, never a
resolved value.

An absent `key`, or one that resolves empty through interpolation, fails
startup naming the entry and the `key` field: the gateway authenticates every
request, so a keyless Go entry is not a usable configuration and is never
loaded as one. `baseUrl` and `accountId` are rejected at boot, because no
configuration value moves or authenticates the request. Startup contacts no
endpoint and validates no model's eligibility; an unreachable gateway or an
invalid credential surfaces at request time, not at boot.

`apps/api/llame.config.json.example` ships the provider and two model entries,
`system:opencode-go:glm-5.3-flash` and
`system:opencode-go:deepseek-v4.1-flash`, with `reasoning` declared where the
model reasons. They ship commented out as a marked block, because a required
key that is not yet configured cannot boot: uncomment the block, set
`OPENCODE_GO_API_KEY`, and restart. A model entry is an ordinary `models[]`
entry that names this provider; llame compiles in no Go model list, and the
gateway's own list is ids alone — `GET /zen/go/v1/models` returns each model's
`{ id, object, created, owned_by }` with no context window and no pricing — so
`contextWindowTokens` and any `pricingUsdPer1M` are values you declare. A
fetched catalogue is #903.

## The endpoint and the route ceiling

Every `opencode-go` request is sent to the gateway's Chat Completions route,
`https://opencode.ai/zen/go/v1/chat/completions`, authenticated with the
entry's resolved key. The base URL `https://opencode.ai/zen/go/v1` is a
constant in llame's code (`OPENCODE_GO_BASE_URL` in
`apps/api/src/models/opencode-go-model-client.ts`): no entry name, ambient
environment variable, or configuration value can move a request, and a
redirect is not followed, so neither the credential nor the session header can
reach a redirect destination.

llame uses only the Chat Completions route for this provider. The gateway
serves three protocols under one base URL and one credential, and a survey of
its live catalogue on 2026-09-17 found that route accepts 37 of 38 models —
the deployed list returned 33 ids on 2026-09-22, so read any such count as a
snapshot of a catalogue llame does not pin. Only `grok-4.6` is reachable
exclusively through the `/responses` route, which llame does not use yet, so
that model cannot be served; #904 owns the per-model route override that would
reach it, and the message an operator will match on when it is declared is the
upstream-unavailable text below, not the format-gate text the gateway's own
handler documents. The catalogue is operator-declared: llame keeps no compiled
model, route, or capability table and checks no model's route at boot, so a
model the gateway rejects fails at request time (below), not at startup.

## Requests llame sends

Every language-model request llame makes for a Chat carries the gateway's
session header, `x-opencode-session`, rendered from the Chat's identity: the
Chat's own id verbatim for the main turn and for both compaction paths, and
`title:<id>` for title generation, so a summarization request reuses the
conversation's prefix identity while a title request gets its own. The value
is stable across retries, worker restarts, compaction, and model switches
within the Chat. It is the Chat's own identifier, not a credential; it never
reaches model context or persisted message parts and adds nothing to
owner-visible output. Because the gateway reads it, treat a Chat id as visible
to the provider: nothing in llame relies on its secrecy.

llame also sends `x-opencode-client: llame` and its own `User-Agent`
(`llame/<version>`) on every provider request. It does not send
`x-opencode-request`, `x-opencode-project`, `X-Session-Id`, or
`x-session-affinity`, and it never claims another product's client identity.

Caching is the gateway's, and llame requests none of it: llame sends the
session identity and records whatever usage the gateway reports. It sends no
cache-control field and no cache-breakpoint marker, neither requests nor
configures prompt caching for this provider, and counts no breakpoints, so a
cache hit is the gateway's behavior and never a llame setting or promise. A
request that observes no cache hit completes normally and is not an error: in
llame's live proof on 2026-09-22 a deliberately re-sent ~860-token prefix under
one session identity reported `prompt_tokens_details.cached_tokens: 0` on both
requests, so no reuse was demonstrated in that window and none is relied on
here.

## Accepted upstream failures

Failures surface at request time under the Chat Completions failure contract,
exactly as for an `openai-completions` entry: the gateway's parsed error
message becomes the run's failure, shown to the owner whose run failed and
recorded on the run, after the SDK's own retry rules for retryable statuses.
The failure response's body and headers, the request body, and the credential
reach no owner output, persisted run, log, or telemetry; a failure body that
is not the gateway's envelope surfaces as the HTTP status text. The parsed
message may echo request values the gateway chose to name, and a stream chunk
the adapter cannot parse surfaces as the SDK's parse error quoting that one
chunk. llame adds no Go-specific error type or sanitizer, keeps no quota
ledger, and never retries against or falls back to another provider, wire, or
model because a request failed.

These shapes were observed by driving the shipped client against the live
gateway on 2026-09-22, except where noted:

- **A model this route does not serve.** The gateway's own handler documents a
  format-gate rejection with HTTP 401 and the body
  `{"type":"error","error":{"type":"ModelError","message":"Model <id> is not supported for format oa-compat"}}`
  (or `"Model <id> is not supported"`). The deployed gateway did not return
  that text for `grok-4.6` on this route: the failure surfaced after the SDK's
  own three retries as `RetryError: Failed after 3 attempts. Last error: Upstream request failed: Endpoint is unavailable.`
  Match on that message. Because a model id the route does not serve is the
  likeliest operator error, check this first: remedy it by declaring a model
  the Chat Completions route accepts, or wait for #904, which owns the
  per-model route override that reaches `grok-4.6` on `/responses`.
- **An invalid credential.** HTTP 401 with the gateway's envelope
  (`{"type":"error","error":{"type":"AuthError","message":"Invalid API key."}}`);
  the run's failure is exactly `Invalid API key.`, and nothing else — no
  response body, response header, request body, or credential accompanies it.
- **An undeclared model id.** HTTP 400 with the message
  `Upstream request failed: Model is unavailable.`, surfaced the same way, as
  the parsed message alone.
- **An exhausted usage limit (the gateway's documented behavior, not observed
  in llame's live proof).** Quota exhaustion is documented as HTTP 429 with
  `retry-after` and body type `GoUsageLimitError`, and a 429 is retryable, so
  such a request is attempted up to the SDK's retry limit with backoff before
  the last gateway message would surface as the affected run's failure; llame
  reports no quota state of its own and claims no cost, and no paid fallback
  is attempted. No usage-limit rejection occurred during llame's live proof on
  2026-09-22, so this remains the gateway's documented behavior rather than
  something llame has seen. Whether an exhausted monthly window returns that
  class or a 401 `MonthlyLimitError` is unverified, and the body's `metadata`,
  which names the workspace and the limit, is stripped from the message before
  it reaches any surface; whether the message text itself names a workspace is
  unverified.
- **A missing session header in a hand-made request.** Third-party clients
  have reported a request without a session header surfacing on some models as
  a generic 400 rather than a named session error. That report is unverified
  here, and it cannot occur through llame: the Chat identity is required by
  the model-client input contract, so llame cannot render a request without
  it. It is recorded only for debugging a hand-made request.

## Model privacy terms differ

Retention and training terms differ between this provider's models, and llame
models neither: models are operator-declared, with no per-model privacy or
consent field. Most Go models are 0-day retention, while `grok-4.6` and
`gpt-5.6-luna` retain requests for 30 days for abuse monitoring, and the Muse
Spark Contributor models train on prompts and are not zero-retention. The
shipped example configuration declares `glm-5.3-flash` and
`deepseek-v4.1-flash` and excludes the Muse Spark Contributor models: a
warning is not a consent gate, and llame has no catalogue field to record
training consent. Check the current terms in the console before declaring a
model whose prompts you would not send.

## Usage windows

The subscription meters per model across three windows: a five-hour window, a
weekly window, and a monthly window. The gateway applies them per model and
does not return window state in response headers, which is why llame shows no
quota surface and reports no quota state: an exhausted window surfaces as the
upstream failure the gateway documents (the 429 shape above), not as a number
llame can display. Model caps are set upstream and change — a promotional
monthly cap on `deepseek-v4.1-flash` ended on 2026-09-20 — so read the console
for the cap you are planning against rather than any published table.

## Cost accounting

`pricingUsdPer1M` is optional here, and the shipped example declares none, so
completed runs record the usage and latency the provider reports with
`costUsd: null`, the same posture as the Codex subscription. When you declare
pricing, llame prices the provider-reported usage at those rates; that figure
is llame's own accounting of a subscription quota, not money paid per token.
The subscription is billed per usage window rather than per token, and llame
never estimates a cost from a provider-side price table. Leave the field off
if you do not want a dollar figure.

## Upstream overage

The console's "Use balance" toggle is what decides upstream overage — whether
the gateway keeps serving past the subscription's windows. llame can neither
observe its state nor set it: the gateway exposes the toggle nowhere in a
request or response llame reads, llame sends no field for it, and a run's
failure surface carries only the gateway's message. Read and change it in the
console if you need to.
