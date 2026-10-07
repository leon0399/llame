## Why

llame sends no conversation-correlation header a gateway can read. LiteLLM,
which an operator can place in front of any provider entry, resolves a session
from a bare `X-Session-Id` request header to keep a conversation on one
deployment for prompt-cache affinity and to group spend and traces by
conversation ([LiteLLM PR #39802](https://github.com/BerriAI/litellm/pull/39802),
[request headers](https://docs.litellm.ai/docs/proxy/request_headers)). Today
every turn of a Chat reaches such a gateway as an unrelated request.

The transport-neutral Chat identity this needs already exists: #809 added the
required `chat: { id, lane }` field to both model-client inputs and supplies it
from the main turn, both compaction paths, and title generation
(`apps/api/src/models/model-client.ts`). Only the `opencode-go` client renders
it. What is missing is an operator surface that decides, per provider entry,
which headers a request carries. This change implements issue #881.

## What Changes

- Add an optional `headers` map to every `providers[]` entry. Keys are header
  names; values are a string or `null`. A string value is a template: boot-time
  `{env:…}` / `{path:…}` interpolation as everywhere else, plus a request-time
  `{session:id}` variable. `null` removes a header the provider type sends by
  default.
- Give each provider type a default header map, laid under the operator's map
  key by key (header names compared case-insensitively):
  - `openai-responses`, `openai-completions`, `anthropic-messages`, and
    `opencode-go`: `{ "X-Session-Id": "{session:id}" }`.
  - `openai-codex`: no default headers. Sending the header to the Codex
    backend is an explicit operator opt-in.
- Render `{session:id}` from the request's Chat identity: the Chat's id on the
  `main` lane (the main turn and compaction) and `title:<chatId>` on the
  `title` lane, the rendering the `opencode-go` session header already uses.
  The variable is not a secret.
- Send the rendered headers on every language-model request a client makes,
  streaming and structured alike, so auxiliary calls carry them too.
- Apply the operator's string values last, so one replaces any header the
  client or adapter would otherwise send, `User-Agent` included. No header name
  is reserved; an operator who overrides a credential, protocol, or identity
  header owns the result.
- Treat a header value that uses `{env:…}` or `{path:…}` as a secret with the
  provider `key`'s protection: startup errors name the path, never the value,
  and a resolved value containing CR, LF, or NUL fails startup.
- Observable change for existing configurations: every request from an
  `openai-responses`, `openai-completions`, `anthropic-messages`, or
  `opencode-go` entry now carries `X-Session-Id` unless the entry removes it.
  No configuration becomes invalid. `openai-codex` requests are unchanged
  unless the operator opts in.

## Assumptions, confirmed with Leo (2026-10-07)

- The generic header is on by default for the four types above and opt-in for
  `openai-codex`; Leo runs LiteLLM in front of llame in some deployments.
- A header map with template variables replaces a single on/off flag, so a
  later custom header is configuration rather than a schema change. This
  supersedes #809 design decision D15, which rejected a configurable header
  name as a generic gateway type in disguise: an operator-owned map changes no
  provider type's wire or destination.
- `null` removes a default (the `providerOptions` and `toolPromptFiles`
  convention), not `false`.
- The variable is named `{session:id}` because on the title lane it renders
  `title:<chatId>`, not the Chat's id. Title generation keeps its own lane until
  #1096 redesigns it.
- The Chat's own identifier is sent verbatim (#809 settled this; reconfirmed).
- No header name is reserved, `User-Agent` included. An operator override is
  the operator's decision under that provider's terms; llame's own default
  identity stays `llame/<version>` and claims no other product.
- `x-session-affinity` is not a default anywhere: no surveyed gateway reads it
  independently.
- The OpenCode Go gateway does not read `X-Session-Id` and forwards non-OpenCode
  headers to the upstream model vendor; OpenCode's shipped v2 client already
  sends it to Go, so llame's requests match first-party traffic (design.md D3).

## Capabilities

### New Capabilities

- `provider-request-headers`: the operator header map on provider entries,
  per-type defaults and their merge, operator precedence over the client's own
  headers, the request-time session variable and its rendering per lane, secret
  handling of interpolated values, and the guarantee that every language-model
  request carries the rendered headers.

### Modified Capabilities

- `instance-config`: requirement "Provider list configuration" adds the
  optional `headers` key to every variant's shape and stops rejecting headers
  on the Codex variant. The "Missing or invalid Codex configuration" scenario
  keeps its heading; its body stops listing a header field as forbidden.
- `provider-api-selection`: requirement "Every provider request identifies
  llame" keeps llame's identity as the default but lets an operator `headers`
  value replace it. Requirement "Language-model requests carry the Chat
  identity" stops saying a client ignores the identity when it has no
  consumer, because the header map makes every client a potential renderer;
  the scenario "A client with no consumer sends nothing extra" keeps its
  heading and now covers an entry whose effective header map is empty, and
  "The identity is not a credential" now says headers, plural.
- `opencode-go-provider`: requirement "Requests identify llame as the client"
  stops listing an affinity header as forbidden, because `X-Session-Id` is now
  sent by default, scopes its identity rules to llame's own values, and lets
  the operator map override the client's headers; `x-session-affinity`,
  `x-opencode-request`, and `x-opencode-project` stay unsent unless the
  operator adds them. Requirement "Every request for a Chat carries its
  session identity" gains one sentence: an operator value for the session
  header replaces it.

Deliberately unchanged:

- `subscription-access-openai-codex` "Fixed direct inference transport" and
  `opencode-go-provider` "Fixed transport for a key-only entry": they say the
  request uses the entry's credential. The new capability's precedence
  requirement states that requirements naming a client header describe its
  default, so an operator credential override needs no edit to either.
- `provider-api-selection` "Chat Completions failures reach the run as bounded
  messages": no failure message is rewritten (design.md D8).

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`headers` on
  `$defs.providerEntry`), `llame-config.ts` (raw and resolved provider
  configs), `config-loader.ts` (one header resolver shared by the five provider
  resolvers, default merge, template parsing).
- `apps/api/src/models/model-client-factory.ts` (pass the resolved header map
  into each client), `openai-model-client.ts` (Responses, also the Codex
  wrapper), `openai-completions-model-client.ts` (the existing session-header
  hook generalizes to the rendered map), `anthropic-model-client.ts`,
  `opencode-go-model-client.ts`, `openai-codex-model-client.ts`.
- Tests that pin the old behavior:
  `apps/api/src/models/opencode-go-model-client.test.ts` asserts `x-session-id`
  is absent; `config-loader.test.ts` cases that assert a Codex or Go entry
  rejects unknown fields.
- `apps/api/llame.config.jsonc.example`, `README.md` provider section,
  `docs/product/operator/providers/litellm-gateway.md`, `opencode-go.md`,
  `codex-subscription.md`, and `CHANGELOG.md`.
- No database migration, no new dependency, no model-client input change, no
  call-site change.

## Non-Goals

- `x-parent-session-id` and a `{session:parentId}` variable. They arrive with
  child agents (#765), which must also decide whether a child's `X-Session-Id`
  carries its own id or its parent's, as OpenCode v2 does for cache reuse.
- Model-level header maps. Whether a header has a reader depends on the
  endpoint, which the provider entry owns.
- Codex's native correlation (`session-id` header, `prompt_cache_key`), which
  the ChatGPT backend reads for cache affinity. That is a separate issue.
- Retiring the `title` lane (#1096).
- Refreshing the stale header sections of the OpenCode, OMP, Kilo, and pi
  research notes; that is a separate docs change outside this stack.
- Headers on embedding requests.

## Acceptance

- An `openai-responses`, `openai-completions`, `anthropic-messages`, or
  `opencode-go` entry with no `headers` key sends `X-Session-Id` carrying the
  Chat's id on the main turn and on compaction, and `title:<chatId>` on title
  generation; a test proves it for an auxiliary call at the serialized
  request.
- The value is identical across turns of one Chat and differs between Chats.
- `"X-Session-Id": null` on such an entry removes the header; an
  `openai-codex` entry sends it only when its map adds it.
- No request carries `x-session-affinity` unless an operator map adds it.
- Two names in one map that collide case-insensitively, or an unknown
  `{scheme:…}` token, fail startup naming the path, never a resolved value.
- An operator `User-Agent` value replaces llame's on every request of that
  entry.
- A header value resolved from `{env:…}` or `{path:…}` appears in no startup
  error or llame log line, and a CR, LF, or NUL in one fails startup.
