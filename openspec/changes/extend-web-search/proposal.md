## Why

`web_search` accepts only a keyword `query`, runs one operator-ordered chain, and hides which
engines exist. Three useful providers are missing: DeepSeek Search (the cheapest result API),
Parallel (excerpts ranked by a natural-language objective), and Yandex (Russian-language and CIS
coverage). The model cannot state the goal behind a search, even though Parallel, Exa, and
DeepSeek rank by one, and it cannot ask for a specific engine. Engines also reject queries above
their own length limits, which today surfaces as an opaque `upstream_error`
([#1430](https://github.com/leon0399/llame/issues/1430),
[#1431](https://github.com/leon0399/llame/issues/1431),
[#1432](https://github.com/leon0399/llame/issues/1432),
[#1437](https://github.com/leon0399/llame/issues/1437),
[#1438](https://github.com/leon0399/llame/issues/1438),
[#1440](https://github.com/leon0399/llame/issues/1440)). Results also ignore the operator's `read`
reject clauses, so the model sees and cites hosts the instance refuses to open.

## What Changes

- **Objective.** `web_search` gains an optional `objective` (1 to 2,000 UTF-16 units): the goal
  behind the search in plain language. Parallel and Exa receive it as their `objective`
  (`parallel-mcp`, `exa`, and `exa-mcp` fall back to the query, which removes today's duplicated
  `exa-mcp` objective). DeepSeek receives its first 128 code points as `ori_question`, silently.
  Hosted engines receive one `Goal:` line. Every other engine ignores it silently; it is never refused or noted, and the future rerank stage uses it. The
  objective never enters the query text.
- **Query limits.** Each engine type declares the query limit its vendor enforces (DeepSeek 128,
  Parallel 200, Yandex 400 characters and 40 words, Brave 600 characters and 75 words). An
  over-long query makes no vendor request and fails that engine with the new failure class
  `unsupported`, so the chain advances. An `aggregate` skips only the children whose limit the
  query exceeds. **BREAKING** for consumers that enumerate failure classes: `unsupported` is new.
- **Result filtering.** In the effective `default` permission mode, results and citations whose
  URL a `read` reject clause matches are removed, and so are results on hosts that a `-site:`
  operator excludes, on every engine. Removal happens before the chain decides on an engine
  outcome and, inside an aggregate, before the merge. Answer text loses links to removed URLs.
  One note, placed first, counts removals without naming them. A fully filtered engine is empty;
  an answer with no citation left is `ungrounded`.
- **Search operators.** The packaged description names `site:`, `-site:`, and quoted phrases as
  supported and states that other operators can reach an engine as plain words. Hosted engines
  send `site:` hosts as allowed and `-site:` hosts as blocked domains. Parsing date and filter operators is
  [#1441](https://github.com/leon0399/llame/issues/1441).
- **Result counts clamp.** A `limit` above an engine's vendor maximum is sent as that maximum;
  the call never fails for it.
- **Engine selection.** `web_search` gains an optional `engines` list. When set, it replaces
  `webSearch.chain` for that call; the listed engines run in order with the usual fallback among
  them only. Any configured engine is selectable. An unknown id fails the call with the list of
  configured ids. The canonical clause "The model SHALL NOT be able to select an engine" is
  deleted.
- **Engine catalog.** The packaged `web_search` description lists the configured engines through
  a new `webSearch.engines` template collection: id, type, result kind, chain position, objective
  and recency handling, query limit, and an optional operator `description`. Keys, base URLs,
  folder ids, and model ids never appear.
- **New engine types.** `deepseek` (DeepSeek search API), `parallel` (Parallel search API with an
  operator `mode`, default `fast`), `parallel-mcp` (keyless hosted Parallel MCP), `yandex` (Yandex
  web search, base64 XML).
- **Answer engines inside aggregates.** `model-hosted` engines can be `aggregate` children. The aggregate output stays `kind: "results"` and gains optional
  `answers: [{ engine, answer, citations }]`; cited URLs also join the rank merge. The output
  cap drops results before it shortens answers. The web renderer shows attached answers.
  **BREAKING** for consumers of the closed output union: `answers` is a new optional field.
- Configuration: new per-type entry shapes, an optional literal `description` on every engine
  entry, and `aggregate` validation that admits answer children.

## Assumptions, confirmed with Leo

Decisions from the 2026-10-26 design session (grilling rounds Q1 to Q18):

- One OpenSpec change delivered as a linear stack (Q1 A).
- An over-long query is skipped as `unsupported`, never truncated; the description states the
  limits briefly and asks for a short keyword query (Q2 A). An `aggregate` advertises the
  smallest child limit and skips only the children the query exceeds.
- `engines` replaces the chain for that call (Q3 A). Every configured engine is selectable, with
  no gate; cost exposure is the operator's responsibility (Q4 A).
- The input schema stays static; ids are checked at execution (Q5 A).
- The catalog shows generated facts plus an optional sanitized operator `description` (Q6 B).
- The field is named `objective`, capped at 2,000 units, and the description asks for a concise
  value (Q7 A). Hosted engines receive it as a `Goal:` line (Q8 A). Engines without an objective field ignore it with no note (Leo, after the grilling).
- All four engine types ship (Q9, narrowed after the grilling: `yandex-gen` dropped). DeepSeek's `ori_question` takes the objective cut silently to
  128 code points (Q16 B), on evidence from the
  [objective spike](../../../docs/research/tool-harness/2026-10-26-web-search-objective-spike/report.md):
  76 to 100 percent of objectives fit 128 characters, no query exceeded 124 characters, and
  `ori_question` left the top-10 order unchanged in 56 of 59 comparisons.
- Parallel's `session_id` is the Chat id (Q10 A). Rerank preparation is out of scope (Q11 A).
- A `limit` above a vendor maximum is clamped, never an error (Leo, after the grilling).
- The description announces search operators in a drive-by, limited to the portable set after the
  operator survey (Leo, after the grilling).
- Results and citations that the `read` group rejects are removed (Leo, after the grilling, with
  a removed `grokipedia` host as the example).
- Answer engines are allowed in aggregates with the `answers` shape (Q15 B); that work is its own
  issue (Q17 C).
- DeepSeek's hosted search through the Responses API is out of scope; `model-hosted` validation is
  unchanged (Q18).
- Yandex's terms forbid reordering results; that is the operator's responsibility, and validation
  does not bar Yandex from aggregates.

Assumptions that follow from those decisions but were not asked:

- Only a matching `read` reject clause removes an entry. An absent `read` allow and a whole-tool
  `read` reject remove nothing, so search keeps working where web `read` is not granted. The
  effective `bypass` mode removes nothing. One note gives a count only.
- `-site:` hosts are also removed by llame, so the announced operator holds on engines that
  ignore it.
- `engines` holds 1 to 20 unique ids of 1 to 64 characters, matching engine id rules.
- An operator `description` is literal text of 1 to 200 characters on one line; it is not
  interpolated and not secret.
- `parallel-mcp` is keyless only, like Parallel's free endpoint; a keyed Parallel engine is
  `parallel`.
- DeepSeek has no date parameter, so `recency` becomes an `after:` query operator; when that would
  break the 128-character limit, the date is omitted with a note.
- Yandex has no one-week or one-year period: `week` maps to two weeks with a note, and `year` is
  not applied.
- `yandex` requires `searchType`; `folderId` is optional, because service-account keys imply it.
- A query limit counts the query the model submitted; a word is a run of non-space characters.

## Deviation from the grilling record

- **Engine catalog delivery (Q6).** The grilling settled on "a new template collection modeled on
  `skills.entries`". The first approved revision appended a code-generated catalog after the
  rendered description instead. On 2026-10-27 Leo restored the template collection: every word of
  a tool description belongs in its template. `tool-prompt-templates` adds `webSearch.engines` the
  way it added `tools.<exact-id>`, so the `model-system-prompts` vocabulary requirement is not
  rewritten.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-search`:
  - MODIFIED "The web search tool has one stable model-facing contract" (adds `objective` and
    `engines`; deletes the engine-selection ban).
  - MODIFIED "Output is a closed, normalized union" (optional `answers`).
  - MODIFIED "The chain tries engines in order and advances on failure or emptiness"
    (`engines` replaces the chain).
  - MODIFIED "Total failure is a fixed, non-disclosing error" (adds `unsupported`).
  - MODIFIED "API and keyless engines speak their vendor wire" (new engine types).
  - MODIFIED "Model-hosted engines run a bounded grounded sub-request" (`Goal:` line).
  - MODIFIED "Aggregate engines fan out and merge by rank fusion" (runs only children that
    accept the query; fails with `unsupported` when every child is skipped).
  - ADDED "Engines skip queries over their query limit", "Engines clamp the result count to their vendor
    maximum", "The call removes the results that the read permission group rejects", "The call removes the results of excluded hosts", "Removed entries can empty an engine outcome", "One note counts the removed entries", "The description names only the portable search operators", "Hosted engines map site operators to domain filters", "Aggregate engines run only the
    children that accept the query", "Engines receive the objective where their vendor accepts
    one", "The model can select the engines for one call", "The web search description lists the
    configured engines", "Aggregate engines attach the answers of answer children", "Attached
    answers fit the result cap after results", "The chat renders attached answers", "DeepSeek
    engines call the DeepSeek search API", "Parallel engines call the Parallel search API",
    "Keyless Parallel engines call the hosted Parallel MCP tool", "Yandex engines call the Yandex
    web search API", and "Yandex engines classify errors from the response body".
- `instance-config`:
  - MODIFIED "Web search engine entries have fixed per-type shapes" (`duckduckgo` has no field for
    its type, so the shared `description` does not contradict it).
  - MODIFIED "Web search references are validated at startup" (`model-hosted` engines may be `aggregate` children). Its scenario "Hosted engine inside an aggregate fails startup" keeps its heading
    but now covers a hosted child on an unsupported provider type, and the new scenario "Hosted
    engine inside an aggregate loads" records the reversal that Q15 decided.
  - ADDED "New web search engine types have fixed shapes", "Yandex web search engines have a fixed
    shape", and "Web search engine entries can carry a model-facing description".

- `permission-modes`:
  - MODIFIED "The permission mode is not model-visible" (the `web_search` removal note is a second
    channel through which the model learns of a policy decision).
- `native-file-tools`:
  - ADDED "Read reject clauses filter web search output but never govern the search".
- `tool-call-permissions`:
  - ADDED "Web search result removal is not native path enforcement".
- `tool-prompt-templates`:
  - ADDED "Templates can iterate the configured web search engines" (the `webSearch.engines`
    collection).

Deliberately unchanged: `tool-calling` (the declaration still carries the `web-search` input
schema), `model-system-prompts` (its variable list is unchanged; the new collection is added through
`tool-prompt-templates`), `provider-request-headers`,
and `run-usage-accounting` (hosted sub-requests stay outside Run usage; see
[#1439](https://github.com/leon0399/llame/issues/1439)).

## Impact

- `apps/api/src/tools/web-search/`: `tool.ts` (schema, `engines` check, catalog), `chain.ts`
  (failure class, chain override), `aggregate.ts` (child skip, answer children, `answers`),
  `output.ts` (`answers` bounds and trim order), `exa.ts`, `exa-mcp.ts`, `model-hosted.ts`
  (objective), and new `deepseek.ts`, `parallel.ts`, `parallel-mcp.ts`, `yandex.ts`, each with tests.
- `apps/api/src/instance-config/`: `llame-config.ts`, `config-loader.ts`,
  `llame.config.schema.json`; tests that pin the old aggregate rule
  (`config-loader` and `web-search-config` tests for a hosted aggregate child).
- `apps/api/src/prompts/tools/web_search.md` and the description assembly in
  `apps/api/src/runs/run-execution.service.ts`.
- `packages/ui/src/components/custom/web-search.tsx` and its stories.
- Docs: `docs/product/operator/web-search.md`, `docs/product/reference/tools/web-search.md`,
  `apps/api/llame.config.jsonc.example`, `CHANGELOG.md`.
- No database, migration, API route, or generated client change. No new dependency.

## Non-Goals

- Reranking and its candidate widening
  ([#1433](https://github.com/leon0399/llame/issues/1433) to
  [#1436](https://github.com/leon0399/llame/issues/1436)).
- Engine usage and cost accounting ([#1439](https://github.com/leon0399/llame/issues/1439)).
- Parsing and translating `after:`, `before:`, `lang:`, `filetype:`, and similar operators, and a
  relaxing post-filter ([#1441](https://github.com/leon0399/llame/issues/1441)).
- DeepSeek's hosted Responses `web_search` tool.
- Model-chosen depth, mode, location, or excerpt size; structured domain filters beyond the
  existing `site:` operators; per-engine permission groups; a gate on selectable engines.

## Acceptance

- A call with `objective` sends it in the native field of Parallel, Exa, and DeepSeek, as a
  `Goal:` line to hosted engines, and is silently ignored elsewhere; the query text never contains it.
- A `read` reject clause for a host removes its results, citations, and answer-text links from
  the output without naming them; an absent `read` allow, a whole-tool `read` reject, and the
  `bypass` mode remove nothing. `-site:` hosts never appear in the output.
- A query over an engine's limit sends nothing to that engine and records `unsupported`; an
  aggregate skips only the exceeded children.
- `engines: ["a", "b"]` runs only `a`, then `b`; an unknown id fails with the configured ids and
  no request.
- The declared description lists every configured engine with no secret, also under a
  description override.
- Each new engine type works end to end through the chain with fixed failure classes, and vendor
  error text never reaches the output, Run events, or logs.
- An aggregate with a hosted child returns merged results plus the hosted answer, within the
  result cap, and the chat renders it live and from history.
