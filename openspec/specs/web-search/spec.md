# web-search Specification

## Purpose

Lets the model search the web through one stable code-owned tool whose engines the operator
configures, falls back between, fans out across, or delegates to a provider's hosted search.

## Requirements

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

- **WHEN** the model calls `web_search` with only a query, the engine that answers returns 15 results, and the Run can read artifacts
- **THEN** the inline text shows a maximum of 10 results
- **AND** the artifact of the call holds all 15 results

#### Scenario: Permission rejection sends nothing

- **WHEN** `tools.permissions.web_search` rejects a call by a clause on `query`
- **THEN** the call returns the permission rejection observation
- **AND** no engine sends an outbound request

#### Scenario: Duplicate engine ids fail validation

- **WHEN** the model calls `web_search` with `{ "query": "x", "engines": ["brave", "brave"] }`
- **THEN** the call fails schema validation and no engine sends a request

### Requirement: Output is a closed, normalized union

A successful call MUST return `kind: "results"` or `kind: "answer"`. A results output has `results` entries with `title`, `url`, and optional `snippet` and `published`, and an `aggregate` can add `answers`. An answer output has `answer` text and one or more citations with `url` and optional `title`. Each output has `engine`, `query`, and optional `notes`. `engine` is the operator id of the engine that answered, or of the last empty engine when none answers. Other vendor fields MUST NOT occur.

#### Scenario: Results output from a result engine

- **WHEN** a result engine returns three hits
- **THEN** the output is `kind: "results"` with three entries and `engine` is the operator id of that engine

#### Scenario: Ignored option is noted

- **WHEN** the call sets `recency` and the engine that answers cannot apply it
- **THEN** the `notes` of the output state that the engine did not apply `recency`

#### Scenario: Aggregate output can carry answers

- **WHEN** an `aggregate` engine has a result child and a `model-hosted` child, and both succeed
- **THEN** the output is `kind: "results"` with merged `results` and one `answers` entry

### Requirement: Result URLs are canonical web locators

Every result and citation `url` SHALL be parsed as a WHATWG URL with scheme `http:` or `https:` and no userinfo, have its fragment removed and its path and query escapes normalized as native `read` normalizes web locators, and SHALL NOT have a selector split off. A literal `:` in the last path segment of a query-free URL SHALL be emitted as `%3A`. Entries failing this, or longer than 2,048 characters, SHALL be dropped.

#### Scenario: Non-web and credential URLs are dropped

- **WHEN** an engine returns entries with URLs `javascript:alert(1)`, `https://user:pw@example.com/a`, and `https://Example.com/a#top`
- **THEN** the output contains only `https://example.com/a`

#### Scenario: A colon in the last segment stays readable

- **WHEN** an engine returns `https://en.wikipedia.org/wiki/Category:Search_engines`
- **THEN** the output URL is `https://en.wikipedia.org/wiki/Category%3ASearch_engines`
- **AND** passing it to `read` fetches that page rather than refusing a selector

### Requirement: Output fields are bounded within the result cap

Lengths MUST count JavaScript UTF-16 code units, cut at a code-point boundary.
Titles MUST hold at most 200 units, snippets 300, and answers 8,000.
`published` MUST be present only as an ISO 8601 date.
The output MUST hold at most the fetch size of results and 20 citations.
An aggregate with `webSearch.rerank.model` set MUST retain its whole merged
result set instead of the fetch-size count cap.
The inline and artifact bounds still apply.
`notes` MUST hold at most 10 notes of at most 200 units each.
Without a rank failure, the tenth note MUST summarize any excess as `<n> more engines`.
With a rank failure, the system MUST reserve the last note for `rerank: unavailable`.
The removal note MUST stay first.
The last available engine-note slot MUST summarize any excess engine notes as `<n> more engines`.

#### Scenario: Long snippet is cut

- **WHEN** an engine returns a 2,000-character snippet
- **THEN** the stored snippet and the snippet that the model reads are at most 300 characters

#### Scenario: Long answer is cut

- **WHEN** a hosted engine answers with 12,000 units of text and three citations
- **THEN** the answer is cut to 8,000 units with a note and all three citations remain

#### Scenario: A failure note stays visible at the note cap

- **WHEN** a ranked call has a removal note, eleven engine notes, and a failed rank call
- **THEN** `notes` holds ten entries
- **AND** the removal note is first, seven engine notes follow, the ninth note is `4 more engines`
- **AND** the last note is `rerank: unavailable`

### Requirement: The serialized output fits the result cap

The inline text MUST hold at most `limit` results and MUST fit in 15,000 UTF-16
units, with its other lines. When a result does not fit, the inline text MUST
end before it. An artifact of the call MUST hold every result. An `answer`
output MUST keep at least its first citation inline. When it still does not
fit, the tool MUST cut the answer text further until it does. The tool MUST NOT cut
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

### Requirement: The chain tries engines in order and advances on failure or emptiness

The call MUST run the engines of `webSearch.chain` in order, or the listed `engines` in their order when the call sets them. A call with `engines` MUST NOT run other engines. The call MUST return the first outcome with results or a grounded answer. A failed or empty engine MUST advance to the next engine. The notes MUST name each other attempted engine that failed, with its class, or was empty. When no engine succeeds and an engine was empty, the call MUST succeed with zero results.

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

When each attempted engine fails, the call MUST return a tool error. The error MUST name each attempted engine id with one class: `auth`, `rate_limited`, `challenge`, `timeout`, `ungrounded`, `unsupported`, or `upstream_error`. Engine errors, notes, logs, and Run events MUST NOT contain upstream status text or bodies, request headers, configured keys, folder ids, or base URLs.

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

### Requirement: Engine and call deadlines bound every search

Each non-aggregate engine attempt SHALL be aborted after its `timeoutSeconds`, defaulting to 60, and classified `timeout`. The whole call, including every chain step and aggregate child, SHALL be bounded by `tools.callTimeoutSeconds`; when it elapses, every in-flight engine request SHALL be aborted and the call SHALL settle with the runner's timeout observation. Run cancellation SHALL abort in-flight engine requests.

#### Scenario: Slow engine advances the chain

- **WHEN** the first chain engine has `timeoutSeconds: 5` and does not answer within 5 seconds
- **THEN** its request is aborted, it is recorded as `timeout`, and the next engine runs

#### Scenario: The call deadline aborts every engine

- **WHEN** `tools.callTimeoutSeconds` elapses while a chain engine's request is in flight
- **THEN** that request is aborted, no later chain engine starts, and the call settles with the runner's timeout observation

#### Scenario: Cancellation aborts requests

- **WHEN** the owner cancels the Run while an engine request is in flight
- **THEN** that request is aborted and the tool call settles as cancelled

### Requirement: Aggregate engines fan out and merge by rank fusion

An `aggregate` MUST run each child that accepts the query concurrently.
It MUST wait until each child settles.
It MUST group results by canonical URL, without `www.` at the host start
and without `/` at the path end.
It MUST score each URL by `Σ 1/(60 + rank)` over the children that return it.
It MUST order the results by score.
A group MUST use its best-ranked URL and the longest snippet.
Without `webSearch.rerank.model`, the aggregate MUST cut the merged list
to the fetch size.
With that setting, it MUST retain the whole merged list for the guard,
rank call, and artifact.
If the rank call fails, the retained list MUST keep its rank-fusion order.
An aggregate with no result MUST be empty when a child was empty.
In other cases it MUST fail.

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

#### Scenario: A configured rank call sees every merged candidate

- **WHEN** two children each return 20 distinct results, the fetch size is 20, `limit` is 10, and `webSearch.rerank.model` is set
- **THEN** all 40 merged results become cards
- **AND** the first 10 results in rank order appear inline
- **AND** the artifact holds all 40 when the Run can read artifacts and the output fits the artifact bound

#### Scenario: An aggregate without a rank model keeps its fetch-size cut

- **WHEN** two children each return 20 distinct results, the fetch size is 20, and no rank model is set
- **THEN** the aggregate returns the first 20 merged results in rank-fusion order

#### Scenario: A failed rank call keeps the full merged candidate set

- **WHEN** two children each return 20 distinct results, the fetch size is 20, and the configured rank call fails
- **THEN** the retained 40 results keep rank-fusion order and the output carries `rerank: unavailable`
- **AND** the artifact holds all 40 when the Run can read artifacts and the output fits the artifact bound

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

### Requirement: Model-hosted engines run a bounded grounded sub-request

A `model-hosted` engine MUST send one request with the hosted web search of the provider to its configured model. The request MUST use the credentials and headers of that model on the `search` session lane, never those of the Run. It MUST send no reasoning effort. It MUST contain only packaged instructions, the query, a recency phrase when `recency` is set, and a `Goal:` line when `objective` is set. The answer is the final text, and the citations MUST be the URLs that the text cites.

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

### Requirement: Stored output is the normalized result only

The persisted tool part MUST contain the normalized output of the inline
results and no raw vendor payload. When the call has an artifact, the part
MUST also name its locator. The part MUST replay into later turns as the live
loop sent it, like any other tool result. It MUST NOT appear in public chat
shares.

#### Scenario: Reload reproduces the output

- **WHEN** the owner reloads a chat after a `web_search` call completed
- **THEN** the reloaded tool part equals the normalized output of the results that the model received inline

#### Scenario: A public share omits the search

- **WHEN** the owner publicly shares a chat that contains a `web_search` call
- **THEN** the shared view contains no `web_search` tool part, input, output, or notes

### Requirement: The chat renders web search results as links

The web chat SHALL render `web_search` tool parts, live and from history, with a dedicated renderer: results as numbered title links with host, date, and snippet; answers as Markdown followed by numbered citation links; the engine id and notes; a running state; a cancelled state for a cancelled call; and the error on failure. Only `http:` and `https:` URLs SHALL render as links, under the same external-link safety handling as assistant Markdown.

#### Scenario: Results are clickable

- **WHEN** a completed `web_search` part with three results is displayed
- **THEN** three title links to the result URLs are shown

#### Scenario: Answer citations are clickable

- **WHEN** a completed `web_search` part of kind `answer` is displayed
- **THEN** each citation renders as a link to its URL

#### Scenario: A cancelled search is not shown as an error

- **WHEN** a `web_search` part settled as cancelled is displayed
- **THEN** it renders in the cancelled state without error text

#### Scenario: Historical part renders the same

- **WHEN** a chat containing a `web_search` part is loaded from history
- **THEN** it renders exactly as it did live

### Requirement: Engines skip queries over their query limit

A result or answer engine MUST NOT send a request when the submitted query is over its query limit. It MUST fail with `unsupported`. Limits count code points: `deepseek` 128, `parallel` and `parallel-mcp` 200, `yandex` 400 and 40 words, `brave` 600 and 75 words. A word is a run of non-space characters. Other types have no limit below 1,000 units. An `aggregate` has no limit of its own.

#### Scenario: An over-long query skips the engine

- **WHEN** the chain is `["brave", "exa"]` and the query has 650 characters
- **THEN** `brave` sends no request and `exa` returns the results
- **AND** the notes name `brave` with `unsupported`

#### Scenario: A word limit applies

- **WHEN** a `yandex` engine receives a query of 45 words and 300 characters
- **THEN** the engine sends no request and fails with `unsupported`

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

### Requirement: Aggregate engines run only the children that accept the query

An `aggregate` engine MUST NOT run a child when the query is over the query limit of that child. The aggregate MUST note that child with `unsupported` and MUST run its other children. When the query limit skips all children, the aggregate MUST fail with `unsupported`.

#### Scenario: The aggregate skips one child

- **WHEN** an `aggregate` has the children `brave` and `exa` and the query has 650 characters
- **THEN** only `exa` sends a request
- **AND** the notes name `brave` with `unsupported`

#### Scenario: The aggregate skips every child

- **WHEN** an `aggregate` has the `brave` children `brave-a` and `brave-b` and the query has 650 characters
- **THEN** no child sends a request and the aggregate fails with `unsupported`

### Requirement: The call removes the results that the read permission group rejects

This requirement applies when the effective permission mode is `default` or `read-only`. The call MUST remove each result and citation whose URL a `read` reject clause matches, as `read` decides for that URL. A whole-tool `read` reject or an absent `read` allow MUST NOT remove an entry. The `bypass` mode MUST NOT remove entries. These clauses MUST NOT admit or refuse the call.

#### Scenario: The call removes a rejected host

- **WHEN** the `read` group rejects `^https://grokipedia\.com/` and an engine returns a `grokipedia.com` result and two other results
- **THEN** the output contains only the two other results
- **AND** a note states that the call removed one entry and does not contain `grokipedia`

#### Scenario: No read allow keeps the results

- **WHEN** the `read` group has no allow for `^https://` and no reject that matches the results
- **THEN** the output keeps every result

#### Scenario: A whole-tool read reject keeps the results

- **WHEN** the `read` group sets `reject: true` for the whole tool
- **THEN** the output keeps every result

#### Scenario: Bypass keeps the results

- **WHEN** the effective permission mode of the attempt is `bypass` and the `read` group rejects a result host
- **THEN** the output keeps that result

#### Scenario: Read-only removes a rejected host

- **WHEN** the effective permission mode of the attempt is `read-only` and the `read` group rejects a result host
- **THEN** the output does not contain that result

### Requirement: The call removes the results of excluded hosts

The call MUST remove each result and citation whose host is a `-site:` host of the query, or a subdomain of it. This rule MUST apply to each engine, also an engine that does not apply `-site:` itself.

#### Scenario: An engine that ignores -site: still loses the host

- **WHEN** the query is `pgvector -site:reddit.com` and an engine returns a result from `old.reddit.com`
- **THEN** the output does not contain that result

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

### Requirement: One note counts the removed entries

When the call removes entries from the output it returns, the output MUST carry one note with their number. That note MUST come before the other notes, and it MUST NOT name a removed URL or host.

#### Scenario: The count note comes first

- **WHEN** an aggregate output loses three entries to removal and has two engine notes
- **THEN** the first note states that the call removed three entries

### Requirement: The description names only the portable search operators

The packaged `web_search` description MUST name `site:`, `-site:`, and quoted phrases as the supported search operators. It MUST state that an engine can search other operators as plain words. It MUST NOT name `after:`, `before:`, `lang:`, `filetype:`, `intitle:`, `inurl:`, or `OR` as supported.

#### Scenario: The packaged description names the portable operators

- **WHEN** a worker renders the packaged `web_search` description
- **THEN** it names `site:`, `-site:`, and quoted phrases
- **AND** it states that other operators can reach an engine as plain words
- **AND** it does not name `after:`, `before:`, `lang:`, `filetype:`, `intitle:`, `inurl:`, or `OR` as supported

### Requirement: Hosted engines map site operators to domain filters

A `model-hosted` engine MUST send `site:` hosts as the allowed domains and `-site:` hosts as the blocked domains of the hosted search tool. On `anthropic-messages`, when both exist, the engine MUST send only the allowed domains and MUST note that it ignored the exclusions.

#### Scenario: An excluded host becomes a blocked domain

- **WHEN** a `model-hosted` engine receives the query `pgvector -site:reddit.com`
- **THEN** the hosted search tool receives `reddit.com` as a blocked domain

#### Scenario: Included hosts win over excluded hosts on Anthropic

- **WHEN** an `anthropic-messages` hosted engine receives `pgvector site:github.com -site:gist.github.com`
- **THEN** the hosted search tool receives only `github.com` as an allowed domain
- **AND** the notes state that the engine ignored the exclusions

### Requirement: Engines receive the objective where their vendor accepts one

`parallel`, `parallel-mcp`, `exa`, and `exa-mcp` MUST send `objective` as the vendor `objective`. Without `objective`, `parallel-mcp`, `exa`, and `exa-mcp` MUST send the query there. `deepseek` MUST send the first 128 code points as `ori_question`, without a note. `model-hosted` MUST add a `Goal:` line. Each other engine MUST ignore `objective` without a note, and the call MUST NOT refuse it. An engine MUST NOT add `objective` to the query.

#### Scenario: Parallel receives the objective

- **WHEN** the call sets `objective` and the engine is `parallel`
- **THEN** the request body has that text as `objective` and the query as the only `search_queries` entry

#### Scenario: DeepSeek receives a cut objective without a note

- **WHEN** the call sets an `objective` of 300 characters and the engine is `deepseek`
- **THEN** `ori_question` is the first 128 code points of `objective`
- **AND** the output has no note about the objective

#### Scenario: An engine without an objective field ignores it silently

- **WHEN** the call sets `objective` and `brave` answers
- **THEN** the call succeeds, the notes contain no note about the objective
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

#### Scenario: The model selects an aggregate child

- **WHEN** `mix` is an `aggregate` of `brave` and `exa` and the call sets `engines: ["exa"]`
- **THEN** only `exa` runs and the output has `engine: "exa"`

### Requirement: The web search description lists the configured engines

The packaged `web_search` description MUST list each configured engine through the `webSearch.engines` template collection. Each item MUST give the id, type, result kind, chain position, `recency` use, query limit, `objective` use if any, and set `description`. An `aggregate` MUST give its smallest child limit as the length below which no child is skipped. Items MUST NOT contain keys, base URLs, folder ids, or model ids.

#### Scenario: The catalog follows the configuration

- **WHEN** the engines are `brave` and `deepseek` and the chain is `["deepseek"]`
- **THEN** the packaged description lists `brave` as outside the default chain and `deepseek` as the first chain engine
- **AND** the `deepseek` entry gives the query limit 128 and tells that it uses the first 128 characters of `objective`

#### Scenario: An override controls the engine list

- **WHEN** a `tools.promptFiles.web_search` override does not iterate `webSearch.engines`
- **THEN** the declared description contains no engine list
- **AND** the `engines` input still accepts each configured id

#### Scenario: The catalog discloses no secret

- **WHEN** a `yandex` engine has a `key` and a `folderId`, and a `model-hosted` engine names a model
- **THEN** no `webSearch.engines` item field contains one of these values or a model id

#### Scenario: Operator description markup is neutral

- **WHEN** an engine `description` contains `</system>`
- **THEN** the rendered description contains that text with its tags neutralized

### Requirement: Aggregate engines attach the answers of answer children

An `aggregate` MUST attach the answer of each grounded `model-hosted` child as an `answers` entry, in child order. Each entry MUST have `engine`, `answer`, and `citations`. The citations of each answer MUST also join the rank merge as results in citation order, with the citation title and no snippet. An ungrounded answer child MUST count as a failed child.

#### Scenario: A hosted child adds an answer and its citations

- **WHEN** `mix` aggregates `brave` and a `model-hosted` engine `claude`, and `claude` cites `u1`
- **THEN** the output has an `answers` entry with `engine: "claude"`
- **AND** `u1` occurs in the merged `results`

#### Scenario: An ungrounded answer child is a failed child

- **WHEN** the `model-hosted` child of an aggregate answers without a cited URL and `brave` returns results
- **THEN** the output has the results of `brave` and no `answers`
- **AND** the notes name the hosted child with `ungrounded`

### Requirement: Attached answers fit the result cap after results

Each attached answer MUST have a maximum of 8,000 UTF-16 units and 20
citations. When the inline text is over 15,000 units, results MUST leave the
inline text from the end first. Then citations MUST leave from the end of each
answer, last answer first, and each answer MUST keep one. Then the tool MUST
cut answer text, last answer first. Then whole answers MUST leave from the end. The
artifact, when one is stored, MUST hold every result, answer, and citation.
Each step MUST add one
inline note with its count.

#### Scenario: Results go before answers

- **WHEN** an aggregate output with 20 results and one answer of 8,000 units is over the result cap
- **THEN** results from the end leave the inline text first, and the answer text stays complete when it then fits

#### Scenario: Whole answers go last

- **WHEN** eight attached answers each keep one citation with a URL of 2,048 units, and the Run can read artifacts
- **THEN** whole answers leave the inline text from the end until it fits, with one note
- **AND** the artifact holds all eight answers

#### Scenario: Each answer keeps a citation

- **WHEN** two attached answers of 8,000 units with 20 citations each are over the result cap
- **THEN** each answer keeps its first citation inline and the inline text fits the result cap

### Requirement: The chat renders attached answers

The web chat MUST render each `answers` entry of a `web_search` part after the results, live and from history. Each entry MUST show its engine id, its answer as Markdown, and its numbered citation links. Only `http:` and `https:` citation URLs MUST render as links. Links in the answer MUST follow the link safety of the chat Markdown.

#### Scenario: Attached answers render

- **WHEN** a completed `web_search` part has three results and one `answers` entry
- **THEN** three result links show first, then the answer with its engine id and citation links

#### Scenario: A part without answers renders as before

- **WHEN** a chat loads a `web_search` part that a release without `answers` stored
- **THEN** it renders without error and shows its results

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

### Requirement: Keyless Parallel engines call the hosted Parallel MCP tool

A `parallel-mcp` engine MUST call the `web_search` tool of the hosted Parallel MCP endpoint from llame code, without a key. It MUST send `objective`, the query as the only `search_queries` entry, and the Chat id as `session_id`. A tool result that reports an error MUST map to `upstream_error`, and its text MUST NOT occur in the output. The model MUST NOT receive a declaration of a tool from that endpoint.

#### Scenario: The engine discloses no tool error

- **WHEN** the hosted tool returns a result with `isError` and a vendor message
- **THEN** the engine fails with `upstream_error`
- **AND** the vendor message does not occur in the tool part, Run events, or logs

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

### Requirement: Yandex engines classify errors from the response body

A `yandex` engine MUST read the error code in the XML response before it reads results, also after HTTP 200. Code 42 MUST map to `auth`, codes 32 and 55 to `rate_limited`, and code 100 to `challenge`. Codes 2 and 15 MUST give an empty outcome. Other codes, HTTP 5xx, and invalid bodies MUST map to `upstream_error`. HTTP 401 and 403 MUST map to `auth`, and 429 to `rate_limited`. The error text MUST NOT occur in the output.

#### Scenario: An in-body error after HTTP 200

- **WHEN** Yandex answers HTTP 200 with an XML error code 55
- **THEN** the engine fails with `rate_limited` and the chain advances

#### Scenario: No results is empty

- **WHEN** Yandex answers HTTP 200 with an XML error code 15
- **THEN** the engine outcome is empty

### Requirement: Results past the inline part go to an artifact

The inline text can leave out a result, an answer, or a citation. The system MUST
then store the whole output as one artifact in the `web_search` text shape,
when the Run can read artifacts and the output fits `tools.artifacts.maxBytes`. The inline text MUST then end with its notice. In other cases the
`tool-artifacts` no-artifact result applies. A call whose whole output fits
inline MUST NOT create an artifact.

#### Scenario: Twenty results with a limit of ten

- **WHEN** `webSearch.fetchLimit` is 20, `limit` is 10, the engine returns 20 results, and the Run can read artifacts
- **THEN** ten results render inline
- **AND** `artifact://web_search-<n>` holds all 20 results in rank order

#### Scenario: A read of the artifact sends no request

- **WHEN** the model reads `artifact://web_search-<n>`
- **THEN** no engine sends an outbound request

### Requirement: The aggregate candidate bound follows its children

A retained aggregate result set MUST hold at most the sum of its children's
admitted result counts.
Each child MUST keep its existing per-engine result bound and configured
fetch-size bound.
The rank stage MUST NOT add a separate candidate cut.

#### Scenario: A larger aggregate uses parallel requests

- **WHEN** three children each return 100 distinct admitted results and the fetch size is 100
- **AND** a rank model is configured
- **THEN** the rank call receives all 300 cards in two parallel requests
- **AND** the artifact holds all 300 when the Run can read artifacts and the output fits the artifact bound

### Requirement: One engine's results are deduplicated by URL

Before the rank call, the guard, and the output, the system MUST collapse the
results of the call that share the aggregate grouping key. The key MUST be the
canonical URL without a leading `www.` and without a trailing `/`. The first
occurrence MUST win. Later steps MUST use the deduplicated results, with their
count. The deduplication MUST NOT add a note.

#### Scenario: A repeated URL yields one result

- **WHEN** an engine returns the same URL twice
- **THEN** the output holds that URL once

#### Scenario: The first spelling wins

- **WHEN** an engine returns `https://www.example.com/docs/` before `https://example.com/docs`
- **THEN** the output holds one result with the URL `https://www.example.com/docs/`

#### Scenario: The left out count measures the deduplicated results

- **WHEN** an engine returns 13 results with one repeated URL, `limit` is 10, and the Run cannot read artifacts
- **THEN** the inline text holds 10 results
- **AND** the last line states that the call left out 2 results

#### Scenario: A repeat can remove the need to rank

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, and an engine returns 11 results with one repeated URL
- **THEN** the call sends no decision request
- **AND** the output holds the 10 results in engine order

### Requirement: Results are ranked by the objective before the inline cut

When `webSearch.rerank.model` is set, the system MUST rank each `results`
outcome unless the whole result fits inline. The rank MUST precede the
inline cut and the artifact. Each result MUST give one card
`[k] <title> — <host> — <snippet>` of at most 400 units. The key `k` MUST be
`p<index>`: the zero-based engine position, zero-padded to the width of the
last index. The system MUST judge each card against the `objective`, or against
the query when `objective` is absent.

#### Scenario: A fetched set over the limit is ranked

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, and the engine returns 20 results
- **THEN** the system sends one card for each of the 20 results
- **AND** the inline text shows the first 10 results in the rank order

#### Scenario: Card keys are padded to the last index

- **WHEN** a call ranks 12 results
- **THEN** the card keys run from `p00` to `p11`

#### Scenario: The query is the criterion without an objective

- **WHEN** the call sets no `objective` and the system ranks the results
- **THEN** the system judges each card against the query

#### Scenario: The artifact shares the rank order

- **WHEN** a ranked call leaves results out of the inline text and the Run can read artifacts
- **THEN** the artifact text and the artifact findings follow the rank order

#### Scenario: An answer output is not ranked

- **WHEN** `webSearch.rerank.model` is set and the engine returns `kind: "answer"`
- **THEN** the call sends no decision request
- **AND** the citations keep the citation order

### Requirement: A call that shows every result makes no decision call

The system MUST make no decision call when at most `limit` deduplicated
results fit wholly within the 15,000-unit inline bound. No minimum number
of results applies. Such a call MUST keep engine order and MUST NOT store
`display.rerank`.

#### Scenario: A fetched set within the limit makes no rank call

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, and the engine returns 5 results that fit inline
- **THEN** the call sends no decision request
- **AND** the output keeps the engine order and stores no `display.rerank`

#### Scenario: The size bound makes ranking useful

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, the engine returns 10 results, and the 15,000-unit bound cuts the text at 7 results
- **THEN** the system ranks the 10 results
- **AND** the inline text shows the first 7 results in the rank order

#### Scenario: A small set over the limit is ranked

- **WHEN** `webSearch.rerank.model` is set, `limit` is 1, and the engine returns 2 results
- **THEN** the system sends one card for each of the 2 results

### Requirement: Ranked results sort by score and keep engine order on a tie

The system MUST sort the judged results by score, highest first. A tie MUST
keep the engine order of the results. A result that the system did not judge
MUST follow the judged results in engine order. The type of the engine that
answers MUST NOT stop the rank call. Ranking MUST NOT change admission, retained
counts, or removal rules. The `left out` count MUST reflect the ranked inline cut.

#### Scenario: A tie keeps engine order

- **WHEN** two results receive the same score
- **THEN** the result with the earlier engine rank comes first

#### Scenario: The engine type does not stop the rank call

- **WHEN** `parallel` answers the call and `webSearch.rerank.model` is set
- **THEN** the system ranks the results of `parallel` like any other engine's results

#### Scenario: Counts and removal do not change

- **WHEN** a ranked call fetches 20 results, `limit` is 10, removal drops two entries, and ten results fit inline
- **THEN** the first note states that the call removed two entries
- **AND** the `left out` count is 8

#### Scenario: Ranked text changes the number of visible results

- **WHEN** ranking moves long results first and only seven of eighteen retained results fit inline
- **THEN** the `left out` notice reports eleven omitted results

### Requirement: A failed rank call keeps engine order and adds one note

An ordinary backend failure MUST NOT fail the tool call.
This rule MUST NOT override enclosing cancellation or timeout.
A rank call fails when no card receives an answer.
The system MUST keep the engine order and MUST add one note
with the text `rerank: unavailable`. The system MUST NOT store
`display.rerank` for that call. When the rank call judges only some results,
the system MUST use the rank order and MUST NOT add the note.

#### Scenario: A failed rank call is noted

- **WHEN** the decision endpoint fails for a call that ranks 20 results
- **THEN** the call succeeds with the results in engine order
- **AND** the output carries one note with the text `rerank: unavailable`
- **AND** the output stores no `display.rerank`

#### Scenario: A response with absent answers adds the failure note

- **WHEN** the decision endpoint answers only 15 of 20 questions in one request
- **THEN** the request fails and all 20 results keep engine order
- **AND** the notes contain `rerank: unavailable`
- **AND** the output stores no `display.rerank`
