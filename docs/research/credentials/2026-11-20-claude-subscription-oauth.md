---
type: Research
title: "Claude subscription OAuth: flow, lifetime, billing and request identity"
description: "Reads the OMP, OpenClaw, Hermes and Pi login implementations and Anthropic's own docs to record the Claude subscription OAuth wire, the 8-hour access token and 30-day grant, the Claude Code identity the API demands, and how third-party usage bills."
tags: [credentials, oauth, anthropic, claude-code, subscriptions, billing, pkce]
status: draft
summary: "Claude subscription login is an authorization-code grant with PKCE against one public Claude Code client id. Access tokens live 8 hours, the grant family dies about 30 days after login regardless of refreshes, the inference API only serves a request that carries Claude Code's identity, and traffic Anthropic classifies as third party bills as extra usage."
read_when:
  - implementing or reviewing the Claude subscription Credential for llame
  - deciding how llame refreshes a single-use Claude refresh token across API and worker processes
  - explaining a Claude subscription 400, 403, 429 or 500 to an owner
  - deciding what request identity llame sends to api.anthropic.com
observed:
  date: "2026-11-20"
sources:
  - id: omp-auth-kdl
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/catalog/src/compat/rules/auth/anthropic.kdl#L1-L52"
    title: "OMP anthropic auth rule: client id, scopes, callback, token and refresh mapping"
  - id: omp-oauth-code
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/engine/oauth-code.ts#L101-L229"
    title: "OMP declarative authorization-code engine: PKCE, state, token exchange, paste handling"
  - id: omp-pkce
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/pkce.ts#L1-L19"
    title: "OMP PKCE: 96 random bytes, base64url verifier, S256 challenge"
  - id: omp-callback
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/callback-server.ts#L607-L685"
    title: "OMP callback server: manual input race, redirect URL and code#state parsing"
  - id: omp-refresh-engine
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/engine/refresh.ts#L72-L118"
    title: "OMP refresh grant: beta and User-Agent headers, organization_id, rotation mapping"
  - id: omp-refresh-lease
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/auth/refresh.ts#L30-L80"
    title: "OMP refresh skew, remint cooldown and cross-process lease constants"
  - id: omp-auth-retry
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/auth-retry.ts#L443-L465"
    title: "OMP retry policy: one forced refresh on 401, rotation on 403 and usage limits"
  - id: omp-fingerprint
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/claude-code-fingerprint.ts#L17-L89"
    title: "OMP Claude Code fingerprint: pinned version, User-Agent form, version-adoption retry, identity sentence"
  - id: omp-headers
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic-headers.ts#L63-L254"
    title: "OMP OAuth header branch: beta defaults, Stainless headers, x-app, Authorization"
  - id: omp-provider
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic.ts#L553-L735"
    title: "OMP billing header, cch attestation, OAuth cache defaults and tool-name prefixing"
  - id: omp-identity
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic-identity.ts#L148-L167"
    title: "OMP built-in tool names and the single-underscore tool prefix"
  - id: omp-bootstrap
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/anthropic.ts#L51-L112"
    title: "OMP claude_cli bootstrap identity probe and login-only organization capture"
  - id: omp-constants
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/anthropic-constants.ts#L1-L12"
    title: "OMP observed 30-day absolute grant lifetime, unaffected by refresh rotation"
  - id: omp-tests
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/test/anthropic-oauth.test.ts#L40-L120"
    title: "OMP OAuth tests: api.anthropic.com token URL, scope string, refresh headers, org not remapped"
  - id: omp-usage
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/usage/claude.ts#L76-L80"
    title: "OMP subscription usage: beta list and the /api/oauth/usage payload shape"
  - id: omp-usage-api
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/usage/claude-api.ts#L1-L66"
    title: "OMP canonical Claude account routes and OAuth usage headers"
  - id: omp-slow-mode
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic-slow-mode.ts#L1-L76"
    title: "OMP slow-lane wire contract: anthropic-usage-limit, unified headers, grace allowance, overage status"
  - id: omp-slow-machine
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/coding-agent/src/session/anthropic-slow-mode.ts#L360-L440"
    title: "OMP wrap-up window and extra-usage notices"
  - id: omp-pr-9801
    resource: "https://github.com/can1357/oh-my-pi/pull/9801"
    title: "OMP PR 9801: subscription OAuth requests rejected without the oauth beta and current SDK fingerprint"
  - id: omp-issue-7238
    resource: "https://github.com/can1357/oh-my-pi/issues/7238"
    title: "OMP issue 7238: 429 Usage credits are required for long context requests on subscription OAuth"
  - id: openclaw-oauth
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/src/llm/utils/oauth/anthropic.ts#L12-L60"
    title: "OpenClaw anthropic OAuth constants: client id, platform token host, loopback port, scopes"
  - id: openclaw-oauth-flow
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/src/llm/utils/oauth/anthropic.ts#L228-L330"
    title: "OpenClaw authorize parameters, manual paste race, token exchange and refresh"
  - id: openclaw-contract
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/packages/ai/src/providers/anthropic-model-contract.ts#L58-L170"
    title: "OpenClaw Claude Code identity builder and claude_code_version_too_old reader"
  - id: openclaw-headers
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/packages/ai/src/providers/anthropic.ts#L190-L215"
    title: "OpenClaw OAuth beta list and bearer auth selection"
  - id: openclaw-payload
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/packages/ai/src/transports/anthropic-payload-policy.ts#L258-L282"
    title: "OpenClaw OAuth system preamble: billing header and identity block"
  - id: hermes-credentials
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_credentials.py#L35-L45"
    title: "Hermes OAuth constants: client id, token hosts, axios User-Agent, console callback, three scopes"
  - id: hermes-login
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_credentials.py#L760-L815"
    title: "Hermes PKCE login: authorize parameters, code#state paste, state check, exchange"
  - id: hermes-refresh
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_credentials.py#L430-L520"
    title: "Hermes refresh: dead-grant codes, cross-process lock, consumed-token refusal"
  - id: hermes-adapter
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_adapter.py#L238-L250"
    title: "Hermes identity comments: intermittent 500 without identity, version sensitivity"
  - id: hermes-adapter-headers
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_adapter.py#L420-L520"
    title: "Hermes client builders: 429 without identity, claude-code User-Agent, beta set"
  - id: hermes-adapter-tools
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_adapter.py#L525-L560"
    title: "Hermes tool-name aliasing: single-underscore mcp_ names trip the third-party classifier"
  - id: hermes-classifier
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/error_classifier.py#L106-L150"
    title: "Hermes billing classification: out of extra usage, ambiguous content-filter body, long-context tier"
  - id: hermes-loop
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/conversation_loop.py#L518-L555"
    title: "Hermes owner guidance for a subscription out of extra usage"
  - id: hermes-issue-79758
    resource: "https://github.com/NousResearch/hermes-agent/issues/79758"
    title: "Hermes issue 79758: identity prefix passes alone, prefix plus harness prompt returns 400 third-party"
  - id: hermes-docs
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/website/docs/integrations/providers.md#L138-L175"
    title: "Hermes operator claim: OAuth only bills extra usage, Pro unsupported"
  - id: hermes-prompt
    resource: "https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/prompt_builder.py#L244-L262"
    title: "Hermes prompt sentence bisected to a billing-shaped 400 on subscription OAuth"
  - id: pi-oauth
    resource: "https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/auth/oauth/anthropic.ts#L14-L32"
    title: "Pi anthropic OAuth: client id, platform token host, loopback port, copy-code redirect, scopes"
  - id: pi-oauth-flow
    resource: "https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/auth/oauth/anthropic.ts#L139-L300"
    title: "Pi browser and copy-code login, redirect URL paste parsing, refresh"
  - id: pi-messages
    resource: "https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L108-L140"
    title: "Pi stealth mode: pinned Claude Code version and canonical tool names"
  - id: pi-messages-headers
    resource: "https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L1291-L1312"
    title: "Pi OAuth client: bearer auth, claude-cli User-Agent, x-app"
  - id: pi-messages-system
    resource: "https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L1388-L1395"
    title: "Pi OAuth beta list"
  - id: pi-messages-identity
    resource: "https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L1486-L1506"
    title: "Pi OAuth identity system block"
  - id: anthropic-legal
    resource: "https://code.claude.com/docs/en/legal-and-compliance"
    title: "Anthropic legal and compliance: authentication and credential use, read 2026-11-20"
  - id: anthropic-authentication
    resource: "https://code.claude.com/docs/en/authentication"
    title: "Claude Code authentication: login lifetimes, setup-token, credential precedence, read 2026-11-20"
  - id: anthropic-errors
    resource: "https://code.claude.com/docs/en/errors"
    title: "Claude Code error reference: usage limits, login expiry, org policy, scope requirement, read 2026-11-20"
  - id: anthropic-usage-credits
    resource: "https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans"
    title: "Anthropic help: manage usage credits for paid Claude plans, read 2026-11-20"
  - id: anthropic-agent-sdk
    resource: "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan"
    title: "Anthropic help: Agent SDK and third-party usage still draw from subscription limits, paused 2026-06-15"
  - id: onwatch-145
    resource: "https://github.com/onllm-dev/onWatch/issues/145"
    title: "onWatch issue 145: refresh without the oauth beta header answered 429, expires_in 28800 observed"
  - id: claudexbar-auth
    resource: "https://github.com/ipangdz/claudexbar/blob/main/docs/AUTH.md"
    title: "ClaudexBar auth notes: rotating refresh token, token prefixes, contradictory redirect findings"
  - id: magpie-team
    resource: "https://github.com/yetone/magpie/issues/5645"
    title: "magpie issue 5645: Team and Enterprise wording of the third-party extra-usage refusal"
  - id: coqu-oauth
    resource: "https://flopsstuff.github.io/coqu/claude-oauth"
    title: "coqu Claude OAuth notes: platform code flow, code#state shape, 8-hour expiry"
---

# Claude subscription OAuth: flow, lifetime, billing and request identity

OMP, OpenClaw, Hermes and Pi each implement the same login: an OAuth 2.0
authorization-code grant with PKCE against a public Claude Code client id. Their
wire details differ in ways that matter for llame, and Anthropic states the risk
plainly. This study records the flow, the credential lifetimes, the request
identity `api.anthropic.com` expects, and how a third-party caller gets billed.

Four implementations agree on the client id, authorize URL, PKCE, scope set and
token response shape. They diverge on the token host, on the on-the-wire request
identity, and on the advice they give operators. Anthropic's own docs are the
authority for policy and for what the client is expected to look like.

## Flow, endpoints and scopes

The login is a standard authorization-code grant. The client is public, so PKCE
carries the proof, and no client secret exists. The client id is
`9d1c250a-e61b-44d9-88ed-5944d1962f5e`, stored base64 in OMP and in clear text in
the other three.[^omp-auth-kdl][^openclaw-oauth][^hermes-credentials][^pi-oauth]

| Element                 | Value                                                                                                        | Cited in                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Authorize endpoint      | `https://claude.ai/oauth/authorize`                                                                          | OMP, OpenClaw, Pi, Hermes |
| Token endpoint          | `https://api.anthropic.com/v1/oauth/token`                                                                   | OMP                       |
| Token endpoint          | `https://platform.claude.com/v1/oauth/token`                                                                 | OpenClaw, Pi, Hermes      |
| Token endpoint fallback | `https://console.anthropic.com/v1/oauth/token`                                                               | Hermes                    |
| Redirect, loopback      | `http://localhost:54545/callback`                                                                            | OMP                       |
| Redirect, loopback      | `http://localhost:53692/callback`                                                                            | OpenClaw, Pi              |
| Redirect, copy code     | `https://platform.claude.com/oauth/code/callback`                                                            | Pi                        |
| Redirect, copy code     | `https://console.anthropic.com/oauth/code/callback`                                                          | Hermes                    |
| Scopes, full set        | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` | OMP, OpenClaw, Pi         |
| Scopes, minimal         | `org:create_api_key user:profile user:inference`                                                             | Hermes                    |

Every implementation sends `code=true` as an authorize parameter on top of the
standard set, and every implementation sends PKCE with `S256`. OMP builds the
authorize URL from its declarative rule and then adds the rule's
`authorize-params`, which is exactly `code=true`.[^omp-auth-kdl][^omp-oauth-code]
Anthropic documents `code=true` for the platform code flow, where the callback
page shows a code instead of redirecting to a client server.[^coqu-oauth]

OMP's rule holds that `platform.claude.com` issues console tokens only, and that
the `claude.ai` endpoint is required for direct inference access.[^omp-auth-kdl]
That comment does not match the field. OpenClaw, Pi and Hermes mint
`sk-ant-oat01-` tokens from `platform.claude.com` and then call
`api.anthropic.com` with them.[^openclaw-oauth][^pi-oauth][^hermes-credentials]
The comment is best read as a warning about the _authorize_ host and the
`user:inference` scope, not about the token host. That reading is [INFERENCE, medium
confidence], because OMP states the claim as a comment without evidence.

Both token hosts accept a JSON body. OMP posts JSON to `api.anthropic.com` and
its tests assert that exact URL and encoding.[^omp-tests] OpenClaw and Pi post
JSON to `platform.claude.com`.[^openclaw-oauth-flow][^pi-oauth-flow] The platform
host also accepts form encoding, which Hermes uses by default and keeps JSON as
an option.[^hermes-credentials][^coqu-oauth]
One secondary write-up claims the platform endpoint rejects JSON with
`invalid_grant`.[^coqu-oauth] Three implementations contradict that claim, so
treat it as [INFERENCE, medium confidence].

## PKCE, state and the manual paste

OMP generates a 96-byte random verifier, encodes it base64url, hashes it with
SHA-256 and base64url-encodes the digest as the challenge.[^omp-pkce] Pi and
Hermes use 32 random bytes for the same construction.[^hermes-login][^pi-oauth-flow]
Pi reuses the verifier as the `state` value, so a pasted code and its state
verify each other with one secret.[^pi-oauth-flow] OMP and Hermes generate an
independent state.[^omp-oauth-code][^hermes-login]

The callback server and the paste prompt race each other. OMP binds
`localhost:54545/callback`, opens the browser, and in parallel accepts manual
input through `onManualCodeInput`. A pasted value is parsed as a full URL, then as
a query string, then as `<code>#<state>`. A manual result whose state differs
from the expected state is discarded and the prompt loop continues.[^omp-callback]
OpenClaw races its manual input the same way and throws `OAuth state mismatch`
on a wrong state.[^openclaw-oauth-flow] Hermes splits the pasted `code#state`
and aborts on mismatch with a CSRF note.[^hermes-login]

Pi also offers an explicit headless method, which skips the loopback server and
advertises `https://platform.claude.com/oauth/code/callback`. The authorize page
then shows the code, and the user pastes `code#state`.[^pi-oauth-flow] Hermes
uses the console variant of that callback page and always asks for the pasted
code.[^hermes-credentials]

Anthropic accepts any loopback port for this client, which is why Pi prefers a
fixed port for container forwarding and falls back to a random free port.[^pi-oauth]
OMP prefers port 54545 and, because its rule leaves port fallback enabled, binds
a free port when that one is taken. A rule that pins an exact redirect URI
disables the fallback and fails before opening the browser.[^omp-callback] One
secondary note claims the client rejects loopback redirects outright.[^claudexbar-auth]
Four current implementations complete loopback logins, so that note describes an
older or different client configuration. That correction is
[INFERENCE, medium confidence].

## Token response and the stored credential

The token response carries `access_token`, `refresh_token`, `expires_in`,
`token_type` and sometimes `account` and `organization` objects. Observed access
tokens start `sk-ant-oat01-` and refresh tokens start `sk-ant-ort01-`.[^claudexbar-auth][^onwatch-145]
`expires_in` is 28800 seconds, eight hours.[^onwatch-145][^claudexbar-auth][^coqu-oauth]
OMP stores `expires` as `expires_in` minus a 300-second skew, and maps
`account.uuid`, `account.email_address`, `organization.uuid` and
`organization.name` when present.[^omp-auth-kdl]

When the token response omits identity, OMP calls `GET
https://api.anthropic.com/api/claude_cli/bootstrap?entrypoint=cli&model=...` with
the bearer, `User-Agent: claude-code/<version>` and the `oauth-2025-04-20` beta.
The reply's `oauth_account` object supplies the account UUID, email and
organization.[^omp-bootstrap] OMP captures the organization at login only and
never rewrites it on refresh, because one email can hold several subscription
workspaces and rewriting identity during a background refresh would silently
re-key a stored credential.[^omp-bootstrap][^omp-tests]

The credential that matters for inference is the access token. Anthropic's legal
page permits an end user to sign in to the unmodified Claude Code binary with
their own subscription, and forbids developers from collecting, storing or
intermediating Claude.ai credentials.[^anthropic-legal] A llame-held access token
is exactly the intermediation that sentence prohibits, which is the risk Leo
accepted while charting.

## Refresh rotation and the refresh discipline

The refresh grant is `grant_type=refresh_token` with `client_id` and
`refresh_token`. OMP also sends `organization_id` when the credential carries
one, keeps a JSON body, and adds two headers that Claude Code sends only on
refresh: `anthropic-beta: oauth-2025-04-20` and
`User-Agent: anthropic-sdk-typescript/<sdk-version> userOAuthProvider`.[^omp-refresh-engine][^omp-auth-kdl]
OMP's tests pin both headers and pin that the org fields are dropped from the
refresh response.[^omp-tests] Pi and OpenClaw send the refresh grant with no beta
header and no User-Agent change.[^pi-oauth-flow][^openclaw-oauth-flow] Hermes
sends a bare `axios/1.7.9` User-Agent, because Anthropic answers 429 to token
requests whose User-Agent starts with `claude-code/`.[^hermes-credentials]

The beta header on refresh is not cosmetic. A headless client that refreshed
without it got HTTP 429 from the token endpoint for six consecutive attempts,
and the same request succeeded with the header present.[^onwatch-145] That
observation is the clearest evidence that the token endpoint is fingerprint
sensitive in both directions: it wants the OAuth beta, and it does not want a
`claude-code/` User-Agent.

Refresh tokens are single use. Each refresh returns a new refresh token, and the
old one dies. OMP serialises refreshes with a row lease in its SQLite credential
store, with a 15-second lease TTL, a 60-second exchange backstop, a 60-second
persist window and a five-minute remint cooldown so a 401 immediately after a
refresh does not rotate the token again.[^omp-refresh-lease] Hermes takes a
cross-process file lock, re-reads the current credential before refreshing, and
refuses to replay a token that another process already consumed.[^hermes-refresh]
ClaudexBar keeps its own login instead of borrowing Claude Code's, for the same
reason.[^claudexbar-auth]

Both clients also force one refresh on a 401 before they rotate to another
credential. OMP's retry policy is explicit: one `forceRefresh` for the current
credential, then sibling rotation, and a 403 or usage-limit failure rotates
without a refresh detour.[^omp-auth-retry] Hermes treats `invalid_grant`,
`invalid_token` and `refresh_token_reused` as terminal for the grant.[^hermes-refresh]

## How long a login lives

Two clocks run at once, and only one of them is renewable.

The access token lives eight hours. One background poller logged clean polls
until 21:01, failed proactive refreshes for the next hour, and then saw the
bearer rejected at 22:01 as `invalid API key`. Its successful refresh returned
`expires_in: 28800`.[^onwatch-145] OMP refreshes 60 seconds
before expiry, and its comment explains the skew as covering request round-trip
and clock drift. The value is a client choice, not a protocol value.[^omp-refresh-lease]

The grant family lives about 30 days from the interactive login. OMP's constant
records production grants authorized on 2026-06-20 and 2026-06-25 that died
exactly 30 days later to the hour, with healthy eight-hour rotations in between.
After that the token endpoint answers `invalid_grant: "Refresh token expired"`
for the latest rotated token, and only a new login recovers the account.[^omp-constants]
Anthropic's own login-status documentation corroborates the shape. `claude auth
status --text` prints `Sign-in ends: between <date A> and <date B>`, a warning
appears before the earlier date, and the page states that using Claude Code does
not extend the login.[^anthropic-authentication]

That gives llame three deadlines to model: access token expiry, the grant's
absolute deadline, and Anthropic's ability to end the login early. Claude Code
surfaces the early end as `Login expired`, `Login reached its time limit`, or
`OAuth token revoked`, and clears the saved credential when renewal fails.[^anthropic-errors]

A separate credential exists and is not this flow. `claude setup-token` performs
the same browser authorization and prints a one-year, inference-only OAuth token
for `CLAUDE_CODE_OAUTH_TOKEN`. It cannot call the account routes, so it cannot be
used to read subscription usage, and it has no refresh token.[^anthropic-authentication][^claudexbar-auth]

## The request identity the inference API demands

`api.anthropic.com` serves a subscription bearer only when the request looks like
Claude Code. Every implementation reproduces a fingerprint, and each reproduces a
different subset of it. The pieces are the User-Agent, the beta list, the first
system block, `x-app`, the optional billing header, and the tool names.

| Piece              | OMP                                                                                                                                                                                                                                                | OpenClaw                                                                 | Pi                                                           | Hermes                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| User-Agent         | `claude-cli/<2.1.321> (external, cli)`                                                                                                                                                                                                             | `claude-cli/<2.1.280>`                                                   | `claude-cli/<2.1.322>`                                       | `claude-code/<detected> (external, cli)`                                                                       |
| `x-app`            | `cli`                                                                                                                                                                                                                                              | `cli`                                                                    | `cli`                                                        | `cli`                                                                                                          |
| Beta list          | `claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05` plus `effort-2025-11-24` and `fallback-credit-2026-06-01` for agent requests | `claude-code-20250219,oauth-2025-04-20` plus conditional streaming betas | `claude-code-20250219,oauth-2025-04-20` plus per-model betas | `claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14` |
| First system block | billing header, then `You are Claude Code, Anthropic's official CLI for Claude.`                                                                                                                                                                   | billing header, then the identity sentence                               | identity sentence                                            | identity sentence                                                                                              |
| Tool names         | single-underscore prefix on non-built-in tools                                                                                                                                                                                                     | unchanged                                                                | Claude Code canonical casing                                 | `mcp__` prefix and two aliases                                                                                 |

The beta list is the most harness-specific piece. OpenClaw and Pi both build it
from `claude-code-20250219` and `oauth-2025-04-20`, then append only the betas
the request needs.[^openclaw-headers][^pi-messages-system] OMP ships a longer
default because it reproduces Claude Code's agent profile.[^omp-headers] Pi and
OpenClaw keep the header set small, with bearer auth, `x-app` and a bare
`claude-cli/<version>` User-Agent.[^pi-messages-headers]

OMP's OAuth header branch sets the bearer as `Authorization`, forces
`x-app: cli`, adds `anthropic-dangerous-direct-browser-access: true`, the eight
`X-Stainless-*` headers, an optional `X-Claude-Code-Session-Id`, and sends
requests to `/v1/messages?beta=true`. It also drops any caller-supplied
`Authorization` or `X-Api-Key` on this branch and logs the keys it dropped.[^omp-headers][^omp-provider]
The version comes from `PI_AI_CLAUDE_CODE_VERSION`, else a version adopted from a
server rejection, else the pinned default. Adoption happens on the
`claude_code_version_too_old` error, whose message names the required version.[^omp-fingerprint]

OMP prepends a billing line to the system array for OAuth requests only:
`x-anthropic-billing-header: cc_version=<version>.<3-hex-suffix>; cc_entrypoint=cli; cch=00000;`.
The suffix hashes a fixed salt with three characters of the first user message,
and a fetch wrapper replaces `cch=00000` with a five-hex XXHash64 of the request
body. A body that cannot be patched is sent as is, so the attestation is a
fingerprint nicety, not a gate.[^omp-provider] OpenClaw writes the same line with
`cc_entrypoint=sdk-cli` and no suffix or attestation.[^openclaw-payload] Pi and
Hermes send no billing line at all.[^pi-messages-identity][^hermes-adapter]

The OAuth system block is the second thing Anthropic looks at. OMP adds it only
for an OAuth token, and its catalog disables the block for Claude 3.5 Haiku.[^omp-provider] Pi marks the block with a comment that it MUST be
present for OAuth tokens.[^pi-messages-identity] Hermes's adapter states that
OAuth requests without the identity intermittently return 500.[^hermes-adapter]

Tool names are part of the same fingerprint. Hermes prefixes every tool with
`mcp__` and renames two of its own tools, because its live A/B runs found that a
single-underscore `mcp_` tool name and two specific tool schemas are classified
as third-party applications.[^hermes-adapter-tools] OMP instead prefixes custom
tools with one underscore and leaves Anthropic's built-in names alone.[^omp-identity]
Pi rewrites its tool names to Claude Code's canonical casing, with a comment that
calls the mode stealth.[^pi-messages]

Version drift is real and self-healing in two clients. OpenClaw reads
`details.error_code == "claude_code_version_too_old"` from a 400, extracts the
required version from the message, raises a process-wide floor and retries.[^openclaw-contract]
OMP does the same and compares against the version the failed request actually
sent, so concurrent first requests all retry once.[^omp-fingerprint]

## What happens without the identity

The failures are specific, and they are not uniform.

| Missing piece                                           | Observed result                                                                                       | Source                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `oauth-2025-04-20` beta and the current SDK fingerprint | HTTP 403 on `claude-opus-5` while the same account worked in `claude`                                 | [^omp-pr-9801]                         |
| Claude Code identity on a bare bearer                   | HTTP 429 `rate_limit_error` with the message `Error`                                                  | [^hermes-adapter-headers]              |
| Claude Code identity, intermittently                    | HTTP 500                                                                                              | [^hermes-adapter]                      |
| User-Agent version behind the release                   | 400 `claude_code_version_too_old`, message names the minimum version                                  | [^omp-fingerprint][^openclaw-contract] |
| `oauth-2025-04-20` beta on a token refresh              | HTTP 429 from the token endpoint                                                                      | [^onwatch-145]                         |
| Identity prefix plus a harness identity prompt          | 400 `invalid_request_error`, `Third-party apps now draw from your extra usage, not your plan limits.` | [^hermes-issue-79758]                  |
| `context-1m-2025-08-07` beta on a subscription bearer   | 429 `rate_limit_error`, `Usage credits are required for long context requests.`                       | [^omp-issue-7238]                      |

The Hermes replay is the most informative single experiment. Stripping tools and
lowering `max_tokens` changed nothing. Sending only the Claude Code identity
block returned 200. Sending the identity block plus Hermes's own rewritten
identity prompt returned 400, and the same happened for a `claude setup-token`
credential. The classifier reads request content, not the credential's origin.[^hermes-issue-79758]

Hermes then found single sentences and single tool schemas that each flip a
valid subscription request into a billing-shaped 400. One was a guidance sentence
about saving skills.[^hermes-prompt] The same 400 body also appears when
Anthropic's content filter rejects part of a request, which is why Hermes marks
the billing verdict unverified.[^hermes-classifier]

## How usage bills

Anthropic documents two metering paths, and its runtime chooses between them per
request.

Plan limits are the subscription allowance: a session window that resets every
five hours, a weekly window, and model-scoped weekly caps for model families.
Claude Code reports them in the unified rate-limit headers and in
`GET /api/oauth/usage`, whose payload carries `five_hour`, `seven_day`, a
`limits[]` list, `extra_usage` and `spend`.[^anthropic-errors][^omp-usage][^omp-usage-api]
OMP reads the same payload, plus the `anthropic-ratelimit-unified-*` response
headers, and it keys usage per credential.[^omp-usage][^omp-slow-mode]

Extra usage, sold as usage credits, is pay-as-you-go at standard API rates once
the plan limits are spent. It has a monthly spend limit and a credit balance, and
it applies to Pro, Max and Ultra as well as Team and Enterprise seats.[^anthropic-usage-credits]

Anthropic's runtime moves a third-party caller onto extra usage. The refusal is a
400 and its wording depends on the plan:

- Pro and Max: `Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.`
- Team and Enterprise: `Third-party apps now draw from extra usage, not plan limits. Ask your workspace admin to add more and keep going.`[^magpie-team]

When the extra-usage bucket is empty, the same path returns
`You're out of extra usage. Add more at claude.ai/settings/usage`.[^hermes-classifier]
Hermes tells the owner to wait for the cycle reset or to switch to an API key,
because a third-party subscription error is not a top-up problem.[^hermes-loop]
Hermes reports that its usage bills only as extra usage and never against the
included Max allowance.[^hermes-docs] That is one deployment's observation, not a
documented rule.

Anthropic's published policy disagrees with its own classifier. A June 15, 2026
note says the planned move to usage credits is paused, and that the Agent SDK,
`claude -p` and third-party app usage still draw from subscription limits.[^anthropic-agent-sdk]
The legal page permits only the unmodified Claude Code binary to sign in with a
subscription and forbids intermediating credentials.[^anthropic-legal] Both
statements leave a third-party harness in a state that the classifier resolves
per request. A wrapping client cannot predict the outcome from the request alone.

Two smaller metering facts belong here. Opus models are not available on the Pro
plan, and the error names the plan rather than the credential.[^anthropic-errors]
An organization can disable subscription sign-in for Claude Code entirely, and
the Agent SDK reports that as `oauth_org_not_allowed`.[^anthropic-errors]

Claude Code also has a third lane below the plan limits. After the session limit,
the server may grant a short wrap-up allowance drawn from the weekly limit, then
serve the account on spare capacity when the request carries
`anthropic-usage-limit: slow`. The server reports that lane in
`anthropic-ratelimit-unified-slow-*` headers, answers `slot_busy` or 529 when no
capacity exists, and reports whether extra usage is serving the account in
`anthropic-ratelimit-unified-overage-status`.[^omp-slow-mode][^omp-slow-machine]

## What this means for llame

- The Credential needs six stored fields beyond the bearer: refresh token, expiry, account id, email, organization id and organization name. The organization is fixed at login and must never be rewritten by a refresh.[^omp-bootstrap]
- Refresh must be single-flight across the API and every worker. The refresh token is single use, so two refreshers log each other out, and a failed persist loses the login entirely.[^omp-refresh-lease][^hermes-refresh]
- The owner must be warned before the grant's absolute deadline, because no refresh recovers it.[^omp-constants]
- llame must send a Claude Code identity or the request fails. That identity is a moving target: a pinned version, a beta list, a first system block, `x-app`, and tool naming. OMP and OpenClaw self-heal one part of it, the version, from the server's own rejection.[^omp-fingerprint][^openclaw-contract]
- Failure handling needs three distinct classes, not one. Auth failures are the usual 401 and `invalid_grant`, policy failures are `oauth_org_not_allowed` and the third-party 400, and capacity failures are 429 `rate_limit_error` with either a reset time or a credit message. A billing-shaped 400 can also mean a content-filter rejection.[^hermes-classifier][^anthropic-errors]

## Open questions

- Which failure class owns the third-party 400 is unsettled. It reads as billing, it can be caused by prompt text, and its wording differs by plan. llame needs one owner-facing message per cause, and the classifier cannot tell them apart.[^hermes-classifier]
- The identity module is a compatibility surface with no contract. Anthropic changes the pinned version, the beta set and the classifier without notice, and no implementation has a probe that detects drift before a Run fails. A preflight check is worth its own ticket.
- Whether llame may show subscription access as plan-billed or usage-billed is undecidable before a request. The owner surface needs a hedge rather than a claim, which feeds the connect and select surface on issue 751.
- Pro availability is reported two ways. Hermes documents Pro as unsupported for this path, while Anthropic's credits article sells usage credits to Pro subscribers. Pro Opus access is documented as unavailable, and nothing in the primary sources excludes Pro from the OAuth path itself.[^hermes-docs][^anthropic-usage-credits]

[^omp-auth-kdl]: [OMP anthropic auth rule](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/catalog/src/compat/rules/auth/anthropic.kdl#L1-L52).

[^omp-oauth-code]: [OMP declarative authorization-code engine](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/engine/oauth-code.ts#L101-L229).

[^omp-pkce]: [OMP `generatePKCE`](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/pkce.ts#L1-L19).

[^omp-callback]: [OMP callback server and `parseCallbackInput`](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/callback-server.ts#L607-L685).

[^omp-refresh-engine]: [OMP refresh grant engine](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/engine/refresh.ts#L72-L118).

[^omp-refresh-lease]: [OMP refresh lease and skew constants](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/auth/refresh.ts#L30-L80).

[^omp-auth-retry]: [OMP `withOAuthAccess` retry contract](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/auth-retry.ts#L443-L465).

[^omp-fingerprint]: [OMP Claude Code fingerprint module](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/claude-code-fingerprint.ts#L17-L89).

[^omp-headers]: [OMP `buildAnthropicHeaders` OAuth branch](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic-headers.ts#L63-L254).

[^omp-provider]: [OMP billing header, cch attestation and OAuth system blocks](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic.ts#L553-L735).

[^omp-identity]: [OMP `applyClaudeToolPrefix`](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic-identity.ts#L148-L167).

[^omp-bootstrap]: [OMP `anthropicIdentityHook`](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/anthropic.ts#L51-L112).

[^omp-constants]: [OMP `ANTHROPIC_OAUTH_GRANT_TTL_MS`](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/anthropic-constants.ts#L1-L12).

[^omp-tests]: [OMP `anthropic-oauth.test.ts`](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/test/anthropic-oauth.test.ts#L40-L120).

[^omp-usage]: [OMP Claude usage payload parsing](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/usage/claude.ts#L76-L80).

[^omp-usage-api]: [OMP `claude-api.ts` account routes](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/usage/claude-api.ts#L1-L66).

[^omp-slow-mode]: [OMP slow-lane wire contract](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/providers/anthropic-slow-mode.ts#L1-L76).

[^omp-slow-machine]: [OMP slow-mode wrap-up notices](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/coding-agent/src/session/anthropic-slow-mode.ts#L360-L440).

[^omp-pr-9801]: [OMP PR 9801](https://github.com/can1357/oh-my-pi/pull/9801).

[^omp-issue-7238]: [OMP issue 7238](https://github.com/can1357/oh-my-pi/issues/7238).

[^openclaw-oauth]: [OpenClaw anthropic OAuth constants](https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/src/llm/utils/oauth/anthropic.ts#L12-L60).

[^openclaw-oauth-flow]: [OpenClaw authorize, paste and refresh paths](https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/src/llm/utils/oauth/anthropic.ts#L228-L330).

[^openclaw-contract]: [OpenClaw Claude Code identity builder](https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/packages/ai/src/providers/anthropic-model-contract.ts#L58-L170).

[^openclaw-headers]: [OpenClaw OAuth beta list](https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/packages/ai/src/providers/anthropic.ts#L190-L215).

[^openclaw-payload]: [OpenClaw OAuth system preamble](https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/packages/ai/src/transports/anthropic-payload-policy.ts#L258-L282).

[^hermes-credentials]: [Hermes anthropic credential constants](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_credentials.py#L35-L45).

[^hermes-login]: [Hermes PKCE login](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_credentials.py#L760-L815).

[^hermes-refresh]: [Hermes refresh discipline](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_credentials.py#L430-L520).

[^hermes-adapter]: [Hermes identity comments](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_adapter.py#L238-L250).

[^hermes-adapter-headers]: [Hermes client builders](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_adapter.py#L420-L520).

[^hermes-adapter-tools]: [Hermes OAuth tool naming](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/anthropic_adapter.py#L525-L560).

[^hermes-classifier]: [Hermes billing classification](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/error_classifier.py#L106-L150).

[^hermes-loop]: [Hermes owner billing guidance](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/conversation_loop.py#L518-L555).

[^hermes-issue-79758]: [Hermes issue 79758](https://github.com/NousResearch/hermes-agent/issues/79758).

[^hermes-docs]: [Hermes provider documentation](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/website/docs/integrations/providers.md#L138-L175).

[^hermes-prompt]: [Hermes prompt builder note](https://github.com/NousResearch/hermes-agent/blob/56ac7b5d51945ae7875c4b669baa757fa17f4846/agent/prompt_builder.py#L244-L262).

[^pi-oauth]: [Pi anthropic OAuth constants](https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/auth/oauth/anthropic.ts#L14-L32).

[^pi-oauth-flow]: [Pi login and refresh paths](https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/auth/oauth/anthropic.ts#L139-L300).

[^pi-messages]: [Pi stealth mode tool names](https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L108-L140).

[^pi-messages-headers]: [Pi OAuth client headers](https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L1291-L1312).

[^pi-messages-system]: [Pi OAuth beta list](https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L1388-L1395).

[^pi-messages-identity]: [Pi OAuth identity block](https://github.com/earendil-works/pi/blob/9d63bb7277999ac83c7b1bd8b616141b28a9f666/packages/ai/src/api/anthropic-messages.ts#L1486-L1506).

[^anthropic-legal]: [Anthropic legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

[^anthropic-authentication]: [Claude Code authentication](https://code.claude.com/docs/en/authentication).

[^anthropic-errors]: [Claude Code error reference](https://code.claude.com/docs/en/errors).

[^anthropic-usage-credits]: [Manage usage credits for paid Claude plans](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans).

[^anthropic-agent-sdk]: [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

[^onwatch-145]: [onWatch issue 145](https://github.com/onllm-dev/onWatch/issues/145).

[^claudexbar-auth]: [ClaudexBar auth notes](https://github.com/ipangdz/claudexbar/blob/main/docs/AUTH.md).

[^coqu-oauth]: [coqu Claude OAuth notes](https://flopsstuff.github.io/coqu/claude-oauth).

[^magpie-team]: [magpie issue 5645](https://github.com/yetone/magpie/issues/5645).
