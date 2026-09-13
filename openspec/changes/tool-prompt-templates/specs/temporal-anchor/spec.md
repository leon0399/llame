## MODIFIED Requirements

### Requirement: The anchor contributes no per-turn variation

Rendering the anchor SHALL be deterministic for a given chat between compactions: across runs whose other effective-context inputs are unchanged, the resulting system prompt SHALL be byte-identical, so the system prompt text and its prompt hash remain identical even though each attempt has its own receipt.

A per-request clock SHALL NOT be introduced ahead of the cached prefix under any circumstances, since that would forfeit caching for the entire conversation.

#### Scenario: Consecutive runs in one chat

- **WHEN** two runs are prepared for the same chat with no compaction between them and no other effective-context input changed
- **THEN** the rendered anchor is byte-identical in both
- **AND** both attempts' system-only receipts contain identical prompt text and prompt hashes

#### Scenario: Run after a compaction

- **WHEN** a run is prepared after the chat has been compacted and the compaction time differs from the previous anchor source at minute precision
- **THEN** the rendered anchor differs from the previous run's
- **AND** the new attempt records its newly rendered system prompt, without changing any earlier receipt
