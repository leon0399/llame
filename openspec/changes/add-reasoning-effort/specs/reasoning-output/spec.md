## MODIFIED Requirements

### Requirement: Normalized reasoning is collected without changing catalog semantics

The system SHALL collect displayable reasoning when the selected AI SDK model adapter emits normalized reasoning output. Reasoning collection SHALL remain independent of catalog configuration: a model that emits normalized reasoning chunks SHALL have them collected and persisted whether or not its catalog entry declares a `reasoning` object, and whether or not the run carries an effort.

The catalog's `reasoning` object declares the model's effort request vocabulary. It SHALL NOT act as a gate on collecting, persisting, or displaying reasoning output.

#### Scenario: Existing catalog metadata remains non-executing

- **WHEN** a model catalog entry declares a `reasoning` object or omits one
- **THEN** that declaration alone does not add, remove, or alter what reasoning output is collected and persisted
- **AND** it gates only which effort values a request may carry, never the reasoning stream

#### Scenario: Existing generic adapter emits normalized reasoning

- **WHEN** an existing selected model adapter emits normalized reasoning chunks
- **THEN** llame collects and persists those chunks regardless of the catalog declaration

#### Scenario: Reasoning is collected regardless of the run's effort

- **WHEN** a run executes at any effort, including one that denotes disabled reasoning
- **THEN** whatever normalized reasoning the adapter emits is collected and persisted unchanged
- **AND** an empty reasoning stream remains a successful run
