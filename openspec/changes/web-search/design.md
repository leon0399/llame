## Context

See proposal.md for motivation. Facts below were observed at `702e6ace` unless a line says
otherwise.

- Code-owned tools are a fixed registry (`apps/api/src/tools/registry.ts:19-31`). Each declares
  `{ id, description, classification, inputSchema, execute, timeoutSeconds? }`
  (`apps/api/src/tools/types.ts:142-157`). `runTool` validates the schema, evaluates
  `tools.permissions` under the Run's permission mode, and bounds execution by the per-tool
  override or the global `tools.callTimeoutSeconds`, whose built-in default is 120
  (`apps/api/src/instance-config/llame-config.ts:512-513,598`).
- Native `read` is the only code-owned tool that fetches external content for the model today (host `bash` has the process's network access). Its HTTP client is specialized to GET,
  redirect admission, locator and address permission, and text rendering
  (`apps/api/src/tools/web-read/execute.ts:20-44`, `http-client.ts:99-117`). Its operator
  adapters live under `tools.webAdapters` (`llame-config.ts:517`).
- Provider clients are dispatched by provider `type` (`apps/api/src/models/model-client-factory.ts:63-173`).
  The installed adapters export hosted search tools: `openai.tools.webSearch` in
  `@ai-sdk/openai@3.0.97` and `anthropic.tools.webSearch_20250305` and `webSearch_20260209` in
  `@ai-sdk/anthropic@3.0.118`. No llame code uses them. The Codex client streams only and has no
  structured generation (`apps/api/src/models/openai-codex-model-client.ts:14-119`).
- The `mcpServers` client speaks Streamable HTTP through `@ai-sdk/mcp`'s `createMCPClient`
  (`apps/api/src/mcp/mcp-server-client.ts:1-5`) with `redirect: 'error'` and a byte-bounded fetch
  (`mcp-server-client.ts:1041-1066`); `@modelcontextprotocol/sdk` is used only for the stdio
  transport, as `pnpm-workspace.yaml:77-81` records. `linkedom` is installed
  (`apps/api/package.json:75`).
- Every model request carries a `ChatIdentity` whose lane is `main` or `title`
  (`apps/api/src/models/model-client.ts:29`), and `{session:id}` renders per lane
  (`openspec/specs/provider-request-headers/spec.md`).
- The live stream emits tool activity as `dynamic-tool` parts, while history stores
  `tool-${toolName}` parts (`apps/api/src/runs/run-stream-bridge.ts:93-95`,
  `apps/api/src/runs/assistant-transcript.ts:337-346`); the chat dispatches both through
  `getToolName` (`apps/web/app/(chat)/components/chat-message-row.tsx:56-71`). Assistant Markdown
  links go through `linkSafety` (`packages/ui/src/components/custom/model-output-streamdown.tsx:85-93`).
- Successful tool results are capped at 16,000 characters
  (`packages/runtime-safety/src/result-truncation.ts:11-12`), framed as untrusted on replay
  (`apps/api/src/chats/tool-observation-part.ts:213-270`), and excluded from public shares.
- The chat renders every tool part through one generic component with collapsible JSON
  (`packages/ui/src/components/ai-elements/tool.tsx`); URLs in output are not links.
- Usage covers only a Run's own model requests; title generation is not recorded
  (`openspec/specs/run-usage-accounting/spec.md`, "Compaction and title spend stay separate
  categories").
- Chat search already merges candidate lists with Reciprocal Rank Fusion
  (`openspec/changes/archive/2026-07-13-chat-search-platform/design.md`).

Research behind the decisions is recorded in the session reports summarized in the prior-art
table; peer harness notes live in `docs/research/harnesses/`.

## Goals / Non-Goals

**Goals:**

- One model-visible contract whose name, schema, and result shape never depend on the engine.
- Each engine is a small adapter from that contract to one vendor wire; adding an engine touches
  the adapter, its config shape, and its docs, nothing else.
- Every outbound request is bounded in time and size, sends credentials only to its own vendor,
  and never surfaces upstream bodies.

**Non-Goals:**

- Retries, caching across calls, rate limiting, or cost accounting inside llame.
- Sharing the web-read HTTP session or its address admission.
- Rendering or fetching result pages.

## Prior art

| Harness         | Model-facing tool                         | Backends                                                                                      | Selection                                                | Fan-out                         |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| oh-my-pi        | `web_search` with query, recency, limits  | 25+ engines; grounded chat models as sub-requests from any parent model                       | `web` model role plus fallback chain                     | `public`: five keyless scrapers |
| OpenClaw        | `web_search` with locale and date filters | Plugin providers; Codex hosted search via an ephemeral app-server turn; OpenAI native in-loop | `tools.web.search.provider` or credential auto-detection | None                            |
| Hermes Agent    | `web_search(query, limit)`                | Many APIs plus Codex and xAI hosted search, independent of the main model                     | `web.search_backend`, keyless rescue rotation            | None                            |
| OpenCode / Kilo | `websearch`                               | Exa or Parallel hosted MCP, called from code by JSON-RPC                                      | Environment variable                                     | None                            |
| Codex CLI       | Provider-hosted `web_search`              | OpenAI only; custom providers need `supports_standalone_web_search`                           | `web_search = cached / live / disabled`                  | None                            |
| Claude Code     | `WebSearch` server tool                   | Anthropic API and some clouds; not Bedrock                                                    | Provider routing                                         | None                            |

Every in-loop design is gated to the Run's own provider. Every cross-vendor design is a
harness-owned sub-request. No peer fans out across arbitrary vendors.

## Decisions

### D1: One code-owned tool; engine choice is operator-only

`web_search` is registered beside `read` with a strict input schema `{ query, recency?, limit? }`:
`query` is a non-empty string, `recency` is `day | week | month | year`, `limit` is an integer
1–20 defaulting to 10. The model never names an engine.

Alternatives rejected: structured filters (`includeDomains`, `after`, `country`), which most
engines would ignore and each adapter would have to reject per field; a model-chosen `engine`
argument, which leaks operator configuration into model behavior.

### D2: Closed result union with bounded, canonical fields

```ts
type WebSearchOutput =
  | {
      kind: "results";
      engine: string;
      query: string;
      notes?: string[];
      results: {
        title: string;
        url: string;
        snippet?: string;
        published?: string;
      }[];
    }
  | {
      kind: "answer";
      engine: string;
      query: string;
      notes?: string[];
      answer: string;
      citations: { url: string; title?: string }[];
    };
```

- `engine` is the operator id of the engine that answered; for `aggregate`, the aggregate's id;
  when the chain ends empty, the last empty engine's id.
- Every `url` is WHATWG-parsed, must be `http:` or `https:` without userinfo, has its fragment
  removed (`stripFragment`) and its path and query escapes normalized (`canonicalHref`), both
  exported by `apps/api/src/tools/web-read/locator.ts:148,165`. Selector splitting
  (`parseWebLocator`) is never applied, because it refuses `Help:Contents` and rewrites
  `page:10`. A literal `:` in the last path segment of a query-free URL is emitted as `%3A`, the
  spelling `read` fetches literally. URLs over 2,048 characters are dropped.
- Lengths are JavaScript UTF-16 code units, cut at a code-point boundary, the unit the runner's
  cap measures. `title` and citation titles are capped at 200, `snippet` at 300, and `answer` at
  8,000 (cut with a note); `published` is kept only when it parses as an ISO date. Results are
  sliced to `limit` and citations to 20.
- The JSON-serialized output is kept under 15,000 units by dropping trailing results or
  citations with a note, so the runner's 16,000-unit truncation
  (`packages/runtime-safety/src/result-truncation.ts:171-172`) never cuts a URL. An 8,000-unit
  answer plus 20 bounded citations always fits, so a grounded answer never loses its last
  citation.
- `notes` record what the answering engine ignored, for example `recency is not supported by
duckduckgo`, and which earlier engines failed or were empty.
- Citations are deduplicated by URL.

Alternative rejected: OpenClaw's `raw` passthrough branch. Every engine here is code-owned, so
there is no unnormalized producer.

### D3: Top-level `webSearch` section

```jsonc
"webSearch": {
  "engines": [
    { "id": "brave", "type": "brave", "key": "{env:BRAVE_API_KEY}" },
    { "id": "exa", "type": "exa-mcp" },
    { "id": "mix", "type": "aggregate", "engines": ["brave", "exa"] },
    { "id": "claude", "type": "model-hosted", "model": "claude-haiku", "timeoutSeconds": 90 }
  ],
  "chain": ["mix", "claude"]
}
```

Entry shapes, all with optional `timeoutSeconds` (positive integer, default 60):

| `type`         | Fields                                 |
| -------------- | -------------------------------------- |
| `brave`        | `key` (required)                       |
| `exa`          | `key` (required)                       |
| `exa-mcp`      | `key` (optional)                       |
| `perplexity`   | `key` (required)                       |
| `searxng`      | `baseUrl` (required, absolute http(s)) |
| `duckduckgo`   | none                                   |
| `aggregate`    | `engines` (two or more distinct ids)   |
| `model-hosted` | `model` (a `models[].id`), `effort`?   |

`key` and `baseUrl` use the existing interpolation and are protected as secrets when
interpolated. Validation at startup: unique ids; every `chain` and `aggregate.engines` id exists;
`aggregate` children are `brave`, `exa`, `exa-mcp`, `perplexity`, `searxng`, or `duckduckgo` (no
nested aggregates, no `model-hosted`); `model-hosted.model` names a model whose provider type is
`openai-responses`, `openai-codex`, or `anthropic-messages`, and its `effort`, when set, is one of
that model's effort levels; a `chain` is non-empty and has no duplicates. `web_search` in `tools.allowed` without `webSearch.chain` fails startup naming
`webSearch.chain`.

Each engine type's schema branch, loader shape, and validation land in the layer that ships its
executor, so no layer accepts a type it cannot run.

Alternatives rejected: `tools.webSearch`, which has the `tools.webAdapters` precedent but would
put vendor credentials in the tool-policy section; engines as `models[]` entries (oh-my-pi), which
makes every model validator and the model picker learn entries without a context window;
credential auto-detection (OpenClaw), which lets adding an environment variable silently reorder
engines.

### D4: The chain advances on failure and on emptiness

For each chain entry in order, the executor runs the engine under its own deadline and the call's
abort signal. An engine outcome is one of `results` (at least one result), `answer` (non-empty
answer with at least one citation), `empty`, or a failure class:

| Class            | Cause                                                        |
| ---------------- | ------------------------------------------------------------ |
| `auth`           | HTTP 401 or 403 (SearXNG 403 is `upstream_error`, see D6)    |
| `rate_limited`   | HTTP 429, or an MCP rate-limit error                         |
| `challenge`      | A recognized bot-challenge page (DuckDuckGo `anomaly-modal`) |
| `timeout`        | The engine deadline elapsed                                  |
| `ungrounded`     | A hosted answer that is empty or cites no URL                |
| `upstream_error` | Any other transport, status, protocol, or parse failure      |

The first `results` or `answer` ends the call, with notes naming each earlier engine that failed
(and its class) or was empty. When the chain is exhausted, the call returns an empty `results`
output carrying the last empty engine's id if any engine was `empty`, with the same notes;
otherwise it returns a tool error naming each attempted engine id and class. Messages are fixed
text: no status line, body, header, key, or configured URL.

Q14 chose fall-through on empty over stopping: recall wins over the cost of asking later engines.
No retries inside an engine (CODING_STANDARDS: no retries without present need); the chain is the
retry.

### D5: `aggregate` runs every child and merges with RRF

The aggregate starts all children concurrently, each under its own deadline and the call signal,
and waits until all settle or the call is aborted. Each child receives the call's `limit`. The
merge:

- groups results by canonical URL (D2) after removing a leading `www.` from the host and a
  trailing `/` from the path, keeping the query string;
- scores each URL by Reciprocal Rank Fusion, `Σ 1 / (60 + rank)` over the children that returned
  it, with 1-based rank, ties broken by best single rank then child order;
- emits each group with the URL of its best-ranked member (ties by child order); the stripped
  form is only a grouping key, because `www.` and a trailing `/` can address different resources;
- keeps the longest snippet and the first non-empty title and date seen in child order;
- slices to `limit`.

The aggregate's outcome is `results` when any child returned results, `empty` when no child
returned results and at least one was empty, and `upstream_error` when every child failed. Notes
name failed children.

Alternative rejected: oh-my-pi's 5 s soft deadline (Q18). The latency bound is the slowest child
under its own `timeoutSeconds`, and the call deadline above it.

### D6: Engine adapters

All requests carry the product User-Agent, reject redirects, and read at most 5 MiB.

| Engine       | Request                                                                                             | `recency`                                    | `limit`       | `site:` / `-site:`                                       |
| ------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | -------------------------------------------------------- |
| `brave`      | `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`                        | `freshness=pd/pw/pm/py`                      | `count`       | left in query                                            |
| `exa`        | `POST https://api.exa.ai/search`, `x-api-key`                                                       | `startPublishedDate` from the current date   | `numResults`  | `includeDomains` / `excludeDomains`, removed from query  |
| `exa-mcp`    | MCP `tools/call` `web_search_exa` at `https://mcp.exa.ai/mcp`; `x-api-key` when a key is configured | note: ignored                                | `numResults`  | left in query                                            |
| `perplexity` | `POST https://api.perplexity.ai/search`, bearer                                                     | `search_recency_filter`                      | `max_results` | `search_domain_filter` (one mode, at most 20), see below |
| `searxng`    | `GET <baseUrl>/search?format=json`                                                                  | `time_range` (`week` sent as `month`, noted) | local slice   | left in query                                            |
| `duckduckgo` | `POST https://html.duckduckgo.com/html/` form `q`, parsed with `linkedom`; redirect URLs unwrapped  | `df=d/w/m/y`                                 | local slice   | left in query                                            |

`exa-mcp` sends `query`, `numResults`, and `objective` (the query text): the deployed
`web_search_exa` schema marks `objective` required even though the public source and today's
server do not enforce it. It parses the tool's text content block by block (`Title:`/`URL:`
blocks separated by `---`) and skips a block without a `URL:` line rather than failing the
response, because highlights are page text that can contain the separator. Exa's success text
`No search results found` is `empty`. An `isError` result is classified by the status its text carries (401/403
`auth`, 429 or Exa's free-limit message `rate_limited`, otherwise `upstream_error`), and an HTTP
429 from the transport is `rate_limited`. Other unparsable output is `upstream_error`.

Perplexity's domain filter is either an allowlist or a denylist, never both, with at most 20
domains: when any `site:` is present only `site:` hosts are mapped and `-site:` stays in the
query; otherwise `-site:` hosts are mapped; hosts beyond 20 stay in the query; a note records
what stayed. `after:` and `before:` stay in the query text for every engine.

SearXNG answers 403 when its instance does not enable the JSON format (`search.formats`), so a
SearXNG 403 is `upstream_error`, not `auth`, and the runbook requires `search.formats: [html,
json]`. DuckDuckGo's challenge page is detected by its `anomaly-modal` marker. Response fields an
adapter does not map are discarded before normalization.

### D7: MCP engines use llame's existing MCP client

`exa-mcp` creates one `@ai-sdk/mcp` client over its `http` transport per engine per process on
first use, with `redirect: 'error'` and a byte-bounded fetch built like the `mcpServers` client's,
performs the initialize handshake, and reuses the connection. A transport error discards the
connection; the next call reconnects. No `mcpServers` discovery, catalog, or availability
machinery is involved, and the remote tool is never shown to the model.

Q11 chose "the MCP SDK client" on the premise, stated in the design session, that `mcpServers`
used it. It does not: the repository's HTTP MCP client is `@ai-sdk/mcp`, and the workspace
catalog reserves `@modelcontextprotocol/sdk` for stdio. Using `@ai-sdk/mcp` keeps Q11's intent
(reuse the protocol client the repository already trusts) and its redirect and size bounds.

Alternatives rejected: raw JSON-RPC `tools/call` without initialize (OpenCode, Kilo, oh-my-pi),
which breaks if the endpoint starts requiring the handshake or answers with an event stream; the
`@modelcontextprotocol/sdk` HTTP `Client`, which would be a second HTTP MCP stack without the
existing bounds.

### D8: Model-hosted engines are bounded sub-requests

A `model-hosted` engine builds the referenced model's client as a Run would (provider
credentials, base URL, configured headers, `providerOptions` composition) and issues one request
on a new `search` session lane, so `{session:id}` renders `search:<chatId>` rather than the main
lane's Chat id. Effort is the engine's optional `effort`, validated at startup against the referenced model's
effort levels, else that model's `defaultEffort` when it declares `reasoning`, else none. The
Run's effort belongs to a different model and is never inherited. The override exists because
OpenAI web search rejects `gpt-5` at `minimal` effort, a plausible chat default:

- system text from a packaged template instructing the model to search, answer concisely, and cite
  sources; user text is the query, plus a recency phrase when `recency` is set. No chat history,
  system prompt, Knowledge, or other Run context is sent.
- OpenAI Responses and Codex: `openai.tools.webSearch()` with tool choice required. Codex streams
  over its fixed endpoint, as its client already does.
- Anthropic Messages: `anthropic.tools.webSearch_20250305({ maxUses: 5 })`. `20260209` is not used:
  without `allowed_callers: ["direct"]` it returns HTTP 400 and otherwise provisions code
  execution.
- The answer is the final text; citations are the URLs that text cites: OpenAI `url_citation`
  annotations, Anthropic `web_search_result_location` citations. Retrieved but uncited results
  are not citations (the Anthropic adapter emits a `source` part for every retrieved result).
  Empty final text, including a paused turn, or text citing no URL is `ungrounded`.
- `site:` hosts map to OpenAI `filters.allowedDomains` and Anthropic `allowedDomains`.
- Request usage is discarded (Q16); billing is the provider's.

Alternative rejected: attaching hosted search to the Run's own request. It skips `runTool` and
`tools.permissions`, and Anthropic's encrypted result blocks must be replayed verbatim to the same
provider, so a model switch or compaction produces unreplayable history. It remains a possible
separate proposal.

### D9: Deadlines reuse the tool call timeout

Each engine attempt has `timeoutSeconds` (default 60). The tool declares no per-tool timeout, so
`tools.callTimeoutSeconds` (default 120) bounds the whole call, including every chain step and
aggregate child. When the call deadline fires, in-flight engines are aborted and the runner's
existing timeout observation is returned.

Alternative rejected: a separate `webSearch.callTimeoutSeconds`. It would duplicate a bound the
runner already enforces, and a value above `tools.callTimeoutSeconds` could never take effect.

### D10: Egress and credentials

Destinations are fixed vendor hosts, the operator's `searxng.baseUrl`, and hosted-search
endpoints already configured in `providers[]`. These are operator-trusted like provider base URLs,
so no address admission applies; the `read` group is not consulted, because no model-supplied URL
is fetched. A key is sent only in that engine's header to that engine's host. Redirects are
refused so a key cannot follow one. Interpolated keys and base URLs are secrets under
`instance-config`.

### D11: Permissions and classification

`web_search` is `read_only`, needs its exact `tools.allowed` entry, and is authorized by an exact
`tools.permissions.web_search` group whose clauses may select `query` or `recency`. Bypass mode
behaves as for every tool. The permission decision precedes any outbound request.

Alternative rejected: `external_send` (Q17). The query leaves the instance exactly as a `read` URL
does; the classifications should not claim a difference that does not exist.

### D12: Storage

The tool part stores the normalized output of D2 and nothing else: no raw vendor payload, no
request metadata. Replay, compaction, and neutralization treat it as any tool result.

### D13: Dedicated chat renderer

`apps/web` dispatches every tool part for which `isToolUIPart(part) && getToolName(part) ===
"web_search"`, covering the live `dynamic-tool` part and the stored `tool-web_search` part, to a
renderer built on the shared tool component:

- `results`: a numbered list of title links with host, date, and snippet;
- `answer`: the answer as Markdown followed by numbered citation links;
- the engine id and notes; a `searching` state while running; a cancelled state when the part
  carries llame's cancellation marker, as the generic tool view shows today
  (`apps/web/app/(chat)/components/chat-message-row.tsx:59-62`); the error text on failure.

Links render only for `http:`/`https:` URLs, and every result and citation link is rendered as
an escaped Markdown link through the chat's Markdown renderer, so Streamdown's own `linkSafety`
confirmation applies, the same one assistant links get. `linkSafety` is a Streamdown prop and
its modal is not exported (`streamdown@2.5.0` `dist/index.d.ts:389-398,492`), so plain anchors
could not share it. The renderer lives in `packages/ui` with stories, and takes the chat's
Markdown renderer as a prop, as message rows receive it from `ChatMarkdownProvider`.

### D14: Packaged description

`apps/api/src/prompts/tools/web_search.md` describes the schema, the operator syntax, and that
results are untrusted, and recommends fetching a promising URL with `read` under
`{{#if tools.read}}`. It is replaceable through `tools.promptFiles` like every llame-owned tool.

## Threats

- **Query exfiltration.** The model can place chat content in a query sent to a third party. The
  only control is a reject clause on `query`; the runbook says so.
- **Prompt injection from results.** Titles, snippets, and answers are untrusted and framed as such
  on replay; the description repeats it.
- **Credential leakage.** Keys go only to their own host, redirects are refused, errors are fixed
  text, and secret-protected values never reach output.
- **Link injection in the UI.** Only canonical `http(s)` URLs are stored and rendered as links.
- **Cost amplification.** `aggregate` multiplies paid requests per call, and empty fall-through
  can ask every chain engine. The runbook states both.
- **Shared subscription.** A Codex `model-hosted` engine sends every owner's searches through the
  operator's ChatGPT subscription, whose terms exclude generic OAuth clients. The runbook states
  it; llame already accepts this posture for the `openai-codex` provider.

Tenant data: `web_search` reads no tenant rows. Owner identity still comes from trusted Run
context, and absence fails closed in the runner.

## Risks / Trade-offs

- [DuckDuckGo blocks server IPs] → It is documented as best-effort and unsupported by the
  vendor; challenges advance the chain; SearXNG is the documented reliable keyless engine.
- [Keyless Exa MCP is limited to 2 requests per second and 50 per day per IP] → Documented; a
  key raises the limit.
- [Vendor terms restrict storing results] → Results are stored as conversation context, not as
  a database or index; the runbook quotes each vendor's terms and leaves the decision to the
  operator.
- [Hosted search spend is invisible in usage] → Accepted (Q16); the runbook states the per-search
  prices.
- [A slow aggregate child holds the call] → Bounded by its `timeoutSeconds` and the call deadline.
- [Vendor response formats change] → Each adapter fails as `upstream_error` and the chain advances.

## Migration Plan

Additive. No database change. An instance that does not allowlist `web_search` behaves as before.
Rollback is removing `web_search` from `tools.allowed`; stored `tool-web_search` parts remain
renderable and replayable.

## Open Questions

None. OpenAI `searchContextSize` may be tuned in its layer; changing a bound the spec states
(field caps, citation count, output size) requires a spec change.
