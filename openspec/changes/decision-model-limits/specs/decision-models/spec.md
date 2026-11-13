## RENAMED Requirements

- FROM: `### Requirement: Requests are bounded and sent together`
- TO: `### Requirement: Requests are bounded and share the provider slots`

## MODIFIED Requirements

### Requirement: Requests are bounded and share the provider slots

One request MUST carry at most 32 cards with their questions. One call MUST
judge at most its first 256 cards in canonical order. The other cards MUST
stay unjudged. Each request MUST carry only its own cards and questions. Each
attempt to a `system-one` provider MUST start only when that provider has a
free slot. Each attempt MUST time out after 10 seconds. A request MUST have at
most 3 attempts. After status 408, 429, 5xx, or a transport failure, the system
MUST retry unless three attempts ran or the enclosing call aborted. The system MUST honour
`retry-after` up to 5 seconds.

#### Scenario: A batch is larger than the bound

- **WHEN** a batch holds 70 cards and the model limits admit 32 cards in one request
- **THEN** the system sends three requests
- **AND** each request carries at most 32 cards
- **AND** each request carries only the cards of its own group

#### Scenario: A call has more cards than the call bound

- **WHEN** a call has 300 cards
- **THEN** the system judges the first 256 cards in canonical order
- **AND** the other 44 cards stay unjudged
- **AND** the log line reports 300 cards and at most 256 judged cards

#### Scenario: All requests of one call are in flight

- **WHEN** a call has three requests and its provider has three free slots
- **THEN** every request starts at the same time

#### Scenario: Requests of one call share the provider bound

- **WHEN** a call has eight requests and the provider allows four concurrent attempts
- **THEN** at most four attempts to that provider are in flight at one time
- **AND** each other attempt starts in arrival order when a slot is free

#### Scenario: A transient failure is retried

- **WHEN** the first attempt returns 503 and the second succeeds before the enclosing deadline
- **THEN** the system sends two attempts and accepts the second response
- **AND** retries wait for `retry-after` up to 5 seconds

#### Scenario: An attempt takes longer than 10 seconds

- **WHEN** an attempt has no response after 10 seconds
- **THEN** the attempt fails
- **AND** the request uses the attempt bound

### Requirement: A judge result reports probabilities or unavailability

A judge result MUST have the status `answered` or `unavailable`. An `answered`
result MUST carry a probability from 0 to 1 for each answered key. An
`unavailable` result MUST carry a reason and MUST NOT carry a probability. The
result MUST list every key that no answer covers.

#### Scenario: Every card is answered

- **WHEN** the provider answers every question
- **THEN** the result has the status `answered`
- **AND** each answered key has a probability from 0 to 1
- **AND** the unanswered list is empty

#### Scenario: Some cards are not answered

- **WHEN** a 40-card call has two requests and only the 32-card request answers every question
- **THEN** the result has the status `answered`
- **AND** the unanswered list holds the 8 keys from the failed request
- **AND** no key from the failed request gets a probability

#### Scenario: No request answers

- **WHEN** every request of the batch fails
- **THEN** the result has the status `unavailable`
- **AND** the result holds a reason

### Requirement: Accepted responses carry valid usage and a model id

`model` MUST be a nonempty string and `usage` MUST be an object.
`usage.input_tokens` and `usage.output_tokens` MUST each be integers from 0 through 9,007,199,254,740,991.
Absent `usage.cost` MUST mean unknown cost; a present value MUST be a finite nonnegative number.
Invalid required fields or present cost MUST make that request unavailable.
Missing counts MUST NOT default to zero. The system MUST read the truncation
fields of `usage`. It MUST ignore each other extra field.

#### Scenario: Invalid usage cannot enter aggregates

- **WHEN** a count is missing, negative, fractional, or unsafe, or a present cost is negative, null, or nonfinite
- **THEN** that request is unavailable and contributes no answers or usage

### Requirement: Rank requests share the enclosing cancellation and deadline

A rank call MUST share the enclosing tool call's deadline and cancellation.
These signals MUST abort all requests, slot waits, and retry waits.
The system MUST NOT start a request or retry after an abort.
The tool MUST settle with the runner's timeout or cancellation observation.
It MUST NOT convert an enclosing abort into ordinary rank unavailability.

#### Scenario: The tool deadline expires during a rank request

- **WHEN** the enclosing deadline expires with rank requests in flight
- **THEN** every request aborts and no retry starts
- **AND** the tool settles with the runner's timeout observation, not a rank-failure note

#### Scenario: The owner cancels during a retry wait

- **WHEN** the owner cancels the Run while a rank request waits to retry
- **THEN** the wait stops, every request aborts, and no retry starts
- **AND** the tool settles as cancelled without a rank-failure note

#### Scenario: The owner cancels while requests wait for a slot

- **WHEN** the owner cancels the Run while its rank requests wait for slots that another call holds
- **THEN** each wait stops at once and no request of that call starts
- **AND** the tool settles as cancelled without a rank-failure note

## ADDED Requirements

### Requirement: Requests fit the limits of the model

A request MUST fit the per-question, per-request, and question limits of its
catalog entry. An entry without a per-question limit MUST use 8,192. An entry
without a per-request limit MUST use 32,768, or its per-question limit when
that is larger. The question limit MUST NOT raise the 32-card bound.

#### Scenario: An entry declares no limits

- **WHEN** an entry declares no `limits`
- **THEN** each request estimate is at most 8,192 tokens per question and 32,768 tokens per request

#### Scenario: An entry declares only a per-question limit

- **WHEN** an entry declares only `perQuestionContextTokens: 65536`
- **THEN** each request estimate is at most 65,536 tokens per question and 65,536 tokens per request

#### Scenario: A question limit is declared

- **WHEN** an entry declares `maxQuestionsPerRequest: 8` and a call has 20 cards
- **THEN** the system sends three requests with 8, 8, and 4 questions

### Requirement: Request estimates use a fixed formula

The system MUST measure the UTF-8 bytes of `JSON.stringify` output. It MUST
add the byte counts first, then divide the sum by 3 and round up. The
per-question estimate MUST add the state and the largest single question. The
per-request estimate MUST add the state and the `questions` map.

#### Scenario: The estimate uses the serialized state and question

- **WHEN** the serialized state has 2,998 bytes and the largest serialized question has 301 bytes
- **THEN** the per-question estimate is 1,100 tokens

### Requirement: Cards fill each request in canonical order

The system MUST put cards into requests in canonical order. Each request MUST
take the next card while the request still fits every limit and the 32-card
bound. A request MUST NOT skip a card.

#### Scenario: A small window takes fewer cards

- **WHEN** the first five cards fit the per-question limit and the first six cards do not
- **THEN** the first request carries exactly the first five cards
- **AND** the next request starts with the sixth card

### Requirement: A card that alone exceeds the limit is cut to fit

When one card exceeds a limit alone, its request MUST carry only that card.
The card text MUST be the longest nonempty code-point prefix that fits. The
cut MUST follow the decision-credential replacement. When no nonempty prefix
fits, the call MUST be `unavailable` with the reason `state_too_large`.

#### Scenario: A long card is cut

- **WHEN** an entry declares `perQuestionContextTokens: 512` and one card is too long for that limit
- **THEN** the request carries the longest prefix of that card text that fits
- **AND** the card gets a probability

#### Scenario: The shared state alone exceeds the limit

- **WHEN** the objective, the fixed state text, and one question with a one-character card exceed the per-question limit
- **THEN** the system sends no request
- **AND** the result is `unavailable` with the reason `state_too_large`
- **AND** the log line reports 0 requests

### Requirement: A truncation report makes its request unavailable

A response with `usage.truncated` equal to `true` MUST make its request
unavailable. A `usage.state_tokens_dropped` above 0 MUST make its request
unavailable. A present `truncated` that is not a boolean MUST make its request
unavailable. A present `state_tokens_dropped` that is not a nonnegative
integer MUST make its request unavailable. That request MUST contribute no
answers or usage.

#### Scenario: The server reports a cut state

- **WHEN** a response answers every question and reports `usage.truncated: true`
- **THEN** that request is `unavailable` with the reason `invalid_response`
- **AND** its cards stay unjudged

#### Scenario: A truncation field has a wrong type

- **WHEN** a response reports `usage.truncated: "true"`, `usage.state_tokens_dropped: "12"`, or `usage.state_tokens_dropped: -1`
- **THEN** that request is `unavailable` with the reason `invalid_response`

#### Scenario: The server reports no truncation field

- **WHEN** a valid response has no `truncated` field and no `state_tokens_dropped` field
- **THEN** the system accepts the answers of that response

### Requirement: Concurrent attempts to one provider are bounded

The system MUST NOT have more in-flight attempts to one `system-one` provider
than its `maxConcurrentRequests`. Every catalog entry and every call on that
provider id MUST share the bound in one process. Without the field, the bound
MUST be 4. Waiting attempts MUST start in arrival order. A retry wait MUST NOT
hold a slot. An attempt MUST release its slot when it settles or aborts.

#### Scenario: Two catalog entries share one provider

- **WHEN** two catalog entries name one provider without `maxConcurrentRequests` and two calls run at one time
- **THEN** at most four attempts to that provider are in flight in the process

#### Scenario: An operator raises the bound

- **WHEN** a provider declares `maxConcurrentRequests: 16`
- **THEN** at most 16 attempts to that provider are in flight in the process

#### Scenario: A retry wait releases its slot

- **WHEN** one request waits to retry and another request waits for a slot on a provider with one slot
- **THEN** the other request starts during the retry wait
