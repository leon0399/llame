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
Supported operator engines are `brave`, `deepseek`, `exa`, `exa-mcp`,
`parallel`, `parallel-mcp`, `perplexity`, `searxng`, `duckduckgo`, `aggregate`,
and `model-hosted`; configure only these types.

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

## Result removal

In the `default` mode a successful call drops each result and citation whose URL a reject clause of the `read` group matches, with the same decision a `read` of that URL gets. The decision runs on the canonical URL the output shows. The clause filters the search output only: it never admits or refuses the call, and `read` still refuses that URL. Two cases keep the entry. A whole-tool `read` reject (`"reject": true`) disables `read` rather than naming a host. A `read` group with no matching allow names no host either. The `bypass` mode removes nothing through this clause.

Each `-site:host` term of the query also removes the results and citations of that host and its subdomains, on every engine, including an engine that does not apply the operator itself. This half is the query's own promise, so it holds in every mode, `bypass` included, and an IDN or root-dot spelling names the same host.

Removal happens before the chain decides, so an engine whose results are all removed counts as empty and the chain advances. An `aggregate` removes entries before the merge and the `limit` cut, so a removed entry never takes a result slot. An answer keeps the text of a link to a removed URL and loses its target, unless the text is that URL or its host, which goes whole; a bare copy of the URL is deleted and the punctuation around it stays. An answer with no citation left is `ungrounded`. The output carries one note with the number of removed results and citations of the whole call, before every other note, truncation notes included; it never names a removed URL or host, so a removal reveals no rejected host to the model.

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

## Query limits and result counts

Each engine type declares its vendor's query limit in code. llame checks the submitted query before any request and never truncates it:

| Type           | Query limit                  | Result count                       |
| -------------- | ---------------------------- | ---------------------------------- |
| `brave`        | 600 code points and 75 words | `count`, at most 20                |
| `deepseek`     | 128 code points              | `count`, at most 50                |
| `exa`          | the tool's 1,000 units       | `numResults`, at most 100          |
| `parallel`     | 200 code points              | `max_results`, at most 20          |
| `parallel-mcp` | 200 code points              | cut to `limit` after normalization |
| `perplexity`   | the tool's 1,000 units       | `max_results`, at most 20          |
| `exa-mcp`      | the tool's 1,000 units       | the hosted tool's `numResults`     |
| `searxng`      | the tool's 1,000 units       | cut to `limit` after normalization |
| `duckduckgo`   | the tool's 1,000 units       | cut to `limit` after normalization |
| `model-hosted` | the tool's 1,000 units       | not applicable                     |
| `aggregate`    | each child's own limit       | merged, then cut to `limit`        |

A word is a run of non-space characters; lengths are code points, so a character outside the Basic Multilingual Plane counts once. The check covers the query the model submitted, before an engine moves `site:` hosts to filters or appends a date, so the model can predict it from the description.

A query over an engine's limit skips that engine: it sends nothing, the call records `<id>: unsupported`, and a later engine answers. When every chain engine is skipped, the call fails with the fixed error and class `unsupported`. An aggregate runs only the children that accept the query, notes each skipped child as `unsupported`, and fails with `unsupported` when it skips every child.

`limit` is 1-20 for the model and is clamped to the vendor maximum, so a
vendor that caps fewer results never fails a call. `searxng`, `duckduckgo`, and
`parallel-mcp` take no count, so their normalized results are cut to `limit`
after URLs that fail validation are dropped.

## Objective

`objective` is an optional 1-2,000-unit statement of the goal the search
serves, for example which sources should rank first. It is outbound text to
every engine that accepts the field: `exa` and `exa-mcp` send it as Exa's
`objective` (the query when absent), `parallel` sends it as Parallel's
`objective` (absent when the call sets none), `parallel-mcp` sends it to the
hosted tool (the query when absent), `deepseek` sends its first 128 code points
as `ori_question` without a note, and a `model-hosted` engine adds one `Goal:`
line to its sub-request. Every other engine ignores it without a note, and no
engine joins it to the query. Because it leaves the instance, add an
`objective` clause to `tools.permissions.web_search` when it can carry text
the instance must not send.

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
instructions, the query, a recency phrase when `recency` is set, a `Goal:` line
when `objective` is set, and the provider's search tool—never chat history or
other Run context. A configured `{session:id}` header (by default
`X-Session-Id`, except on Codex, which has no default) renders as
`search:<chatId>`.

OpenAI Responses and Codex use the provider's hosted web search and force it
(Responses with a required tool choice, Codex by naming the hosted tool);
Anthropic uses `web_search_20250305` with `maxUses: 5` without forcing it. Each
call makes at most one search step and one answer step. `site:host` terms
become allowed domains and `-site:host` terms become blocked domains; Anthropic
accepts one list, so inclusions win there and the dropped exclusions are noted.
The answer's citations are only URLs that its text
cites; empty or uncited answers are `ungrounded`, so the chain advances. No
reasoning effort is sent: set it through the referenced model's
`providerOptions` if needed. The Codex backend's support for hosted search
sources is undocumented and was not verified against a live subscription; if
it drops them, every Codex answer is `ungrounded`.

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

## DeepSeek

```jsonc
{
  "id": "deepseek",
  "type": "deepseek",
  "key": "{env:DEEPSEEK_API_KEY}",
  "timeoutSeconds": 60,
}
```

`key` is required. llame sends it only as `Authorization: Bearer <key>` to
`https://api.deepseek.com/v1/tools/search`, and redirects are refused, so the
key cannot follow a redirect to another host. `limit` becomes `count` (at most 50) and `objective` its first 128 code points as `ori_question`.

DeepSeek has no freshness parameter, so `recency` becomes an `after:YYYY-MM-DD`
term appended to the query. The vendor caps the query at 128 code points, so
when the dated query would be longer the date is omitted and the output notes
that `deepseek` did not apply `recency`. DeepSeek filters on publication date,
so a page that was updated but published earlier is excluded. `site:`,
`-site:`, `lang:`, `after:`, and `before:` stay in the query text; llame
translates none of them here.

The snippet is the vendor's `summary` (the longer, model-oriented field) unless
it is empty, then its `snippet`. `date` becomes `published`. HTTP 401 and 403
are `auth`, 429 `rate_limited`, 408 and 504 `timeout`, and every other status
`upstream_error`; a 402 means the account is not funded and is reported as
`upstream_error`, so top up the account. The vendor's 401 body echoes the key's
last four characters, which llame never surfaces.

Price: $0.75 per 1,000 successful requests, per request rather than per token
or result. Failed requests, empty results, and timeouts are not billed. The
documented limit is 100 requests per second per account. DeepSeek documents no
retention period or training use for search queries, and its privacy policy
stores personal data in the People's Republic of China; treat query retention
as unknown and decide accordingly.

## Parallel

```jsonc
{
  "id": "parallel",
  "type": "parallel",
  "key": "{env:PARALLEL_API_KEY}",
  "mode": "fast",
  "timeoutSeconds": 60,
}
```

`key` is required and is sent only as `x-api-key` to
`https://api.parallel.ai/v1/search`; redirects are refused. `mode` is one of
`turbo`, `fast`, `basic`, or `advanced` and defaults to `fast`. `turbo` and
`fast` cost $1 per 1,000 requests at up to 10 results, `basic` and `advanced`
$5; each result beyond ten adds $1 per 1,000. `turbo` answers English and
Japanese queries only and rejects a `site:` host that carries a path, so such a
query fails as `upstream_error`; other modes accept it. `advanced` is the
vendor default and is the slowest (about 3 seconds).

The query is the only `search_queries` entry, `limit` becomes `max_results` (at
most 20), and `objective` is sent as the vendor's `objective`. `site:` hosts
become `include_domains` and `-site:` hosts `exclude_domains`, and those tokens
leave the query. Parallel ignores exclusions while inclusions exist, so with
both present llame sends the inclusions only and notes the dropped exclusions.
`recency` becomes `source_policy.after_date`. Each result's first excerpt
becomes the snippet, without a leading copy of the title, and the request asks
for at most 1,000 excerpt characters per result (the vendor's own default is
undocumented) so the output's 300-unit cap does the cutting.

The Chat id is sent as `session_id`, so Parallel can contextualize calls made
inside one Chat. That is the same exposure as the default `X-Session-Id`
model-provider header; sessions are never shared across Chats. The vendor's
error bodies carry a reference id and are discarded; HTTP 401 and 403 are
`auth`, 429 `rate_limited`, 408 and 504 `timeout`, and a 402 (credit exhausted)
stays `upstream_error`, so watch the account balance.

Processing is in the United States, and llame calls only that endpoint:
Parallel's EU endpoint, which returns zero data retention and runs `basic`
mode, is not configurable here. With llame, zero data retention therefore
needs an Enterprise plan, and the standard customer terms allow Parallel to
train on customer input. Search answers at most 600 requests per minute over a
rolling 60-second window; Parallel does not document whether that limit applies
per key or per organization.

## Parallel MCP

```jsonc
{
  "id": "parallel-mcp",
  "type": "parallel-mcp",
  "timeoutSeconds": 60,
}
```

`parallel-mcp` calls the `web_search` tool of Parallel's hosted, keyless MCP
endpoint at `https://search.parallel.ai/mcp` from llame code; the model never
receives a tool declaration from it. It takes no `key` and rejects one. The
call sends `objective` (the query when the call sets none), the query as the
only search query, and the Chat id as `session_id`, which is the same exposure
as for `parallel`.

Anonymous use runs the vendor's `fast` mode with about 25,000 excerpt
characters per call and no documented rate limit, price, or retention period;
Parallel's customer terms still apply to the queries. The tool takes no result
count, so results are cut to `limit` after URL validation, and `recency` is not
supported, which the output notes. A tool error arrives as HTTP 200 with an
error flag and vendor text; llame reports `upstream_error` and drops the text.
llame keeps one MCP session per configured engine and reconnects on failure.

## Query exfiltration

Every query leaves the instance for the configured provider and may contain model-copied conversation, file, or tool text. `read` path permissions do not restrict this, and `read_only` does not make it private. `objective` is outbound text in the same way, for the engines that accept it.
The only query-exfiltration control is a `query` or `objective` reject clause in `tools.permissions.web_search`; use literal or anchored regex markers/patterns. Matching is textual—a guard against submitted query text, not a DLP scanner.

## Storage and provider terms

A completed call stores normalized results/answer in the chat's `web_search` tool part as conversation context, not raw vendor payload or request metadata. The part replays as untrusted tool output and is omitted from public chat shares like other protected parts.
Provider terms constrain this storage. Brave Search API terms prohibit storing/caching results beyond transient operational use. Exa's terms prohibit copying/archiving results except a temporary cache; normalized chat storage may exceed that allowance.
Perplexity grants display rights without an archive grant, so retaining normalized results is not automatically permitted. SearXNG is self-hosted, but the upstream engines' terms still apply.
DeepSeek documents no retention period for search queries or results, and its
privacy policy stores personal data in the People's Republic of China.
Parallel processes searches in the United States, publishes no default
retention period, and its standard terms allow training on customer input.
Disable or avoid an engine if the operator cannot accept its terms for llame's
chat-part storage.
