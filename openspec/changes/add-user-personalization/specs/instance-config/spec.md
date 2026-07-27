## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, and require non-empty rendered content.

Prompt files SHALL be **Handlebars templates**. The loader SHALL parse each template at boot and validate its abstract syntax tree against a deliberately narrow allowlisted subset, failing startup and naming the model id together with the offending construct when it encounters an identifier outside the allowlisted context paths, unescaped output, a partial reference, or any helper other than the built-in `if` and `unless`.

The allowlisted context paths SHALL be exactly the selected model's public id and configured public name, plus the **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.personalization.timezone`, `user.name`, and `user.email`. Per-user paths SHALL be validated at boot like any other identifier while their **values** resolve per run, because no owner is in scope at startup. A template that references no per-user path SHALL remain valid and MUST NOT fail startup; that model simply forgoes per-user context. The packaged project-default prompt SHALL reference no account-identity path, so a default installation transmits no account identity until an operator adds one.

Template **rendering** SHALL be lenient where validation is strict: a context path that is allowlisted but has no value at render time SHALL render as empty rather than raising, so that data absent at request time can never fail a run. Boot-time validation SHALL be performed against the template rather than against any rendered output, so a template whose content is only expressions and whitespace fails startup as empty rather than passing and rendering empty per run.

Escaped output SHALL neutralize the characters that could forge a structural delimiter in the prompt while leaving ordinary prose punctuation intact; the engine's default HTML escaping MUST NOT be used unmodified, because it would render an apostrophe or quotation mark as a character reference inside natural-language text.

The template **context** SHALL be an explicit, hand-constructed projection containing only values intended to be renderable. A database row, ORM entity, or configuration object MUST NOT be passed as context, so that no column, field, or secret becomes reachable merely because it exists on a record — including when the context is extended with per-user values.

A referenced context path with no available value at startup, or a missing, unreadable, non-file, or empty configured prompt, SHALL fail startup naming the model id and field; it MUST NOT silently use the project default. The built-in project prompt SHALL be validated at startup as a packaged application asset.

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

#### Scenario: Template references per-user paths

- **WHEN** a configured prompt file references personalization or account-identity paths
- **THEN** startup accepts them as allowlisted identifiers without resolving any owner data
- **AND** their values resolve per run instead

#### Scenario: Template names an unknown per-user field

- **WHEN** a configured prompt file references a per-user path outside the allowlist
- **THEN** startup fails naming the model id and that path
- **AND** the allowlist is not silently extended

#### Scenario: Template references no per-user path

- **WHEN** an operator's configured prompt file references no per-user context path
- **THEN** startup succeeds
- **AND** that model forgoes per-user context rather than failing startup or falling back to the project default

#### Scenario: Context extension does not pass records

- **WHEN** the loader renders a prompt referencing per-user paths
- **THEN** the context contains only explicitly projected scalar values
- **AND** no personalization row, user row, or configuration object is reachable through any context path

#### Scenario: Packaged default references no account identity

- **WHEN** the packaged project-default prompt is validated at startup
- **THEN** it references no account-identity path
- **AND** a stock installation transmits no account display name or email address
