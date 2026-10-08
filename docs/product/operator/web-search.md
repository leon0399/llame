---
summary: "Configure web_search engines, its fallback chain, permissions, and data handling"
read_when:
  - you are enabling, restricting, or troubleshooting web_search
  - you are configuring a search-engine key or endpoint, or deciding how search results may be stored
behavior:
  - ../reference/tools/web-search.md
---

# Web search

This runbook covers enabling `web_search`, its configured engines/chain, deadlines, and how queries/results cross the instance boundary. The [web_search reference](../reference/tools/web-search.md) has the model-facing schema, output union, bounds, fall-through details, and failure classes.
Supported operator engines are `brave`, `exa`, `exa-mcp`, `perplexity`, `searxng`, `duckduckgo`, `aggregate`, and `model-hosted`; configure only these types.

## Enabling

Both gates are required:

1. Add the exact `web_search` id to `tools.allowed`.
2. Add a `web_search` group under `tools.permissions`.
   A whole-tool allow is simplest; reject clauses can veto queries containing data the instance must not send:

```jsonc
{
  "tools": {
    "allowed": ["web_search"],
    "permissions": {
      "web_search": {
        "allow": true,
        "reject": [
          { "field": "query", "literal": "PRIVATE_MARKER" },
          { "field": "query", "regex": "(?i)password" },
        ],
      },
    },
  },
}
```

Permission is decided before an engine request; rejection is the ordinary permission error and sends no query. See [tool-call permissions](tool-call-permissions.md) for matching/order. Allowlisting without `webSearch.chain` is a startup failure naming that path; configuring `webSearch` without the allowlist loads but does not advertise/expose the tool.

## Configure the chain

Add optional top-level `webSearch`; `engines` contains operator-owned entries and `chain` names them in try order:

```jsonc
{
  "webSearch": {
    "engines": [
      { "id": "brave", "type": "brave", "key": "{env:BRAVE_API_KEY}" },
    ],
    "chain": ["brave"],
  },
}
```

Engine ids are unique strings of 1-64 characters; every chain id must exist, the chain is non-empty and has no repeats. There is no built-in engine/chain; omit `webSearch` to leave search unconfigured.
Each non-aggregate engine's positive-integer `timeoutSeconds` defaults to 60 seconds. The whole call (all chain steps) uses existing `tools.callTimeoutSeconds`, default 120 seconds; do not add another web-search call timeout. Engine timeouts are `timeout` and advance; other failures and empty results also advance. The first non-empty result/grounded answer ends the call. If all attempts fail, the fixed error names engine ids/classes, never an upstream response or credential.

## Aggregate

An aggregate fans out across two or more distinct configured result-engine ids:

```jsonc
{
  "id": "broad",
  "type": "aggregate",
  "engines": ["brave", "exa"],
}
```

Children cannot be another aggregate or `model-hosted`. All children start
concurrently, and the aggregate waits for every child up to
`tools.callTimeoutSeconds`; each child is bounded by its own `timeoutSeconds`.
Results use Reciprocal Rank Fusion (`k=60`), grouped by canonical URL while
ignoring a leading `www.` and trailing `/`. The emitted URL is the
best-ranked member's spelling. It is empty only when no child has results and
at least one child was empty; notes name failed and empty children. Cost
multiplies by child count, while latency is the slowest child within those
deadlines.

## Model-hosted

A `model-hosted` entry delegates a search to a configured model:

```jsonc
{
  "id": "claude-search",
  "type": "model-hosted",
  "model": "<models[].id>",
}
```

The referenced model's provider MUST be `openai-responses`, `openai-codex`, or
`anthropic-messages`; a `model-hosted` entry cannot be an `aggregate` child.
Each call is a separate bounded sub-request carrying only packaged search
instructions, the query, and a recency phrase (when set)—never chat history or
other Run context. A configured `{session:id}` header (by default
`X-Session-Id`, except on Codex, which has no default) renders as
`search:<chatId>`.

OpenAI Responses and Codex use the provider's hosted web search; Anthropic uses
`web_search_20250305` with `maxUses: 5`. `site:host` terms become allowed
domains. The answer's citations are only URLs that its text cites; empty or
uncited answers are `ungrounded`, so the chain advances. No reasoning effort is
sent: set it through the referenced model's `providerOptions` if needed.

OpenAI and Anthropic cost about $10 per 1,000 searches plus tokens; this spend
is not recorded in llame usage. Codex uses the operator's ChatGPT subscription
for every owner's search, and OpenAI's docs exclude generic OAuth clients
outside Codex—an operator risk. OpenAI and Anthropic require visible,
clickable citations; the web chat renders them as links.

## Brave

A Brave entry is:

```jsonc
{
  "id": "brave",
  "type": "brave",
  "key": "{env:BRAVE_API_KEY}",
  "timeoutSeconds": 60,
}
```

`key` is required and SHOULD be whole-value secret interpolation. llame sends it only as `X-Subscription-Token` to Brave's fixed endpoint:

```text
https://api.search.brave.com/res/v1/web/search
```

The query goes there; `limit` maps to `count`, and `recency` maps to `freshness`: `day`→`pd`, `week`→`pw`, `month`→`pm`, `year`→`py`.
Redirects are refused, so the key cannot follow a redirect to another host. Responses are normalized or discarded; keys never appear in output, errors, Run events, or logs.

## Exa

```jsonc
{
  "id": "exa",
  "type": "exa",
  "key": "{env:EXA_API_KEY}",
  "timeoutSeconds": 60,
}
```

`key` is required; llame sends it as `x-api-key` to `https://api.exa.ai/search`. A `site:host` token becomes `includeDomains` and a `-site:host` token becomes `excludeDomains`, and those tokens are removed from the outbound query. Only an operator that stands alone as a whitespace-delimited token is translated; one wrapped in quotes or parentheses (`"rust site:docs.rs"`, `(site:a.com OR site:b.com)`) stays in the query text and reaches no filter. `recency` becomes `startPublishedDate` using the current date; `limit` becomes `numResults`.

## Exa MCP

```jsonc
{
  "id": "exa-mcp",
  "type": "exa-mcp",
  "timeoutSeconds": 60,
}
```

`exa-mcp` calls Exa's hosted MCP at `https://mcp.exa.ai/mcp` from llame code; the
MCP and its tools are never exposed to the model. An optional `key` (for example
`{env:EXA_API_KEY}`) raises limits. Without one, Exa's changelog (2 Feb 2026)
gives about 3 requests/second and 150 calls/day per IP for unauthenticated use;
Exa may change it. It does not support `recency`.
Do not use keyless access to avoid API billing. Exa API storage restrictions apply
to these results too.

## Perplexity

```jsonc
{
  "id": "perplexity",
  "type": "perplexity",
  "key": "{env:PERPLEXITY_API_KEY}",
  "timeoutSeconds": 60,
}
```

The Search API uses `https://api.perplexity.ai/search`; `key` is required and is sent as `Authorization: Bearer <key>`. `recency` maps to `search_recency_filter`, and `limit` to `max_results`. `search_domain_filter` is one mode with at most 20 hosts: `site:` terms form an allowlist; without them, `-site:` terms form a denylist. For mixed operators, only `site:` terms are filtered and each `-site:` remains in the query; overflow remains in the query with a note. As for Exa, only standalone operator tokens are translated; wrapped ones stay in the query text.

## SearXNG

```jsonc
{
  "id": "searxng",
  "type": "searxng",
  "baseUrl": "https://search.example.test",
  "timeoutSeconds": 60,
}
```

SearXNG is self-hosted, has no key, and requires an absolute `http:` or `https:` `baseUrl`. It calls `<baseUrl>/search?format=json`; `settings.yml` must enable JSON:

```yaml
search:
  formats: [html, json]
```

A 403 normally means JSON is disabled and is reported as `upstream_error`, not `auth`. `recency: "week"` is sent as `time_range=month`; `day`, `month`, and `year` map directly. `limit` is applied after URL canonicalization, and `site:`/`-site:` remain in the query.

## DuckDuckGo

```jsonc
{
  "id": "duckduckgo",
  "type": "duckduckgo",
  "timeoutSeconds": 60,
}
```

DuckDuckGo posts to its HTML endpoint, `https://html.duckduckgo.com/html/`; it
needs no key and is not supported by the vendor for automated queries. Bot
challenges on datacenter/shared IPs are reported as `challenge`.
There is no license for automated queries or storage, so the operator owns that
risk. SearXNG is the dependable keyless option.

## Query exfiltration

Every query leaves the instance for the configured provider and may contain model-copied conversation, file, or tool text. `read` path permissions do not restrict this, and `read_only` does not make it private.
The only query-exfiltration control is a `query` reject clause in `tools.permissions.web_search`; use literal or anchored regex markers/patterns. Matching is textual—a guard against submitted query text, not a DLP scanner.

## Storage and provider terms

A completed call stores normalized results/answer in the chat's `web_search` tool part as conversation context, not raw vendor payload or request metadata. The part replays as untrusted tool output and is omitted from public chat shares like other protected parts.
Provider terms constrain this storage. Brave Search API terms prohibit storing/caching results beyond transient operational use. Exa's terms prohibit copying/archiving results except a temporary cache; normalized chat storage may exceed that allowance.
Perplexity grants display rights without an archive grant, so retaining normalized results is not automatically permitted. SearXNG is self-hosted, but the upstream engines' terms still apply.
Disable or avoid an engine if the operator cannot accept its terms for llame's chat-part storage.
