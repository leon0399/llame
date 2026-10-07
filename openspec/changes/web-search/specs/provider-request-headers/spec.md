## MODIFIED Requirements

### Requirement: The session variable renders the Chat identity per lane

`{session:id}` SHALL render the request's Chat identity exactly as the `opencode-go` session header does: the Chat's identifier, verbatim, on the `main` lane (the main turn and compaction), under a `title:` prefix on the `title` lane, and under a `search:` prefix on the `search` lane used by the hosted-search sub-requests of `web-search` model-hosted engines. It is not a secret.

#### Scenario: Main turn and compaction share the value

- **WHEN** a run's main turn and a compaction request for the same Chat are made through an entry that sends `X-Session-Id`
- **THEN** both carry the Chat's identifier as the header value

#### Scenario: Title generation carries the title lane

- **WHEN** the title service makes a structured-generation request through an entry that sends `X-Session-Id`
- **THEN** the serialized request carries `title:` followed by the Chat's identifier

#### Scenario: A hosted web search carries the search lane

- **WHEN** a model-hosted web search engine makes its sub-request for a Run in Chat `c1` through an entry that sends `X-Session-Id`
- **THEN** the serialized request carries `search:c1` as the header value
