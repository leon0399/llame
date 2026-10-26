# Spec Delta

## ADDED Requirements

### Requirement: Read reject clauses filter web search output but never govern the search

The statement that `read` `path` clauses do not restrict `web_search` MUST mean that they never admit or refuse a `web_search` call. In the `default` mode, each `read` reject clause MUST remove the `web_search` results and citations that it matches, as `web-search` defines. An absent `read` allow MUST NOT remove a `web_search` result.

#### Scenario: A read reject removes a search result

- **WHEN** the `read` group rejects `^https://grokipedia\.com/` and allows `^https://`, and an engine returns a `grokipedia.com` result
- **THEN** the `web_search` call succeeds and its output does not contain that result
- **AND** a `read` of that URL is still rejected as `explicit_reject`
