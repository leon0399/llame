## ADDED Requirements

### Requirement: Summarization instructions and the title prompts are packaged templates

The full-current summarization instruction, the transition summarization instruction, the title-generation system prompt, and the title-generation user prompt SHALL be packaged template files owned by their modules and shipped with the executing process, rendered through the same engine and under the same producer-owned-values rule as item bodies under `context-injection`. They SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one, and they SHALL remain outside system-prompt receipts.

The rendered instructions and prompts SHALL be byte-identical to their previous inline text, SHALL continue to request the stable summary sections, and SHALL continue to name both standing-context delimiters and the `recency-digest` producer under the shared envelope. The stable section list and the exclusion sentence SHALL be carried by the instruction template itself and verified against independently authored literal text rather than derived from or compared with a shared constant.

#### Scenario: Compaction request is unchanged by the template migration

- **WHEN** full-current or transition compaction assembles its trailing instruction after this change
- **THEN** the instruction text is byte-identical to the previous inline instruction
- **AND** the bound prompt, compactable prefix, and tool-declaration behavior of that mode are unchanged

#### Scenario: Instruction template omits a stable section or the digest exclusion

- **WHEN** a packaged instruction template no longer contains one of the stable section headings or no longer names the `recency-digest` producer under the shared envelope
- **THEN** the compaction contract check fails against its independently authored literal text
- **AND** the omission cannot be masked by comparing the instruction with itself

#### Scenario: Title generation keeps its dedicated prompts

- **WHEN** a title is generated after this change
- **THEN** the request uses the packaged title system prompt and wraps the bounded conversation text with the packaged title user prompt, both byte-identical to the previous inline text
- **AND** it does not use the chat model's effective system prompt or any owner personalization

#### Scenario: No configuration replaces an instruction template

- **WHEN** an operator configuration attempts to name a replacement for a summarization instruction or a title prompt
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use
