## MODIFIED Requirements

### Requirement: Tool prompt files support instance and model precedence

Configuration SHALL accept optional `tools.promptFiles` and
`models[].toolPromptFiles` maps from registered llame-owned exact tool ids to
complete prompt-file paths. For each id, the selected model's entry SHALL win
over the instance entry, which SHALL win over the packaged default. Missing or
null entries SHALL follow existing absence semantics; an empty map SHALL not
clear lower-level entries. Selection SHALL not compose multiple files.

Worker boot SHALL validate all packaged and configured files, including
shadowed and disabled-tool entries, using system-prompt visible-content path
rules, normalization, and shared template validation. Relative paths SHALL
resolve against the active instance config directory. An explicit invalid file
SHALL fail worker startup without fallback. Unknown override targets, MCP
override targets, and wildcard keys SHALL be rejected. This key validation
SHALL not reject a valid template predicate merely because its target is absent.

File/config changes SHALL require restarting the executing process. The worker
SHALL render its boot-loaded sources with newly resolved attempt inputs.
Catalogs, owner receipts, and public APIs SHALL not disclose override paths or
raw configuration. System-only receipts SHALL expose the actual rendered
system prompt; rendered tool descriptions SHALL not be stored in receipts.

#### Scenario: Highest applicable file wins

- **WHEN** a model and the instance both override Bash
- **THEN** the model uses its complete Bash file
- **AND** a model without that key uses the instance file

#### Scenario: Overrides inherit independently

- **WHEN** the model overrides read and the instance overrides Bash
- **THEN** each tool resolves its highest-priority entry independently
- **AND** tools with no entry use their packaged defaults

#### Scenario: Empty maps do not disable tools

- **WHEN** a map is missing, null, or empty
- **THEN** absent keys resolve from the next level
- **AND** template selection does not alter tool admission

#### Scenario: Invalid shadowed file fails worker boot

- **WHEN** an explicit instance override is invalid but shadowed by every model
- **THEN** worker startup fails at that field without a fallback

#### Scenario: Unknown predicate is valid while unknown override target is not

- **WHEN** a valid registered-tool override checks an unregistered `tools.never_registered`
- **THEN** worker boot succeeds and that predicate is false
- **AND** an override map entry targeting the unregistered `never_registered` tool itself is rejected

#### Scenario: Worker restart applies file edits

- **WHEN** a worker restarts after a valid file edit
- **THEN** its next execution attempt renders the new file
- **AND** running workers retain their existing boot-loaded source

#### Scenario: API-only process schedules work without file access

- **WHEN** configuration shape is valid and an API-only process has no mounted prompt files
- **THEN** it can accept the selected model's Run
- **AND** only its executing worker needs to load and validate those files
