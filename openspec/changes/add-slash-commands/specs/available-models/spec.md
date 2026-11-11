## ADDED Requirements

### Requirement: An owner compaction uses the model of its own Run

A compaction Run MUST send its summary request with the model id and the effort stored on that Run.
A prepared request can be too large for the window of that model. Then the Run MUST use the model id
and the effort of the previous completed turn Run. One compaction MUST NOT use both model ids.

#### Scenario: Compact with the composer model

- **WHEN** the owner sends `/compact` with model `B` and effort `low`, and the last turn Run used model `A`
- **THEN** the summary request uses model `B` with effort `low`

#### Scenario: A history that does not fit the composer model

- **WHEN** the owner sends `/compact` with a model whose window cannot hold the absorbed rows
- **THEN** the summary request uses the model id and the effort of the previous completed turn Run
