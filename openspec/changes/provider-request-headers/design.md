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
- Model-level headers, embedding-request headers, and any override of a
  reserved header.

## Prior art

Source inspection, 2026-10-07; nothing was run.

| Harness                                                                               | Generic session header policy                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OMP (`can1357/oh-my-pi` `355b5d9`)                                                    | Per-provider, data-declared names: Codex `session_id`/`session-id`, xAI `x-grok-conv-id`, OpenCode `x-opencode-session`, Anthropic `X-Claude-Code-Session-Id`, OpenRouter body `session_id`. No generic `X-Session-Id`; OMP #6122 asks for an opt-in one. Title calls use a derived per-Chat id after a same-session 400 (#10619). |
| pi-mono (`27c7b6f`)                                                                   | Native Codex headers; nothing on Anthropic OAuth, deliberately.                                                                                                                                                                                                                                                                    |
| OpenCode v1 (`dev` `ecc4916`, `packages/opencode/src/session/llm/request.ts:188-203`) | `X-Session-Id` + `x-session-affinity` to every non-OpenCode provider; `x-opencode-*` to OpenCode providers.                                                                                                                                                                                                                        |
| OpenCode v2 (`v2` `119cb15`, `packages/core/src/session/model-request.ts:266-274`)    | `X-Session-Id`, `x-session-affinity`, and `x-opencode-*` to every provider, Go included; the value is the parent's id for children and forks.                                                                                                                                                                                      |
| Kilo (`6f5e9ca`)                                                                      | As OpenCode v1, including provider `anthropic`.                                                                                                                                                                                                                                                                                    |
| goose, OpenClaw, Hermes                                                               | One configurable or endpoint-gated session header; Hermes adds arbitrary affinity headers per custom provider as opt-in.                                                                                                                                                                                                           |
| LiteLLM                                                                               | Reads inbound `X-Session-Id` for its own affinity and spend logs (PR #39802); strips client headers upstream unless forwarding is enabled.                                                                                                                                                                                         |
| Claude Code                                                                           | Sends `x-claude-code-session-id`; disables its gateway-hint headers on custom base URLs because proxies may reject unknown headers ([gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol#gateway-hint-headers)).                                                                                                |

## Decisions

### D1: An operator header map on the provider entry

`providers[].headers` is an object from header name to `string | null`,
accepted on every provider type. The provider entry owns it because whether a
header has a reader depends on the endpoint, not the model.

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
replaces the default value and its casing; `null` removes the header; a
`null` for a name with no default is accepted and removes nothing. Defaults:
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
traffic. `x-opencode-session` stays code-owned and reserved: the gateway keys
sticky routing on it.

### D4: `{session:id}` is the lane-rendered Chat identity

`{session:id}` renders the request's `chat` exactly as the `opencode-go`
session header does: the Chat's id on `main`, `title:<chatId>` on `title`. One
exported function renders both, and the Go client's private
`renderSessionValue` moves to it. The variable is not a secret (#809, and
reconfirmed). When #1096 retires the `title` lane, the variable becomes the
Chat's id everywhere without a configuration change.

Rejected:

- **`{chat:id}`.** It misnames the title-lane value.
- **The raw id on every lane.** Leo chose to keep `title:<chatId>` until #1096.

### D5: Header values are parsed into segments at startup

Each string value is scanned once, at startup, into segments:

- `{{` is a literal `{`.
- `{session:id}` is the request-time variable.
- `{env:…}` and `{path:…}` are resolved with the existing interpolation
  functions and recorded as secret segments.
- Any other `{name:…}` token fails startup naming the path. Interpolation
  elsewhere copies unknown tokens literally; a header value fails closed
  because a typo such as `{sesion:id}` would otherwise be sent verbatim.
- Everything else is literal text.

A resolved secret is never rescanned, so an environment value that contains
`{session:id}` is sent as that literal text. Rendering a request concatenates
the segments. A value that renders empty is not sent, so `{env:NAME:-}` with
`NAME` unset omits the header, matching the "empty resolution means unset"
rule. Startup also rejects a header name that is not an HTTP token and a
resolved value containing CR, LF, or NUL, naming the path only.

Rejected:

- **Interpolating the whole value first, then substituting the variable.**
  It cannot tell an escaped `{{session:id}` from the variable, and it lets a
  resolved secret inject a variable.

### D6: Reserved header names per type

Startup fails, naming the path, when the merged-in operator map names a
reserved header (ASCII case-insensitive):

| Type                 | Reserved                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| every type           | `authorization`, `content-type`, `content-length`, `host`, `user-agent` |
| `anthropic-messages` | `x-api-key`, `anthropic-version`, `anthropic-beta`                      |
| `openai-codex`       | `chatgpt-account-id`, `originator`, `openai-beta`, `accept`             |
| `opencode-go`        | `x-opencode-session`, `x-opencode-client`                               |

`null` on a reserved name fails too: removal is also an override. Two names in
one map that collide under case-folding fail, as for MCP. `anthropic-beta` is
reserved because the client composes betas from `providerOptions`; a raw
header would bypass that. `user-agent` is reserved by
`provider-api-selection`'s identity requirement and stays so until a separate
issue decides otherwise.

Rejected:

- **No reserved list, last writer wins.** A misconfigured map could drop the
  credential or claim another product's identity.

### D7: Clients render once per request and send per call

The factory passes each client its resolved segment map. Each client renders
it from `chat` on every streaming and structured request and puts the result
in the per-call `headers` beside `user-agent`, the place the session hook
already uses. The Completions client's `sessionHeader` hook is replaced by
that rendered map: Go's `x-opencode-session` becomes a fixed code-owned
template in the Go client, and the operator map renders beside it. The Codex
client passes the map through to the Responses client it wraps. Per call, not
at provider construction, because the variable changes per request.

### D8: Interpolated values are secrets and are redacted from failures

Every resolved `{env:}` / `{path:}` segment value joins a frozen
protected-values list on the resolved provider config. Startup diagnostics
name the path, never the value. Each client applies `redactProtectedString`
from `@workspace/runtime-safety` to the failure message it reports to the run,
the one place an upstream echo of a request header could reach the owner. The
Messages and Codex clients already replace failures with bounded messages, so
the redaction there is defensive; the Completions and Responses paths pass
upstream messages through and need it. A header value with no interpolation is
not secret: the operator wrote it in the file.

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
