# Spec Delta

## MODIFIED Requirements

### Requirement: The web search tool has one stable model-facing contract

The code-owned inventory MUST include `web_search` with the `read_only` classification. It needs its exact `tools.allowed` entry, and `tools.permissions.web_search` MUST authorize each call. The input MUST be a strict object with a required `query` of 1 to 1,000 UTF-16 units. Optional `objective` has 1 to 2,000 units. Optional `engines` has 1 to 20 unique ids of 1 to 64 characters. Optional `recency` is `day`, `week`, `month`, or `year`. Optional `limit` is an integer from 1 to 20, default 10.

#### Scenario: Unknown argument is refused

- **WHEN** the model calls `web_search` with `{ "query": "x", "engine": "brave" }`
- **THEN** the call fails schema validation and no engine sends a request

#### Scenario: Default limit

- **WHEN** the model calls `web_search` with only a query and the answering engine returns 15 results
- **THEN** the output contains a maximum of 10 results

#### Scenario: Permission rejection sends nothing

- **WHEN** `tools.permissions.web_search` rejects a call by a clause on `query`
- **THEN** the call returns the permission rejection observation
- **AND** no engine sends an outbound request

#### Scenario: Duplicate engine ids are refused

- **WHEN** the model calls `web_search` with `{ "query": "x", "engines": ["brave", "brave"] }`
- **THEN** the call fails schema validation and no engine sends a request

### Requirement: Output is a closed, normalized union

A successful call MUST return `kind: "results"` or `kind: "answer"`. A results output has `results` entries with `title`, `url`, and optional `snippet` and `published`, and an `aggregate` can add `answers`. An answer output has `answer` text and one or more citations with `url` and optional `title`. Each output has `engine`, `query`, and optional `notes`. `engine` is the id of the engine that answered, or of the last empty engine. Other vendor fields MUST NOT occur.

#### Scenario: Results output from a result engine

- **WHEN** a result engine returns three hits
- **THEN** the output is `kind: "results"` with three entries and `engine` is the operator id of that engine

#### Scenario: Ignored option is noted

- **WHEN** the call sets `recency` and the answering engine cannot apply it
- **THEN** the `notes` of the output state that the engine did not apply `recency`

#### Scenario: Aggregate output can carry answers

- **WHEN** an `aggregate` engine has a result child and a `model-hosted` child, and both succeed
- **THEN** the output is `kind: "results"` with merged `results` and one `answers` entry

### Requirement: The chain tries engines in order and advances on failure or emptiness

The call MUST run the engines of `webSearch.chain` in order, or the listed `engines` in their order when the call sets them. A call with `engines` MUST NOT run other engines. The call MUST return the first outcome with results or a grounded answer. A failed or empty engine MUST advance to the next engine. The notes MUST name each other attempted engine that failed, with its class, or was empty. When no engine succeeds and one was empty, the call MUST succeed with zero results.

#### Scenario: Failure falls through

- **WHEN** the chain is `["brave", "exa"]`, `brave` answers HTTP 503, and `exa` returns results
- **THEN** the output has the results of `exa` with `engine: "exa"`
- **AND** its notes name `brave` with `upstream_error`

#### Scenario: Empty falls through

- **WHEN** the chain is `["brave", "exa"]`, `brave` returns no results, and `exa` returns results
- **THEN** the output has the results of `exa`
- **AND** its notes name `brave` as empty

#### Scenario: All engines empty or failed

- **WHEN** the chain is `["brave", "exa"]`, `brave` fails with `auth`, and `exa` returns no results
- **THEN** the call succeeds with `kind: "results"`, an empty `results` list, and `engine: "exa"`
- **AND** its notes name `brave` with `auth`

#### Scenario: A failure after an empty engine is noted

- **WHEN** the chain is `["brave", "exa"]`, `brave` returns no results, and `exa` fails with `auth`
- **THEN** the call succeeds with an empty `results` list and `engine: "brave"`
- **AND** its notes name `exa` with `auth`

#### Scenario: Selected engines replace the chain

- **WHEN** the chain is `["brave", "exa"]` and the call sets `engines: ["deepseek", "exa"]`
- **THEN** the call runs `deepseek` first and runs `exa` only if `deepseek` fails or is empty
- **AND** `brave` sends no request

#### Scenario: A selected engine does not fall back to the chain

- **WHEN** the chain is `["brave"]`, the call sets `engines: ["yandex"]`, and `yandex` fails with `rate_limited`
- **THEN** the call returns the total-failure error that names `yandex`
- **AND** `brave` sends no request

### Requirement: Total failure is a fixed, non-disclosing error

When each attempted engine fails, the call MUST return a tool error. The error MUST name each attempted engine id with one class: `auth`, `rate_limited`, `challenge`, `timeout`, `ungrounded`, `unsupported`, or `upstream_error`. Engine errors, notes, logs, and Run events MUST NOT contain upstream status text or bodies, request headers, configured keys, or configured base URLs.

#### Scenario: Authorization failure

- **WHEN** the only chain engine answers HTTP 401 with a body that echoes its key
- **THEN** the tool error names that engine with class `auth`
- **AND** the key and the body do not occur in the tool part, Run events, or logs

#### Scenario: Rate limit

- **WHEN** the only chain engine answers HTTP 429
- **THEN** the tool error names that engine with class `rate_limited`

#### Scenario: Query limit failure

- **WHEN** the only chain engine is `brave` and the query has 700 characters
- **THEN** the tool error names `brave` with class `unsupported`
- **AND** `brave` sends no request

### Requirement: API and keyless engines speak their vendor wire

The engine types are `brave`, `exa`, and `perplexity` (Search API) with a key; `searxng` with its `baseUrl`; `exa-mcp`, which calls the hosted Exa MCP tool `web_search_exa` from llame code; `duckduckgo`, which posts to the HTML endpoint; and `deepseek`, `parallel`, `parallel-mcp`, `yandex`, and `yandex-gen`. Each engine MUST map `recency` and `limit` where its vendor supports them. Each engine MUST refuse redirects and MUST send a key only to its own host.

#### Scenario: Keyless Exa MCP

- **WHEN** an `exa-mcp` engine without a key runs a query
- **THEN** llame calls the hosted MCP tool and returns normalized results
- **AND** the model receives no declaration of an MCP tool from that endpoint

#### Scenario: DuckDuckGo challenge

- **WHEN** the DuckDuckGo endpoint answers with its bot-challenge page
- **THEN** the engine outcome is `challenge` and the chain advances

#### Scenario: A redirect never carries the key

- **WHEN** the response of a `brave` engine is a redirect to another host
- **THEN** the engine does not follow the redirect and sends no request to the other host
- **AND** the outcome is `upstream_error`

### Requirement: Model-hosted engines run a bounded grounded sub-request

A `model-hosted` engine MUST send one request with the hosted web search of the provider to its configured model. The request MUST use the credentials and headers of that model on the `search` session lane, never those of the Run. It MUST send no reasoning effort, as title generation does. It MUST contain only packaged instructions, the query, a recency phrase for `recency`, and a `Goal:` line for `objective`. The answer is the final text, and the citations MUST be the URLs that the text cites.

#### Scenario: Different Run model

- **WHEN** a Run on an `opencode-go` model calls `web_search` and the chain engine is `model-hosted` on an `anthropic-messages` model
- **THEN** the call returns `kind: "answer"` with citations from the Anthropic sub-request

#### Scenario: Ungrounded answer is a failure

- **WHEN** the hosted sub-request returns empty text, or text that cites no URL
- **THEN** the engine outcome is `ungrounded` and the chain advances

#### Scenario: No chat context leaves the instance

- **WHEN** a model-hosted engine runs in a chat with prior turns and a system prompt
- **THEN** the sub-request contains neither the prior turns nor the system prompt

#### Scenario: Objective becomes a goal line

- **WHEN** the call sets `objective` to `compare pgvector benchmarks` and the engine is `model-hosted`
- **THEN** the user message of the sub-request contains the line `Goal: compare pgvector benchmarks`
- **AND** a call without `objective` sends no `Goal:` line

## ADDED Requirements

### Requirement: Engines skip queries over their query limit

An engine MUST NOT send a request when the query is over its query limit. It MUST fail with `unsupported`, and the chain advances. The limits count Unicode code points: `deepseek` 128, `parallel` and `parallel-mcp` 200, `yandex` 400 and 40 words, and `brave` 600 and 75 words. Other engine types have no limit below the 1,000 units of the input schema.

#### Scenario: An over-long query skips the engine

- **WHEN** the chain is `["brave", "exa"]` and the query has 650 characters
- **THEN** `brave` sends no request and `exa` returns the results
- **AND** the notes name `brave` with `unsupported`

#### Scenario: A word limit applies

- **WHEN** a `yandex` engine receives a query of 45 words and 300 characters
- **THEN** the engine sends no request and fails with `unsupported`

### Requirement: Aggregate engines run only the children that accept the query

An `aggregate` engine MUST NOT run a child when the query is over the query limit of that child. The aggregate MUST note that child with `unsupported` and MUST run its other children. When the query limit skips all children, the aggregate MUST fail with `unsupported`.

#### Scenario: One child is skipped

- **WHEN** an `aggregate` has the children `deepseek` and `exa` and the query has 150 characters
- **THEN** only `exa` sends a request
- **AND** the notes name `deepseek` with `unsupported`

#### Scenario: All children are skipped

- **WHEN** an `aggregate` has the children `deepseek` and `parallel` and the query has 300 characters
- **THEN** no child sends a request and the aggregate fails with `unsupported`

### Requirement: Engines receive the objective where their vendor accepts one

`parallel`, `parallel-mcp`, `exa`, and `exa-mcp` MUST send `objective` as the vendor `objective`. When `objective` is absent, `parallel-mcp`, `exa`, and `exa-mcp` MUST send the query there. `deepseek` MUST send the first 128 code points of `objective` as `ori_question`, without a note. `model-hosted` and `yandex-gen` MUST add a `Goal:` line. Each other engine MUST note `objective not applied by <id>`. An engine MUST NOT add `objective` to the query.

#### Scenario: Parallel receives the objective

- **WHEN** the call sets `objective` and the engine is `parallel`
- **THEN** the request body has that text as `objective` and the query as the only `search_queries` entry

#### Scenario: A long objective is cut for DeepSeek without a note

- **WHEN** the call sets an `objective` of 300 characters and the engine is `deepseek`
- **THEN** `ori_question` is the first 128 code points of `objective`
- **AND** the output has no note about the objective

#### Scenario: An engine without an objective field notes it

- **WHEN** the call sets `objective` and `brave` answers
- **THEN** the notes contain `objective not applied by brave`
- **AND** the query that `brave` receives does not contain the objective

#### Scenario: Exa falls back to the query

- **WHEN** the call has no `objective` and the engine is `exa-mcp`
- **THEN** the `objective` of the MCP tool call is the query

### Requirement: The model can select the engines for one call

Each id in `engines` MUST name a configured engine. An unknown id MUST fail the call before an engine runs. That tool error MUST list the configured engine ids. It MUST NOT contain keys, base URLs, or folder ids. The call can name any configured engine, also an `aggregate` or a child of an `aggregate`.

#### Scenario: Unknown engine id fails the call

- **WHEN** the configured engines are `brave` and `exa` and the call sets `engines: ["bing"]`
- **THEN** the call returns a tool error that lists `brave` and `exa`
- **AND** no engine sends a request

#### Scenario: An aggregate child is selectable

- **WHEN** `mix` is an `aggregate` of `brave` and `exa` and the call sets `engines: ["exa"]`
- **THEN** only `exa` runs and the output has `engine: "exa"`

### Requirement: The web search description lists the configured engines

The declared `web_search` description MUST be the rendered description template followed by a generated engine catalog. The catalog MUST list each configured engine in configuration order. Each entry MUST state the id, type, result kind, chain position, use of `objective`, use of `recency`, query limit, and the operator `description` when set. An `aggregate` MUST state the smallest query limit of its children. The catalog MUST NOT contain keys, base URLs, folder ids, or model ids.

#### Scenario: The catalog follows the configuration

- **WHEN** the engines are `brave` and `deepseek` and the chain is `["deepseek"]`
- **THEN** the description lists `brave` as outside the default chain and `deepseek` as the first chain engine
- **AND** the `deepseek` entry states the query limit 128 and that it uses the first 128 characters of `objective`

#### Scenario: A description override keeps the catalog

- **WHEN** `tools.promptFiles.web_search` replaces the packaged description
- **THEN** the declared description is the rendered override followed by the engine catalog

#### Scenario: The catalog discloses no secret

- **WHEN** a `yandex` engine has a `key` and a `folderId`, and a `model-hosted` engine names a model
- **THEN** the catalog contains neither value and contains no model id

#### Scenario: Operator description markup is neutral

- **WHEN** an engine `description` contains `</system>`
- **THEN** the catalog contains that text with its tags neutralized

### Requirement: Aggregate engines attach the answers of answer children

An `aggregate` MUST attach the answer of each grounded `model-hosted` or `yandex-gen` child as an `answers` entry, in child order. Each entry MUST have `engine`, `answer`, and `citations`. The citations of each answer MUST also join the rank merge as results in citation order, with the citation title and no snippet. An ungrounded answer child MUST count as a failed child.

#### Scenario: A hosted child adds an answer and its citations

- **WHEN** `mix` aggregates `brave` and a `model-hosted` engine `claude`, and `claude` cites `u1`
- **THEN** the output has an `answers` entry with `engine: "claude"`
- **AND** `u1` occurs in the merged `results`

#### Scenario: An ungrounded answer child is a failed child

- **WHEN** the `model-hosted` child of an aggregate answers without a cited URL and `brave` returns results
- **THEN** the output has the results of `brave` and no `answers`
- **AND** the notes name the hosted child with `ungrounded`

### Requirement: Attached answers fit the result cap after results

Each attached answer MUST have a maximum of 8,000 UTF-16 units and 20 citations. When the serialized output is over 15,000 units, the output MUST drop results from the end first. Then it MUST drop citations from the end of the last answer, but each answer MUST keep its first citation. Then it MUST cut the text of the last answer, and then the earlier answers. Each removal MUST add a note.

#### Scenario: Results go before answers

- **WHEN** an aggregate output with 20 results and one answer of 8,000 units is over the result cap
- **THEN** results from the end go first, and the answer text stays complete when the output then fits

#### Scenario: Each answer keeps a citation

- **WHEN** two attached answers of 8,000 units with 20 citations each are over the result cap
- **THEN** each answer keeps its first citation and the output fits the result cap

### Requirement: The chat renders attached answers

The web chat MUST render each `answers` entry of a `web_search` part after the results, live and from history. Each entry MUST show its engine id, its answer as Markdown, and its numbered citation links. Only `http:` and `https:` URLs MUST render as links.

#### Scenario: Attached answers render

- **WHEN** a completed `web_search` part has three results and one `answers` entry
- **THEN** three result links show first, then the answer with its engine id and citation links

#### Scenario: A part without answers renders as before

- **WHEN** a chat loads a `web_search` part that a release without `answers` stored
- **THEN** it renders without error and shows its results

### Requirement: DeepSeek engines call the DeepSeek search API

A `deepseek` engine MUST post to `https://api.deepseek.com/v1/tools/search` with its key as a bearer token. It MUST send the query, and `limit` as `count`. It MUST add `recency` to the query as an `after:` date. When the date would put the query over its limit, the engine MUST omit the date and note that. The snippet MUST be `summary`, else `snippet`. HTTP 401 MUST map to `auth`, 429 to `rate_limited`, and 408 or 504 to `timeout`.

#### Scenario: Recency becomes an after date

- **WHEN** the call sets `recency: "week"` with the query `pgvector release`
- **THEN** the query that DeepSeek receives ends with `after:` and the date seven days before the request date

#### Scenario: A full query omits the date

- **WHEN** the call sets `recency` and the query has 125 characters
- **THEN** DeepSeek receives the query without a date
- **AND** the notes state that `deepseek` did not apply `recency`

#### Scenario: The summary is the snippet

- **WHEN** a DeepSeek result has both `summary` and `snippet`
- **THEN** the output snippet comes from `summary`

### Requirement: Parallel engines call the Parallel search API

A `parallel` engine MUST post to `https://api.parallel.ai/v1/search` with its key in `x-api-key`. It MUST send the query as the only `search_queries` entry, its configured `mode`, `limit` as `max_results`, and the Chat id as `session_id`. It MUST send `site:` hosts as included domains and `-site:` hosts as excluded domains. It MUST send `recency` as `after_date`. The snippet MUST be the first excerpt, without a copy of the title at its start.

#### Scenario: Site operators become the source policy

- **WHEN** the query is `rerank site:arxiv.org`
- **THEN** the request has `arxiv.org` as an included domain and `rerank` as the query

#### Scenario: The Chat id is the session

- **WHEN** a Run in a Chat calls a `parallel` engine twice
- **THEN** both requests send that Chat id as `session_id`

### Requirement: Keyless Parallel engines call the hosted Parallel MCP tool

A `parallel-mcp` engine MUST call the `web_search` tool of the hosted Parallel MCP endpoint from llame code, without a key. It MUST send `objective` and the query as the only `search_queries` entry. A tool result that reports an error MUST map to `upstream_error`, and its text MUST NOT occur in the output. The model MUST NOT receive a declaration of a tool from that endpoint.

#### Scenario: A tool error is not disclosed

- **WHEN** the hosted tool returns a result with `isError` and a vendor message
- **THEN** the engine fails with `upstream_error`
- **AND** the vendor message does not occur in the tool part, Run events, or logs

### Requirement: Yandex engines call the Yandex web search API

A `yandex` engine MUST post to `https://searchapi.api.cloud.yandex.net/v2/web/search` with `Api-Key` authorization. It MUST send its `searchType` and its `folderId` when set. It MUST request flat groups with one document in each group, so that `limit` counts results. It MUST decode the base64 XML response. `day` MUST map to one day and `month` to one month. `week` MUST map to two weeks, with a note. `year` is not applied, with a note.

#### Scenario: Flat grouping keeps the limit

- **WHEN** the call sets `limit: 5` and two results come from one host
- **THEN** the output can contain both results from that host

#### Scenario: Week recency is widened with a note

- **WHEN** the call sets `recency: "week"`
- **THEN** the request uses the two-week period
- **AND** the notes state that `yandex` mapped `week` to two weeks

### Requirement: Yandex engines classify errors from the response body

A `yandex` engine MUST read the error code in the XML response before it reads results, also after HTTP 200. Code 42 MUST map to `auth`, codes 32 and 55 to `rate_limited`, and code 100 to `challenge`. Codes 2 and 15 MUST give an empty outcome. Each other code MUST map to `upstream_error`. The error text MUST NOT occur in the output.

#### Scenario: An in-body error after HTTP 200

- **WHEN** Yandex answers HTTP 200 with an XML error code 55
- **THEN** the engine fails with `rate_limited` and the chain advances

#### Scenario: No results is empty

- **WHEN** Yandex answers HTTP 200 with an XML error code 15
- **THEN** the engine outcome is empty

### Requirement: Generative Yandex engines answer with the sources they used

A `yandex-gen` engine MUST post one user message to `https://searchapi.api.cloud.yandex.net/v2/gen/search`. The message MUST contain the query, a recency phrase when `recency` is set, and a `Goal:` line when `objective` is set. The answer MUST be the response message text. The citations MUST be the sources that the response marks as used. A rejected answer, or an answer without a used source, MUST fail with `ungrounded`.

#### Scenario: Only used sources are citations

- **WHEN** the response lists three sources and marks two as used
- **THEN** the output citations are those two sources

#### Scenario: A rejected answer is ungrounded

- **WHEN** the response marks the answer as rejected
- **THEN** the engine fails with `ungrounded` and the chain advances
