## Context

Inspected at `master` `e90b4aa` (2026-10-07). See proposal.md for motivation.

- Both model-client inputs carry a required `chat: ChatIdentity = { id, lane }`
  (`apps/api/src/models/model-client.ts`). The main turn
  (`runs/run-execution.service.ts:1619-1624`), the shared compaction
  summarizer (`compaction/compaction.service.ts:354-389`), and both title paths
  (`titles/title.service.ts:117,136`) supply it. Every production
  language-model call is Chat-bound; the recency digest makes no model call.
- Only `opencode-go` renders the identity, through the Chat Completions
  client's optional `sessionHeader` hook
  (`openai-completions-model-client.ts:184-194`) and its own
  `renderSessionValue` (`opencode-go-model-client.ts:70-72`: the id on `main`,
  `title:<id>` on `title`).
- Per-call headers today: Responses and Messages set `user-agent` per call
  (`openai-model-client.ts:530,753-755`; `anthropic-model-client.ts:372,452`);
  Completions sets `user-agent` plus the hook's output. Construction-time
  headers: Codex `ChatGPT-Account-ID`, `Accept`, `OpenAI-Beta`, `Originator`
  (`openai-codex-model-client.ts:94-99`); Go `x-opencode-client`
  (`opencode-go-model-client.ts:105`). The Messages adapter generates
  `x-api-key`, `anthropic-version`, and `anthropic-beta` itself.
- Config interpolation is per field, single pass
  (`packages/config-interpolation/src/interpolation.ts:72-105`). An unknown
  `{foo:bar}` token is copied literally and `{{` yields a literal `{`, so a
  literal `{session:id}` already survives boot unchanged.
- MCP remote `headers` are the precedent for an operator header map: ASCII
  case-folded collision checks and a transport-owned name list
  (`config-loader.ts:1242-1250,1399-1421`), interpolation with substitution
  tracking (`resolvePrivateMcpValue`, `:1324-1337`), and output redaction
  through `@workspace/runtime-safety` (`redactProtectedString`,
  `sanitizeProtectedValueJson`).
- Provider resolution: five per-type resolvers in `config-loader.ts:1477-1637`,
  raw and resolved unions in `llame-config.ts:40-107,205-241`, published
  schema `llame.config.schema.json` `$defs.providerEntry`. Per-type defaults
  already exist for `billing` (`model-catalog.ts:264-277`).
- Provider failure paths: the Messages client replaces provider failures with
  bounded messages (`anthropic-model-client.ts:315-325`), the Codex client maps
  every failure (`openai-codex-model-client.ts:69-75`), and the Completions and
  Responses clients pass an upstream error message through. None redacts a
  request header value today.

## Goals / Non-Goals

**Goals:**

- One operator-owned header map per provider entry, with per-type defaults,
  resolved and validated entirely at startup.
- One request-time variable, `{session:id}`, rendered from `chat` by one
  function shared with the `opencode-go` session header.
- Every language-model request a client issues carries the rendered map.

**Non-Goals:**

- A general template language. One variable today; #765 adds
  `{session:parentId}` under the same rules.
- Model-level headers, embedding-request headers, and stripping headers the
  client or adapter sets.

## Prior art

Source inspection, 2026-10-07; nothing was run.

| Harness                                                                               | Generic session header policy                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OMP (`can1357/oh-my-pi` `355b5d9`)                                                    | Per-provider, data-declared names: Codex `session_id`/`session-id`, xAI `x-grok-conv-id`, OpenCode `x-opencode-session`, Anthropic `X-Claude-Code-Session-Id`, OpenRouter body `session_id`. No generic `X-Session-Id`; OMP #6122 asks for an opt-in one. Title calls use a derived per-Chat id after a same-session 400 (#10619). |
| OpenCode v1 (`dev` `ecc4916`, `packages/opencode/src/session/llm/request.ts:188-203`) | `X-Session-Id` + `x-session-affinity` to every non-OpenCode provider; `x-opencode-*` to OpenCode providers.                                                                                                                                                                                                                        |
| OpenCode v2 (`v2` `119cb15`, `packages/core/src/session/model-request.ts:266-274`)    | `X-Session-Id`, `x-session-affinity`, and `x-opencode-*` to every provider, Go included; the value is the parent's id for child sessions and the fork source's id for forks.                                                                                                                                                       |
| LiteLLM                                                                               | Reads inbound `X-Session-Id` for its own affinity and spend logs (PR #39802); strips client headers upstream unless forwarding is enabled.                                                                                                                                                                                         |
| Claude Code                                                                           | Sends `x-claude-code-session-id`; disables its gateway-hint headers on custom base URLs because proxies may reject unknown headers ([gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol#gateway-hint-headers)).                                                                                                |

## Decisions

### D1: An operator header map on the provider entry

`providers[].headers` is an object from header name to `string | null`,
accepted on every provider type. The provider entry owns it because whether a
header has a reader depends on the endpoint, not the model.

At startup, each name is checked with Node's own `Headers` acceptance rule; no
second header-name grammar is maintained. The resolved map uses a null
prototype, like MCP headers in `config-loader.ts`'s `resolveMcpHeaders`, so a
`__proto__` key remains an own property.

Rejected:

- **A boolean `sessionHeaders` flag.** One header per key: the next header
  needs a schema change, and the key name over- or under-describes it.
- **A model-level map.** Two entries pointing at the same endpoint would
  disagree, and no current case needs it.
- **A per-type configurable header name** (#809 D15's rejected option). The
  map supersedes D15: it changes no provider type's wire or destination, so it
  is not a generic gateway type in disguise.

### D2: Per-type defaults merged under the operator map

The resolved map is the type's default map with the operator's map laid over
it, key by key, comparing names by ASCII case-folding. An operator string
replaces the default value and its casing; `null` removes a default-map header;
a `null` for a name with no default is accepted and removes nothing. Two keys in
one operator map that collide under case-folding fail startup, because the
overlay would otherwise depend on key order. Defaults:
`{ "X-Session-Id": "{session:id}" }` for `openai-responses`,
`openai-completions`, `anthropic-messages`, and `opencode-go`; `{}` for
`openai-codex`.

The merge is a flat case-folded overlay, not `provider-options.ts`'s deep
merge: header maps are one level, and that merge compares keys exactly.

Rejected:

- **Default off everywhere.** Leo's decision: the deployments with LiteLLM in
  front should not need configuration. The cost is recorded under Risks.
- **Opt-in for `opencode-go`.** The spike (D3) found OpenCode's shipped client
  already sends the header there.

### D3: `opencode-go` sends `X-Session-Id` by default

The gateway handler at OpenCode `dev` `ecc4916`
(`packages/console/app/src/routes/zen/util/handler.ts`) reads only
`x-opencode-session` (lines 125, 172, 329), copies every client header into
the upstream request (line 234), and deletes only the `x-opencode-*` and
`x-zen-*` headers before forwarding to a third-party upstream (lines
261-268). So `X-Session-Id` reaches the upstream vendor unread by Go. OpenCode's
shipped v2 client sends it on every Go request (prior-art table), so the
vendors behind Go already receive it and llame's request matches first-party
traffic. llame always sends `x-opencode-session` itself; the gateway keys
sticky routing on it.

### D4: `{session:id}` is the lane-rendered Chat identity

`{session:id}` renders the request's `chat` exactly as the `opencode-go`
session header does: the Chat's id on `main`, `title:<chatId>` on `title`. One
exported function renders both, and the Go client's private
`renderSessionValue` moves to it. The variable is not a secret (#809, and
reconfirmed). When #1096 retires the `title` lane, the variable becomes the
Chat's id everywhere without a configuration change.

LiteLLM only accepts session ids of at least eight characters consisting of
alphanumerics, hyphens, or underscores, so it discards `title:<chatId>` and
does not group title requests. That is the accepted trade until issue #1096
retires the title lane.

Rejected:

- **`{chat:id}`.** It misnames the title-lane value.
- **The raw id on every lane.** Leo chose to keep `title:<chatId>` until #1096.

### D5: Existing interpolation at startup, single-pass parts per request

Each string value is checked on raw authored text for unknown `{name:…}` tokens,
then split at authored `{session:id}` tokens; an escaped `{{session:id}` is not
a token or a split point. Each literal part independently goes through
`interpolateStringWithSubstitutions`
(`packages/config-interpolation/src/interpolation.ts:76`) once at startup. The
resolved value is stored as the ordered list of literal parts and session
slots. Per request, the parts are joined with the rendered identity. Text
produced by `{env:…}` or `{path:…}` is therefore never rescanned for
`{session:id}`, and `{{session:id}` yields a literal `{session:id}`. A value
that renders empty sends no operator or default value for that header, so
`{env:NAME:-}` with `NAME` unset works as a switch.

Rejected:

- **A segment parser that tracks literal, secret, and variable parts.** The
  split-into-parts form is the minimum needed to preserve the existing
  single-pass interpolation rule while supporting one request-time variable
  (round-1 review).

### D6: Operator values win; nothing is reserved

The rendered operator map is applied last on every request, so a string value
replaces any header the client would send under that name: `user-agent`, Go's
`x-opencode-session` and `x-opencode-client`, Codex's `originator`, a
credential header. Requirements elsewhere that name those headers describe the
default. `null` and an empty render withdraw only the operator or default
value; they never strip a header the client sets itself.
Two adapter limits remain: the adapter may append its own token to an operator
`User-Agent`, as it does to llame's, and
`@ai-sdk/anthropic@3.0.118` uses the exact-key lookup in
`getBetasFromHeaders`: it merges an operator `anthropic-beta` with its own
betas only when the key is spelled exactly lowercase `anthropic-beta`; another
casing is replaced by the adapter's own value (`dist/index.mjs:3992-3996`).

Rejected:

- **Per-type reserved lists.** They cost a list per type kept in sync with
  each adapter's internals, to stop an operator from changing a request the
  operator already controls through `key` and `baseUrl`. Leo's decision:
  YAGNI.

### D7: Clients overlay the rendered map on their per-call headers

The factory passes each client its resolved map. Each client renders it from
`chat` on every streaming and structured request and overlays it on the
per-call headers it already builds (`user-agent`, and Go's session header from
the existing `sessionHeader` hook), deleting any case-folded match first so
one value per name is sent. Per-call headers override construction headers in
the installed adapters (`combineHeaders`, then `normalizeHeaders`, last write
wins), which the implementation layer's tests prove per client. The Go client's
`renderSessionValue` moves to one shared export that `{session:id}` also uses.
The Codex client passes the map through to the Responses client it wraps.

### D8: Interpolated values get the provider key's non-disclosure

An interpolated header value is as secret as `key`, and gets the same
treatment: startup errors name the path, never the value, and llame logs no
request headers. No client redacts `key` from a provider's echoed error today
(`@workspace/runtime-safety` is imported there only for type guards), so
header values get no runtime redaction either; a provider that echoes a header
in its error is outside the guarantee for both. One leak is llame's own: Node's
`Headers` rejects a value containing CR or LF with a `TypeError` that quotes
it, which would reach the run's failure message. So a resolved value containing
CR, LF, or NUL fails startup naming the path.

Rejected:

- **Redacting echoed values in every client's failure paths.** Round-1 review
  found it needs every rejection, `onError`, structured, and logging path in
  four clients, plus a change to the Chat Completions failure contract, to
  protect against a case `key` is not protected against.

### D9: `opencode-go` stays a provider type

The map removes #809 D1's first reason for the type (the session header could
not come from configuration), but an `openai-completions` entry with
`"x-opencode-session": "{session:id}"` still cannot replace it: it requests
`stream_options.include_usage`, which Go answers with a stream that fails the
run (`opencode-go-model-client.ts:107-111`), and it follows redirects, reports
the wrong provider identity, loads keyless, and lets `baseUrl` move a Go key.
The runbook warns against that configuration.

## Risks / Trade-offs

- [A strict proxy behind `anthropic-messages`, `openai-responses`, or
  `openai-completions` rejects the unknown header with a 400] -> The run fails
  with the provider's message; the operator runbook names
  `"X-Session-Id": null` as the fix. Claude Code's own behavior shows such
  proxies exist.
- [Default-on sends the Chat's id to OpenAI and Anthropic, which read nothing
  from it] -> Accepted: the id is an opaque UUID, not a secret, and the request
  body already carries the conversation.
- [Through Go, the id reaches the upstream vendor] -> Accepted: OpenCode's own
  v2 client does the same (D3).
- [An operator writes a credential as a literal header value] -> It is not
  marked secret because nothing distinguishes it from any other literal; the
  docs say to use `{env:}` or `{path:}` for credentials, as for MCP headers.
- [An operator override claims another product's client identity, or breaks
  authentication] -> The operator's decision under that provider's terms;
  llame's defaults never do either. The runbooks say so.
- [A future Claude subscription type (#754) inherits a default] -> #754 is an
  executor path, not a `ModelClient` type, so no map reaches it. A
  subscription type added later declares its own default, and `{}` is the
  precedent `openai-codex` sets.

## Migration Plan

Additive configuration; no database change. Deploying adds `X-Session-Id` to
requests from the four default-on types. Rollback is the previous release, or
`"X-Session-Id": null` per entry without a rollback.

## Open Questions

None that change the specs or tasks.
