## Purpose

Lets the model search the web through one stable code-owned tool whose engines the operator
configures, falls back between, fans out across, or delegates to a provider's hosted search.

## ADDED Requirements

### Requirement: The web search tool has one stable model-facing contract

The code-owned inventory SHALL include `web_search`, classified `read_only`, eligible only through its own exact `tools.allowed` entry and authorized per call by `tools.permissions.web_search`. Its input SHALL be a strict object with a required `query` string of 1 to 1,000 UTF-16 units, an optional `recency` of `day`, `week`, `month`, or `year`, and an optional integer `limit` from 1 to 20 that defaults to 10. The model SHALL NOT be able to select an engine.

#### Scenario: Unknown argument is refused

- **WHEN** the model calls `web_search` with `{ "query": "x", "engine": "brave" }`
- **THEN** the call fails schema validation and no engine is contacted

#### Scenario: Default limit

- **WHEN** the model calls `web_search` with only a query and the answering engine returns 15 results
- **THEN** the output contains at most 10 results

#### Scenario: Permission rejection sends nothing

- **WHEN** `tools.permissions.web_search` rejects a call by a clause on `query`
- **THEN** the call returns the permission rejection observation
- **AND** no outbound request is made by any engine

### Requirement: Output is a closed, normalized union

A successful call SHALL return either `kind: "results"` with `results` entries of `title`, `url`, optional `snippet`, and optional `published`, or `kind: "answer"` with `answer` text and at least one citation of `url` and optional `title`. Both SHALL carry `engine`, `query`, and optional `notes`. `engine` SHALL be the operator id of the answering engine, or of the last empty engine when the chain ends empty. No other vendor field SHALL appear.

#### Scenario: Results output from a result engine

- **WHEN** a result engine returns three hits
- **THEN** the output is `kind: "results"` with three entries and `engine` set to that engine's operator id

#### Scenario: Ignored option is noted

- **WHEN** the call sets `recency` and the answering engine cannot apply it
- **THEN** the output's `notes` states that `recency` was not applied by that engine

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

Lengths count JavaScript UTF-16 code units, cut at a code-point boundary. Titles SHALL be at most 200, snippets 300, and answers 8,000 units; `published` SHALL be present only as an ISO 8601 date; results SHALL be cut to `limit` and citations to 20. `notes` SHALL hold at most 10 notes of at most 200 UTF-16 units each; when more are due, the tenth SHALL record the remainder as `<n> more engines`.

#### Scenario: Long snippet is cut

- **WHEN** an engine returns a 2,000-character snippet
- **THEN** the stored and model-visible snippet is at most 300 characters

#### Scenario: Long answer is cut

- **WHEN** a hosted engine answers with 12,000 units of text and three citations
- **THEN** the answer is cut to 8,000 units with a note and all three citations remain

### Requirement: The serialized output fits the result cap

When the JSON-serialized output, `query`, `engine`, and `notes` included, would exceed 15,000 UTF-16 units, trailing results or citations SHALL be dropped with a note until it fits, so generic result truncation never cuts a URL. An `answer` output SHALL keep at least its first citation; when it still does not fit, its answer text SHALL be cut further until it does.

#### Scenario: Oversized output drops trailing entries

- **WHEN** 20 results with maximum-length fields would serialize beyond 15,000 characters
- **THEN** trailing results are dropped until the output fits, with a note stating how many
- **AND** every remaining URL is complete

#### Scenario: A maximal answer keeps a citation

- **WHEN** a hosted engine answers with 8,000 units of text and 20 citations whose URLs are each 2,000 units long, for a 1,000-unit query
- **THEN** trailing citations are dropped with a note until the output fits
- **AND** at least the first citation remains

### Requirement: The chain tries engines in order and advances on failure or emptiness

The call SHALL run the engines of `webSearch.chain` in order and SHALL return the first engine outcome with at least one result or a grounded answer. An engine that fails or returns no results SHALL advance the chain. A returned output's notes SHALL name every other attempted engine that failed, with its class, or was empty. When the chain is exhausted and any engine was empty, the call SHALL succeed with zero results.

#### Scenario: Failure falls through

- **WHEN** the chain is `["brave", "exa"]`, `brave` answers HTTP 503, and `exa` returns results
- **THEN** the output carries `exa`'s results with `engine: "exa"`
- **AND** its notes name `brave` with `upstream_error`

#### Scenario: Empty falls through

- **WHEN** the chain is `["brave", "exa"]`, `brave` returns no results, and `exa` returns results
- **THEN** the output carries `exa`'s results
- **AND** its notes name `brave` as empty

#### Scenario: All engines empty or failed

- **WHEN** the chain is `["brave", "exa"]`, `brave` fails with `auth`, and `exa` returns no results
- **THEN** the call succeeds with `kind: "results"`, an empty `results` list, and `engine: "exa"`
- **AND** its notes name `brave` with `auth`

#### Scenario: A failure after an empty engine is noted

- **WHEN** the chain is `["brave", "exa"]`, `brave` returns no results, and `exa` fails with `auth`
- **THEN** the call succeeds with an empty `results` list and `engine: "brave"`
- **AND** its notes name `exa` with `auth`

### Requirement: Total failure is a fixed, non-disclosing error

When every chain engine fails, the call SHALL return a tool error naming each attempted engine id with one class from `auth`, `rate_limited`, `challenge`, `timeout`, `ungrounded`, or `upstream_error`. Engine errors, notes, logs, and Run events SHALL NOT contain upstream status text or bodies, request headers, configured keys, or configured base URLs.

#### Scenario: Authorization failure

- **WHEN** the only chain engine answers HTTP 401 with a body echoing its key
- **THEN** the tool error names that engine with class `auth`
- **AND** neither the key nor the body appears in the tool part, Run events, or logs

#### Scenario: Rate limit

- **WHEN** the only chain engine answers HTTP 429
- **THEN** the tool error names that engine with class `rate_limited`

### Requirement: Engine and call deadlines bound every search

Each engine attempt SHALL be aborted after its `timeoutSeconds`, defaulting to 60, and classified `timeout`. The whole call, including every chain step and aggregate child, SHALL be bounded by `tools.callTimeoutSeconds`; when it elapses, every in-flight engine request SHALL be aborted and the call SHALL settle with the runner's timeout observation. Run cancellation SHALL abort in-flight engine requests.

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

An `aggregate` engine SHALL run all its children concurrently and wait until each settles. It SHALL group results by canonical URL ignoring a leading `www.` and a trailing path `/`, score each URL by `Σ 1/(60 + rank)` over the children that returned it, order by score, emit each group with its best-ranked member's URL, keep the longest snippet, and cut to `limit`. With no child results it SHALL be empty when at least one child was empty, and fail otherwise.

#### Scenario: Shared result ranks first

- **WHEN** child A returns `[u1, u2]` and child B returns `[u3, u1]`
- **THEN** the merged order begins with `u1`

#### Scenario: A grouped result keeps a real spelling

- **WHEN** child A returns `https://www.example.com/docs/` first and child B returns `https://example.com/docs` second
- **THEN** one merged entry is emitted with URL `https://www.example.com/docs/`

#### Scenario: Partial failure still answers

- **WHEN** one child fails with `rate_limited` and another returns results
- **THEN** the aggregate returns the successful child's results with a note naming the failed child

#### Scenario: A failed and an empty child are empty

- **WHEN** one child fails with `auth` and the other returns no results
- **THEN** the aggregate outcome is empty and the chain advances

#### Scenario: Every child fails

- **WHEN** every child of an aggregate fails
- **THEN** the aggregate outcome is `upstream_error` and the chain advances

#### Scenario: Cancellation aborts every child

- **WHEN** the Run is cancelled while two aggregate children are in flight
- **THEN** both requests are aborted

### Requirement: API and keyless engines speak their vendor wire

Engine types SHALL be `brave`, `exa`, and `perplexity` (Search API) with a required key; `searxng` against its configured `baseUrl`; `exa-mcp`, calling Exa's hosted MCP `web_search_exa` tool from llame code with an optional key; and `duckduckgo`, posting to the HTML endpoint. Each SHALL map `recency` and `limit` where its vendor supports them, refuse redirects, and send a key only to its own host.

#### Scenario: Keyless Exa MCP

- **WHEN** an `exa-mcp` engine without a key runs a query
- **THEN** llame calls the hosted MCP tool itself and returns normalized results
- **AND** no MCP tool from that endpoint is declared to the model

#### Scenario: DuckDuckGo challenge

- **WHEN** the DuckDuckGo endpoint answers with its bot-challenge page
- **THEN** the engine outcome is `challenge` and the chain advances

#### Scenario: A redirect never carries the key

- **WHEN** a `brave` engine's response is a redirect to another host
- **THEN** the redirect is not followed, no request reaches the other host, and the outcome is `upstream_error`

### Requirement: Model-hosted engines run a bounded grounded sub-request

A `model-hosted` engine SHALL send one request to its configured model, with that model's credentials and headers on the `search` session lane, no reasoning effort, as title generation sends none, and never the Run's, and the provider's hosted web search enabled. The request SHALL contain only packaged instructions, the query, and a recency phrase when set. It SHALL answer with the final text and, as citations, the URLs that text cites.

#### Scenario: Different Run model

- **WHEN** a Run on an `opencode-go` model calls `web_search` and the chain's engine is `model-hosted` on an `anthropic-messages` model
- **THEN** the call returns `kind: "answer"` with citations from the Anthropic sub-request

#### Scenario: Ungrounded answer is a failure

- **WHEN** the hosted sub-request returns empty text, or text that cites no URL
- **THEN** the engine outcome is `ungrounded` and the chain advances

#### Scenario: No chat context leaves the instance

- **WHEN** a model-hosted engine runs inside a chat with prior turns and a system prompt
- **THEN** the sub-request contains neither the prior turns nor the system prompt

### Requirement: Stored output is the normalized result only

The persisted tool part SHALL contain the normalized output and no raw vendor payload. It SHALL replay into later turns as untrusted tool output like any other tool result, and SHALL NOT appear in public chat shares.

#### Scenario: Reload reproduces the output

- **WHEN** the owner reloads a chat after a `web_search` call completed
- **THEN** the reloaded tool part equals the normalized output the model received

#### Scenario: A public share omits the search

- **WHEN** the owner publicly shares a chat containing a `web_search` call
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
