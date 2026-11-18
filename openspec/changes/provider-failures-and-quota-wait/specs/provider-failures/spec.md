## ADDED Requirements

### Requirement: Every failed model request has one failure class

Every send of a model request on a language-model wire that fails MUST have exactly one failure
class. The set is closed: `quota_exhausted`, `billing`, `rate_limited`, `overloaded`,
`server_error`, `unreachable`, `first_token_timeout`, `stream_broken`, `model_not_found`, `auth`,
`context_overflow`, `invalid_request`, `content_policy`, and `unknown`. A failure that matches no
other class MUST be `unknown`. Decision, rerank, and embedding requests are not in this scope.

#### Scenario: An unknown failure has a class

- **WHEN** an endpoint answers with HTTP 418 and a body that llame does not recognize
- **THEN** the request fails with the failure class `unknown`

#### Scenario: No other class value exists

- **WHEN** a test fails one request on each wire with each recognized shape
- **THEN** each failure class that it records is a member of the closed set

### Requirement: The wire client assigns the failure class

The client of each wire MUST assign the failure class before it sanitizes or bounds the error. The
order MUST be: the body error code, the in-stream error type, the HTTP status, and the transport
failure. The class MUST NOT depend on the message text when one of these
decides it. Credential redaction MUST NOT change the class.

#### Scenario: The Codex client classifies before it sanitizes

- **WHEN** the Codex endpoint answers with HTTP 429 and the body code `usage_limit_reached`
- **THEN** the request fails with the failure class `quota_exhausted`
- **AND** the failure message is the bounded Codex limit text, without the body or the headers

#### Scenario: An overloaded Anthropic endpoint

- **WHEN** an Anthropic endpoint answers with HTTP 529 and the error type `overloaded_error`
- **THEN** the failure class is `overloaded`

#### Scenario: A body code wins over a synthetic status

- **WHEN** a Codex stream sends an error frame with the code `usage_not_included` before any output, and the adapter reports it as status 500
- **THEN** the failure class is `billing`, and the request is not sent again

### Requirement: A usage limit that resets is quota_exhausted

A limit that resets on a time window MUST be `quota_exhausted`, also when it is a spend limit.
Examples are a Codex usage window, an OpenCode Go `GoUsageLimitError`, an OpenRouter budget with a
reset, and an Anthropic spend limit. A limit that a wait cannot clear MUST be `billing`. Examples
are exhausted credits, a plan without the model, and an OpenRouter lifetime budget.

#### Scenario: An OpenRouter budget block

- **WHEN** OpenRouter answers with HTTP 403, a budget `limit_source`, and a non-null `error.metadata.resets_at`
- **THEN** the failure class is `quota_exhausted`

#### Scenario: An OpenRouter lifetime budget

- **WHEN** OpenRouter answers with HTTP 403, a budget `limit_source`, and `error.metadata.resets_at` set to `null`
- **THEN** the failure class is `billing`

#### Scenario: Exhausted prepaid credits

- **WHEN** the OpenAI API answers with HTTP 429 and the error code `insufficient_quota`
- **THEN** the failure class is `billing`, and the request is not sent again

### Requirement: A short throttle is rate_limited

A throttle that is not a usage window or a spend limit MUST be `rate_limited`. A bare HTTP 429 with
no body code that names a usage limit MUST be `rate_limited`.

#### Scenario: A bare 429

- **WHEN** an `openai-completions` endpoint answers with HTTP 429 and no recognized body code
- **THEN** the failure class is `rate_limited`

### Requirement: A reset time comes only from the provider

A `quota_exhausted` or `rate_limited` failure MUST carry a reset time only when the provider states
one for the limit that failed. llame MUST NOT infer a reset time from a message or a calendar rule.
A `Retry-After` or `retry-after-ms` without a classified usage limit MUST be a hint, not a reset
time.

#### Scenario: An Anthropic spend limit has no reset time

- **WHEN** Anthropic answers with HTTP 429 and `error.details.error_code` `enforced_spend_limit_reached`
- **THEN** the failure class is `quota_exhausted`, and the failure has no reset time
- **AND** no reset time comes from the text "first of next month"

#### Scenario: A bare Retry-After is a hint

- **WHEN** an endpoint answers with HTTP 429, `Retry-After: 120`, and no body code that names a usage limit
- **THEN** the failure class is `rate_limited`, the failure has a hint of 120 seconds, and it has no reset time

### Requirement: Codex states its reset in the body or the window headers

For a Codex failure, the reset time MUST be `error.resets_at` in Unix seconds. Without it, the
reset time MUST be the `x-codex-primary-reset-at` or `x-codex-secondary-reset-at` of a window whose
used percent is at least 100. When both windows are exhausted, the later reset time MUST apply. A
window below 100 percent MUST NOT give a reset time.

#### Scenario: Both Codex windows are exhausted

- **WHEN** a Codex 429 carries no `error.resets_at`, and both window headers report 100 percent with two reset times
- **THEN** the reset time is the later of the two

#### Scenario: An unspent window does not give a reset time

- **WHEN** a Codex 429 carries no `error.resets_at`, and its only exhausted window has no reset header
- **THEN** the failure has no reset time, even though another window header has one

### Requirement: Anthropic, OpenRouter, and OpenAI state their resets in fields

For Anthropic, the reset time MUST be the latest `anthropic-ratelimit-*-reset` instant of the
buckets with no remaining capacity, and `retry-after` is then a hint only. For OpenRouter, it MUST
be a non-null `error.metadata.resets_at`. For the OpenAI API, it MUST be the receipt time plus the
`x-ratelimit-reset-*` duration of the exhausted bucket.

#### Scenario: An exhausted Anthropic bucket

- **WHEN** Anthropic answers with HTTP 429, and `anthropic-ratelimit-output-tokens-remaining` is 0
- **THEN** the reset time is the instant in `anthropic-ratelimit-output-tokens-reset`

### Requirement: OpenCode Go states its reset as Retry-After on a usage limit

For OpenCode Go, a 429 with the error type `GoUsageLimitError` and a `metadata.limitName` MUST be
`quota_exhausted`. Its reset time MUST be the receipt time plus its `Retry-After` seconds. Without a
`Retry-After`, the failure MUST have no reset time.

#### Scenario: A weekly Go limit

- **WHEN** the gateway answers with HTTP 429, `GoUsageLimitError`, the limit name of the weekly window, and `Retry-After: 86400`
- **THEN** the failure class is `quota_exhausted`, and the reset time is 86,400 seconds after receipt

### Requirement: A failed Run records the failure class as its code

When a model request ends a Run `failed`, the error of the Run MUST carry the failure class as
`code`. Its `run.failed` event MUST carry the same `code`. A caller that defines its own Run
code, such as `context_incompatible`, MUST keep that code. The failure message MUST stay the message
of the wire contract. A failure with a reset time MUST also carry `resetsAt`.

#### Scenario: A Run fails on a removed model

- **WHEN** the endpoint answers a Run request with HTTP 404 for an unknown model
- **THEN** the Run is `failed` with `error.code` `model_not_found`, and its `run.failed` event has the same code

### Requirement: The SDK makes no retry

Every request on a chat wire MUST send `maxRetries: 0` to the AI SDK. This covers the step requests,
compaction summaries, title generation, hosted web search, and structured generation. The AI SDK
MUST NOT send a request again after a failure.

#### Scenario: One request on a 503

- **WHEN** an `openai-responses` endpoint answers one request with HTTP 503 and then streams a reply
- **THEN** the endpoint receives exactly 2 sends
- **AND** a `model.retrying` event with retry number 1 comes before the second send

### Requirement: Transient failures get request retries

A send that fails as `overloaded`, `server_error`, `unreachable`, `rate_limited`,
`first_token_timeout`, or `stream_broken` MUST get a request retry on the same model. Before retry
`n`, from 1, llame MUST wait a random delay from 0 to `min(8000, 500 * 2^(n-1))` milliseconds. A
request MUST get at most 10 request retries, also across a restart of its step.

#### Scenario: Ten overloaded answers fail the request

- **WHEN** an endpoint answers one request and its 10 request retries with HTTP 529
- **THEN** the request fails with the failure class `overloaded` after 11 sends

#### Scenario: A retry succeeds

- **WHEN** an endpoint answers a request with HTTP 502 and then streams a reply
- **THEN** the Run continues on the same model, and the Reply holds that streamed output

#### Scenario: Restarts share one retry budget

- **WHEN** a request breaks after its first text delta on each of 11 sends
- **THEN** the request fails with the failure class `stream_broken` after 11 sends

### Requirement: A request that a wait cannot help fails at once

A send that fails as `billing`, `model_not_found`, `auth`, `context_overflow`, `invalid_request`,
`content_policy`, or `unknown` MUST NOT get a request retry. A `quota_exhausted` failure without a
reset time MUST NOT get one either.

#### Scenario: An authentication failure is not sent again

- **WHEN** an endpoint answers with HTTP 401
- **THEN** the request fails at once with the failure class `auth`

### Requirement: A stated wait of up to 60 seconds is honored in process

A `quota_exhausted` or `rate_limited` failure with a reset time at most 60 seconds away MUST get a
request retry. A reset time or a hint can be at most 60 seconds away. The delay of the next request
retry MUST then be at least that wait, and that retry counts as one of the 10.

#### Scenario: A 20-second bucket reset

- **WHEN** Anthropic answers with HTTP 429 and an exhausted bucket that resets 20 seconds later
- **THEN** llame sends the request again after at least 20 seconds, on the same worker

#### Scenario: A short Go usage limit

- **WHEN** the gateway answers with `GoUsageLimitError` and `Retry-After: 30`
- **THEN** llame sends the request again after at least 30 seconds, and the Run does not wait in `awaiting_quota`

### Requirement: A longer stated wait parks the request or ends it

A failure with a reset time more than 60 seconds away MUST NOT get a request retry. A request of a
Run to its own model MUST then enter the quota wait of `quota-wait`, and any other request MUST fail.
A `rate_limited` hint more than 60 seconds away MUST fail the request at once. For another class,
such a hint MUST NOT change the random delay.

#### Scenario: An unclassified long hint

- **WHEN** an endpoint answers with HTTP 429, `Retry-After: 300`, and no classified usage limit
- **THEN** the request fails at once with the failure class `rate_limited`

#### Scenario: An overload with a long hint

- **WHEN** an endpoint answers with HTTP 503 and `Retry-After: 120`
- **THEN** the request gets request retries with the random delay

#### Scenario: A title request hits a usage limit

- **WHEN** the title model answers with a Codex `usage_limit_reached` and a reset in two days
- **THEN** the title request fails, and no Run waits for it

### Requirement: A caller sees a failure only after the retries and the quota wait

A caller failure rule MUST apply only when a request ends without success. That is when its request
retries end, or its quota wait cannot apply or ends without success. The quota wait of a request
MUST NOT count as a failure of that request.

#### Scenario: A step-boundary compaction hits a usage limit

- **WHEN** the summary request of a step-boundary compaction fails with a Codex usage limit and a reset in one hour
- **THEN** the Run enters `awaiting_quota`, and no compaction failure is recorded

### Requirement: The first-token timeout ends at the first content part

The first window of a request MUST end at its first text delta, reasoning delta, tool-input start,
or tool-call part. Other parts, such as response metadata, MUST NOT end it. The window MUST be the
`firstTokenTimeoutSeconds` of the model entry, or 300 seconds without it. When it expires, the send
MUST fail as `first_token_timeout`.

#### Scenario: Metadata alone does not end the window

- **WHEN** an endpoint sends response metadata at once and then no content part for 300 seconds
- **THEN** the send fails with the failure class `first_token_timeout`

#### Scenario: A per-model timeout

- **WHEN** a model entry sets `firstTokenTimeoutSeconds` to 900, and its first content part arrives after 600 seconds
- **THEN** the request continues

### Requirement: Parts before the first content part stay unseen until it arrives

llame MUST hold back each part of a send that arrives before its first content part. It MUST
release them in order with the first content part. A send that fails before its first content part
MUST store no part, and a request retry MUST drop its held parts.

#### Scenario: A redacted thinking start and then a stall

- **WHEN** a send streams the start of a redacted thinking block and then no content part for 300 seconds
- **THEN** the request is sent again, and no reasoning part of the first send is stored

### Requirement: A stall after content is stream_broken

After the first content part, a send that gives no part for 300 seconds MUST fail as
`stream_broken`. An error after the first content part MUST keep the class of its body code or its
in-stream error type. Without one, it MUST be `stream_broken`, as for a stream that ends without a
finish part. Tool execution time MUST NOT count toward a window.

#### Scenario: A stream ends without a finish part

- **WHEN** an endpoint streams text and then closes the connection without a finish part
- **THEN** the send fails with the failure class `stream_broken`

#### Scenario: A long tool call does not count

- **WHEN** a tool call executes for longer than 300 seconds between two requests
- **THEN** no window expires, and the next request starts its own first window

### Requirement: A request with a started tool call is not sent again

A send whose tool call started MUST NOT get a request retry or a quota wait, for any failure class.
The Run MUST then fail with that failure class. A tool call MUST count as started when the send has
streamed its complete tool-call part.

#### Scenario: The stream breaks after a tool call

- **WHEN** a request streams a complete `read` tool-call part and then breaks
- **THEN** the Run fails with `error.code` `stream_broken`, and the request is not sent again

#### Scenario: An overload after a tool call

- **WHEN** a request streams a complete `read` tool-call part and then an `overloaded_error` event
- **THEN** the Run fails with `error.code` `overloaded`, and the `read` call does not execute twice

### Requirement: A request retry sends the same request

A request retry MUST send the same messages, tools, and options as the send that failed. It MUST
NOT carry a part that the failed send streamed. When the failed send stored parts, a
`model.superseded` event MUST mark them superseded before the retry starts.

#### Scenario: A stream breaks inside a thinking block

- **WHEN** an Anthropic request streams half a thinking block without a signature and then breaks
- **THEN** the request retry carries no reasoning part from the broken send
- **AND** a `model.superseded` event names the broken send

#### Scenario: A stream breaks mid-text

- **WHEN** a request streams two sentences of text and then breaks before any tool call
- **THEN** the request is sent again, and the Reply holds only the output of the new send

### Requirement: Each request retry of a Run is a Run event

Before each request retry of a request of the Run to its own model, the Run MUST append one
`model.retrying` event. It MUST carry the failure class, the retry number from 1 to 10, and the
delay in milliseconds. It MUST NOT carry a provider message, header, or body. A side call MUST NOT
append it.

#### Scenario: A reload during a retry delay

- **WHEN** the owner reloads the Chat during the delay of the third request retry
- **THEN** the event stream replays the `model.retrying` event with retry number 3

### Requirement: The web shows a request retry

While a Run waits on a request retry, the web MUST show a line in the place of "Thinking…". The line
MUST show "Retrying after", a label of the failure class, and the retry number out of 10. The line
MUST go away when the next part streams or the Run ends.

#### Scenario: An overloaded provider

- **WHEN** a Run waits on its second request retry after `overloaded`
- **THEN** the transcript shows "Retrying after provider overload (2/10)"

### Requirement: A failed hosted-search request keeps the engine classes

A hosted web search request that fails after its request retries MUST fail its engine with one
engine class of `web-search`. `quota_exhausted` and `rate_limited` MUST map to `rate_limited`.
`auth` and `billing` MUST map to `auth`. Every other failure class MUST map to `upstream_error`.

#### Scenario: A hosted-search model is out of quota

- **WHEN** the chain is `["model-hosted", "brave"]`, and the hosted model fails with `quota_exhausted`
- **THEN** the chain advances to `brave`, and the notes name `model-hosted` with `rate_limited`
