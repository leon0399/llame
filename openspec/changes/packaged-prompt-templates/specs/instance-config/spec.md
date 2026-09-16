## ADDED Requirements

### Requirement: Prompt-file rules govern replaceable files only

The prompt-file requirements of this capability, namely boot-time Handlebars validation, the permitted node kinds, the context-path allowlist, bounded iteration, and the value-escaping regime, SHALL govern configured prompt files and the packaged defaults an operator may replace through `systemPromptFile`, `tools.promptFiles`, or `models[].toolPromptFiles`. A packaged template that no configuration can select or replace SHALL be outside those requirements; its rendering rules are owned by the capability that renders it, under `context-injection` and `model-system-prompts`.

The reserved-delimiter neutralization rules this capability defines for owner-authored values SHALL continue to apply wherever a producer neutralizes a foreign value, regardless of which template renders it.

#### Scenario: A packaged internal template uses a producer-specific variable

- **WHEN** a packaged, non-replaceable template references a variable that is not on the configured-prompt allowlist
- **THEN** worker startup succeeds
- **AND** the configured-prompt allowlist is unchanged

#### Scenario: A configured prompt file uses a producer-specific variable

- **WHEN** a configured system-prompt or tool-description file references a variable that exists only in a producer's packaged template
- **THEN** worker startup fails naming the model id and the unsupported construct
- **AND** no producer variable is added to the configured-prompt allowlist by that reference

#### Scenario: Neutralization is independent of the rendering template

- **WHEN** a producer renders an owner-authored value through a packaged template
- **THEN** the value is neutralized under the same reserved-delimiter rules as a configured prompt would apply
- **AND** the rendered output is not re-evaluated as a template
