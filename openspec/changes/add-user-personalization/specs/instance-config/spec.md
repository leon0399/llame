## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, render only `${model.id}` and `${model.name}` with `$${model.name}` as the literal escape, and require non-empty rendered content.

The loader SHALL additionally accept a closed set of **personalization expressions** whose values are deferred to per-run substitution rather than resolved at boot: a composite `${user.personalization}` rendering llame's complete owner-personalization section, one expression per authored personalization field, and the account-identity expressions `${user.name}` and `${user.email}`. The packaged project-default prompt SHALL NOT use either account-identity expression. The set SHALL be closed and enumerated, so an expression naming a field that does not exist SHALL fail startup like any other unsupported expression. Because no owner exists at startup, a personalization expression SHALL NOT be evaluated at boot and its absence of a value SHALL NOT fail startup — the deferred value renders empty at run time instead. Non-empty rendered content SHALL be assessed against the prompt with personalization expressions still unresolved, so a prompt consisting only of personalization expressions fails startup as empty rather than passing and rendering empty per run.

A referenced `${model.name}` with no configured model name, an unsupported `${...}` expression, or a missing, unreadable, non-file, or empty configured prompt SHALL fail startup naming the model id and field or expression; it MUST NOT silently use the project default. A prompt file that omits every personalization expression SHALL remain valid and MUST NOT fail startup; that model simply forgoes personalization. The packaged project-default prompt SHALL use the composite `${user.personalization}` expression, so a default installation applies owner personalization without operator action and cannot emit operator-authored labels with no content beneath them. The built-in project prompt SHALL be validated at startup as a packaged application asset.

The resolved public model catalog and all user-facing APIs MUST omit `systemPromptFile` and every resolved host path. The resolved prompt contents and a source label MAY be exposed only through the owner-authorized run context receipt defined by the `model-system-prompts` capability. Config errors and operator logs MUST NOT print prompt contents.

#### Scenario: Relative model prompt path resolves

- **WHEN** a model declares `systemPromptFile: "prompts/reasoning-model.md"`
- **THEN** the loader resolves it relative to the active `llame.config.json` directory
- **AND** the model uses the normalized non-empty file contents as its complete prompt

#### Scenario: Absolute model prompt path resolves

- **WHEN** a model declares a valid absolute `systemPromptFile`
- **THEN** the loader reads that exact file at startup
- **AND** no additional path sandbox is applied beyond the administrator-controlled process permissions

#### Scenario: Prompt override is omitted

- **WHEN** a model entry omits `systemPromptFile`
- **THEN** the resolved model uses the packaged project-default prompt
- **AND** startup does not require a model-specific file

#### Scenario: Configured prompt file is invalid

- **WHEN** `systemPromptFile` resolves to a missing, unreadable, non-file, or empty prompt
- **THEN** startup fails naming the model id and field
- **AND** neither prompt contents nor partial model catalog state is exposed
- **AND** the project default is not used as a silent recovery path

#### Scenario: Public model catalog is requested

- **WHEN** any caller retrieves the available-model catalog
- **THEN** no `systemPromptFile`, absolute path, relative path, or server-only prompt-source location is returned

#### Scenario: Two models declare different files

- **WHEN** two model entries declare different valid `systemPromptFile` values
- **THEN** each model resolves its own complete prompt independently
- **AND** changing one model's file does not alter the other model's effective prompt

#### Scenario: Prompt file declares the composite personalization expression

- **WHEN** a configured prompt file contains `${user.personalization}`
- **THEN** startup accepts the expression as supported without resolving any owner content
- **AND** the loaded prompt retains it for per-run substitution

#### Scenario: Prompt file declares per-field personalization expressions

- **WHEN** a configured prompt file places per-field personalization expressions inside operator-authored markup and labels
- **THEN** startup accepts each enumerated expression as supported without resolving any owner content
- **AND** the operator's surrounding structure is preserved verbatim for per-run substitution

#### Scenario: Prompt file names a personalization field that does not exist

- **WHEN** a configured prompt file references a personalization expression for an unknown field
- **THEN** startup fails naming the model id and the unsupported expression
- **AND** the closed expression set is not silently extended

#### Scenario: Prompt file omits every personalization expression

- **WHEN** an operator's configured prompt file contains no personalization expression
- **THEN** startup succeeds
- **AND** that model forgoes personalization rather than failing startup or falling back to the project default

#### Scenario: Prompt consists only of personalization expressions

- **WHEN** a configured prompt file contains nothing but personalization expressions and whitespace
- **THEN** startup fails because the prompt is empty with those expressions unresolved
- **AND** no model is left able to send an empty top-level system prompt

#### Scenario: Packaged default uses the composite expression

- **WHEN** the packaged project-default prompt is validated at startup
- **THEN** it contains the composite `${user.personalization}` expression
- **AND** an installation that configures no `systemPromptFile` applies owner personalization without further operator action
