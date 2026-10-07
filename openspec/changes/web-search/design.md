## Context

See proposal.md for motivation. Facts below were observed at `702e6ace` unless a line says
otherwise.

- Code-owned tools are a fixed registry (`apps/api/src/tools/registry.ts:19-31`). Each declares
  `{ id, description, classification, inputSchema, execute, timeoutSeconds? }`
  (`apps/api/src/tools/types.ts:142-157`). `runTool` validates the schema, evaluates
  `tools.permissions` under the Run's permission mode, and bounds execution by the per-tool
  override or the global `tools.callTimeoutSeconds`, whose built-in default is 120
  (`apps/api/src/instance-config/llame-config.ts:512-513,598`).
- Native `read` is the only code-owned egress today. Its HTTP client is specialized to GET,
  redirect admission, locator and address permission, and text rendering
  (`apps/api/src/tools/web-read/execute.ts:20-44`, `http-client.ts:99-117`). Its operator
  adapters live under `tools.webAdapters` (`llame-config.ts:516`).
- Provider clients are dispatched by provider `type` (`apps/api/src/models/model-client-factory.ts:63-173`).
  The installed adapters export hosted search tools: `openai.tools.webSearch` in
  `@ai-sdk/openai@3.0.97` and `anthropic.tools.webSearch_20250305` and `webSearch_20260209` in
  `@ai-sdk/anthropic@3.0.118`. No llame code uses them. The Codex client streams only and has no
  structured generation (`apps/api/src/models/openai-codex-model-client.ts:14-119`).
- `@modelcontextprotocol/sdk` is already a dependency (`apps/api/package.json:52`) behind the
  `mcpServers` client (`apps/api/src/mcp/mcp-server-client.ts`). `linkedom` is installed
  (`apps/api/package.json:75`).
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

- `engine` is the operator id of the engine that answered; for `aggregate`, the aggregate's id.
- Every `url` must parse as `http:` or `https:` and is canonicalized as web `read` canonicalizes
  locators (lowercase scheme and host, fragment removed). Entries failing that are dropped.
- `title` is capped at 200 and `snippet` at 300 characters; `published` is kept only when it parses
  as an ISO date. Results are sliced to `limit`.
- `notes` record what the answering engine ignored, for example `recency is not supported by
duckduckgo`, and which earlier engines failed or were empty.
- `answer` relies on the generic 16,000-character cap; citations are deduplicated by URL.

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
| `aggregate`    | `engines` (two or more engine ids)     |
| `model-hosted` | `model` (a `models[].id`)              |

`key` and `baseUrl` use the existing interpolation and are protected as secrets when
interpolated. Validation at startup: unique ids; every `chain` and `aggregate.engines` id exists;
`aggregate` children are `brave`, `exa`, `exa-mcp`, `perplexity`, `searxng`, or `duckduckgo` (no
nested aggregates, no `model-hosted`); `model-hosted.model` names a model whose provider type is
`openai-responses`, `openai-codex`, or `anthropic-messages`; a `chain` is non-empty and has no
duplicates. `web_search` in `tools.allowed` without `webSearch.chain` fails startup naming
`webSearch.chain`.

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
| `auth`           | HTTP 401 or 403                                              |
| `rate_limited`   | HTTP 429, or an MCP rate-limit error                         |
| `challenge`      | A recognized bot-challenge page (DuckDuckGo `anomaly-modal`) |
| `timeout`        | The engine deadline elapsed                                  |
| `ungrounded`     | A hosted answer without any URL source                       |
| `upstream_error` | Any other transport, status, protocol, or parse failure      |

The first `results` or `answer` ends the call. When the chain is exhausted, the call returns an
empty `results` output if any engine was `empty`, with notes naming each failed engine and class;
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
- keeps the longest snippet and the first non-empty title and date seen in child order;
- slices to `limit`.

The aggregate's outcome is `results` when any child returned results, `empty` when no child
returned results and at least one was empty, and `upstream_error` when every child failed. Notes
name failed children.

Alternative rejected: oh-my-pi's 5 s soft deadline (Q18). The latency bound is the slowest child
under its own `timeoutSeconds`, and the call deadline above it.

### D6: Engine adapters

All requests carry the product User-Agent, reject redirects, and read at most 5 MiB.

| Engine       | Request                                                                                             | `recency`                                    | `limit`       | `site:` / `-site:`                                      |
| ------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | ------------------------------------------------------- |
| `brave`      | `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`                        | `freshness=pd/pw/pm/py`                      | `count`       | left in query                                           |
| `exa`        | `POST https://api.exa.ai/search`, `x-api-key`                                                       | `startPublishedDate` from the current date   | `numResults`  | `includeDomains` / `excludeDomains`, removed from query |
| `exa-mcp`    | MCP `tools/call` `web_search_exa` at `https://mcp.exa.ai/mcp`; `x-api-key` when a key is configured | note: ignored                                | `numResults`  | left in query                                           |
| `perplexity` | `POST https://api.perplexity.ai/search`, bearer                                                     | `search_recency_filter`                      | `max_results` | `search_domain_filter`, removed from query              |
| `searxng`    | `GET <baseUrl>/search?format=json`                                                                  | `time_range` (`week` sent as `month`, noted) | local slice   | left in query                                           |
| `duckduckgo` | `POST https://html.duckduckgo.com/html/` form `q`, parsed with `linkedom`; redirect URLs unwrapped  | `df=d/w/m/y`                                 | local slice   | left in query                                           |

`exa-mcp` parses the tool's text content into results; a response without parsable entries is
`upstream_error`. DuckDuckGo's challenge page is detected by its `anomaly-modal` marker. Response
fields an adapter does not map are discarded before normalization.

### D7: MCP engines use the SDK client

`exa-mcp` creates one SDK `Client` over Streamable HTTP per engine per process on first use,
performs the normal initialize handshake, and reuses the connection. A transport error discards
the connection; the next call reconnects. No `mcpServers` discovery, catalog, or availability
machinery is involved, and the remote tool is never shown to the model.

Alternative rejected: raw JSON-RPC `tools/call` without initialize (OpenCode, Kilo, oh-my-pi). It
is smaller, but breaks if the endpoint starts requiring the handshake or answers with an event
stream, and llame already depends on a client that handles both.

### D8: Model-hosted engines are bounded sub-requests

A `model-hosted` engine builds the referenced model's client exactly as a Run would (provider
credentials, base URL, configured headers, `providerOptions` composition) and issues one request:

- system text from a packaged template instructing the model to search, answer concisely, and cite
  sources; user text is the query, plus a recency phrase when `recency` is set. No chat history,
  system prompt, Knowledge, or other Run context is sent.
- OpenAI Responses and Codex: `openai.tools.webSearch()` with tool choice required. Codex streams
  over its fixed endpoint, as its client already does.
- Anthropic Messages: `anthropic.tools.webSearch_20250305({ maxUses: 5 })`. `20260209` is not used:
  without `allowed_callers: ["direct"]` it returns HTTP 400 and otherwise provisions code
  execution.
- The answer is the final text; citations are the response's URL sources. No URL source means
  `ungrounded`.
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

`apps/web` dispatches `tool-web_search` parts to a renderer built on the shared tool component:

- `results`: a numbered list of title links with host, date, and snippet;
- `answer`: the answer as Markdown followed by numbered citation links;
- the engine id and notes; a `searching` state while running; the error text on failure.

Links render only for `http:`/`https:` URLs, open in a new tab, and carry
`rel="noopener noreferrer nofollow"`. The renderer lives in `packages/ui` with stories so it can
be tested without a running API.

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

None. Defaults that do not change the contract (OpenAI `searchContextSize`, Anthropic `maxUses`,
snippet caps) may be tuned in their layers.
