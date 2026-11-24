## MODIFIED Requirements

### Requirement: Packaged cross-tool guidance follows membership

Packaged descriptions recommending another tool MUST gate that recommendation
on its predicate while preserving independent safety and result-limit text.
This MUST include Bash-to-edit and search-to-Chat-read advice.

#### Scenario: Reader is absent

- **WHEN** search is admitted and `read` is absent
- **THEN** its description omits the reader invocation recommendation
- **AND** it still identifies search excerpts as bounded and untrusted

#### Scenario: Edit is available in a retry

- **WHEN** a fresh retry admits edit alongside Bash
- **THEN** that retry's Bash description includes the edit recommendation
- **AND** the failed attempt supplies no earlier description to model context
- **AND** each attempt renders its own descriptions
- **AND** the retry keeps stored accepted-turn reminders unchanged and in place
- **AND** it can append a new reminder from comparison against stored availability
