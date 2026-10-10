## MODIFIED Requirements

### Requirement: Packaged cross-tool guidance follows membership

Packaged descriptions recommending another tool SHALL gate that recommendation
on its predicate while preserving independent safety and result-limit text.
This SHALL include Bash-to-edit and search-to-conversation-read advice.

#### Scenario: Reader is absent

- **WHEN** search is admitted and `conversation_read` is absent
- **THEN** its description omits the reader invocation recommendation
- **AND** it still identifies search excerpts as bounded and untrusted

#### Scenario: Edit is available in a retry

- **WHEN** a fresh retry admits edit alongside Bash
- **THEN** that retry's Bash description includes the edit recommendation
- **AND** the failed attempt supplies no earlier description to its model context
- **AND** the retry replays the accepted-turn reminders already stored on the triggering user message unchanged rather than re-authoring them
