## MODIFIED Requirements

### Requirement: Message usage aggregates every model request of its attempt

An assistant message's persisted usage SHALL be the sum of the provider-reported usage of every model request made by the Run attempt that produced it, including tool-requesting requests and the final answer. Each request's usage SHALL be normalized on its own before summing: cached-input and cache-write tokens SHALL each be bounded within that request's input total, and total tokens SHALL be at least that request's input plus output. Reasoning tokens SHALL be treated as a subset of output tokens and SHALL NOT be added to output. The aggregate SHALL NOT include usage from compaction or title-generation requests. A hosted-search sub-request of a `web-search` model-hosted engine is not a model request of the attempt for any requirement of this capability, so it adds no usage, measured context size, reasoning count, or completeness condition.

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

#### Scenario: A pre-step compaction is not added to the message

- **WHEN** the Run's first model step is preceded by a compaction whose request reports usage
- **THEN** the assistant message usage is unchanged by the compaction request

### Requirement: Compaction and title spend stay separate categories

Assistant message usage SHALL cover only the Run's own model requests. A published compaction's usage SHALL remain a single-request receipt on the checkpoint message row it was written to. Compaction requests that publish no checkpoint, title-generation requests, and the hosted-search sub-requests of `web-search` model-hosted engines are not recorded by this capability.

#### Scenario: A compaction keeps its own receipt

- **WHEN** a Run's first model request is preceded by a compaction that publishes a checkpoint
- **THEN** the compaction's usage is recorded on that checkpoint message row as that one request's usage
- **AND** no assistant message usage includes the compaction request

#### Scenario: A hosted web search is not added to the message

- **WHEN** a Run's tool call is answered by a model-hosted web search engine whose sub-request reports usage
- **THEN** the assistant message usage, measured context size, and estimated cost are unchanged by that sub-request
