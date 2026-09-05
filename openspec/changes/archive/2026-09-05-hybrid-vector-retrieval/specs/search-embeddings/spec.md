## MODIFIED Requirements

### Requirement: Retrieval degrades rather than gates, and never mixes embedding spaces

There SHALL be no completeness gate: a partially embedded corpus SHALL remain retrievable, with the vector contribution present for documents that have a usable vector and absent for those that do not — retrieval degrades in quality, never into an error or a refusal. Any query reading vectors SHALL restrict itself to documents whose recorded model key matches the corpus's current selection, whose embedded content hash equals the live content hash, and whose recorded input version equals the current `EMBED_INPUT_VERSION`, so vectors produced by different models, for superseded content, or under a superseded input derivation are never compared within one ranking. The query SHALL be embedded under the same binding as the stored vectors — the corpus's selected model key, its revision, its query-side prefix, and its declared dimensions — and a query vector whose dimension differs from the declaration SHALL be treated as absent rather than compared.

#### Scenario: A partially embedded corpus is still fully searchable

- **WHEN** only part of a corpus has been embedded
- **THEN** every document remains retrievable by its lexical representations, and no search is refused or degraded to an error

#### Scenario: Vectors from a superseded model never enter a ranking

- **WHEN** a corpus's model has changed and some documents still carry vectors from the previous key
- **THEN** those vectors contribute nothing, and the ranking contains no comparison between vectors of different models

#### Scenario: Query is embedded under the corpus binding

- **WHEN** a search embeds its query
- **THEN** the request uses the corpus's selected model key, revision, and query-side prefix
- **AND** a returned vector whose dimension differs from the declared `dimensions` is discarded and the vector leg is skipped
