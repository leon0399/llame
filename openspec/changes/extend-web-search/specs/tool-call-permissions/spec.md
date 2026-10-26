# Spec Delta

## ADDED Requirements

### Requirement: Web search result removal is not native path enforcement

The rule that native path rejects are not search-result filters MUST keep its scope: native tools. The removal of `web_search` results by `read` reject clauses is a separate `web-search` behavior. It MUST NOT change a native tool decision, and a native tool MUST NOT rely on it for confinement.

#### Scenario: A read reject still refuses the read

- **WHEN** a `read` reject clause matches `https://grokipedia.com/page` and `web_search` removed that URL from its results
- **THEN** a `read` of that URL is refused as `explicit_reject`, exactly as without the search
