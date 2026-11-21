---
type: Research
title: "MCP OAuth from a self-hosted llame installation"
description: "Checks what MCP authorization 2026-07-28 asks of the client, what llame's two pinned client libraries already do, and how a self-hosted installation without a public URL registers a client, receives the redirect and refreshes, including servers relayed through a Machine."
tags: [mcp, oauth, credentials, client-registration, machine-relay]
status: draft
generated:
  by: "omp/deepseek-v4.1-flash"
  at: "2026-11-20"
observed:
  date: "2026-11-20"
sources:
  - id: mcp-auth
    resource: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
    title: "MCP authorization, 2026-07-28: flow steps, resource indicators, refresh, error handling"
  - id: mcp-discovery
    resource: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery"
    title: "MCP authorization server discovery, 2026-07-28: protected resource metadata and metadata validation"
  - id: mcp-registration
    resource: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration"
    title: "MCP client registration, 2026-07-28: CIMD, pre-registration, DCR, authorization server binding"
  - id: mcp-security
    resource: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations"
    title: "MCP authorization security considerations, 2026-07-28: PKCE, redirect URIs, mix-up, token storage"
  - id: sdk-auth
    resource: "https://unpkg.com/@modelcontextprotocol/sdk@1.32.0/dist/esm/client/auth.js"
    title: "@modelcontextprotocol/sdk 1.32.0 client auth.js: auth(), registration, resource selection, refresh"
  - id: sdk-transport
    resource: "https://unpkg.com/@modelcontextprotocol/sdk@1.32.0/dist/esm/client/streamableHttp.js"
    title: "@modelcontextprotocol/sdk 1.32.0 StreamableHTTPClientTransport: 401 and 403 auth recovery"
  - id: sdk-auth-types
    resource: "https://unpkg.com/@modelcontextprotocol/sdk@1.32.0/dist/esm/client/auth.d.ts"
    title: "@modelcontextprotocol/sdk 1.32.0 OAuthClientProvider: methods, clientMetadataUrl, discoveryState"
  - id: sdk2-auth-types
    resource: "https://unpkg.com/@modelcontextprotocol/client@2.4.0/dist/index.d.mts"
    title: "@modelcontextprotocol/client 2.4.0 auth options: clientMetadataUrl, iss, finishAuth"
  - id: ai-sdk-auth
    resource: "https://unpkg.com/@ai-sdk/mcp@1.0.71/dist/index.js"
    title: "@ai-sdk/mcp 1.0.71 auth() and OAuthClientProvider: discovery, registration, refresh, 401 recovery"
  - id: ai-sdk-types
    resource: "https://unpkg.com/@ai-sdk/mcp@1.0.71/dist/index.d.ts"
    title: "@ai-sdk/mcp 1.0.71 MCPTransportConfig authProvider and OAuthClientProvider interface"
  - id: omp-flow
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/coding-agent/src/mcp/oauth-flow.ts"
    title: "OMP MCP OAuth flow: callback resolution, DCR body, static client id, resource filter"
  - id: omp-callback
    resource: "https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/callback-server.ts"
    title: "OMP OAuthCallbackFlow: loopback listener, manualInputOnly paste path"
  - id: opencode-oauth
    resource: "https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/mcp/oauth.ts"
    title: "OpenCode MCP OAuth: CIMD selection, DCR fallback, loopback redirects, issuer checks"
  - id: opencode-redirect
    resource: "https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/oauth/redirect.ts"
    title: "OpenCode pasted redirect URL handling for browsers that cannot reach the callback host"
  - id: opencode-cimd
    resource: "https://opencode.ai/oauth/opencode/client.json"
    title: "OpenCode client metadata document, fetched 2026-11-20"
  - id: llame-relay
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/machine/src/mcp-relay.ts"
    title: "llame Machine relay: StreamableHTTPClientTransport with static headers and no auth provider"
  - id: llame-machine-open
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/machine/src/mcp.ts"
    title: "llame mcp.open: the hub names a root and a server, the Machine resolves the declaration"
  - id: llame-hub-client
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/mcp/mcp-server-client.ts"
    title: "llame hub MCP client: @ai-sdk/mcp http transport built over a guarded fetch"
  - id: llame-failure
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/mcp/mcp-failure-policy.ts"
    title: "llame MCP failure policy: every non-call failure reconnects, 401 included"
  - id: llame-config
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/packages/mcp-workspace/src/workspace-mcp-config.ts"
    title: "llame Workspace MCP config: remote entries are a URL and interpolated headers"
  - id: llame-origin
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/app.setup.ts"
    title: "llame WEB_ORIGIN: a comma-separated list of bare origins, required in production"
  - id: llame-cookie
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/auth/auth.controller.ts"
    title: "llame session cookie: SESSION_COOKIE_DOMAIN required in production"
  - id: llame-mcp-doc
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/docs/product/operator/mcp-tools.md"
    title: "llame operator doc: remote MCP servers take interpolated headers, which is how a static token works today"
  - id: llame-transport-study
    resource: "https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/docs/research/tool-harness/2026-08-07-mcp-transport.md"
    title: "Earlier llame study that deferred MCP OAuth by design"
  - id: ext-auth
    resource: "https://github.com/modelcontextprotocol/ext-auth/tree/main/specification/stable"
    title: "MCP authorization extensions: enterprise-managed-authorization and oauth-client-credentials, listed 2026-11-20"
---

# MCP OAuth from a self-hosted llame installation

A self-hosted llame is an OAuth client that nobody pre-registered. It runs on a host the operator chooses. It serves a browser UI at an origin the operator configures. It may reach the MCP server directly or through a Machine.

This document reads the 2026-07-28 authorization spec, the two client libraries llame pins, and the two reference harnesses. It answers four questions. What does the spec demand of the client. What do the libraries already do. How does a client identify itself and receive the redirect without a public URL. What changes when the server sits behind a Machine.

The earlier llame transport study ruled OAuth out of scope for #215 and named the SDK's `authProvider` path as the deferred option.[^llame-transport-study]

## What the specification asks of the client

The spec makes OAuth 2.1 with PKCE the standard path. It lists twelve client obligations that matter here.

| Obligation                    | What the client must do                                                                              | Source              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| Protected resource metadata   | Use the `resource_metadata` URL from `WWW-Authenticate`, else probe the two well-known URIs in order | [^mcp-discovery]    |
| Authorization server metadata | Try RFC 8414 and both OIDC discovery endpoints in the stated priority                                | [^mcp-discovery]    |
| Metadata identity             | Reject a metadata document whose `issuer` differs from the URL it was fetched from                   | [^mcp-discovery]    |
| Client registration           | Obtain a `client_id` by pre-registration, CIMD or DCR, in that priority                              | [^mcp-registration] |
| DCR body                      | Send `application_type`, `native` for a local app and `web` for a hosted one                         | [^mcp-registration] |
| PKCE                          | Always `S256`, and refuse to proceed when `code_challenge_methods_supported` is absent               | [^mcp-security]     |
| Resource indicator            | Send `resource` in the authorization and token requests, whether or not the server supports it       | [^mcp-auth]         |
| Mix-up defense                | Compare the callback `iss` with the recorded issuer before redeeming the code                        | [^mcp-auth]         |
| Redirect URI                  | Use `localhost` or HTTPS, and register the exact value                                               | [^mcp-security]     |
| Authorization server binding  | Keep client credentials and tokens per issuer, never present them to another                         | [^mcp-registration] |
| Refresh                       | Store refresh tokens confidentially, list `refresh_token` in `grant_types`, expect rotation          | [^mcp-auth]         |
| Step-up                       | On `403 insufficient_scope`, re-authorize with the union of the granted and challenged scopes        | [^mcp-auth]         |

Two constraints shape every deployment decision. Clients must record the issuer before the redirect and validate `iss` after it.[^mcp-auth] A client with no public URL cannot satisfy the CIMD requirement, which demands an HTTPS document with a path.[^mcp-registration]

## What the pinned client libraries already do

llame pins two different client libraries. The hub talks to MCP servers through `@ai-sdk/mcp` 1.0.71.[^llame-hub-client] The Machine daemon and the Workspace package pin `@modelcontextprotocol/sdk` 1.32.0.[^llame-relay][^llame-config]

Their OAuth coverage is not the same, and the difference decides how much llame must supply.

| Requirement                 | `@ai-sdk/mcp` 1.0.71                                       | `@modelcontextprotocol/sdk` 1.32.0                                           |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Resource metadata discovery | Yes, with a fallback to the server origin                  | Yes, with the same fallback[^sdk-auth]                                       |
| Server metadata discovery   | Yes, both families                                         | Yes, both families[^sdk-auth]                                                |
| Metadata `issuer` check     | No                                                         | No, and the source says so[^sdk-auth]                                        |
| CIMD                        | No, the provider has no `clientMetadataUrl`[^ai-sdk-types] | Yes, when advertised and the URL is HTTPS with a path[^sdk-auth]             |
| DCR                         | Yes, without `application_type`[^ai-sdk-auth]              | Yes, without `application_type`[^sdk-auth]                                   |
| PKCE                        | Yes, `S256`                                                | Yes, `S256`, but only refuses when the field is present and wrong[^sdk-auth] |
| `resource` in both requests | Yes when resource metadata exists                          | Yes when it exists, else only via `validateResourceURL`[^sdk-auth]           |
| `iss` validation            | No                                                         | No, and v2 adds it[^sdk2-auth-types]                                         |
| Refresh                     | Yes, bound to the stored server information[^ai-sdk-auth]  | Yes, stamps the issuer and drops a mismatch[^sdk-auth]                       |
| Discovery cache             | No                                                         | Optional, through `discoveryState`[^sdk-auth-types]                          |
| `403` step-up               | No                                                         | Yes, at the transport with a loop breaker[^sdk-transport]                    |
| Re-auth on `401`            | One attempt per response[^ai-sdk-auth]                     | Yes, with a loop breaker[^sdk-transport]                                     |

Both libraries keep the interactive flow behind the same seam. The provider answers `tokens`, `saveTokens`, `clientInformation`, `saveClientInformation`, `codeVerifier`, `saveCodeVerifier`, `redirectToAuthorization`, `redirectUrl` and `clientMetadata`.[^sdk-auth-types][^ai-sdk-types] That seam is the storage llame's Credential store would fill.

The SDK in llame's pin leaves four gaps against the table above. It omits `resource` when the server publishes no resource metadata.[^sdk-auth] It accepts a server that publishes none. It skips the `iss` check that v2 adds.[^sdk2-auth-types] It sends no `application_type`, though the caller's own `clientMetadata` object can add one.[^sdk-auth]

The hub's library has a further gap. Its provider interface has no `clientMetadataUrl`, so CIMD is unreachable even against a server that advertises it.[^ai-sdk-types] It also asserts that a `resource_metadata` URL shares the MCP server's origin, which the spec does not require.[^ai-sdk-auth]

OpenCode already uses the newer client. It pins `@modelcontextprotocol/client` 2.4.0 and passes the callback `iss` into `auth()`.[^opencode-oauth] That is the shape llame's callback route would need.

## Client identity without a public URL

The spec ranks three mechanisms. Pre-registered credentials come first, CIMD second, DCR third.[^mcp-registration] A self-hosted installation can use each, with different costs.

| Mechanism      | What it needs                                                                                          | Verdict for a self-hosted install                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Pre-registered | The operator creates the client at the server, then pastes `client_id` and secret into configuration   | Works with no public URL, and works when DCR is closed. It costs a manual step per server. |
| CIMD           | An HTTPS document with a path that the authorization server can fetch, listing the exact redirect URIs | Works only when the installation's origin is reachable from the authorization server.      |
| DCR            | A `registration_endpoint`, and a client that stores the result per issuer                              | Works with no public URL. It is deprecated, and servers may restrict it.                   |

CIMD does not require the vendor to host the document. Each installation can serve its own at, for example, `https://llame.example.com/oauth/client-metadata.json`. The document must name the same URL as `client_id`, list the callback, and stay reachable for as long as the grant lives.[^mcp-registration]

A vendor-hosted document cannot serve a hosted callback. OpenCode's document lists only loopback redirects.[^opencode-cimd] Any installation behind a reverse proxy needs a redirect URI that document does not contain.

Pre-registration is what OMP falls back to when DCR is refused. Its error text names the failing endpoint and asks the operator for `oauth.clientId`.[^omp-flow]

DCR is what both harnesses use by default. It fits a self-hosted install because the registration carries the exact redirect URI the install will use, and the credential then lives in the install's store.

### What the two harnesses chose

OMP runs a loopback listener and registers the URI it actually bound, with `application_type: "native"`.[^omp-flow] It accepts a configured `clientId` and never uses CIMD.

OpenCode prefers CIMD when the server advertises `client_id_metadata_document_supported`, the server allows `none` client authentication, and the operator configured neither a client id nor a redirect URI.[^opencode-oauth] Otherwise it registers, and a configured `client_id` always wins.[^opencode-oauth]

Both reserve a manual path. OMP's generic flow can skip its listener and take a pasted code.[^omp-callback] OpenCode accepts a pasted redirect URL and applies the same `state` check as the browser route.[^opencode-redirect]

## The redirect URI a self-hosted installation can offer

The spec allows `localhost` or HTTPS, and requires exact registration.[^mcp-security] Four shapes fit llame, and only the first suits a server install.

| Shape                               | When it works                                                                         | Cost                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Callback on the installation origin | Always, because the operator's browser already reaches that origin                    | Needs a new HTTP route, and an origin llame can name                      |
| Loopback listener on the llame host | Only when the browser runs on that host, as on a laptop or a published container port | Not reachable from an operator's desktop when llame runs on a server      |
| Pasted redirect URL                 | When the browser lands somewhere llame cannot read                                    | One extra operator step, and the same `state` check                       |
| Device authorization grant          | Never, as things stand                                                                | Absent from the spec, from both pinned libraries, and from both harnesses |

The stable authorization extensions are `enterprise-managed-authorization` and `oauth-client-credentials`.[^ext-auth] Neither is a device grant. A device flow would be llame-specific and impossible to negotiate with a server.

llame already requires its own origin list in production. `WEB_ORIGIN` is a comma-separated list of bare origins, and `SESSION_COOKIE_DOMAIN` is required in the same environment.[^llame-origin][^llame-cookie] A callback route on that origin needs no new information, only a path.

The install origin is also the natural `clientMetadataUrl` host. An installation whose origin is public can serve CIMD from that origin and skip DCR.

Today the token reaches a remote server through an interpolated header.[^llame-mcp-doc] That works for a static token and cannot refresh.

## Servers relayed through a Machine

A remote server declared in a Workspace that lives on a Machine never touches the hub's HTTP stack. The Machine starts it and relays JSON-RPC messages in both directions.[^llame-machine-open]

Three facts decide the design.

1. The relay builds `StreamableHTTPClientTransport` with static `requestInit` headers and no `authProvider`.[^llame-relay] A `401` during the handshake therefore throws out of `start()`.[^sdk-transport]
2. The relay turns that throw into `MachineRequestError("internal", "mcp.open: the server could not be started ...")`, with the text redacted.[^llame-relay] The status and the `WWW-Authenticate` header do not survive.
3. The hub answers every non-`call` MCP failure with a reconnect.[^llame-failure] A server that needs a login becomes a reconnect loop that no operator can break.

The hub cannot supply a header either. `mcp.open` names a root and a server, and the Machine re-reads the declaration from its own disk.[^llame-machine-open] Interpolation resolves against the Machine's environment by design.[^llame-config]

The options below follow from those facts. None is free.

| Option                                     | What it means                                                                                  | Cost                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OAuth only for hub-reachable servers       | A remote server in a hub-local Workspace gets a login. A Machine-relayed server keeps headers. | Splits one Operator surface into two behaviors                                        |
| Flow and store on the Machine              | The Machine runs the login and keeps the Credential, and the hub keeps only non-secret state   | Contradicts installation-scope storage, and needs a Machine-side store and encryption |
| Hub-orchestrated, delivered to the Machine | The hub runs the flow, then hands the access token to the relay                                | No such channel exists, and the value would cross the wire the config layer avoids    |
| Challenge through the relay                | `mcp.open` reports a `401` with the challenge, and the hub drives `auth()`                     | A protocol change, and the token still has to return to the Machine                   |

The first option matches the shipped architecture. The other three each need a decision before #1844 can cover Machine-relayed servers.

## What llame supplies

For a hub-reachable server, the split is small and testable.

1. A provider object backed by the Credential store, holding tokens, client information, the PKCE verifier and the discovery state.
2. A callback route on the installation origin that reads `code`, `state` and `iss`, then calls `auth()` with the code.
3. A redirect URI derived from `WEB_ORIGIN`, with `application_type: "web"` in the client metadata.
4. A `validateResourceURL` that returns the server URL when no resource metadata exists, so `resource` is always sent.[^sdk-auth]
5. An `iss` comparison at the callback, because 1.32.0 does not do one.[^sdk2-auth-types]
6. A terminal failure state for an authenticated server, replacing today's reconnect,[^llame-failure] plus a refresh path shared with the rest of the Credential store.

The hub's own library cannot fill items 4 and 5. Driving `auth()` from the pinned SDK next to the guarded fetch is the narrower change, and both harnesses already do that.

## Open questions

- Where a Machine-relayed server's OAuth Credential lives, and which side runs the flow, needs its own ticket before #1844 can claim Machine coverage.
- Which entry of `WEB_ORIGIN` is the redirect base, or whether a dedicated setting joins it, is a decision for the #1844 Spec brief.
- Whether the hub keeps `@ai-sdk/mcp` for transport and calls the SDK's `auth()` beside it, or moves the whole connection to the SDK client, is an architecture choice for review.

[^mcp-auth]: [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): flow steps, resource parameter implementation, authorization response validation, refresh tokens, step-up flow.

[^mcp-discovery]: [MCP authorization server discovery, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery): protected resource metadata discovery requirements, and the rule that metadata `issuer` must equal the URL it was fetched from.

[^mcp-registration]: [MCP client registration, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration): priority order, CIMD requirements, `application_type` for DCR, authorization server binding.

[^mcp-security]: [MCP authorization security considerations, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations): PKCE and the refusal rule, `localhost` or HTTPS redirect URIs, token theft, mix-up attacks.

[^sdk-auth]: [@modelcontextprotocol/sdk 1.32.0 client auth.js](https://unpkg.com/@modelcontextprotocol/sdk@1.32.0/dist/esm/client/auth.js), lines 186-390 for `auth()`, 417-430 for `selectResourceURL`, 781-840 for `startAuthorization`, 907-920 for `refreshAuthorization`, 995-1020 for `registerClient`. The comment at lines 258-262 states that the metadata document's `issuer` is not checked.

[^sdk-transport]: [@modelcontextprotocol/sdk 1.32.0 streamableHttp.js](https://unpkg.com/@modelcontextprotocol/sdk@1.32.0/dist/esm/client/streamableHttp.js), lines 328-375: `401` re-authorization and `403 insufficient_scope` step-up, both behind `_authProvider`, with a loop breaker. Lines 43-70 show `UnauthorizedError` when no provider exists.

[^sdk-auth-types]: [@modelcontextprotocol/sdk 1.32.0 client auth.d.ts](https://unpkg.com/@modelcontextprotocol/sdk@1.32.0/dist/esm/client/auth.d.ts): `OAuthClientProvider` with `clientMetadataUrl`, `discoveryState`, `validateResourceURL` and the storage methods, and `auth()` accepting `authorizationCode` and `resourceMetadataUrl`.

[^sdk2-auth-types]: [@modelcontextprotocol/client 2.4.0 index.d.mts](https://unpkg.com/@modelcontextprotocol/client@2.4.0/dist/index.d.mts), lines 821-829 and 1193-1198: `iss` is validated per RFC 9207 against the recorded issuer. Line 2164 shows `finishAuth` taking callback parameters.

[^ai-sdk-auth]: [@ai-sdk/mcp 1.0.71 index.js](https://unpkg.com/@ai-sdk/mcp@1.0.71/dist/index.js): `authInternal` at line 1166, registration without `application_type`, `assertResourceMetadataUrlSameOrigin`, `assertAuthorizationServerInformationMatches`, and the single `401` retry near lines 1408-1419.

[^ai-sdk-types]: [@ai-sdk/mcp 1.0.71 index.d.ts](https://unpkg.com/@ai-sdk/mcp@1.0.71/dist/index.d.ts): `OAuthClientProvider` at lines 155-211 has no `clientMetadataUrl` and no `discoveryState`, and `MCPTransportConfig.authProvider` is at line 295.

[^omp-flow]: [OMP oauth-flow.ts at de397d5](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/coding-agent/src/mcp/oauth-flow.ts): `resolveCallbackOptions` at lines 225-247, `staticClientIdFromConfig` at 214-223, the DCR body with `application_type: "native"` in `#tryRegisterClient`, and the manual `oauth.clientId` hint in `#missingClientIdError`.

[^omp-callback]: [OMP callback-server.ts at de397d5](https://github.com/can1357/oh-my-pi/blob/de397d59d3aea002ebd2acb52ffeac64644f7cf7/packages/ai/src/registry/oauth/callback-server.ts): `manualInputOnly` at lines 111-112 and 245-247 skips the listener and waits for a pasted code.

[^opencode-oauth]: [OpenCode oauth.ts at cdd0585](https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/mcp/oauth.ts): `CLIENT_METADATA_URL` at line 36, the provider at 149-196, the CIMD condition at 534-541, loopback registrations at 545-556, the issuer check at 386-389, and `iss` passed into `auth()` at 612-618.

[^opencode-redirect]: [OpenCode redirect.ts at cdd0585](https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/oauth/redirect.ts): the pasted URL path for a browser that cannot reach the callback host, with the same `state` check as the browser route.

[^opencode-cimd]: [OpenCode client metadata document](https://opencode.ai/oauth/opencode/client.json): `client_id` is the document URL, and `redirect_uris` lists only `http://127.0.0.1` and `http://localhost` paths.

[^llame-relay]: [llame mcp-relay.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/machine/src/mcp-relay.ts): `createHttpTransport` at lines 214-227 passes static headers and no auth provider, and `startFailure` at 305-318 returns an `internal` error with the redacted text.

[^llame-machine-open]: [llame apps/machine/src/mcp.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/machine/src/mcp.ts): `openOperation` at lines 111-134 takes a root and a server name, then starts the relay from the declaration the Machine read.

[^llame-hub-client]: [llame mcp-server-client.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/mcp/mcp-server-client.ts), lines 1275-1284: the hub builds an `@ai-sdk/mcp` `http` transport over its guarded fetch, with no `authProvider`.

[^llame-failure]: [llame mcp-failure-policy.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/mcp/mcp-failure-policy.ts), lines 46-52 and 60-70: every failure outside the `call` stage reconnects, and a `401` during a call reconnects too.

[^llame-config]: [llame workspace-mcp-config.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/packages/mcp-workspace/src/workspace-mcp-config.ts), lines 80-93: interpolation reads the environment the caller passes, so the Machine resolves its own values.

[^llame-origin]: [llame app.setup.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/app.setup.ts), lines 93-129: `WEB_ORIGIN` is a comma-separated list of bare origins and is required in production.

[^llame-cookie]: [llame auth.controller.ts at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/apps/api/src/auth/auth.controller.ts), lines 259-278: `SESSION_COOKIE_DOMAIN` is required in production.

[^llame-mcp-doc]: [llame remote MCP operator doc at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/docs/product/operator/mcp-tools.md): remote entries are a URL and interpolated headers, and an `Authorization` header is redacted as a protected value.

[^llame-transport-study]: [llame MCP transport study at 3cc5b42](https://github.com/leon0399/llame/blob/3cc5b4272f22d8d4541a7dd209fccc9fe5c0ca3c/docs/research/tool-harness/2026-08-07-mcp-transport.md), lines 311-314: the SDK `authProvider` path was deferred as out of scope.

[^ext-auth]: [MCP authorization extensions](https://github.com/modelcontextprotocol/ext-auth/tree/main/specification/stable): the stable set is `enterprise-managed-authorization` and `oauth-client-credentials`. No device authorization extension is listed.
