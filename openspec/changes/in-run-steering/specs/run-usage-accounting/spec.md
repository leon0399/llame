## MODIFIED Requirements

### Requirement: Message usage aggregates every model request of its attempt

The persisted usage of an assistant message MUST sum the provider-reported usage
of each model request of its segment. These are requests of the Run attempt that produced it.
A Run without a delivered message has one segment, as `run-steering` defines.
This includes requests for tools and the final answer.
The system MUST normalize each request before the sum.
The cached-input and cache-write tokens of each request MUST stay within its input total.
Its total tokens MUST be at least its input plus output.
Reasoning tokens MUST count as a subset of output, not as extra output.
The aggregate MUST exclude compaction and title-generation requests.
A hosted-search sub-request of a `web-search` model-hosted engine is not a
model request of the attempt for this capability.
A decision or rerank request from the rank call of a tool is also not a model request of
the attempt for this capability.
These sub-requests MUST NOT add usage, estimated cost, measured context size,
reasoning count, or a completeness condition.

The same persisted usage MUST record the input plus output of the final completed model request
of the segment as its measured context size.
This separate field MUST NOT add to the aggregate.
If that final request reports neither input nor output, the field MUST be absent,
not zero or an estimate.

#### Scenario: A two-request tool loop sums both requests

- **WHEN** a tool request reports 1,000 input, 0 cached, 200 output, and 150 reasoning tokens
- **AND** the final answer request reports 1,400 input, 1,000 cached, 100 output, and 60 reasoning tokens
- **THEN** usage records 2,400 input, 1,000 cached-input, 300 output, 210 reasoning, and 2,700 total tokens

#### Scenario: A single-request turn is unchanged

- **WHEN** an attempt answers with one model request and no tool call
- **THEN** the assistant message usage equals that request's normalized usage

#### Scenario: Cache subsets stay bounded per request

- **WHEN** one request of a loop reports cached-input plus cache-write tokens that exceed its input total
- **THEN** that request's cache subsets stay within its own input total before the sum
- **AND** no other request's input absorbs the excess

#### Scenario: The measured context size sits outside the aggregate

- **WHEN** the two-request tool loop above completes
- **THEN** usage records 1,500 as that attempt's measured context size
- **AND** the aggregate stays at 2,400 input and 2,700 total tokens

#### Scenario: A final request without counts records no measured size

- **WHEN** the final completed model request reports neither input nor output
- **THEN** persisted usage records no measured context size
- **AND** the aggregate still records the requests that report counts

#### Scenario: A pre-step compaction is not added to the message

- **WHEN** a compaction request reports usage before the first model step of the Run
- **THEN** the compaction request changes no assistant message usage

#### Scenario: A decision request does not affect attempt measurements

- **WHEN** the rank call of a tool reports tokens and cost during the two-request loop above
- **THEN** usage stays at 2,400 input and 2,700 total tokens, with a measured context size of 1,500
- **AND** the decision request changes no estimated message cost, reasoning count, or usage completeness condition

#### Scenario: Each segment reply sums only its own requests

- **WHEN** the first segment of a Run makes two model requests, and a steer starts a second segment that makes one request
- **THEN** the usage of the first reply sums the two requests of the first segment
- **AND** the usage of the second reply equals the normalized usage of its one request
