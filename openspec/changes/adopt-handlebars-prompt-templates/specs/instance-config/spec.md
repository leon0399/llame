## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, and require non-empty rendered content.

Prompt files SHALL be **Handlebars templates**. The loader SHALL parse each template at boot and validate its abstract syntax tree against a deliberately narrow allowlisted subset, failing startup and naming the model id together with the offending construct when it encounters any of:

- an identifier outside the allowlisted context paths;
- unescaped output (a triple-stache expression);
- a partial reference;
- any helper other than the built-in `if` and `unless`.

Partial rejection is normative rather than stylistic: partials are prompt fragments and inheritance, which the `model-system-prompts` capability forbids.

Template **rendering** SHALL be lenient where validation is strict: a context path that is allowlisted but has no value at render time SHALL render as empty rather than raising, so that data absent at request time can never fail a run. Boot-time validation SHALL be performed against the template rather than against any rendered output.

Escaped output SHALL neutralize the characters that could forge a structural delimiter in the prompt while leaving ordinary prose punctuation intact; the engine's default HTML escaping MUST NOT be used unmodified, because it would render an apostrophe or quotation mark as a character reference inside natural-language text.

The template **context** SHALL be an explicit, hand-constructed projection containing only values intended to be renderable. A database row, ORM entity, or configuration object MUST NOT be passed as context, so that no column, field, or secret becomes reachable merely because it exists on a record. The renderable set introduced by this capability is exactly the selected model's public id and configured public name.

A referenced context path with no available value, a missing, unreadable, non-file, or empty configured prompt SHALL fail startup naming the model id and field; it MUST NOT silently use the project default. The built-in project prompt SHALL be validated at startup as a packaged application asset.

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

#### Scenario: Template references an unknown identifier

- **WHEN** a configured prompt file references a context path outside the allowlist
- **THEN** startup fails naming the model id and that path
- **AND** no prompt contents are printed

#### Scenario: Template requests unescaped output

- **WHEN** a configured prompt file emits a value through a triple-stache expression
- **THEN** startup fails naming the model id and the unescaped expression
- **AND** the template is not loaded with escaping bypassed

#### Scenario: Template references a partial

- **WHEN** a configured prompt file references a partial
- **THEN** startup fails naming the model id and the partial reference
- **AND** no file-include or prompt-fragment mechanism becomes reachable

#### Scenario: Template invokes a disallowed helper

- **WHEN** a configured prompt file invokes any helper other than `if` or `unless`
- **THEN** startup fails naming the model id and the helper
- **AND** `if` and `unless` continue to load successfully

#### Scenario: Legacy interpolation syntax is present

- **WHEN** a configured prompt file still contains a `${...}` expression after the cutover
- **THEN** startup fails naming the model id and the stale expression
- **AND** the expression is not rendered literally into the prompt

#### Scenario: Allowlisted value is missing at render time

- **WHEN** an allowlisted context path has no value when a prompt is rendered
- **THEN** the expression renders as empty and rendering succeeds
- **AND** neither startup nor the run fails

#### Scenario: Escaping preserves prose while neutralizing delimiters

- **WHEN** a rendered value contains an apostrophe, a quotation mark, and a structural delimiter character
- **THEN** the apostrophe and quotation mark appear unchanged in the prompt
- **AND** the delimiter character is neutralized so it cannot terminate or forge surrounding structure

#### Scenario: Context is a projection rather than a record

- **WHEN** the loader renders any prompt
- **THEN** the context contains only explicitly projected renderable values
- **AND** no database row, ORM entity, or configuration object is reachable through any context path
