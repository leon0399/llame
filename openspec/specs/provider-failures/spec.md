# provider-failures Specification

## Purpose

Define failure classes and bounded same-model request retries. Preserve tool effects, complete reasoning, and safe diagnostics when a provider request fails.

## Requirements

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

### Requirement: The bounded errors of llame are unknown

The fixed unreadable-event error and the fixed redirect error of `provider-api-selection` MUST be
`unknown`. A request that fails with one of them MUST NOT get a request retry.

#### Scenario: An unreadable event after text

- **WHEN** a Chat Completions send streams text and then an event that is not JSON
- **THEN** the request fails at once with the failure class `unknown` and the fixed unreadable-event text

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
buckets whose `anthropic-ratelimit-*-remaining` is 0, and `retry-after` is then a hint only. For OpenRouter, it MUST
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

#### Scenario: A compaction Run fails on auth

- **WHEN** the summary request of a compaction Run fails with HTTP 401
- **THEN** the compaction Run is `failed` with `error.code` `auth`

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
`first_token_timeout`, or `stream_broken` MUST get a request retry on the same model. A rule below
can forbid it. Before retry
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

#### Scenario: A title request is retried

- **WHEN** the title model answers one title request with HTTP 529 and then returns a title
- **THEN** the title is stored, and no Run event records the retry

### Requirement: A request that a wait cannot help fails at once

A send that fails as `billing`, `model_not_found`, `auth`, `context_overflow`, `invalid_request`,
`content_policy`, or `unknown` MUST NOT get a request retry. A `quota_exhausted` failure without a
reset time MUST NOT get one either.

#### Scenario: An authentication failure is not sent again

- **WHEN** an endpoint answers with HTTP 401
- **THEN** the request fails at once with the failure class `auth`

### Requirement: A stated wait of up to 60 seconds is honored in process

A `quota_exhausted` or `rate_limited` failure with a reset time at most 60 seconds away MUST get a
request retry. For a reset time or a hint at most 60 seconds away, the delay of the next retry MUST
be at least that wait. That retry counts as one of the 10.

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

#### Scenario: A model-switch compaction hits a usage limit

- **WHEN** the source-model summary of a model switch fails with `quota_exhausted` and a reset in two days
- **THEN** the Run fails with `error.code` `context_incompatible`, and it does not wait

### Requirement: A caller sees a failure only after the retries and the quota wait

A caller failure rule MUST apply only when a request ends without success. That is when its request
retries end, or its quota wait cannot apply or ends without success. The quota wait of a request
MUST NOT count as a failure of that request.

#### Scenario: A step-boundary compaction hits a usage limit

- **WHEN** the summary request of a step-boundary compaction fails with a Codex usage limit and a reset in one hour
- **THEN** the Run enters `awaiting_quota`, and no compaction failure is recorded

### Requirement: The first-token timeout ends at the first content part

The first window of a request MUST end at its first content part. A content part is a non-empty
text or reasoning delta, a tool-input start, or a tool-call, file, source, or finish part. Other parts, such as response
metadata, MUST NOT end it. The window MUST be the
`firstTokenTimeoutSeconds` of the model entry, or 300 seconds without it. When it expires, the send
MUST fail as `first_token_timeout`.

#### Scenario: Metadata alone does not end the window

- **WHEN** an endpoint sends response metadata at once and then no content part for 300 seconds
- **THEN** the send fails with the failure class `first_token_timeout`

#### Scenario: A per-model timeout

- **WHEN** a model entry sets `firstTokenTimeoutSeconds` to 900, and its first content part arrives after 600 seconds
- **THEN** the request continues

### Requirement: Parts before the first content part stay unseen until it arrives

llame MUST hold back each part of a send that arrives before the end of its first window. For a
caller with live text or reasoning deliveries, it MUST release the held parts in order before the
part that ends the window. A send that fails before its first content part MUST store no part,
and a request retry MUST drop its held parts.

For a caller without live text or reasoning deliveries, llame MUST hold every part until the send
succeeds. It MUST then release all parts in order. A retryable failure before a complete tool-call
part MUST drop that buffer and retry the same request under the same retry limit, even after
content. The first-content and stall windows MUST still apply while parts are held.

#### Scenario: A redacted thinking start and then a stall

- **WHEN** a send streams the start of a redacted thinking block and then no content part for 300 seconds
- **THEN** the request is sent again, and no reasoning part of the first send is stored

#### Scenario: A send that finishes with no content part

- **WHEN** a send streams response metadata and then a finish part with the reason `content-filter`
- **THEN** the step completes with its held parts released before the finish part, and no request retry follows

#### Scenario: A buffered summary breaks after content

- **WHEN** a compaction summary send streams partial text without live deliveries and then breaks before a complete tool-call part
- **THEN** llame drops that send's held parts and retries the same request
- **AND** the summary receives only the successful send's parts, with no supersession event for the unstored buffer

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

A send whose tool call started MUST NOT get a request retry, for any failure class. That send MUST
NOT get a quota wait of its own. A tool call MUST count as started when the send has streamed its
complete tool-call part. When the send is a step of a Run, the Run MUST wait for its started calls.
It MUST then continue, wait for a quota reset, or fail, as the requirements below state. For
another caller, the request MUST fail with that failure class, and the failure rule of its caller
applies.

#### Scenario: The stream breaks after a tool call

- **WHEN** a Run step streams a complete `read` tool-call part and then breaks
- **THEN** the request is not sent again, and the `read` call executes once
- **AND** the Run continues with the next step, and that step carries the `read` result

#### Scenario: An overload after a tool call

- **WHEN** a Run step streams a complete `read` tool-call part and then an `overloaded_error` event
- **THEN** the Run continues after the `read` call settles, and the `read` call does not execute twice

#### Scenario: A usage limit after a tool call

- **WHEN** a Codex Run step streams a complete `bash` tool-call part and then `usage_limit_reached` with a reset in two days
- **THEN** the Run enters `awaiting_quota` after the `bash` call settles
- **AND** the woken Run sends the next step with the `bash` result, and the `bash` call does not execute again

#### Scenario: A hosted search breaks after its search tool call

- **WHEN** a hosted web search send streams its provider search tool-call part and then breaks
- **THEN** the engine fails with `upstream_error`, and the Run continues

#### Scenario: An authentication failure after a tool call

- **WHEN** a Run step streams a complete `read` tool-call part and then fails with `auth`
- **THEN** the Run fails with `error.code` `auth` after the `read` call settles
- **AND** the reply holds the result of the `read` tool, not a termination result

### Requirement: A request retry sends the same request

A request retry MUST send the same messages, tools, and options as the send that failed. It MUST
NOT carry a part that the failed send streamed. When the failed send stored parts, a
`model.superseded` event MUST mark them superseded before the retry starts.

#### Scenario: A stream breaks inside a thinking block

- **WHEN** an Anthropic request with live reasoning deliveries stores half a thinking block without a signature and then breaks
- **THEN** the request retry carries no reasoning part from the broken send
- **AND** a `model.superseded` event names the broken send

#### Scenario: A stream breaks mid-text

- **WHEN** a request streams two sentences of text and then breaks before any tool call
- **THEN** the request is sent again, and the Reply holds only the output of the new send

#### Scenario: The live view drops a superseded send

- **WHEN** the owner watches a send stream text that then breaks, and its request retry streams
- **THEN** the live transcript removes the text of the broken send, and a reload shows the same parts

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

### Requirement: A failed send waits for its started tool calls

When a send of a Run step fails after a started tool call, the Run MUST wait until each started call
of that send settles. A call settles with success, an error, or `outcome_unknown`. The Run MUST NOT
cancel a started call because the send failed. The Run MUST NOT send a step request during the wait. It MUST decide by the failure class only after the wait. This rule MUST apply to each failure
class.

#### Scenario: One call still runs when the send breaks

- **WHEN** a send streams complete `read` and `bash` tool-call parts, and it breaks while the `bash` call runs
- **THEN** the Run sends no request until the `bash` call returns its result
- **AND** the next step carries the `read` result and the `bash` result

#### Scenario: The owner stops the Run during the wait

- **WHEN** the owner stops the Run while it waits for a started `bash` call of a failed send
- **THEN** the Run is cancelled, and termination settles the `bash` call
- **AND** the reply does not hold the text after the last tool part, and it holds the `provider-failure` notice

#### Scenario: A rejected call does not cause a second send

- **WHEN** a send streams a complete tool-call part, the permission policy rejects that call, and then the send breaks
- **THEN** the request is not sent again, and the Run continues with the next step
- **AND** that step carries the rejection result of the call

### Requirement: The Run keeps the parts of the failed send through its last settled tool part

The Run MUST keep the parts of the failed send through its last settled tool part, as `turn-actions`
defines that part. It MUST also keep the context items directly after it. The later parts of that
send are the cut. A `model.superseded` event MUST name the cut, in each outcome of the wait. That
event names no kept part. The next request MUST carry the kept parts, and no part of the cut.

#### Scenario: The text after the last tool call is not kept

- **WHEN** a send streams text, a complete `read` tool-call part, more text, and then breaks
- **THEN** the reply keeps the first text and the `read` part with its result
- **AND** the live view removes the text after the `read` part, and a reload shows the same parts
- **AND** the next request does not carry the text after the `read` part

#### Scenario: Text between two kept calls stays

- **WHEN** a send streams a `read` tool-call part, text, a `grep` tool-call part, more text, and then breaks
- **THEN** the reply keeps the `read` part, the text after it, and the `grep` part
- **AND** only the text after the `grep` part is superseded

### Requirement: The cut and the notice are stored together

The Run MUST append the `model.superseded` event of the cut and store the `provider-failure` notice
in one fenced write. When the Run continues, that write MUST come before the retry delay of the
next step. A worker that stops before that write MUST leave neither of them.

#### Scenario: A worker stops before the next step starts

- **WHEN** a send breaks after a settled `read` call, and the worker stops after the call settles and before the next step starts
- **THEN** the reply holds neither the cut nor the notice

#### Scenario: A worker stops during the delay of the next step

- **WHEN** a send breaks after a settled `edit` call, and the worker stops during the delay before the first send of the next step
- **THEN** the redelivered attempt fails the Run with `error.code` `outcome_unknown`
- **AND** the reply holds the cut and the notice

### Requirement: The next step uses the budgets of the failed request

The next step MUST continue the request-retry count and the wait count of the failed request.
Its first send is a new request, not a request retry. When the failure class gets a request retry,
that send MUST still count as one. It MUST wait the delay of that retry number and append one
`model.retrying` event with it. The web MUST show the line of that retry.

#### Scenario: A provider breaks after each tool call

- **WHEN** a provider breaks after a complete `read` tool-call part on each of 11 sends in a row
- **THEN** the Run fails with `error.code` `stream_broken` after 11 sends
- **AND** each `read` call executes once

#### Scenario: A reload during the delay of the next step

- **WHEN** the owner reloads the Chat during the delay before the first send of the next step, after a third broken send
- **THEN** the event stream replays the `model.retrying` event with retry number 3

#### Scenario: No retry is left for the next step

- **WHEN** a send breaks after a tool call, and its request already used 10 request retries
- **THEN** the Run fails with `error.code` `stream_broken` after the call settles

#### Scenario: A second usage limit after a woken tool call

- **WHEN** a woken next step streams a complete `bash` tool-call part, and then fails with `usage_limit_reached` and a reset in range
- **THEN** the Run enters `awaiting_quota` with a wait count of 2

### Requirement: Some events end the counts of the next step

A later step send of the Run that ends without failure MUST end both counts. A quota wait MUST end
the request-retry count, as for every woken request. The Run MUST decide by the failure class
before it delivers at the step boundary before the next step. A delivery there starts a segment.
That segment MUST start with no carried request-retry count and no retry delay.

#### Scenario: A send without failure ends the count

- **WHEN** a send breaks after a tool call, the next step ends without failure, and a later send breaks after a tool call
- **THEN** the transcript shows "Retrying after a broken stream (1/10)" before the step after that later send

#### Scenario: A steer at the boundary starts a new count

- **WHEN** a send breaks with `stream_broken` after a tool call on its fifth send, and the owner sent a steer before the calls settled
- **THEN** the steer starts a segment, and its first send goes out with no retry delay and no `model.retrying` event

#### Scenario: A failure with no retry does not deliver a pending steer

- **WHEN** a send fails with `auth` after a tool call, and the owner sent a steer before the calls settled
- **THEN** the Run fails with `error.code` `auth`, and no segment of that Run delivers the steer

### Requirement: A wait call of a failed send does not open

A `wait` call of a send that failed after a started tool call MUST NOT open. It MUST settle with a
result that states that the wait did not start. The Run MUST NOT enter `awaiting_jobs` for it.

#### Scenario: A wait call in a broken send

- **WHEN** a send streams a complete `bash` tool-call part and a `wait` tool-call part, and then breaks
- **THEN** the Run does not enter `awaiting_jobs`, and the `wait` part holds a result that states that the wait did not start
- **AND** the Run continues with the next step

### Requirement: A provider-failure notice follows the last settled tool part

After the wait, the reply MUST hold one context item with producer `provider-failure` and form
`notice`. It MUST be directly after the last settled tool part of the failed send. This MUST be true
when the Run continues, waits for a quota reset, fails, or expires. It MUST also be true when an
interrupt or a cancellation ends the wait. Each later request that carries that tool part MUST also
carry the notice.

#### Scenario: The next request carries the notice

- **WHEN** the Run continues after a send that broke after a `read` call
- **THEN** the next request carries the `read` result, and then the notice as a user-role message

#### Scenario: Owner Continue keeps the notice

- **WHEN** a Run fails with `auth` after a `read` call, and the owner continues the reply
- **THEN** the first request of the Continue Run carries the `read` result, and then the notice

#### Scenario: An interrupt during the wait keeps the notice

- **WHEN** the owner interrupts the Run while it waits for a started `bash` call of a failed send
- **THEN** the reply of the closed segment holds the `bash` part and then the notice

### Requirement: The provider-failure notice has a fixed text

The body of the notice MUST start with "Your previous response stopped because the provider
failed:" and the label of the failure class. The label MUST be a fixed plain-language name, not the
class code. The body MUST then state: "Each tool call above has its result. Your output after the
last result is not kept." It MUST NOT carry a provider message, header, or body.

#### Scenario: A broken stream has a label

- **WHEN** a send breaks with `stream_broken` after a `read` call
- **THEN** the notice body names "a broken stream", and it does not contain `stream_broken`
