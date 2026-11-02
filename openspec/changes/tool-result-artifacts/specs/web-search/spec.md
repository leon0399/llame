## MODIFIED Requirements

### Requirement: The web search tool has one stable model-facing contract

The code-owned inventory MUST include `web_search` as `read_only`. It MUST be
eligible only through its exact `tools.allowed` entry. `tools.permissions.web_search`
MUST authorize each call. The input MUST be a strict object with a required
`query` of 1 to 1,000 UTF-16 units. Optional `objective` has 1 to 2,000 units.
Optional `engines` has 1 to 20 unique ids of 1 to 64 units. Optional `recency`
is `day`, `week`, `month`, or `year`. Optional `limit` is an integer from 1 to
20, default 10. It bounds the results inline.

#### Scenario: Unknown argument is refused

- **WHEN** the model calls `web_search` with `{ "query": "x", "engine": "brave" }`
- **THEN** the call fails schema validation and no engine sends a request

#### Scenario: Default limit

- **WHEN** the model calls `web_search` with only a query and the engine that answers returns 15 results
- **THEN** the inline text shows a maximum of 10 results
- **AND** the artifact of the call holds all 15 results

#### Scenario: Permission rejection sends nothing

- **WHEN** `tools.permissions.web_search` rejects a call by a clause on `query`
- **THEN** the call returns the permission rejection observation
- **AND** no engine sends an outbound request

#### Scenario: Duplicate engine ids fail validation

- **WHEN** the model calls `web_search` with `{ "query": "x", "engines": ["brave", "brave"] }`
- **THEN** the call fails schema validation and no engine sends a request

### Requirement: Engines clamp the result count to their vendor maximum

The fetch size of a call is the larger of `limit` and `webSearch.fetchLimit`.
When the fetch size is above the maximum result count of the vendor, the
engine MUST send that maximum. The call MUST NOT fail for that reason. An
engine without a count parameter MUST cut its results to the fetch size.

#### Scenario: The engine clamps a large limit

- **WHEN** an engine with a vendor maximum of 10 receives a fetch size of 20
- **THEN** the engine requests 10 results and the call succeeds

#### Scenario: A small limit passes unchanged

- **WHEN** `webSearch.fetchLimit` is 5 and a `deepseek` engine receives `limit: 5`
- **THEN** the request has `count: 5`

### Requirement: Aggregate engines fan out and merge by rank fusion

An `aggregate` MUST run each child that accepts the query concurrently. It
MUST wait until each child settles. It MUST group results by canonical URL,
without `www.` at the host start and without `/` at the path end. It MUST
score each URL by `Σ 1/(60 + rank)` over the children that return it, and
order by score. A group MUST use its best-ranked URL and the longest snippet.
The aggregate MUST cut the merged list to the fetch size. When it has no
result, it is empty when a child was empty. In other cases it MUST fail.

#### Scenario: Shared result ranks first

- **WHEN** child A returns `[u1, u2]` and child B returns `[u3, u1]`
- **THEN** the merged order starts with `u1`

#### Scenario: A grouped result keeps a real spelling

- **WHEN** child A returns `https://www.example.com/docs/` first and child B returns `https://example.com/docs` second
- **THEN** the aggregate emits one merged entry with the URL `https://www.example.com/docs/`

#### Scenario: Partial failure still answers

- **WHEN** one child fails with `rate_limited` and another returns results
- **THEN** the aggregate returns the results of the successful child with a note that names the failed child

#### Scenario: A failed and an empty child are empty

- **WHEN** one child fails with `auth` and the other returns no results
- **THEN** the aggregate outcome is empty and the chain advances

#### Scenario: Every child fails

- **WHEN** every child of an aggregate fails
- **THEN** the aggregate outcome is `upstream_error` and the chain advances

#### Scenario: Cancellation aborts every child

- **WHEN** the owner cancels the Run while two aggregate children are in flight
- **THEN** llame aborts both requests

#### Scenario: Every skipped child fails as unsupported

- **WHEN** the query limit skips each child of an aggregate
- **THEN** the aggregate outcome is `unsupported` and the chain advances

### Requirement: Output fields are bounded within the result cap

Lengths count JavaScript UTF-16 code units, cut at a code-point boundary.
Titles MUST be at most 200 units, snippets 300, and answers 8,000. `published`
MUST be present only as an ISO 8601 date. Results MUST be cut to the fetch
size and citations to 20. `notes` MUST hold at most 10 notes of at most 200
units each. When more notes are due, the tenth MUST record the rest as
`<n> more engines`.

#### Scenario: Long snippet is cut

- **WHEN** an engine returns a 2,000-character snippet
- **THEN** the stored snippet and the snippet that the model reads are at most 300 characters

#### Scenario: Long answer is cut

- **WHEN** a hosted engine answers with 12,000 units of text and three citations
- **THEN** the answer is cut to 8,000 units with a note and all three citations remain

### Requirement: The serialized output fits the result cap

The inline text MUST hold at most `limit` results and MUST fit in 15,000 UTF-16
units, with its other lines. When a result does not fit, the inline text MUST
end before it. The artifact MUST hold every result of the call. An `answer`
output MUST keep at least its first citation inline. When it still does not
fit, the answer text MUST be cut further until it does. The tool MUST NOT cut
a URL.

#### Scenario: Oversized output drops trailing entries

- **WHEN** 20 results with fields of maximum length do not fit in 15,000 characters
- **THEN** the inline text ends before the first result that does not fit
- **AND** every URL inline is complete, and the artifact holds all 20 results

#### Scenario: A maximal answer keeps a citation

- **WHEN** a hosted engine answers a 1,000-unit query with 8,000 units of text
  and 20 citations of 2,000-unit URLs
- **THEN** the last citations move out of the inline text until it fits
- **AND** at least the first citation remains inline

### Requirement: Stored output is the normalized result only

The persisted tool part MUST contain the normalized output of the inline
results and no raw vendor payload. When the call has an artifact, the part
MUST also name its locator. The part MUST replay into later turns as untrusted
tool output, like any other tool result. It MUST NOT appear in public chat
shares.

#### Scenario: Reload reproduces the output

- **WHEN** the owner reloads a chat after a `web_search` call completed
- **THEN** the reloaded tool part equals the normalized output of the results that the model received inline

#### Scenario: A public share omits the search

- **WHEN** the owner publicly shares a chat that contains a `web_search` call
- **THEN** the shared view contains no `web_search` tool part, input, output, or notes

### Requirement: API and keyless engines speak their vendor wire

`brave`, `exa`, and `perplexity` (Search API) use a key. `searxng` uses its
`baseUrl`. `exa-mcp` calls the hosted Exa MCP tool `web_search_exa` from llame
code with an optional key. `duckduckgo` posts to the HTML endpoint.
`deepseek`, `parallel`, `parallel-mcp`, and `yandex` are also engine types.
Each engine MUST map `recency` and the fetch size where its vendor supports
them. Each engine MUST refuse redirects and MUST send a key only to its own
host.

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

### Requirement: DeepSeek engines call the DeepSeek search API

A `deepseek` engine MUST post to `https://api.deepseek.com/v1/tools/search`
with its key as a bearer token. It MUST send the query, and the fetch size as
`count`. It MUST add `recency` to the query as an `after:` date. When the date
would put the query over its limit, the engine MUST omit the date and note
that. The snippet MUST be `summary`, else `snippet`. HTTP 401 and 403 MUST map
to `auth`, 429 to `rate_limited`, 408 and 504 to `timeout`, and others to
`upstream_error`.

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

A `parallel` engine MUST post to `https://api.parallel.ai/v1/search` with its
key in `x-api-key`. It MUST send the query as the only `search_queries` entry,
its `mode`, the fetch size as `max_results`, and the Chat id as `session_id`.
It MUST move `site:` hosts to included domains and `-site:` hosts to excluded
domains, and note ignored exclusions. It MUST send `recency` as `after_date`.
The snippet MUST be the first excerpt, without a title copy at its start.
HTTP statuses MUST map as for `deepseek`.

#### Scenario: Site operators become the source policy

- **WHEN** the query is `rerank site:arxiv.org`
- **THEN** the request has `arxiv.org` as an included domain and `rerank` as the query

#### Scenario: The Chat id is the session

- **WHEN** a Run in a Chat calls a `parallel` engine twice
- **THEN** both requests send that Chat id as `session_id`

### Requirement: Yandex engines call the Yandex web search API

A `yandex` engine MUST post to
`https://searchapi.api.cloud.yandex.net/v2/web/search` with `Api-Key`
authorization. It MUST send its `searchType`, and its `folderId` when set. It
MUST request flat groups with one document in each group, so that the fetch
size counts results. It MUST decode the base64 XML response. `day` MUST map to
one day and `month` to one month. `week` MUST map to two weeks, with a note.
`year` MUST NOT set a period, and the engine MUST note that.

#### Scenario: Flat groups keep the limit

- **WHEN** the fetch size is 5 and Yandex finds two results on one host
- **THEN** the request has flat groups with one document each, and the output contains both results

#### Scenario: Week recency becomes two weeks with a note

- **WHEN** the call sets `recency: "week"`
- **THEN** the request uses the two-week period
- **AND** the notes state that `yandex` mapped `week` to two weeks

### Requirement: Removed entries can empty an engine outcome

The call MUST remove entries from each engine outcome before the chain decides
on it. An `aggregate` MUST remove them before the merge and the fetch-size cut.
An engine with no result left is empty, and the chain advances. An answer with
no citation left MUST fail with `ungrounded`. Answer text MUST keep the text of
a link to a removed URL, and MUST drop its target and each bare copy.

#### Scenario: A fully removed result list advances the chain

- **WHEN** the chain is `["brave", "exa"]`, the `read` group rejects every result of `brave`, and `exa` returns allowed results
- **THEN** the output has the results of `exa`
- **AND** its notes name `brave` as empty

#### Scenario: An answer without allowed citations is ungrounded

- **WHEN** a `model-hosted` engine answers and the `read` group rejects each of its citations
- **THEN** the engine fails with `ungrounded` and the chain advances

#### Scenario: Answer text loses a rejected link

- **WHEN** a hosted answer contains `[Grokipedia](https://grokipedia.com/x)` and an allowed citation, and the `read` group rejects `grokipedia.com`
- **THEN** the answer contains `Grokipedia` without that URL and keeps the allowed citation

### Requirement: Attached answers fit the result cap after results

Each attached answer MUST have a maximum of 8,000 UTF-16 units and 20
citations. When the inline text is over 15,000 units, results MUST leave the
inline text from the end first. Then citations MUST leave from the end of each
answer, last answer first, and each answer MUST keep one. Then answer text MUST
be cut, last answer first. Then whole answers MUST leave from the end. The
artifact MUST hold every result, answer, and citation. Each step MUST add one
inline note with its count.

#### Scenario: Results go before answers

- **WHEN** an aggregate output with 20 results and one answer of 8,000 units is over the result cap
- **THEN** results from the end leave the inline text first, and the answer text stays complete when it then fits

#### Scenario: Whole answers go last

- **WHEN** eight attached answers each keep one citation with a URL of 2,048 units
- **THEN** whole answers leave the inline text from the end until it fits, with one note
- **AND** the artifact holds all eight answers

#### Scenario: Each answer keeps a citation

- **WHEN** two attached answers of 8,000 units with 20 citations each are over the result cap
- **THEN** each answer keeps its first citation inline and the inline text fits the result cap

## ADDED Requirements

### Requirement: Results past the inline part go to an artifact

When the inline text leaves out a result, an answer, or a citation, the
system MUST store the whole output as one artifact. The artifact
uses the `web_search` text shape. The inline text MUST end with the artifact notice. A call whose results
all fit inline MUST NOT create an artifact.

#### Scenario: Twenty results with a limit of ten

- **WHEN** `webSearch.fetchLimit` is 20, `limit` is 10, and the engine returns 20 results
- **THEN** ten results render inline
- **AND** `artifact://web_search-<n>` holds all 20 results in rank order

#### Scenario: Reading the artifact sends no request

- **WHEN** the model reads `artifact://web_search-<n>`
- **THEN** no engine sends an outbound request
