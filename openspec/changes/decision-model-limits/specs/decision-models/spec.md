## MODIFIED Requirements

### Requirement: Requests are bounded and sent together

One request MUST carry at most 32 cards with their questions. A larger batch
MUST become several requests. Each request MUST carry only its own cards and
questions. The system MUST start each request when its provider has a free
concurrency slot. Each attempt MUST time out after 10 seconds. A request MUST
have at most 3 attempts. After status 408, 429, 5xx, or a transport failure,
the system MUST retry until three attempts ran or the enclosing call aborted.
The system MUST honour `retry-after` up to 5 seconds.

#### Scenario: A batch is larger than the bound

- **WHEN** a batch holds 70 cards and the model limits admit 32 cards in one request
- **THEN** the system sends three requests
- **AND** each request carries at most 32 cards
- **AND** each request carries only the cards of its own group

#### Scenario: All requests of one call are in flight

- **WHEN** a call has three requests and its provider has three free slots
- **THEN** every request starts at the same time

#### Scenario: Requests of one call share the provider bound

- **WHEN** a call has eight requests and the provider allows four concurrent requests
- **THEN** at most four requests of that provider are in flight at one time
- **AND** each other request starts when a slot is free

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

## ADDED Requirements

### Requirement: Requests fit the limits of the model

Each request MUST fit the limits of its catalogue entry. The per-question
estimate is the state plus the largest question. The per-request estimate is
the state plus all questions. Each estimate is the UTF-8 bytes of that JSON,
divided by 3 and rounded up. A request MUST NOT have more questions than the
question limit.

#### Scenario: A small window takes fewer cards

- **WHEN** an entry declares `perQuestionContextTokens: 1024` and 32 cards do not fit that estimate
- **THEN** the system puts fewer cards in each request
- **AND** each request estimate is at most 1,024 tokens per question

#### Scenario: An entry declares no limits

- **WHEN** an entry declares no `limits`
- **THEN** each request estimate is at most 8,192 tokens per question and 32,768 tokens per request

#### Scenario: A question limit is declared

- **WHEN** an entry declares `maxQuestionsPerRequest: 8` and a call has 20 cards
- **THEN** each request carries at most 8 questions

### Requirement: A card that alone exceeds the limit is cut to fit

When one card with its question exceeds a limit, the system MUST cut that card
text at a code-point boundary until the request fits. The cut MUST follow the
decision-credential replacement. When an empty card text does not fit, the
system MUST NOT send that card, and the card stays unjudged.

#### Scenario: A long card is cut

- **WHEN** an entry declares `perQuestionContextTokens: 512` and one card is too long for that limit
- **THEN** the request carries a shorter text of that card
- **AND** the card gets a probability

#### Scenario: The shared state alone exceeds the limit

- **WHEN** the objective and the fixed state text exceed the per-question limit without a card
- **THEN** the system sends no request for those cards
- **AND** those cards stay unjudged

### Requirement: A truncation report makes its request unavailable

A response with `usage.truncated` set to `true` MUST make its request
unavailable. A response with `usage.state_tokens_dropped` above 0 MUST make
its request unavailable. That request MUST contribute no answers or usage.

#### Scenario: The server reports a cut state

- **WHEN** a response answers every question and reports `usage.truncated: true`
- **THEN** that request is `unavailable`
- **AND** its cards stay unjudged

#### Scenario: The server reports no truncation field

- **WHEN** a valid response has no `truncated` field and no `state_tokens_dropped` field
- **THEN** the system accepts the answers of that response

### Requirement: Concurrent requests to one provider are bounded

The system MUST NOT have more in-flight requests to one `system-one` provider
than its `maxConcurrentRequests`. Every catalogue entry and every call on that
provider MUST share the bound in one process. Without the field, the bound
MUST be 4.

#### Scenario: Two catalogue entries share one provider

- **WHEN** two catalogue entries name one provider without `maxConcurrentRequests` and two calls run at one time
- **THEN** at most four requests to that provider are in flight in the process

#### Scenario: An operator raises the bound

- **WHEN** a provider declares `maxConcurrentRequests: 16`
- **THEN** at most 16 requests to that provider are in flight in the process
