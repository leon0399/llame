---
type: Research
title: "#215 transport research — MCP Streamable HTTP: spec, client libraries, peers"
description: "Reads the current MCP spec, the installed ai and @ai-sdk/mcp sources, and peer MCP consumers to name the Streamable HTTP gaps llame must build, and confirms no #214 decision needs reopening."
tags:
  [
    mcp,
    streamable-http,
    transport,
    client-libraries,
    peer-comparison,
    tool-calling,
  ]
status: stable
---

# #215 transport research — MCP Streamable HTTP: spec, client libraries, peers

Noncanonical research. Date: 2026-08-07. Scope: issue #215 (instance-managed
Streamable HTTP MCP tools), transport half only. The contract half — tool id form,
`tools.allowed` boot-validation split, drift-withdraws-the-tool, payload redaction,
description neutralization — is **already decided** in
`openspec/changes/add-dynamic-tool-catalog/design.md` ("Decided now, implemented in
issue #215") and `docs/research/tool-harness/2026-08-07-214-harness-audit.md`
("Handoff to issue #215"). This document does not re-litigate either; it cites them
where transport findings touch them and flags anywhere a transport fact would force a
reopen.

Method: read the MCP specification (2025-11-25 revision, the latest published),
inspected `ai@6.0.217` as installed in this repo's `node_modules`, `npm pack`ed
`@ai-sdk/mcp` at the version compatible with that `ai` version and read its shipped
`src/`, and read three peer checkouts for MCP **consumption** code. Every version and
file:line claim was checked against installed package source or a pinned checkout,
not memory.

| source                      | pin                                                                                     | dated / fetched                          | why                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| MCP specification           | `2025-11-25` (current; matches `SUPPORTED_PROTOCOL_VERSIONS[0]` in the SDK below)       | fetched 2026-08-07                       | normative transport requirements                                                          |
| `ai` (installed)            | `6.0.217`                                                                               | installed today                          | llame's pinned model SDK (`apps/api/package.json`, `apps/web/package.json`)               |
| `@ai-sdk/mcp`               | `1.0.67` (the `ai-v6` dist-tag; **not** `latest`, which is `2.0.28` and targets `ai@7`) | published 2026-08-07, `npm pack`ed today | the MCP client the AI SDK ecosystem ships for llame's `ai` major                          |
| `@modelcontextprotocol/sdk` | `1.29.0`, transitive only, pulled in by `shadcn` (the CLI dev-dependency)               | resolved from `pnpm-lock.yaml`           | **not** a llame runtime dependency — see Finding 1                                        |
| `anomalyco/opencode`        | `fab213312927`                                                                          | 2026-07-18                               | same stack, uses the official SDK directly rather than `@ai-sdk/mcp`                      |
| `open-webui/open-webui`     | `ecd48e2f7182`                                                                          | 2026-07-01                               | closest self-hosted multi-user product comp; Python official SDK                          |
| `nanocoai/nanoclaw`         | `b7e24123ef7e`                                                                          | 2026-07-14                               | **excluded** — its `mcp-tools/` serves MCP (stdio server), doesn't consume it (Finding 0) |

`openclaw/openclaw` (`347ee4589503`, 2026-07-18) was not re-read: its `src/mcp/` is
openclaw **serving** MCP, the caveat the task flagged for nanoclaw, and its
already-cited value to #215 (quarantine-health, redaction-on-persist) is
transport-adjacent and already in the #214 audit's handoff section.

---

## Finding 0 — nanoclaw is not a peer for this question

`container/agent-runner/src/mcp-tools/server.ts:1-12` imports
`@modelcontextprotocol/sdk/server/index.js` and `.../server/stdio.js`, builds a
`Server`, and calls `server.setRequestHandler(ListToolsRequestSchema, ...)`:
nanoclaw is an MCP **server** (its agent-runner container exposes `send_message` /
`send_file` etc. as tools to whatever drives it over stdio). A repo-wide grep for
`StreamableHTTPClientTransport`, `createMCPClient`, or any client import under
`@modelcontextprotocol/sdk/client` returns nothing — it has no MCP-consumption code
at all. Dropped from the comparison table below.

---

## Finding 1 — `ai@6.0.217` ships no MCP client; the package isn't in this repo yet

Verified by grepping the installed package, not by reading docs:

```text
node_modules/.pnpm/ai@6.0.217_zod@3.25.76/node_modules/ai/dist/{index,internal/index,test/index}.{d.ts,d.mts,js,mjs}
```

Zero matches for `mcp`, `MCP`, or `createMCPClient` (case-insensitive) across every file
in that package's `dist/`. `experimental_createMCPClient`, which shipped from the core
`ai` package in the v4/v5 line, is gone from `ai@6`. The functionality moved to
`@ai-sdk/mcp`, exporting `createMCPClient` (the `experimental_` prefix was also
dropped). **`@ai-sdk/mcp` is not a dependency anywhere in this repo** — not in
`apps/api/package.json`, not in the lockfile, not even transitively. The only
MCP-shaped package the lockfile carries is `@modelcontextprotocol/sdk@1.29.0`
(`pnpm-lock.yaml:1813,9401,15122`), pulled in solely by `shadcn` (the
component-registry CLI, a dev dependency) — unrelated to runtime tool execution, and
not something #215 should repurpose.

**The version pin matters, and the docs page does not tell you which version you are
reading.** `npm view @ai-sdk/mcp dist-tags` returns `latest: 2.0.28` alongside
`ai-v6: 1.0.67`; the `2.0.x` line targets `ai@7` (unreleased against this repo) while
`1.0.x` is built against `ai@6`, matching what is installed. The published docs at
`ai-sdk.dev/docs/ai-sdk-core/mcp-tools` describe session-resumption options
(`initialSessionId`, `initialProtocolVersion`, `onSessionExpired`,
`terminateSessionOnClose`) and a `fingerprintTools`/`detectToolDrift` pair exported
from `ai` itself — **none of it exists in the `1.0.67` source** (`grep -rn
"initialSessionId\|onSessionExpired\|fingerprintTools\|detectToolDrift"` across the
unpacked `1.0.67` tarball and the installed `ai@6.0.217` dist returns nothing in
either). Either the docs page reflects the `2.0.x`/`ai@7` line by default, or a
not-yet-published feature; either way, treat the live docs site as describing a
_different_ release than the one llame would install. `npm i @ai-sdk/mcp` with no
version pin follows `latest` — `2.0.28`, which per its own `peerDependencies` wants
`ai@^7`. **#215 must pin `@ai-sdk/mcp` to the `1.0.x` line explicitly** (e.g.
`^1.0.0`, verified today at `1.0.67`), not `latest`.

Confidence: high — read from the installed `ai` package and the unpacked, pinned
`@ai-sdk/mcp` tarball, not from documentation or memory.

**Secondary, minor finding:** `@ai-sdk/mcp@1.0.67`'s own
`peerDependencies`/`dependencies` want `@ai-sdk/provider@3.0.14` and
`@ai-sdk/provider-utils@4.0.42`; the repo currently has `3.0.13` / `4.0.34`
(`node_modules/.pnpm/@ai-sdk+provider@3.0.13`,
`@ai-sdk+provider-utils@4.0.34_zod@3.25.76`). Likely resolves fine under semver
caret ranges, but wasn't installed and verified — see "what I could not verify."

---

## Finding 2 — the transport `@ai-sdk/mcp@1.0.67` ships is spec-following, with named gaps

Read from `src/tool/mcp-http-transport.ts` (519 lines) in the pinned tarball — the
class used when you pass `{ transport: { type: 'http', url, headers } }` to
`createMCPClient`. Correct against the spec (§Streamable HTTP,
`modelcontextprotocol.io/specification/2025-11-25/basic/transports`):

- POST for every outgoing JSON-RPC message, `Accept: application/json,
text/event-stream` on every POST (`mcp-http-transport.ts:183-186`) — the spec's MUST
  that the client "include an `Accept` header, listing both `application/json` and
  `text/event-stream`".
- Both allowed response shapes: a single `application/json` body, or a
  `text/event-stream` parsed via `EventSourceParserStream` (`:255-325`).
- `notifications`/`response`-shaped outbound messages (no `id`) short-circuit before
  expecting a JSON-RPC reply (`:250-253`), matching the spec's 202-Accepted case.
- Session id: captured from `mcp-session-id` on any response (`:198-201,409-412`) and
  echoed on every subsequent request via `commonHeaders` (`:95-97`) — "if an
  `MCP-Session-Id` is returned... clients... MUST include it... on all of their
  subsequent HTTP requests." `mcp-protocol-version` is likewise sent on every request
  once negotiated (`:92`).
- `close()` best-effort DELETEs the session (`:146-165`) — the spec's "clients that no
  longer need a session SHOULD send an HTTP DELETE"; failures are swallowed
  (`.catch(() => undefined)`), correct given the spec says a server MAY respond 405.
- Resumable SSE **for the background listen channel**: `openInboundSse` tracks
  `lastInboundEventId` from each event's `id` and, on drop, reconnects with
  `last-event-id` (`:398-399,460-461`) — a real Last-Event-ID implementation, not a
  stub. Bounded: 1s initial delay, 1.5x growth, 30s cap, **max 2 retries**
  (`:50-55,346-375`) before it surfaces an `MCPClientError` via `onerror`.

Not supported, per the same source and `mcp-client.ts`'s own docstring (`:361-364`,
verbatim): _"Not supported: - Accepting notifications - Session management (when
passing a sessionId to an instance of the Streamable HTTP transport) - Resumable SSE
streams."_ Read precisely, not literally against the transport code above (which does
track a session id and does reconnect within one instance's lifetime):

- **No cross-instance/injectable session resumption.** A new client cannot be handed a
  previously-obtained session id to resume where a prior process left off — the session
  only exists for the lifetime of one `DefaultMCPClient`, so a restart re-initializes.
- **No reaction to server-pushed notifications**, including
  `notifications/tools/list_changed` — see Finding 4.
- **Per-request SSE streams are not resumed.** The 2-retry backoff is only for the
  separate GET "listen" channel opened by `client.start()`; an SSE stream attached to a
  `tools/call` POST that drops mid-flight is not resumed (Finding 6).

One discrepancy against the published docs, flagged with **moderate-to-high**
confidence since it is read from the pinned source rather than the (possibly
differently-versioned) docs page: the docs claim redirects default to `'error'` "to
prevent SSRF", but `mcp-transport.ts:107-113` (JSDoc on
`MCPTransportConfig.redirect`) says _"`'follow'`: Follow redirects automatically
(standard fetch behavior)... `@default 'follow'`"_ and `mcp-http-transport.ts:66,78`
confirms the constructor default. **If #215 wants redirect-following disabled for an
operator-configured remote endpoint (defense against a compromised/misconfigured MCP
endpoint redirecting into internal infrastructure), it must pass `redirect: 'error'`
explicitly per server** — the library will not do this for you.

---

## Finding 3 — no default request timeout; retries are narrow and opt-in

`RequestOptions` (`types.ts:76-80`) is `{ signal?, timeout?, maxTotalTimeout? }`, and
`getEffectiveTimeout` (`mcp-client.ts:146-159`) only fires `setTimeout` when the
_caller_ supplies one. Absent that, a `tools/list` or `tools/call` request has no
ceiling beyond whatever the underlying `fetch` does (i.e. none). **#215 must supply an
explicit per-call timeout** — a BUILD item, not a library default. opencode's own
default (`catalog.ts:11`, `DEFAULT_TIMEOUT = 30_000`) is a reasonable reference point.

Retries (`mcp-client.ts:69,107-124,238-245,727-748`): `maxRetries` defaults to `0`
(disabled). When enabled, only `tools/call` requests retry, and only for HTTP
`408/409/429/5xx` or the network error codes `ECONNRESET`, `ECONNREFUSED`,
`ETIMEDOUT`, `EPIPE` plus MCP-SDK-internal `ConnectionRefused`/`ConnectionClosed`/
`FailedToOpenSocket`. A `MCPClientError` already carrying a JSON-RPC `.code` (an
application-level error the server returned deliberately) is excluded
(`isRetryableMCPToolCallError:107-120`, `return false` when `error.code != null`).
That matches the docs' warning that retrying non-idempotent tools can duplicate side
effects, and is inert for llame today, since every tool through #215 stays read-only per
the already-decided landmine requirement (design.md D4). Remember it when a write tool
is proposed: the retry semantics are call-level, not idempotency-aware, so nothing
here dedupes for you.

---

## Finding 4 — no default pagination, and no reaction to runtime change notifications

**Pagination.** `mcpClient.tools()` → `listTools()` → a single `{ method:
'tools/list' }` request (`mcp-client.ts:713-725,901-910`), with no loop over
`nextCursor`. A paginating server yields only the first page — nothing errors, nothing
warns. **#215 must build its own pagination loop** to get every tool. Copy opencode:

- `catalog.ts:18-36`, `paginate()` loops up to `MAX_LIST_PAGES = 1_000`, tracks seen
  cursors in a `Set`, and throws `MCP list returned duplicate cursor` if a server hands
  back a cursor it already served — cheap insurance against a malformed or hostile
  server cursoring forever.
- `catalog.ts:145-162`, `listTools()` wraps each page fetch and catches an
  `outputSchema`-shaped validation failure (`isOutputSchemaValidationError`,
  regex-matched against error text: `can't resolve reference|resolves to more than one
schema|outputSchema|...`), retrying that one page against a schema with `outputSchema`
  stripped (`TolerantListToolsResultSchema`). This exists because the **official**
  `@modelcontextprotocol/sdk`'s strict zod `ListToolsResultSchema` can fail on one
  tool's malformed/self-referencing `outputSchema` and take down discovery for **every
  tool on that server**, not just the bad one — a real failure mode opencode had to
  harden against. `@ai-sdk/mcp@1.0.67`'s own `ToolSchema` (`types.ts:142-169`) declares
  `outputSchema: z.optional(z.object({}).loose())` — loose, not strict — which looks
  more tolerant by construction but was not verified against a malformed-schema
  fixture; see "what I could not verify."

**Runtime change notifications.** The MCP spec defines
`notifications/tools/list_changed` (server capability `tools.listChanged`) so a client
doesn't have to poll. `@ai-sdk/mcp@1.0.67` routes it nowhere useful: its `onmessage`
handler (`mcp-client.ts:409-424`) feeds a message with `method` but no `id` (any
notification) straight to
`this.onError(new MCPClientError({ message: 'Unsupported message type' }))`, losing
the notification's own `.method` and `.params`, so whatever `onUncaughtError` callback
llame supplies sees an indistinguishable generic error for _every_ server-pushed
notification. **There is no way to react to a server's own change signal at the
`MCPClient` level** — you would have to bypass the client and wrap `HttpMCPTransport`
directly to inspect `onmessage` before the client discards the method name. Issue #215's
"when to (re)discover" question therefore has one real answer with this library: **poll
or re-discover on your own cadence** (e.g., once per run bind — matching issue #214's
already-decided "drift can only mean a redeploy landed mid-run" framing, D2 in
design.md), not "subscribe and get pushed updates." This forecloses an option nobody
had assumed was available; it conflicts with nothing #214 decided.

---

## Finding 5 — failure isolation is a build item everywhere; the spec is silent

The MCP spec is a single-server protocol with no notion of "one server among several,"
so nothing here is a spec requirement. All peer isolation is application-level, and
issue #215's own "offline or malformed servers degrade only their own tools" (issue
text) has to be built the same way.

- **open-webui** (`backend/open_webui/utils/middleware.py:2620-2671`): tool ids
  `server:mcp:<server_id>`; `connect_mcp_server` (`:2112-2160`) is called per server
  inside a `try/except Exception` that, on failure, logs, emits a user-visible
  `chat:message:error` event ("Failed to connect to MCP server '{server*id}'"), and
  `continue`s — one server's connection or discovery failure never aborts the
  tool-resolution loop for the rest. The executable tool name it registers is
  `f'{server_id}*{tool*spec["name"]}'` (`:2652,2655`): server-id-prefixed but with **no
character sanitization of the tool name itself**, unlike opencode/Claude Code's
`[^A-Za-z0-9*-]→\_`pass (#214's F3, already decided as`mcp**server**tool`) — a gap
in this peer, not a pattern to copy. Discovery for the separate OpenAPI-tool-server
path (`utils/tools.py:1315-1411`) gathers every configured server concurrently with
`asyncio.gather(\*tasks, return_exceptions=True)`, then per-result
`if isinstance(response, Exception): log.error(...); continue` — the same
  isolate-and-skip shape, batched.
- **opencode** (`mcp/index.ts:83-107`): a small closed discriminated status type per
  server — `connected | disabled | failed{error} | needs_auth |
needs_client_registration` (`Schema.Union`, `:100-106`) — stored per-server-name in
  `State.status` (`:144`). `defs()` (`catalog.ts:38-40`) wraps `listTools` in
  `Effect.catch(() => Effect.void)`, so discovery failure for one server degrades to
  "no tools from this server," never a thrown error the caller has to catch.
  `needs_auth`/`needs_client_registration` are OAuth-only and out of scope for #215's
  static-header model, but the shape — a small closed enum, not a boolean up/down — is
  worth copying for whatever status/health record #214's already-decided
  withdraw-and-record (F8, no TTL) ends up using.

**Concrete recommendation for #215:** wrap connect+discover per configured MCP server
in isolation (open-webui's try/except/continue shape is the simplest), record a small
typed status per server rather than a boolean (opencode's enum minus the OAuth-only
variants), and never let one server's exception propagate into the tool-catalog build
for the others. Additive scope for #215; it does not reopen F7 or F8, which already
specify the _tool-level_ behavior (fail-closed until resolved,
withdraw-not-fail-the-run) this _server-level_ discovery isolation feeds into.

---

## Finding 6 — mid-flight tool-call disconnect: no partial resume, and the whole client goes down together

Two failure shapes, both from `mcp-client.ts`/`mcp-http-transport.ts`:

1. **The per-request SSE stream (attached to one `tools/call` POST) drops.** Its
   `processEvents()` reader loop (`mcp-http-transport.ts:284-313`) catches the error
   and calls `this.onerror?.(error)` — nothing resumes _that_ stream. The pending
   `request()` promise for that call (`mcp-client.ts:597-711`) waits on its
   `responseHandlers` entry, which this path never resolves; it only resolves via
   `onClose()` (below) or its own `timeout`/`signal` if one was supplied (Finding 3:
   none by default). **Without an explicit per-call timeout, a dropped per-request
   stream can hang the call indefinitely** rather than fail fast.
2. **The whole transport closes** (network death, explicit `close()`, or the SSE
   listen-channel exhausting its 2 reconnect attempts and calling `onclose`).
   `DefaultMCPClient.onClose()` (`mcp-client.ts:1199-1212`) rejects **every** pending
   `responseHandlers` entry at once with `MCPClientError('Connection closed')` — every
   in-flight `tools/call`/`tools/list` on that client fails together, with no
   partial-recovery path.

Neither case is unique to MCP — it is the same "a tool call can receive no clean
result" shape #214's F2 already solved generically (settle-on-termination, D6's
first-writer-wins), and the existing run-abort/settlement path already turns "tool
promise rejects" into a structured, non-fatal `ToolResult` error. **What #215 must add
is the explicit per-call timeout** (Finding 3) so case 1 fails in bounded time instead
of hanging the run.

---

## Finding 7 — credentials: static headers only (matches the deferral), and the library's own error object is the redaction hazard #214 already named

llame's model, per design.md and the issue text, is instance-managed static headers, no
OAuth. `MCPTransportConfig.headers` (`mcp-transport.ts:96-100`) is exactly that — a
plain `Record<string, string>` merged into every request by `commonHeaders`
(`mcp-http-transport.ts:86-111`). The SDK's `authProvider` / `OAuthClientProvider` path
(`oauth.ts`, 1333 lines not read in depth here — out of scope by design) is what OAuth
would use; #215 doesn't touch it.

**Concrete, previously-unnamed mechanism for F10** (the #214 audit's deferred
redaction finding — "the requirement is written in #215 already... but the write path
it applies to is `run_events` emission, which is #214's code"): `MCPClientError`
(`error/mcp-client-error.ts:39-44`) carries a `responseBody: string` field, populated
unconditionally from `await response.text()` on any non-2xx HTTP response
(`mcp-http-transport.ts:229,242`) — **no size cap, no redaction, whole body**. A
misconfigured or malicious MCP server that echoes a request header (including the
configured `Authorization`/secret header) into its error body — a common
debugging-leftover pattern in real APIs — puts that value directly into
`MCPClientError.responseBody`. If #215's tool executor lets that error's `.message` or
`.responseBody` flow into a `tool.completed` run event the way #214's audit found
`runner.ts`/`run-execution.service.ts` currently do for its own tool
(`run-execution.service.ts:625-649` per the audit), the configured secret leaks into
`run_events` — durable, owner-visible, replayed on reconnect. F10's disposition is
unchanged (already correctly deferred to #215, not #214); this upgrades it from "a
requirement to satisfy" to "a requirement with a named, concrete library-level source
to redact against." The #214 handoff's redaction scope already covered call arguments
and results; **add `MCPClientError.responseBody`/`.message`/`.data` and the outbound
`headers` map itself** to what must never reach a persisted field.

Also add: the `mcp-session-id` value. The spec's own security note
(`.../security_best_practices#session-hijacking`, referenced from the
Session-Management section) treats it as a hijacking-relevant secret-adjacent value;
llame should not log or persist it either, even though it is not the header configured
by the operator.

---

## Cross-source comparison

| question                            | MCP spec (2025-11-25)                               | `@ai-sdk/mcp@1.0.67`                                                                              | opencode (`fab213312927`)                         | open-webui (`ecd48e2f7182`)                               | llame must BUILD for #215                                   |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| Streamable HTTP endpoint model      | single endpoint, POST+GET, MUST                     | implements correctly                                                                              | uses official SDK's implementation                | uses official Python SDK's implementation                 | nothing — consume as-is                                     |
| session id propagation              | MAY assign, client MUST echo if assigned            | correct, per-instance                                                                             | inherited from official SDK                       | inherited from official SDK                               | nothing                                                     |
| resumability (Last-Event-ID)        | MAY, server-optional                                | implemented, listen-channel only, 2 retries, 1s→30s backoff                                       | inherited from official SDK                       | not inspected                                             | nothing beyond what's shipped                               |
| default request timeout             | not specified                                       | **none** — caller must supply                                                                     | 30s default (`catalog.ts:11`)                     | `AIOHTTP_CLIENT_TIMEOUT_TOOL_SERVER` config               | **yes — pick and enforce a default**                        |
| redirect-following default          | n/a                                                 | `'follow'` (docs claim `'error'` — verified discrepancy)                                          | not configured explicitly                         | `follow_redirects: True` (httpx)                          | **yes — decide, probably `'error'` per operator server**    |
| `tools/list` pagination             | cursor-based, optional                              | **none — first page only**                                                                        | **built** (`paginate()`, cap + dup-cursor guard)  | not observed to paginate                                  | **yes — copy opencode's shape**                             |
| malformed per-tool schema isolation | not specified                                       | looser `ToolSchema` (untested against real malformed fixture)                                     | **built** (`TolerantListToolsResultSchema` retry) | not observed                                              | verify library behavior; build a fallback if it fails       |
| reaction to `tools/list_changed`    | server MAY notify, client behavior unspecified      | **none — notification discarded as "unsupported message"**                                        | not found in reviewed files                       | not observed                                              | **yes — poll/re-discover on your own cadence**              |
| per-server failure isolation        | n/a — single-server protocol                        | client-per-server by construction (one client instance per server)                                | **built**: typed status enum per server           | **built**: try/except + continue + UI error event         | **yes — wrap connect+discover per server**                  |
| retry policy                        | n/a                                                 | opt-in, narrow (5xx/408/409/429/net errors), JSON-RPC errors excluded                             | not inspected in depth                            | not inspected in depth                                    | decide `maxRetries`; matches D4 (all tools read-only today) |
| mid-flight disconnect               | disconnection MUST NOT imply cancellation           | listen-channel resumes; per-request stream does not; whole client's pending calls reject together | inherited from official SDK                       | not inspected                                             | nothing new — #214's F2/D6 settlement already covers it     |
| credential transport                | headers unspecified by spec; OAuth section separate | static `headers` + optional `authProvider` (OAuth, unused here)                                   | full OAuth store (`auth.ts`) — **out of scope**   | Bearer token header, no OAuth store observed in this path | nothing — static headers already match design.md's model    |
| response-body-in-error redaction    | n/a                                                 | **none — full body captured, unbounded, unredacted**                                              | not inspected                                     | not inspected                                             | **yes — extends #214's already-deferred F10 scope**         |

---

## Does anything here force reopening a #214 decision?

No. Every load-bearing #214 decision (D1–D7, F3, F7, F8) still holds; nothing found
here contradicts them. Two items sharpen how #215 should _implement_ an
already-settled decision without changing it:

- **D2 (canonical comparison, no round-trip)**: `mcpClient.tools()`'s "automatic" mode
  (`mcp-client.ts:961-976`) force-mutates the discovered `inputSchema` before returning
  it — unconditionally injecting `additionalProperties: false` (`:969-973`) and
  wrapping it in `jsonSchema()` with no `validate` function supplied. If #215
  snapshots/hashes/canonicalizes _that_ mutated form, it diverges from what the server
  actually declared — the same false-drift risk D2 was written to eliminate for llame's
  own round-trip. **Integration requirement, not a contract change:** canonicalize
  from the raw `MCPTool.inputSchema` returned by `listTools()` (`types.ts:142-169`), and
  build the executable tool wrapper separately using #214's own
  `jsonSchema(schema, { validate })` helper (D3) rather than `toolsFromDefinitions`'s
  built-in path.
- **D3 (ajv validator supplied to the SDK)**: independently confirmed necessary for
  the MCP path. `dynamicTool()`'s call to `jsonSchema({...} as JSONSchema7)`
  (`mcp-client.ts:969-973`) passes no `validate`, so MCP tool-call arguments would be
  validated by nothing before `execute` runs if #215 used `@ai-sdk/mcp`'s own
  tool-conversion output unmodified — exactly the landmine D3 already fixed for
  llame's first-party JSON-Schema tools.

Genuinely new scope, not named in #214 or its handoff: **pagination policy** (page cap

- duplicate-cursor guard), required because neither `@ai-sdk/mcp` nor the MCP spec
  provides it, and #214 never had a multi-page tool source to consider.

## What I could not verify

- Whether `@ai-sdk/mcp@1.0.67`'s peer-dependency versions (`@ai-sdk/provider@3.0.14`,
  `@ai-sdk/provider-utils@4.0.42`) resolve against the repo's installed
  `3.0.13`/`4.0.34` without a bump — read the version numbers, did not run `pnpm add`.
- Whether the looser `outputSchema` zod shape actually avoids opencode's
  malformed-schema discovery crash — inferred from reading the schema definition, not
  from reproducing the failure against a fixture server.
- Live behavior against a real Streamable HTTP server for session-id echoing,
  404-triggered reinitialization, and redirect handling — read from source and the
  spec text, not exercised against a running server.
- Whether a later patch on the `1.0.x`/`ai-v6` line (published after 2026-08-07)
  changes any of the above — re-check the installed version before implementation if
  meaningful time has passed.
- opencode's OAuth flow (`auth.ts`, `oauth-provider.ts`, `oauth-callback.ts`,
  `browser.ts`) and open-webui's OAuth-token-storage path were not read in depth —
  out of scope per design.md's OAuth deferral.
- openclaw's transport-layer code was not re-read; its already-cited findings
  (quarantine-health, redaction-on-persist) are structural/persistence patterns, not
  transport-specific.
