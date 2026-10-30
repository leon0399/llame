# Spec Delta

## MODIFIED Requirements

### Requirement: Framing llame authors inside tool results is a packaged template

The untrusted-output framing that wraps every tool result presented to a model MUST be a packaged template file. So MUST each closed notice llame places inside a tool result: the prior-conversation notice of `conversation-reads`, the search-excerpt notice of `chat-search`, the Knowledge content notice of `knowledge-tools`, and the path instruction of `agent-skills`. The module that authors the text owns the file, and the executing process ships it. The template renders under the producer-owned-values rule `context-injection` defines for item bodies. These templates MUST NOT be operator configuration: no configuration key can select, replace, or disable one. The rendered framing and notice bytes MUST stay identical to the previous inline text. The payload inside the framing MUST be the rendering and neutralization that `tool-result-rendering` defines; the framing itself MUST NOT apply a second neutralization pass.

Result content composed by a tool implementation, the permission layer, or result truncation is not framing and remains outside this requirement. That content includes error messages, permission rejections, and settlement and truncation notices.

#### Scenario: Wrapped tool output is unchanged by the template migration

- **WHEN** a tool result is presented to a model after this change
- **THEN** its untrusted-output framing and outcome line are byte-identical to the previous inline composition
- **AND** the payload block is the rendering that `tool-result-rendering` defines, neutralized once

#### Scenario: A result notice is unchanged by the template migration

- **WHEN** a conversation read, search, Knowledge read, or skill read returns its closed notice after this change
- **THEN** the notice text is byte-identical to the previous inline constant
- **AND** the capability that owns the notice still observes its content obligations

#### Scenario: No configuration replaces a result notice

- **WHEN** an operator configuration attempts to name a replacement for a result notice or the output framing
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use
