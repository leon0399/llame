# Spec Delta

## MODIFIED Requirements

### Requirement: Message usage aggregates every model request of its attempt

An assistant message's persisted usage SHALL be the sum of the provider-reported usage of every model request made by the Run attempt that produced it, including tool-requesting requests and the final answer. Each request's usage SHALL be normalized on its own before summing: cached-input and cache-write tokens SHALL each be bounded within that request's input total, and total tokens SHALL be at least that request's input plus output. Reasoning tokens SHALL be treated as a subset of output tokens and SHALL NOT be added to output. The aggregate SHALL NOT include usage from compaction or title-generation requests.

Alongside the aggregate, the same persisted usage SHALL record the attempt's final completed model request's input plus output tokens as that attempt's measured context size, in a separate field that is never added to the aggregate. When that final request reported neither an input nor an output count, the measured context size SHALL be absent rather than zero or estimated.

#### Scenario: A two-request tool loop sums both requests

- **WHEN** an attempt makes a tool-requesting request reporting 1,000 input, 0 cached, 200 output, and 150 reasoning tokens, then an answer request reporting 1,400 input, 1,000 cached, 100 output, and 60 reasoning tokens
- **THEN** the assistant message usage records 2,400 input, 1,000 cached-input, 300 output, 210 reasoning, and 2,700 total tokens

#### Scenario: A single-request turn is unchanged

- **WHEN** an attempt answers with one model request and no tool call
- **THEN** the assistant message usage equals that request's normalized usage

#### Scenario: Cache subsets stay bounded per request

- **WHEN** one request of a loop reports cached-input plus cache-write tokens exceeding its input total
- **THEN** that request's cache subsets are bounded within its own input total before summing
- **AND** no other request's input absorbs the excess

#### Scenario: The measured context size sits outside the aggregate

- **WHEN** the two-request tool loop above completes
- **THEN** the assistant message usage records 1,500 as that attempt's measured context size
- **AND** the aggregate stays at 2,400 input and 2,700 total tokens

#### Scenario: A final request without counts records no measured size

- **WHEN** an attempt's final completed model request reported neither an input nor an output count
- **THEN** the persisted usage records no measured context size
- **AND** the aggregate still records the requests that did report

#### Scenario: Compaction after the turn is not added to the message

- **WHEN** the Run's first model step is preceded by a compaction whose request reports usage
- **THEN** the assistant message usage is unchanged by the compaction request

### Requirement: Compaction uses the final request's size, not the aggregate

The compaction trigger SHALL be evaluated inside a Run, before that Run's first model request, and SHALL use one measured context size: the previous completed assistant message's persisted final-request context size, plus the estimate of the rows and rail items recorded after it. The assistant message aggregate SHALL NOT be used as the measured size. When no completed assistant message carries a persisted final-request context size, the whole prepared request SHALL be estimated instead. A failed, cancelled, or expired Run SHALL NOT contribute a measured context size to a later trigger.

#### Scenario: A long loop over a small context does not compact

- **WHEN** a completed attempt makes many requests whose summed tokens exceed the compaction threshold while its final request's persisted context size stays below it
- **THEN** the next Run's pre-step trigger does not compact on the aggregate alone

#### Scenario: A final request above the threshold compacts

- **WHEN** the previous completed attempt's persisted final-request context size plus the estimate of later rows and rail items reaches the Run model's compaction threshold
- **THEN** exactly one compaction runs before that Run's first model request, on the request built for that step

#### Scenario: A final request without counts uses the estimate

- **WHEN** no completed assistant message carries a persisted final-request context size
- **THEN** the compaction trigger uses the existing context estimate

#### Scenario: A failed Run does not compact

- **WHEN** the previous Run failed, was cancelled, or expired after requests whose final input plus output exceeded the compaction threshold
- **THEN** it contributes no measured context size to the next Run's trigger
- **AND** no compaction is triggered on its own behalf after its outcome

### Requirement: Compaction and title spend stay separate categories

Assistant message usage SHALL cover only the Run's own model requests. A published compaction's usage SHALL remain a single-request receipt on the checkpoint message row it was written to. Compaction requests that publish no checkpoint and title-generation requests are not recorded by this capability.

#### Scenario: A compaction keeps its own receipt

- **WHEN** a Run's first model request is preceded by a compaction that publishes a checkpoint
- **THEN** the compaction's usage is recorded on that checkpoint message row as that one request's usage
- **AND** no assistant message usage includes the compaction request
