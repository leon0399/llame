## MODIFIED Requirements

### Requirement: Compaction and title spend stay separate categories

Assistant message usage SHALL cover only the Run's own model requests. A published compaction's usage SHALL remain a single-request receipt on the checkpoint message row it was written to. Compaction requests that publish no checkpoint, title-generation requests, and the hosted-search sub-requests of `web-search` model-hosted engines are not recorded by this capability.

#### Scenario: A compaction keeps its own receipt

- **WHEN** a Run's first model request is preceded by a compaction that publishes a checkpoint
- **THEN** the compaction's usage is recorded on that checkpoint message row as that one request's usage
- **AND** no assistant message usage includes the compaction request

#### Scenario: A hosted web search is not added to the message

- **WHEN** a Run's tool call is answered by a model-hosted web search engine whose sub-request reports usage
- **THEN** the assistant message usage, measured context size, and estimated cost are unchanged by that sub-request
