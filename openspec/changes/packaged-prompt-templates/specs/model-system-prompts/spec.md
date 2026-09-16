## ADDED Requirements

### Requirement: Summarization instructions and the title prompt are packaged templates

The full-current summarization instruction, the transition summarization instruction, and the title-generation system prompt SHALL be packaged template files owned by their modules and shipped with the executing process, rendered through the same engine and core-only context as producer item bodies under `context-injection`. They SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one, and they SHALL remain outside system-prompt receipts.

The rendered instructions SHALL be byte-identical to their previous inline text, SHALL continue to request the stable summary sections, and SHALL continue to name both standing-context delimiters and the `recency-digest` producer under the shared envelope. The stable section list SHALL be carried by the instruction template itself and verified against an independently authored list rather than derived from a shared constant.

#### Scenario: Compaction request is unchanged by the template migration

- **WHEN** full-current or transition compaction assembles its trailing instruction after this change
- **THEN** the instruction text is byte-identical to the previous inline instruction
- **AND** the bound prompt, compactable prefix, and tool-declaration behavior of that mode are unchanged

#### Scenario: Instruction template omits a stable section

- **WHEN** a packaged instruction template no longer contains one of the stable section headings
- **THEN** the compaction contract test fails against its independently authored heading list
- **AND** the omission cannot be masked by a shared heading constant

#### Scenario: Title generation keeps its dedicated prompt

- **WHEN** a title is generated after this change
- **THEN** the request uses the packaged title system prompt, byte-identical to the previous inline text
- **AND** it does not use the chat model's effective system prompt or any owner personalization

#### Scenario: No configuration replaces an instruction template

- **WHEN** an operator configuration attempts to name a replacement for a summarization instruction or the title prompt
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use
