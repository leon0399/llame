---
type: Research
title: "Codex login path and refresh-token behavior"
description: "Compares direct OAuth with the Codex public client id, the App Server host-managed token mode, and a managed App Server, and records token lifetimes, rotation, errors, device-code availability, and the policy boundary."
tags: [credentials, oauth, codex, chatgpt, refresh-tokens, policy]
status: draft
summary: "Direct OAuth with the Codex public client id fits llame's Codex provider, but OpenAI tolerates it rather than granting it, and the sanctioned open-source plan route is a different Responses API provider."
read_when:
  - choosing the login and refresh path for the Codex subscription provider
  - deciding whether to adopt the Codex App Server or its host-managed token mode
  - checking what OpenAI permits for a third-party client that uses a ChatGPT plan
generated: { by: "omp/opencode-go-deepseek-v4.1-flash", at: "2026-11-20" }
observed:
  date: "2026-11-20"
  revisions:
    codex: "e58bf8f5233b51e7cd1679d947e3028c1ed91b06"
    oh-my-pi: "de397d59d3aea002ebd2acb52ffeac64644f7cf7"
    openclaw: "5d8c25101e6726d64348ec014a3e2e8e7467884e"
    opencode: "cdd0585e048b08d85df1f854b7deb3fa52b8dac4"
sources:
  - id: codex-manager
    resource: "https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/login/src/auth/manager.rs"
    title: "Codex auth manager: client id, refresh request, rotation, failure classes"
  - id: codex-server
    resource: "https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/login/src/server.rs"
    title: "Codex login server: callback URI, scopes, authorize parameters"
  - id: codex-oauth-client
    resource: "https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/login/src/oauth/client.rs"
    title: "Codex OAuth client: JSON refresh encoding"
  - id: codex-account-protocol
    resource: "https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/app-server-protocol/src/protocol/v2/account.rs"
    title: "App Server account protocol: chatgptAuthTokens login"
  - id: codex-external-auth
    resource: "https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/app-server/src/external_auth.rs"
    title: "App Server external auth bridge: refresh request and timeout"
  - id: codex-auth-doc
    resource: "https://learn.chatgpt.com/docs/auth.md"
    title: "Codex authentication documentation"
  - id: app-server-doc
    resource: "https://learn.chatgpt.com/docs/app-server.md"
    title: "Codex App Server documentation and auth endpoints"
  - id: siwc-overview
    resource: "https://developers.openai.com/siwc/token-sharing-open-source.md"
    title: "Sign in with ChatGPT plan usage for open-source apps"
  - id: siwc-tokens
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/token-reference.md"
    title: "Sign in with ChatGPT token response, lifetimes, claims"
  - id: siwc-refresh
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md"
    title: "Sign in with ChatGPT accounts, sessions, and refresh"
  - id: siwc-errors
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery.md"
    title: "Sign in with ChatGPT refresh errors and recovery"
  - id: siwc-models
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md"
    title: "Sign in with ChatGPT models and inference"
  - id: siwc-app-server
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md"
    title: "Sign in with ChatGPT and Codex App Server"
  - id: siwc-sign-in
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md"
    title: "Sign in with ChatGPT registration and sign-in"
  - id: siwc-preview
    resource: "https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations.md"
    title: "Sign in with ChatGPT preview limitations"
  - id: issue-originator
    resource: "https://github.com/openai/codex/issues/31967"
    title: "Model routing depends on originator and version"
  - id: issue-siwc-live
    resource: "https://github.com/openai/codex/issues/53003"
    title: "SIWC token works for Responses but not Codex Live"
  - id: omp-codex
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/openai-codex.ts"
    title: "OMP Codex OAuth browser and device flows"
  - id: omp-refresh
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/auth/refresh.ts"
    title: "OMP refresh skew, remint cooldown, and cross-process lease"
  - id: omp-policy
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/catalog/src/compat/rules/auth/openai-codex.kdl"
    title: "OMP Codex auth policy"
  - id: openclaw-auth
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/extensions/openai/openai-chatgpt-oauth-authorization.runtime.ts"
    title: "OpenClaw Codex authorization request"
  - id: openclaw-token
    resource: "https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/extensions/openai/openai-chatgpt-oauth-token.runtime.ts"
    title: "OpenClaw Codex token exchange, refresh, and error mapping"
  - id: opencode
    resource: "https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/plugin/provider/openai.ts"
    title: "OpenCode Codex OAuth and refresh"
  - id: llame-codex
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272/apps/api/src/models/openai-codex-model-client.ts"
    title: "llame Codex model client and Originator header"
---

# Codex login path

## Finding

Direct OAuth with the Codex public client id is the only path that fits the
shipped `openai-codex` provider. llame executes against
`https://chatgpt.com/backend-api/codex` itself and already sends
`Originator: llame` [^llame-codex]. Adding a login and a refresh loop keeps
credential ownership inside llame and changes nothing about execution.

The App Server host-managed mode is explicitly marked for OpenAI internal use.
A managed App Server is supported for local and open-source embedding, but it
moves the credential into Codex's store and makes the `codex` binary a runtime
dependency. Neither matches the outcome of #1826.

OpenAI documents a sanctioned open-source route for ChatGPT plan usage. It
issues a different kind of token, works only against `api.openai.com/v1`, and
cannot power the Codex backend. It is a future provider, not a drop-in login
for this one.

Confidence: high for the mechanics, medium for the policy boundary, medium for
long-term route stability.

## What was inspected

Codex is the primary source because it owns the public client id and the
refresh implementation. OMP, OpenClaw, and OpenCode show what independent
harnesses do with that client id. OpenAI's docs give the policy boundary and
the sanctioned alternative.

| Surface              | Revision   | Role                                                      |
| -------------------- | ---------- | --------------------------------------------------------- |
| `openai/codex`       | `e58bf8f5` | Client id, authorize parameters, refresh, App Server auth |
| `can1357/oh-my-pi`   | `de397d59` | Browser and device flows, refresh lease                   |
| `openclaw/openclaw`  | `5d8c2510` | Browser flow, refresh error mapping                       |
| `anomalyco/opencode` | `cdd0585e` | Browser and device flows, originator                      |
| `leon0399/llame`     | `3cc5b427` | Existing Codex provider and execution route               |

## Login paths

| Path                           | Credential owner                  | Refresh owner                | Execution owner     | Status                                                 |
| ------------------------------ | --------------------------------- | ---------------------------- | ------------------- | ------------------------------------------------------ |
| Direct OAuth, Codex client id  | llame                             | llame                        | llame               | Undocumented, tolerated for local and open-source apps |
| App Server `chatgptAuthTokens` | llame, supplied per session       | llame, on App Server request | Codex App Server    | Internal, marked do not use                            |
| Managed App Server             | Codex, in `CODEX_HOME` or keyring | Codex                        | Codex App Server    | Supported for local and open-source apps               |
| SIWC open-source client        | llame                             | llame                        | llame or App Server | Sanctioned, Responses API only                         |

### Direct OAuth with the Codex public client id

All three reference harnesses hardcode `app_EMoamEEZ73f0CkXaXp7hrann`, the same
value Codex defines as `CLIENT_ID` [^codex-manager] [^omp-codex] [^openclaw-auth]
[^opencode].

The flow:

1. Start PKCE with `S256` and a loopback callback.
2. Request scopes `openid profile email offline_access api.connectors.read api.connectors.invoke` [^codex-server].
3. Send `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, and an `originator` value [^codex-server].
4. Exchange the code at `https://auth.openai.com/oauth/token` with the same redirect URI and verifier.
5. Read `access_token`, `refresh_token`, `id_token`, and `expires_in` from the response.

The callback host is `127.0.0.1` in Codex, on port 1455 by default with a
fallback port when the first bind fails [^codex-server]. OMP pins
`http://localhost:1455/auth/callback` and refuses a port fallback because the
authorization server allowlists that exact URI [^omp-policy]. OpenClaw allows a
configurable loopback host on port 1455 [^openclaw-auth]. A server deployment
cannot rely on the operator's browser reaching a remote loopback port. Device
code or a pasted redirect URL is the practical headless path.

The identity comes from JWT claims. `chatgpt_account_id` under
`https://api.openai.com/auth` is the workspace and quota pool. Plan type may
appear only on the `id_token` [^omp-codex].

Token exchange is form-encoded. Refresh is where implementations diverge.
Codex sends the refresh grant as JSON [^codex-oauth-client]. OMP, OpenClaw, and
OpenCode send form-encoded refresh requests [^omp-policy] [^openclaw-token]
[^opencode]. The peers' refresh works, so the endpoint accepts both today.
[INFERENCE, high confidence] Matching Codex and sending JSON reduces drift risk.
Do not depend on both forms surviving forever.

### App Server host-managed tokens (`chatgptAuthTokens`)

The host calls `account/login/start` with `type: "chatgptAuthTokens"` and
supplies only `accessToken`, `chatgptAccountId`, and an optional
`chatgptPlanType` [^codex-account-protocol]. There is no refresh token in this
mode. Codex stores the token ephemerally [^codex-manager].

On a `401`, Codex sends the server request
`account/chatgptAuthTokens/refresh` to the host and waits 10 seconds for a
replacement access token [^codex-external-auth]. The host must hold the refresh
token and produce a new access token on demand. Missing or slow responses fail
the request.

The protocol source labels this login `[UNSTABLE] FOR OPENAI INTERNAL USE ONLY -
DO NOT USE.` [^codex-account-protocol]. The App Server doc calls it
experimental and requires `capabilities.experimentalApi` during `initialize`
[^app-server-doc].

Verdict: reject. llame would still own the refresh token, gain no storage or
serialization benefit, and take on an unstable internal interface.

### Managed App Server

With `type: "chatgpt"` or `type: "chatgptDeviceCode"`, Codex owns the OAuth
flow, persists tokens, and refreshes them automatically [^app-server-doc]. The
host receives an `authUrl` or a `verificationUrl` plus `userCode` and waits for
`account/login/completed`.

The credential lands in Codex's store: `auth.json` under `CODEX_HOME` or the OS
keyring [^codex-auth-doc]. A dedicated `CODEX_HOME` per llame installation would
keep it separate from the operator's own Codex CLI login. Codex's file lock and
compare-and-save would then serialize refresh across App Server processes
[^codex-manager].

The policy sentence matters. OpenAI says local and open-source applications
that use App Server authentication "can continue using it", and that App Server
authentication "has never been permitted for commercial or hosted services"
[^app-server-doc].

Verdict: viable only as a provider-owned execution path, not as a credential
backend for the native Codex client. It adds a binary dependency, moves refresh
and storage out of the #1825 store, and gives llame no token to reuse elsewhere.
It also changes who owns the model and tool loop, which is a #752 decision, not
a #1826 change.

## Token behavior

### Lifetimes

| Token         | Codex client id                                                        | Sanctioned open-source route                                    |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Access token  | JWT with `exp`, refreshed 5 minutes before expiry                      | 1 hour (`expires_in: 3600`) [^siwc-tokens]                      |
| Refresh token | Replaced when the response returns a new value, no documented lifetime | 30 days, renewed on each successful refresh [^siwc-tokens]      |
| ID token      | Returned at login, not used for refresh                                | Returned at login, retained for `id_token_hint` [^siwc-sign-in] |

Codex does not store an access-token lifetime. It parses the JWT `exp` and
refreshes inside a 5-minute window. When `exp` is unreadable, it refreshes after
8 days without a refresh [^codex-manager]. OMP uses a 60-second skew [^omp-refresh].

The 30-day refresh lifetime is documented for the sanctioned open-source
client, not for the Codex client id. [INFERENCE, medium confidence] The same
authorization server issues both, so 30 days is the best planning assumption.
A refresh resets the window, so a live installation does not hit it. An
installation idle for longer than the lifetime needs a new login.

### Rotation and single use

A successful refresh returns a new access token and a replacement refresh
token [^siwc-tokens]. Codex writes the returned refresh token over the stored
one. It keeps the old value only when the response omits the field
[^codex-manager].

The refresh token is single use. Reusing a spent token returns HTTP `401` with
`code: "refresh_token_reused"` and the message "Your refresh token has already
been used to generate a new access token. Please try signing in again."
[^codex-manager]. The sanctioned route documents the same code in its refresh
error list [^siwc-errors].

That makes a lost write destructive. OpenAI tells apps to serialize refreshes
so two processes do not race a rotating token [^siwc-refresh]. If process A
spends the token and process B then persists a stale value, the login is gone
for every process. [INFERENCE, medium confidence] Reuse may also invalidate the
token family, which would make recovery require a new login. Design for the
stricter case.

### Refresh errors and failure classes

Codex classifies these codes as permanent:

| Code                        | Meaning                            | Operator action |
| --------------------------- | ---------------------------------- | --------------- |
| `refresh_token_expired`     | Refresh token lifetime ended       | Log in again    |
| `refresh_token_reused`      | Token was already spent            | Log in again    |
| `refresh_token_invalidated` | Session revoked or account changed | Log in again    |
| `invalid_grant` on `400`    | Grant rejected                     | Log in again    |

Other `401` responses are permanent. An unknown code on a non-`400` response is
transient and retried [^codex-manager]. OpenClaw maps the same codes and keeps
the provider message while stripping the token from diagnostics
[^openclaw-token]. OMP maps a failed refresh to an `auth` failure with a
re-login instruction.

For llame, the mapping is simple. Every permanent code ends the Run as `auth`
with a re-login message. Network errors and `5xx` are transient. No token value
appears in the message, the Run event, or the log.

### Serializing refresh

Codex serializes refresh inside one process with a one-permit semaphore. Across
processes it takes a write lock, reloads the stored record, checks that the
expected refresh and access tokens still match, and only then saves
[^codex-manager].

OMP does the cross-process part explicitly. It takes a SQLite lease with a
15-second TTL, renews it, and saves through a compare-and-set that also checks
the lease owner [^omp-refresh]. It refreshes at expiry minus 60 seconds, keeps a
5-minute remint cooldown so a rejected token is not re-minted instantly, and
retries a busy store for up to 60 seconds so a spent token is never dropped
[^omp-refresh].

For llame this maps onto the existing Postgres advisory locks or a row lease.
The refresh operation must have one owner across API and workers, reload the
stored refresh token under the lock, exchange once, and compare-and-set the new
access token, refresh token, and expiry together.

## Device code

Codex exposes device code as `codex login --device-auth`, and the App Server as
`type: "chatgptDeviceCode"` [^codex-auth-doc] [^app-server-doc]. OpenAI marks it
beta and requires enabling it in ChatGPT security settings for a personal
account, or in workspace permissions for a workspace [^codex-auth-doc].

The device flow is not standard RFC 8628. Codex posts `client_id` to
`https://auth.openai.com/api/accounts/deviceauth/usercode`, polls
`/deviceauth/token`, and receives an authorization code plus a verifier for the
normal token exchange [^omp-codex]. OMP and OpenClaw implement the same
endpoints [^omp-codex] [^openclaw-token]. A `404` means device login is not
enabled for the account or server.

Device code is the most reliable remote-host path. A pasted redirect URL also
works when the operator's browser can finish authorization but cannot reach the
llame loopback port.

## Policy and terms

OpenAI does not publish a way for a third-party application to register its own
client id for the Codex backend. The Codex client id is a constant in
open-source Codex.
Every major harness reuses it and sets its own `originator`: `omp`, `openclaw`,
`opencode`, and in llame's case `llame` [^omp-policy] [^openclaw-auth]
[^opencode] [^llame-codex].

OpenAI's statements draw a line by deployment shape, not by client id:

- App Server authentication is allowed for local and open-source applications,
  and "has never been permitted for commercial or hosted services"
  [^app-server-doc].
- The sanctioned open-source route exists for apps that want to use a user's
  ChatGPT plan. It uses dynamic client registration, not the Codex client id,
  and restricts inference to `api.openai.com/v1/responses` [^siwc-sign-in]
  [^siwc-models].
- Commercial partners must apply for Sign in with ChatGPT [^siwc-overview].

The OpenAI Terms of Use do not grant a third-party app the right to use
OpenAI's OAuth client. They prohibit circumventing restrictions and sharing
account credentials, and they say nothing about client ids. The operative
permission is the documentation above.

[INFERENCE, medium confidence] A single-operator, self-hosted llame instance
that signs in with the operator's own subscription sits in the tolerated class,
alongside OMP and OpenClaw. A llame deployment that accepts other people's
subscriptions, or presents itself as a hosted service, sits on the prohibited
side of the App Server sentence and outside the sanctioned route's terms.

There is a second policy-independent risk. The Codex backend routes models by
`originator` and client version. In issue 31967 the same account and token
succeeded with `originator: codex_cli_rs` and a version, and failed with
`originator: pi`. The failure named an internal engine ending in
`codexswic-ev3` [^issue-originator]. llame already sends its own originator, so
it owns that exposure today. A subscription login does not make it worse, but
it does not remove it either.

## The sanctioned alternative, and why it is not this login

The open-source Sign in with ChatGPT flow registers a dynamic client:

1. Authorize with `client_id=dynamic_agent_client`, `agent_name_hint`, and a stable `ext_agent_host_id`.
2. Receive an issued `client_id`, such as `oaiapp_...`, and save it with the account.
3. Request scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
4. Exchange the code at `https://auth.openai.com/api/accounts/oauth/token`.
5. Use the access token at `https://api.openai.com/v1/responses` with `store: false` and `stream: true`.

The docs are explicit that this route must not point at ChatGPT's `backend-api`
endpoints [^siwc-models]. A report on issue 53003 confirms the boundary in
practice: a fresh SIWC token completed a text Responses turn but failed Codex
Live with `401 no_matching_rule` [^issue-siwc-live].

The route also restricts the request. It rejects `temperature`, `top_p`,
`previous_response_id`, hosted MCP, image generation, file search, Code
Interpreter, and `tool_search` [^siwc-preview]. It can drive Codex App Server
through an `env_key` provider, but the traffic still goes to
`api.openai.com/v1/responses` [^siwc-app-server].

So SIWC is the sanctioned way to use a ChatGPT plan from an open-source app.
It is not a way to authenticate the Codex backend. Adopting it means shipping a
second provider with a different model surface and feature set.

## Recommendation

Use direct OAuth with the Codex public client id for the `openai-codex` login.

1. Implement the browser flow with PKCE, the Codex scopes, and the Codex
   authorize parameters. Keep the callback on loopback port 1455, send the
   exact same URI in the authorization request and the code exchange, and
   accept a pasted redirect URL when the callback cannot be reached.
2. Offer device code as the remote-host path. Treat `404` from the usercode
   endpoint as "device login is not enabled" and say how to enable it.
3. Store access token, refresh token, account id, plan type, and expiry in the
   #1825 credential store. Key the credential by installation and workspace.
4. Refresh inside a single-writer lease at expiry minus 60 seconds, and force
   one refresh after a `401`. Save the rotated refresh token under the lease
   with compare-and-set.
5. Map `refresh_token_reused`, `refresh_token_expired`,
   `refresh_token_invalidated`, and `invalid_grant` to `auth` and ask the
   operator to log in again. Map transport and `5xx` failures to a retry.
6. Keep the client id, issuer, scopes, and authorize parameters in one place so
   an issued SIWC client or a different route can replace them without touching
   the refresh loop.
7. Record the policy position in the provider docs. State that the login is
   for a single operator's own subscription and that OpenAI does not publish a
   permission for third-party client ids.

Revisit the decision if any of these change:

- llame accepts subscriptions from people other than the operator.
- OpenAI publishes a client registration for third-party Codex clients.
- The Codex backend starts rejecting originators other than its own.
- llame ships an SIWC provider and can move subscription access onto it.

## Open questions

1. Which llame deployment shapes count as hosted or commercial? The App Server
   sentence and the SIWC route both turn on that boundary.
2. Does llame want a second, sanctioned `openai-chatgpt-plan` provider on
   `api.openai.com/v1/responses` as a fallback, with its narrower feature set?
3. Should the login UI require device code on remote hosts, or also support a
   pasted redirect URL? Codex supports the loopback callback, OpenClaw supports
   pasted input, and OMP supports device code.

[^codex-manager]: Codex auth manager, `codex-rs/login/src/auth/manager.rs:232-246, 1758-1798, 1861-1885, 1895, 1965-1975, 2248, 3658-3675`. <https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/login/src/auth/manager.rs#L232-L246>

[^codex-server]: Codex login server, `codex-rs/login/src/server.rs:193-197, 590-614, 641-671`. <https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/login/src/server.rs#L193-L197>

[^codex-oauth-client]: Codex OAuth client, `codex-rs/login/src/oauth/client.rs:17-33, 128-136`. <https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/login/src/oauth/client.rs#L17-L33>

[^codex-account-protocol]: Codex App Server account protocol, `codex-rs/app-server-protocol/src/protocol/v2/account.rs:98-115, 301-331`. <https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L98-L115>

[^codex-external-auth]: Codex App Server external auth bridge, `codex-rs/app-server/src/external_auth.rs:18, 44-46`. <https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/app-server/src/external_auth.rs#L18>

[^codex-auth-doc]: Codex authentication, "Login on headless devices". <https://learn.chatgpt.com/docs/auth.md>

[^app-server-doc]: Codex App Server, "Auth endpoints" at `app-server.md:2242-2266`. <https://learn.chatgpt.com/docs/app-server.md>

[^siwc-overview]: Sign in with ChatGPT plan usage. <https://developers.openai.com/siwc/token-sharing-open-source.md>

[^siwc-tokens]: Sign in with ChatGPT token reference, "Token lifetimes" at `token-reference.md:7-15`. <https://developers.openai.com/siwc/token-sharing-open-source/token-reference.md#token-lifetimes>

[^siwc-refresh]: Sign in with ChatGPT accounts and sessions, "Refreshing tokens" at `profiles-and-sessions.md:36-38`. <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#refreshing-tokens>

[^siwc-errors]: Sign in with ChatGPT errors and recovery, "Refresh errors" at `errors-and-recovery.md:46-52`. <https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery#refresh-errors>

[^siwc-models]: Sign in with ChatGPT models and inference, "Supported endpoint" at `models-and-inference.md:24`. <https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference>

[^siwc-app-server]: Sign in with ChatGPT and Codex App Server at `codex-app-server.md:9-32`. <https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server>

[^siwc-sign-in]: Sign in with ChatGPT registration and sign-in at `sign-in.md:5, 20-30, 59`. <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>

[^siwc-preview]: Sign in with ChatGPT preview limitations at `preview-limitations.md:8-22`. <https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations>

[^issue-originator]: Codex issue 31967, originator-dependent model routing. <https://github.com/openai/codex/issues/31967>

[^issue-siwc-live]: Codex issue 53003, SIWC token and Codex Live. <https://github.com/openai/codex/issues/53003>

[^omp-codex]: OMP Codex OAuth, `packages/ai/src/registry/oauth/openai-codex.ts:12-24, 186-205, 210-260`. <https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/openai-codex.ts#L12-L24>

[^omp-refresh]: OMP refresh coordinator, `packages/ai/src/auth/refresh.ts:40-70, 305`. <https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/auth/refresh.ts#L40-L70>

[^omp-policy]: OMP Codex auth policy, `packages/catalog/src/compat/rules/auth/openai-codex.kdl:5-17, 25-26`. <https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/catalog/src/compat/rules/auth/openai-codex.kdl#L5-L17>

[^openclaw-auth]: OpenClaw Codex authorization, `extensions/openai/openai-chatgpt-oauth-authorization.runtime.ts:3-9, 40-48`. <https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/extensions/openai/openai-chatgpt-oauth-authorization.runtime.ts#L3-L9>

[^openclaw-token]: OpenClaw Codex token exchange and refresh, `extensions/openai/openai-chatgpt-oauth-token.runtime.ts:22, 35-38, 311-313`. <https://github.com/openclaw/openclaw/blob/5d8c25101e6726d64348ec014a3e2e8e7467884e/extensions/openai/openai-chatgpt-oauth-token.runtime.ts#L35-L38>

[^opencode]: OpenCode Codex provider, `packages/core/src/plugin/provider/openai.ts:18, 277, 363, 393`. <https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/plugin/provider/openai.ts#L18>

[^llame-codex]: llame Codex model client, `apps/api/src/models/openai-codex-model-client.ts:15, 104`. <https://github.com/leon0399/llame/blob/3cc5b4272/apps/api/src/models/openai-codex-model-client.ts#L15>
