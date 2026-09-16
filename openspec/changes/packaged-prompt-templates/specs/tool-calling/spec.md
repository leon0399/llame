## ADDED Requirements

### Requirement: Framing llame authors inside tool results is a packaged template

The untrusted-output framing that wraps every tool result presented to a model, and each closed notice llame places inside a tool result (the prior-conversation notice of `conversation-reads`, the search-excerpt notice of `chat-search`, the Knowledge content notice of `knowledge-tools`, and the path instruction of `agent-skills`), SHALL be a packaged template file owned by the module that authors the text and shipped with the executing process, rendered under the producer-owned-values rule `context-injection` defines for item bodies. These templates SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one. Rendered bytes SHALL be identical to the previous inline text, and the neutralization applied to a composed result today SHALL continue to apply to the rendered result.

Result content composed by a tool implementation, the permission layer, or result truncation (error messages, permission rejections, settlement and truncation notices) is not framing and remains outside this requirement.

#### Scenario: Wrapped tool output is unchanged by the template migration

- **WHEN** a tool result is presented to a model after this change
- **THEN** its untrusted-output framing, outcome line, and payload block are byte-identical to the previous inline composition
- **AND** the composed text is neutralized exactly as before

#### Scenario: A result notice is unchanged by the template migration

- **WHEN** a conversation read, search, Knowledge read, or skill read returns its closed notice after this change
- **THEN** the notice text is byte-identical to the previous inline constant
- **AND** the capability that owns the notice still observes its content obligations

#### Scenario: No configuration replaces a result notice

- **WHEN** an operator configuration attempts to name a replacement for a result notice or the output framing
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use
