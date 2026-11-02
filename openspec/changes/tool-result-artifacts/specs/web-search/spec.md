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

## ADDED Requirements

### Requirement: Results past the inline part go to an artifact

When the engines return more results than the inline text holds, the system
MUST store all results of the call as one artifact. The artifact uses the
`web_search` text shape. The inline text MUST end with the artifact notice. A call whose results
all fit inline MUST NOT create an artifact.

#### Scenario: Twenty results with a limit of ten

- **WHEN** `webSearch.fetchLimit` is 20, `limit` is 10, and the engine returns 20 results
- **THEN** ten results render inline
- **AND** `artifact://web_search-<n>` holds all 20 results in rank order

#### Scenario: Reading the artifact sends no request

- **WHEN** the model reads `artifact://web_search-<n>`
- **THEN** no engine sends an outbound request
