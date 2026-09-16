## ADDED Requirements

### Requirement: Prompt-file rules govern replaceable files only

The prompt-file requirements of this capability, namely boot-time Handlebars validation, the permitted node kinds, the context-path allowlist, bounded iteration, and the value-escaping regime under "Model prompt files are dedicated visible-content configuration" and "Tool prompt files support instance and model precedence", SHALL govern configured prompt files and the packaged defaults an operator may replace through `systemPromptFile`, `tools.promptFiles`, or `models[].toolPromptFiles`. A packaged template that no configuration can select or replace SHALL be outside those requirements; its rendering rules are owned by the capability that renders it: `context-injection` for rail item bodies, `model-system-prompts` for summarization instructions and title prompts, and `tool-calling` for the output framing and closed notices llame places inside tool results.

The reserved-delimiter neutralization rules this capability defines for owner-authored values SHALL continue to apply wherever a producer neutralizes untrusted text, regardless of which template renders it. The shared template engine's default escaping SHALL remain unused by every template.

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

#### Scenario: One source text compiled under both regimes

- **WHEN** identical template text is compiled once for a configured prompt file and once for a packaged template
- **THEN** each render uses the compilation for its own regime
- **AND** neither regime's escaping behavior leaks into the other through a shared compile cache
