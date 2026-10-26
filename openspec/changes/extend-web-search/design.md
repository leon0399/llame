# Design

## Context

See proposal.md for motivation. Code facts at `master` `ba5b101`:

- The input schema is a module-level strict object `{ query, recency?, limit }`
  (`apps/api/src/tools/web-search/tool.ts:18-22`), and the code-owned registry is a build-time
  constant (`apps/api/src/tools/registry.ts:22-33`).
- Failure classes are `auth`, `rate_limited`, `challenge`, `timeout`, `ungrounded`, and
  `upstream_error` (`apps/api/src/tools/web-search/chain.ts:16-23`). `EngineRequest` carries
  `query`, `recency`, `limit`, `signal`, `userAgent`, `chatId`, and the model-client factory
  (`chain.ts:66-78`). The chain runs `webSearch.chain` in order (`chain.ts:267-301`).
- `aggregate` passes the same request to every child and cuts the merged list to `limit`
  (`apps/api/src/tools/web-search/aggregate.ts:170-184`). Config validation rejects `aggregate` and
  `model-hosted` children (`apps/api/src/instance-config/config-loader.ts:638`).
- `exa-mcp` sends `objective: request.query` (`exa-mcp.ts:201`); `exa` sends no objective.
- The hosted sub-request message is the query plus an optional recency phrase
  (`model-hosted.ts:104-110`); citations come from the provider's citation annotations
  (`model-hosted.ts:170-186`).
- Output bounds: URL 2,048, output 15,000, title 200, snippet 300, answer 8,000, note 200, ten
  notes, 20 citations (`apps/api/src/tools/web-search/output.ts:9-16`).
- The description is the Handlebars template `apps/api/src/prompts/tools/web_search.md`, rendered
  per attempt (`apps/api/src/runs/run-execution.service.ts:4699-4712`) against a fixed vocabulary
  (`apps/api/src/instance-config/prompt-loader.ts:78-167`) that system prompts share.
- Replayed tool calls are not validated again
  (`apps/api/src/chats/tool-observation-part.ts:262-272`), so a removed engine id never breaks
  history. Invalid arguments reach the model as `Invalid input for tool web_search: ...`
  (`apps/api/src/models/tool-call-gate.ts:119-140`).
- The renderer shows results, answers, engine, and notes
  (`packages/ui/src/components/custom/web-search.tsx:116-228`).

## Goals / Non-Goals

**Goals:** a model-facing goal channel that each engine uses natively and other engines ignore silently;
model choice among the configured engines with full visibility of what exists; three new
providers on the existing engine contract; answer engines inside aggregates.

**Non-Goals:** see proposal.md. The design also keeps the `Engine` contract result-shaped: no
engine returns scores, and no widened candidate fetch is added for a future reranker.

## Prior art

Inspected at the pinned revisions in the objective spike's sibling research (oh-my-pi `dcafcef6`,
OpenClaw `0e90c04a`, OpenCode `ab4d1f3a`, Kilo `1180b803`, Hermes `edfa1c2a`, Open WebUI
`33c1978d`, LibreChat `a3786575`).

| Harness        | Engine choice                                                                            | Objective                                                                            | DeepSeek / Parallel / Yandex                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| oh-my-pi       | Model role chain over `web/<engine>` catalog models; the tool schema exposes no provider | None; Parallel receives the query as `objective`                                     | DeepSeek `/v1/tools/search` with `{ query, count }` (drops `ori_question`); Parallel `/v1beta/search` |
| OpenClaw       | `tools.web.search.provider` or credential auto-detection                                 | Parallel plugin declares `objective`, but the shared tool schema never advertises it | DeepSeek without `ori_question`; Parallel `/v1/search` with `advanced_settings.max_results`           |
| OpenCode, Kilo | Persisted provider choice, environment variable, or session hash                         | None; `objective = query`                                                            | Parallel hosted MCP `{ objective, search_queries }`                                                   |
| Hermes Agent   | `web.backend` or auto-detection                                                          | None; its plugin notes say `ori_question` cannot pass through `(query, limit)`       | Parallel SDK; DeepSeek only as a community plugin                                                     |
| Open WebUI     | `web.search.engine` config                                                               | None                                                                                 | Yandex `/v2/web/search`, base64 XML                                                                   |
| LibreChat      | `webSearch.searchProvider`                                                               | None                                                                                 | Jina or Cohere rerank over results (deployment-level)                                                 |

No surveyed harness lets the model name an engine or passes a model-authored objective. That is
consistent with llame's earlier decision against engine choice, which this change reverses for
transparency (D3).

## Decisions

### D1: One change, layered stack

The objective, limits, new engines, answer aggregation, and selection share one tool contract and
one configuration section. One proposal settles the contract; five implementation layers ship it
in dependency order (tasks.md). Alternative rejected: separate changes for providers and model
steering, which would edit each new adapter twice.

### D2: Query limits fail closed as `unsupported`

Each engine type declares its vendor query limit in code points, plus a word limit where the
vendor has one: `deepseek` 128, `parallel` and `parallel-mcp` 200 (per `search_queries` entry),
`yandex` 400 and 40 words, `brave` 600 and 75 words. A word is a run of non-space characters.
The limit counts the query the model submitted, before an engine moves `site:` operators to
native filters or appends a date, so the model can predict it from the catalog; DeepSeek appends
its `after:` date only when the sent query still fits. The check runs before the request; an
over-long query records `unsupported` and advances. An `aggregate` has no limit of its own: it
checks each child (`AggregateChild` gains the child's limit), advertises the smallest child limit
in the catalog, and fails with `unsupported` only when every child was skipped, which the
MODIFIED aggregate requirement states.

Alternatives rejected: reuse `upstream_error`, which reports a local decision as a vendor failure
and leads the model to retry the same query; truncate the query, which silently searches for
something else. The spike measured no query above 124 characters across three models, so the
class is a guard, not a common path.

### D2a: Result counts clamp to the vendor maximum

`limit` stays 1 to 20 for the model. Each engine sends `min(limit, vendor maximum)` and never fails
because the vendor caps fewer results; an engine without a count parameter (`searxng`, `duckduckgo`, `parallel-mcp`) cuts
its results to `limit`, as the output bounds already do. Today every vendor maximum is at least 20 (Brave 20, Parallel 20,
DeepSeek 50, Yandex 100 per page), so the clamp is a guard for future engines and vendor changes.
The asymmetry with D2 is deliberate: a smaller result set answers the same search, while a
truncated query is a different search. Leo's decision, 2026-10-26.

### D2b: Results follow the `read` reject clauses and `-site:` exclusions

Each engine outcome passes through the reject decision that native `read` takes for a web locator
(`apps/api/src/tools/web-read/admission.ts:120-140`, submitted and projected forms; the function
is exported for this) before the chain or an aggregate decides on it. The check travels on
`EngineRequest`, so aggregate children use it too. Only a matching reject clause removes an entry
(a decision with `explicit_reject` and a clause reference). `no_allow` keeps the entry, so the
canonical `native-file-tools` scenario where `web_search` returns results under a `read` group
without a web allow stays true. A whole-tool `read` reject also keeps entries: it disables `read`,
and emptying every search would make `web_search` useless on that deployment. In the effective `bypass` mode this half removes nothing: the check goes through `admitPermission`, which returns an allow in `bypass` without evaluating clauses (`apps/api/src/tools/permissions/admit.ts:11`), exactly as every other call site does. Routing every check through one mode-aware entry point is [#1443](https://github.com/leon0399/llame/issues/1443). The decision runs on the canonical URL the output shows, so a vendor spelling that `read` would refuse cannot pass the clause that matches the displayed URL.

The same pass removes results and citations on hosts that a `-site:` operator excludes, including
subdomains, with the exclusion normalized through the URL parser so an IDN or a root dot names the same host. Several engines ignore `-site:` (`exa-mcp`, and SearXNG upstreams vary), and this post-filter makes the announced operator hold everywhere (D11). This half is the query's own promise, not a policy decision, so it holds in every mode, `bypass` included.

Answer text is cleaned too: a Markdown link to a removed URL keeps its text and loses its target,
unless the text is itself that URL or its host, which is a bare copy of the entry and goes whole;
a bare copy of a removed URL is deleted and the sentence punctuation around it stays. Otherwise
the OpenAI hosted wires, which inline citation links whose text is the host, would still show a
rejected host. An answer with no citation left is `ungrounded`.

Filtering before the chain decision matters: a result list that filtering empties advances the
chain, and an aggregate filters each child before its merge and its `limit` cut, so removed
entries never take result slots. One note, placed first in the normalized output so neither the ten-note cap nor a truncation note can take its place, counts the removed results and citations of the whole call — including the entries of an engine that removal emptied — without naming one. A copy in answer text is not an entry and is not counted. For `read` removals that note is a second channel through which the model learns of a `default`-mode policy decision (it never appears for them in `bypass`, so it reveals no mode), so `permission-modes` "The permission mode is not model-visible" is MODIFIED to name it. Two canonical sentences read against this behavior and sit inside requirements far over the 500-character limit that strict validation applies to MODIFIED prose (`native-file-tools` "Web locators are fetched by the native read tool", 6,991 characters, says `read` `path` clauses "do not restrict" `web_search`; `tool-call-permissions` "Recommended portable policy with explicit replacement" says native path rejects are not "search-result filtering"). Rewriting either whole in STE to change one sentence is out of proportion, so each capability gains one ADDED requirement that fixes the reading: `read` clauses never govern a `web_search` call but filter its output, and that filtering is not native path enforcement. No vendor request
changes; translating rejects into `-site:` exclusions is not attempted, because reject clauses are
regular expressions, not host lists.

Alternative rejected: filtering on the full `read` decision, which would empty every search on a
deployment that grants `web_search` but not web `read`.

### D3: `engines` replaces the chain for one call

When set, the listed engines run in the given order with the usual fallback among them only.
Naming one engine pins it; naming two gives a fallback. Every configured engine is selectable,
also an `aggregate` child; cost exposure is the operator's responsibility.

Alternatives rejected: prepend the listed engines and fall back to the rest of the chain, which
hides the choice (a model that asked for Yandex can silently get Brave); a `fallback` flag, which
adds a second mode to learn; an operator `selectable` gate, deferred until an operator needs it.

### D4: Static schema, execution-time id check

`engines` is a plain array of 1 to 20 unique strings. The tool checks each id against the
configured engines before any engine runs and fails with the configured ids. Alternative
rejected: a zod enum built from configuration, which gives provider-side constrained decoding but
makes `web_search` the only code-owned tool with a configuration-derived schema and breaks the
registry's build-time invariant.

### D5: The engine catalog is appended by code

The declared description is the rendered template (packaged or `tools.promptFiles` override)
followed by a generated `Engines` section. Per engine: id, type, result kind (`results`,
`answer`, or `results with answers` for an aggregate with answer children), chain position or
"not in the default chain", objective use (`objective`, first 128 characters, or `Goal:` line; omitted for engines that ignore it), recency use (applied, mapped, or ignored), query limit, and the operator `description`
after tag neutralization. Engine ids are tag-neutralized like the descriptions, since ids are operator text bounded only by
length. Keys, base URLs, folder ids, and model ids never appear. The empty-render check runs on
the rendered template before the catalog is appended, so an override that renders empty still
fails the attempt (`apps/api/src/tools/turn-tool-catalog.ts:420-432`). The section is
built once per worker from the resolved configuration, so the provider prompt cache changes only
when the operator edits engines.

This deviates from the grilling record's "template collection" (proposal.md). `tool-prompt-templates` gets one MODIFIED sentence allowing `web-search` to append the catalog,
so its "complete packaged description" rule stays true for the template file. Alternatives
rejected: a `webSearch.engines` template collection, which `tool-prompt-templates` would expose to
system prompts too and which requires rewriting the `model-system-prompts` vocabulary
requirement; the `engines` parameter's JSON-schema description, which would make the declared
schema configuration-derived (contradicting D4) and which `tool-prompt-templates` reserves from
templates.

### D6: Objective mapping

| Engine                                                   | Field                                            | Absent objective |
| -------------------------------------------------------- | ------------------------------------------------ | ---------------- |
| `parallel`                                               | `objective`                                      | omitted          |
| `parallel-mcp`                                           | `objective` (required by the tool)               | the query        |
| `exa`, `exa-mcp`                                         | `objective` (Exa caps it at 4,096)               | the query        |
| `deepseek`                                               | `ori_question`, first 128 code points, no note   | omitted          |
| `model-hosted`                                           | one `Goal: <objective>` line in the user message | no line          |
| `brave`, `perplexity`, `searxng`, `duckduckgo`, `yandex` | none; ignored silently, never refused            | nothing          |

The objective never enters the query: Brave and Yandex would break their limits, and lexical
engines would match goal words instead of keywords. Engines without an objective field ignore it silently: the field exists now for the engines that use it and for the future rerank stage (#1433), so a per-call note would only be noise. Q16 chose the silent DeepSeek cut on spike data: `ori_question` changed the top-10 order in 3 of 59 comparisons, so a per-call note would
push the model to shorten objectives that Parallel and Exa use in full. A future rerank stage uses
the full objective.

### D7: DeepSeek engine

`POST https://api.deepseek.com/v1/tools/search` with `Authorization: Bearer <key>`; body
`{ query, count: limit, ori_question? }`
([DeepSeek search guide](https://api-docs.deepseek.com/guides/search),
[API reference](https://api-docs.deepseek.com/api/search)). The API has no date parameter, so
`recency` becomes an `after:YYYY-MM-DD` operator appended to the query when it fits the limit;
otherwise the date is omitted with a note. Results map `summary ?? snippet` to the snippet
(`summary` is the 600 to 800 character model-oriented field; `output.ts` cuts it to 300) and
`date` to `published`. Status mapping: 401 and 403 `auth`, 429 `rate_limited`, 408 and 504 `timeout`, else `upstream_error`; 402
(insufficient balance) stays `upstream_error` because no billing class exists, and the runbook
names it as an unfunded account. A live probe returned 401 bodies that echo the key's last four characters, so
the fixed-class rule is load-bearing here. Price: $0.75 per 1,000 requests; empty results are not
billed. Retention and training use of search queries are undocumented.

### D8: Parallel engines

`parallel`: `POST https://api.parallel.ai/v1/search` with `x-api-key`; body
`{ search_queries: [query], objective?, mode, session_id: chatId, advanced_settings: {
max_results: limit, source_policy: { include_domains | exclude_domains, after_date },
excerpt_settings: { max_chars_per_result } } }` ([API reference](https://docs.parallel.ai/api-reference/search/search.md)).
`site:` hosts become `include_domains`, `-site:` hosts `exclude_domains` (the vendor ignores
exclusions when inclusions exist; the engine notes that case). `recency` becomes `after_date`.
Results map `excerpts[0]`, minus a leading copy of the title, to the snippet and `publish_date` to
`published`. Status mapping, the same as DeepSeek: 401 and 403 `auth`, 429 `rate_limited`, 408 and 504 `timeout`, else `upstream_error`;
402 (insufficient credit) stays `upstream_error`, named in the runbook. Modes ([modes](https://docs.parallel.ai/search/modes.md)): `turbo` (about
200 ms, $1 per 1,000, English and Japanese only), `fast` (about 700 ms, $1), `basic` (about 1 s,
$5), `advanced` (about 3 s, $5, the vendor default). The default here is `fast`, which the vendor
recommends for agents. Results beyond ten add $1 per 1,000. Processing is in the US; zero data
retention needs an Enterprise plan or the EU endpoint, and the standard
[customer terms](https://parallel.ai/customer-terms) allow training on customer input.

`parallel-mcp`: the keyless `https://search.parallel.ai/mcp` tool `web_search`
`{ objective, search_queries, session_id }` ([Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp.md)),
called through the `@ai-sdk/mcp` client that `exa-mcp` already uses. Anonymous use runs `fast`
mode with about 25,000 excerpt characters per call. Tool errors arrive as HTTP 200 with `isError`
and vendor text; they map to `upstream_error`, and the text is dropped. `session_id` is capped at
100 characters by the tool, which a Chat UUID fits.

The Chat id as `session_id` matches the exposure of the default `X-Session-Id: {session:id}`
model-provider header (Q10).

### D9: Yandex engines

Host `https://searchapi.api.cloud.yandex.net`, `Authorization: Api-Key <key>`. `folderId` is optional because a service-account key implies it ([Search API concepts](https://aistudio.yandex.ru/en/docs/search-api/concepts/)).

`yandex`: `POST /v2/web/search` with `query { searchType, queryText, familyMode:
FAMILY_MODE_MODERATE }`, `groupSpec { GROUP_MODE_FLAT, groupsOnPage: limit, docsInGroup: 1 }`
(the default deep grouping returns one document per domain, so `limit` would stop counting
results), `maxPassages`, and `responseFormat: FORMAT_XML`. The response's `rawData` is base64 XML;
the engine parses it with `linkedom`, already a dependency, and strips `<hlword>` highlights.
Yandex reports search errors inside HTTP 200 as `<error code>`: 42 `auth`; 32 and 55
`rate_limited`; 100 `challenge`; 2 and 15 empty; others `upstream_error`. Recency uses the request field `period` (`PERIOD_DAY`, `PERIOD_2_WEEKS`, `PERIOD_MONTH`; the
concepts pages also show a `resultsWithin` spelling that the strict REST body rejects): `day` and
`month` map directly, `week` maps to `PERIOD_2_WEEKS` with a note, and `year` has no period and
is noted. HTTP 401 and 403 map to `auth`, 429 to `rate_limited`, and 5xx or an unparsable body to
`upstream_error`. Price: $4 per 1,000 requests; 10 requests per second.

Yandex generative search (`/v2/gen/search`, an answer engine at $41.64 per 1,000 requests and
1 request per second) is out of scope; `model-hosted` covers grounded answers.

Yandex is Russia-hosted; its own documentation states that search requests leave the
152-FZ-certified perimeter. Its [terms](https://yandex.ru/legal/cloud_terms_search_api) §3.2
forbid changing the order of results. Aggregation reorders them; that is the operator's
responsibility (Q12), stated in the runbook, and validation does not bar Yandex from aggregates.
Yandex's official MCP server wraps the same endpoints, so a native engine adds no indirection.

### D10: Answer engines inside aggregates

`model-hosted` engines can be `aggregate` children. Each grounded answer becomes an
`answers` entry `{ engine, answer, citations }` in child order, and its citations join the rank
merge as results at citation rank, with the citation title and no snippet. An ungrounded child
counts as failed. The aggregate's existing empty and failure rules apply to the merged results.
Output bounds: each attached answer keeps the 8,000-unit and 20-citation caps; over the
15,000-unit result cap, results go first from the end, then citations from the end of the last
answer (each answer keeps its first), then answer text from the last answer backwards, and finally whole answers from the end. The
renderer shows attached answers after the results with their engine id.

Alternatives rejected (Q15): citations-as-results only, which discards the paid answer; the
aggregate returning `kind: "answer"` whenever a hosted child answers, which drops result
snippets and arbitrarily chooses between two answers.

Latency: the aggregate already waits for every child up to the call deadline; a hosted child (10
to 30 seconds) sets the aggregate's latency. The runbook states it.

### D11: Announce only the portable search operators

Models write Google-style operators whatever the tool says; the description only decides which ones
llame vouches for. `site:` and quoted phrases are native on Brave, DuckDuckGo, Exa, DeepSeek, and
Yandex; `-site:` is native on Brave, DuckDuckGo, and DeepSeek and undocumented on Yandex and Exa,
and the D2b post-filter enforces it on every engine. All three reach hosted engines through a model that understands them, and are mapped
to native filters for Exa, Perplexity, Parallel, and hosted engines. Every other operator is a
coin flip: DeepSeek parses `after:`, `before:`, and `lang:`, Yandex parses `date:` and `mime:`, but
Brave, DuckDuckGo, and SearXNG search `after:2026-01-01` as literal tokens, Perplexity documents
no operators, and Parallel's REST guidance forbids operators in `search_queries`
([operator guides](https://api-dashboard.search.brave.com/documentation/resources/search-operators),
[DeepSeek](https://api-docs.deepseek.com/guides/search#query-operators),
[Parallel best practices](https://docs.parallel.ai/search/best-practices)). The packaged
description therefore names the portable three and states once that other operators can reach an
engine as plain words, the honest framing Hermes uses.

Drive-by mappings close gaps the portable set exposes: hosted engines send `site:` hosts as
allowed and `-site:` hosts as blocked domains (both `@ai-sdk/openai` and `@ai-sdk/anthropic`
expose `blockedDomains`; today only `allowedDomains` is sent, `model-hosted.ts:57,67`); on
`anthropic-messages` the exclusions are dropped with a note when `site:` hosts exist, because
Anthropic accepts only one of the two lists, while OpenAI accepts both; and Parallel moves `site:`/`-site:` to `source_policy` (D8). Prior art: oh-my-pi announces a full Google set and
backs it with a parser, per-provider rewriting, and a relaxing post-filter
(`packages/coding-agent/src/web/search/query.ts`); OpenClaw announces operators only for DeepSeek;
OpenCode, Kilo, and Open WebUI announce none. Parsing and translating date and filter operators,
and the post-filter that makes announcing them safe, is
[#1441](https://github.com/leon0399/llame/issues/1441).

## Risks / Trade-offs

- [The model escalates cost by choosing expensive engines (hosted model searches, Parallel `advanced` $5 per 1,000)] -> Engines are selectable only when the operator defines them; the operator
  `description` can state cost; usage accounting is [#1439](https://github.com/leon0399/llame/issues/1439).
- [Yandex residency and the result-order clause] -> Runbook states both; the operator chooses
  whether to configure Yandex or aggregate it.
- [Parallel's standard terms allow training on queries and objectives] -> Runbook states it and
  names the EU or Enterprise zero-retention options.
- [Vendor error text echoes credentials (DeepSeek 401) or arrives inside HTTP 200 (Yandex,
  Parallel MCP)] -> Classification reads status or error codes only; tests assert that bodies
  never reach output, Run events, or logs.
- [The objective is new outbound text to every vendor that accepts it] -> The runbook's query
  exposure section covers the objective too; the existing `tools.permissions.web_search` clauses
  can match it.
- [A catalog line per engine grows the tool description] -> One line per engine with fixed
  fields; operator descriptions are capped at 200 characters.
- [The model names a removed engine id in a new call] -> The call fails with the current ids; old
  calls in history replay unchanged.

## Migration Plan

No data migration. Configuration changes are additive; an existing `webSearch` section loads
unchanged. Stored `web_search` parts without `answers` render as before. Rollback reverts the
layer; configurations that use a new engine type or a hosted aggregate child must be reverted
with it, because the older loader rejects them at startup.

## Open Questions

- Parallel's default excerpt size per result is undocumented; the engine sets
  `max_chars_per_result` to a value above the 300-unit snippet cap and the layer records the
  chosen value in the runbook.
- Yandex's documentation pages disagree on whether Search API requests are stored; the runbook
  quotes the Search API page ("does not store data by default") and links the platform page.
