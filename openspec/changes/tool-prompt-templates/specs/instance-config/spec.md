## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, and require non-empty rendered content.

Prompt files SHALL be **Handlebars templates**. The loader SHALL parse each template at boot and validate its abstract syntax tree, failing startup and naming the model id together with the offending construct on anything it does not explicitly permit.

Validation SHALL permit only these node kinds: literal content, a value expression, a block expression, and a comment. Everything else SHALL be rejected. An allowlist is used because it is simpler than enumerating bad forms and does not need revisiting when the engine adds a node kind — partials, for example, exist in three syntactic forms that a blocklist would have to name individually.

Within permitted node kinds:

- a value expression SHALL reference an allowlisted context path and SHALL carry no parameters, since a parameterized value expression is a helper invocation;
- a context path SHALL be validated on its **parsed segments and depth**, not on its display string: a bracketed path such as `{{[model.id]}}` reports an allowlisted display string while parsing to a single literal segment, so accepting it would silently render empty instead of failing boot, and a parent-context path (`../`) escapes the projection entirely;
- a block expression SHALL use `if`/`unless` or the bounded `each` already defined by `model-system-prompts`, SHALL take exactly one permitted subject, and SHALL carry neither hash arguments nor block parameters — a hash pair can hold a subexpression, which is a helper invocation the parameter check alone does not see; a wrong argument count left to the engine surfaces at render time as an unwrapped error naming neither the model nor the field; and `as |x|` binds a name outside the projected context;
- unescaped output SHALL be rejected.

Fragments stay rejected because `model-system-prompts` forbids prompt composition; with an allowlist this costs nothing to enforce.

A template SHALL be rejected at boot as empty when it contains no literal text at all. Literal text SHALL count wherever it appears, **including inside a conditional body** — a prompt may legitimately consist of nothing but an `if` block wrapping its only prose, and rejecting that would defeat the conditional idiom this capability exists to enable.

Template **rendering** SHALL be lenient where validation is strict: a context path that is allowlisted but has no value at render time SHALL render as empty rather than raising, so that data absent at request time can never fail a run. Boot-time validation SHALL be performed against the template rather than against any rendered output.

Rendered values SHALL be neutralized in two regimes, by field kind. **Model and account-identity values** (`model.*`, `user.name`, `user.email`) SHALL be escaped by replacing exactly `&`, `<`, and `>` with character references — short single-line strings with no legitimate markup. **Owner-authored values** (the `user.personalization.*` text fields) SHALL instead pass through a tag sanitizer enforcing exactly two rules:

1. **A value SHALL never close a tag it did not open within that same value.** A closing tag passes through only when it names a tag opened earlier in the same value (closing past unclosed intermediate openers is permitted, as in HTML recovery, so a prose mention that merely reads as an opening tag cannot cause a legitimate closer to be escaped). An unmatched closing tag, or one whose spelling is malformed or whitespace-padded, SHALL be entity-escaped regardless of what is open — fail closed, because a model may honor a spelling a strict parser rejects. This rule is deliberately template-agnostic: it protects whatever wrapper the surrounding template uses without the sanitizer knowing its name.
2. **A reserved tag name SHALL never be emitted as a tag at all**, opening or closing, matched or not. Rule 1 alone is insufficient: a value that both opens and closes the wrapper's own name satisfies it while rendering a complete forged copy of the wrapper inside the real one. The reserved set SHALL contain the packaged default prompt's delimiter name. An operator whose replacement template wraps per-user content in a differently-named tag retains rule 1's protection but not rule 2's, and this limitation SHALL be documented rather than implied away.

Everything else — self-contained markup under a non-reserved name, unmatched opening tags, prose comparisons, ampersands — SHALL pass byte-for-byte, because owners legitimately author tag-structured preference text and entity-mangling it destroys the structure it exists to convey. In both regimes no other character SHALL be altered, so apostrophes, quotation marks, equals signs, backticks, and other prose punctuation survive verbatim; the engine's default escaping MUST NOT be used, because it converts all of those and mangles both prose and code fragments. Neutralization SHALL be applied when building the context and the value marked already-safe, so the engine emits it without a second pass. The engine's global escaping behavior MUST NOT be mutated: a created environment shares its utility object with the global one, so replacing that function process-wide would alter behavior for every other consumer.

The template **context** SHALL be an explicit, hand-constructed projection containing only values intended to be renderable. A database row, ORM entity, or configuration object MUST NOT be passed as context, so that no column, field, or secret becomes reachable merely because it exists on a record — including when the context is extended with per-user values. The renderable set SHALL be the complete explicit projection defined by `model-system-prompts`, including its bounded chat collections and temporal paths, plus the conditional-only tool predicates defined by `tool-prompt-templates`. System and tool-description templates SHALL share this projection and validator; extending one SHALL NOT silently expose raw settings or records to the other.

Per-user paths SHALL be validated at boot exactly like any other identifier, while their **values** resolve per run because no owner is in scope at startup. The loader SHALL therefore expose a template that the run path renders, rather than returning a string rendered at boot. Boot SHALL render each template with BOTH an absent and a populated per-user context, and SHALL fail if either renders empty. One probe is not sufficient: `unless` is a permitted helper over the per-user gates, so a template whose only content sits inside `{{#unless user}}` renders non-empty with no owner and empty for precisely the owners who personalized. The earlier claim that an absent per-user context yields the minimum possible output is therefore false, and probing one gate state would pass such a template at boot and ship an empty prompt in production. A template that references no per-user path SHALL remain valid and MUST NOT fail startup; that model simply forgoes per-user context.

A missing, unreadable, non-file, or empty configured prompt SHALL fail startup naming the model id and field; it MUST NOT silently use the project default. An allowlisted path whose value is simply absent SHALL NOT fail startup — it renders empty, so that a conditional over a possibly-absent value is expressible; this SHALL apply to per-user paths at boot, where no value can exist by construction. The built-in project prompt SHALL be validated at startup as a packaged application asset.

The **packaged project-default prompt** SHALL reference the per-user paths, each inside a conditional, so that a stock installation applies an owner's personalization with no operator action and an owner's `shareAccountIdentity` toggle governs their account identity directly. An operator who replaces the default with a prompt referencing no per-user path SHALL silently forgo personalization for that model; this consequence SHALL be documented, and it is accepted rather than reported, because per-model activation reporting is out of scope.

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

#### Scenario: Path only appears allowlisted in its display form

- **WHEN** a configured prompt file uses a bracketed path whose display string matches an allowlisted path but whose parsed segments do not, or a parent-context path
- **THEN** startup fails naming the model id and that path
- **AND** the template is not accepted to render empty at request time

#### Scenario: Conditional has the wrong argument count

- **WHEN** a configured prompt file uses an `if` or `unless` block with no parameter or more than one
- **THEN** startup fails with the capability's own configuration error, naming the model id and the construct
- **AND** the failure does not surface later as an unwrapped engine error at render time

#### Scenario: Conditional declares block parameters

- **WHEN** a configured prompt file declares block parameters on a conditional
- **THEN** startup fails naming the model id and the construct

#### Scenario: Template requests unescaped output

- **WHEN** a configured prompt file emits a value through unescaped output
- **THEN** startup fails naming the model id and that expression
- **AND** the template is not loaded with escaping bypassed

#### Scenario: Template references a fragment

- **WHEN** a configured prompt file references a partial in any of its syntactic forms
- **THEN** startup fails naming the model id and the construct

#### Scenario: Template invokes a helper

- **WHEN** a configured prompt file invokes a helper outside the shared validator's permitted `if`/`unless`/bounded-`each` constructs
- **THEN** startup fails naming the model id and the helper
- **AND** `if` and `unless` continue to load successfully

#### Scenario: Comment is permitted

- **WHEN** a configured prompt file contains a template comment
- **THEN** startup succeeds and the comment does not appear in rendered output

#### Scenario: Helper smuggled through a block hash argument

- **WHEN** a configured prompt file passes a hash argument holding a subexpression to an `if` or `unless` block
- **THEN** startup fails naming the model id and the helper invocation
- **AND** the helper is never executed at render time

#### Scenario: Conditional holds the only literal content

- **WHEN** a configured prompt file consists solely of a conditional block whose body carries its only literal text
- **THEN** startup succeeds rather than rejecting the template as empty
- **AND** the block renders its content when the tested path has a value
- **AND** the template still passes the required empty-render probes and actual Run render validation

#### Scenario: Allowlisted value is missing at render time

- **WHEN** an allowlisted context path has no value when a prompt is rendered
- **THEN** the expression renders as empty and rendering succeeds
- **AND** neither startup nor the run fails

#### Scenario: Escaping alters exactly three characters

- **WHEN** a rendered model or account-identity value contains `&`, `<`, `>`, an apostrophe, a quotation mark, an equals sign, and a backtick
- **THEN** only `&`, `<`, and `>` are replaced with character references
- **AND** every other character appears verbatim in the prompt

#### Scenario: Rendered value cannot introduce markup characters

- **WHEN** a rendered model or account-identity value contains `<` or `>`
- **THEN** they appear as character references rather than as markup

#### Scenario: Context is a projection rather than a record

- **WHEN** the loader renders any prompt
- **THEN** the context contains only explicitly projected renderable values
- **AND** no database row, ORM entity, or configuration object is reachable through any context path

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

- **WHEN** the run path renders a prompt referencing per-user paths
- **THEN** the context contains only explicitly projected scalar values
- **AND** no personalization row, user row, or configuration object is reachable through any context path

#### Scenario: Authored markup survives while the enclosing structure stays closed to it

- **WHEN** an owner's authored field contains self-contained tag markup under a non-reserved name and, elsewhere, a closing tag for a tag the value never opened
- **THEN** the self-contained markup renders verbatim
- **AND** the unmatched closing tag is escaped as content, so the surrounding template structure cannot be terminated from inside the value

#### Scenario: Authored value spells the delimiter's own name as a balanced pair

- **WHEN** an owner's authored field contains a well-formed opening and closing tag pair naming the packaged prompt's delimiter
- **THEN** both tags are escaped as content even though the pair is balanced
- **AND** the rendered prompt contains exactly one opening and one closing delimiter, the template's own

#### Scenario: Packaged default carries the per-user block

- **WHEN** the packaged project-default prompt is validated at startup
- **THEN** it references the per-user paths, each inside a conditional
- **AND** a stock installation applies an owner's personalization without an operator editing any file

## ADDED Requirements

### Requirement: Operators can select complete tool description files per instance and model

The instance configuration SHALL accept `tools.promptFiles` and
`models[].toolPromptFiles` as optional maps from exact registered llame-owned
tool ids to prompt-file paths. For each tool independently, a model entry SHALL
take precedence over its instance entry, which SHALL take precedence over the
packaged default. Every selected file SHALL replace the complete description.
Absent keys SHALL inherit from the next level; an empty map SHALL NOT clear
lower-level entries. The existing explicit-null-as-absence rule SHALL apply.

Paths SHALL have the same visible-content file semantics, normalization, and
config-directory-relative resolution as `systemPromptFile`; they SHALL NOT be
secret-file interpolation. Startup SHALL validate all packaged defaults and
configured overrides, including shadowed or disabled-tool entries, without
requiring that a tool is currently admitted. Missing, unreadable, non-file,
empty, invalid-template, unknown-tool, MCP-tool, and wildcard entries SHALL fail
startup with safe field/model/tool diagnostics and no silent fallback. Config
and file edits SHALL take effect only after process restart. Override settings
and private prompt paths SHALL remain absent from public model catalogs and
owner receipts; receipts SHALL expose the effective rendered contents through
their existing prompt/description fields.

#### Scenario: Model override has highest precedence

- **WHEN** both maps contain a valid entry for `bash`
- **THEN** that model uses its complete file for Bash
- **AND** a model without that key uses the instance file

#### Scenario: Partial override map inherits per tool

- **WHEN** a model overrides only `read` and the instance overrides `bash`
- **THEN** the model uses its read file and the instance Bash file
- **AND** other tools use their packaged defaults

#### Scenario: Empty or absent map preserves defaults

- **WHEN** an override map is absent, null, or empty
- **THEN** every absent tool key resolves from the next level
- **AND** no map entry enables or disables a tool

#### Scenario: Relative files can be reused across models

- **WHEN** several entries reference one relative file path
- **THEN** each resolves against the active configuration directory
- **AND** each Run renders it with its own selected model and owner context

#### Scenario: Invalid lower-priority override is still an error

- **WHEN** an instance file is invalid even though every configured model shadows it
- **THEN** startup fails at that instance field without a fallback

#### Scenario: Description override cannot target MCP or an unknown tool

- **WHEN** either map contains a wildcard, MCP id, or unregistered code-owned id
- **THEN** startup fails naming the invalid configuration location
- **AND** the entry cannot create a tool or alter MCP declarations

#### Scenario: Private configuration does not reach a receipt

- **WHEN** an owner retrieves a Run receipt using an override file
- **THEN** the receipt contains the rendered description exactly as bound
- **AND** it contains no override map, prompt-file path, or private source-binding metadata
