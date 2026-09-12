## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at execution-worker boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, and require non-empty rendered content.

Prompt files SHALL be **Handlebars templates**. The loader SHALL parse each template at execution-worker boot and validate its abstract syntax tree, failing startup and naming the model id together with the offending construct on anything it does not explicitly permit.

Validation SHALL permit only these node kinds: literal content, a value expression, a block expression, and a comment. Everything else SHALL be rejected. An allowlist is used because it is simpler than enumerating bad forms and does not need revisiting when the engine adds a node kind — partials, for example, exist in three syntactic forms that a blocklist would have to name individually.

Within permitted node kinds:

- a value expression SHALL reference an allowlisted context path and SHALL carry no parameters, since a parameterized value expression is a helper invocation;
- a context path SHALL be validated on its **parsed segments and depth**, not on its display string: a bracketed path such as `{{[model.id]}}` reports an allowlisted display string while parsing to a single literal segment, so accepting it would silently render empty instead of failing boot, and a parent-context path (`../`) escapes the projection entirely;
- a block expression SHALL use `if`/`unless` or the bounded `each` defined by `model-system-prompts`, SHALL take exactly one permitted subject, and SHALL carry neither hash arguments nor block parameters — a hash pair can hold a subexpression, which is a helper invocation the parameter check alone does not see; a wrong argument count left to the engine surfaces at render time as an unwrapped error naming neither the model nor the field; and `as |x|` binds a name outside the projected context;
- unescaped output SHALL be rejected.

Fragments stay rejected because `model-system-prompts` forbids prompt composition; with an allowlist this costs nothing to enforce.

A template SHALL be rejected at execution-worker boot as empty when it contains no literal text at all. Literal text SHALL count wherever it appears, **including inside a conditional body** — a prompt may legitimately consist of nothing but an `if` block wrapping its only prose, and rejecting that would defeat the conditional idiom this capability exists to enable.

Template **rendering** SHALL be lenient where validation is strict: a context path that is allowlisted but has no value at render time SHALL render as empty rather than raising, so absence is not an expression-resolution error. The complete rendered system prompt and each admitted description SHALL still satisfy the nonempty-attempt requirement; an empty final result fails preparation. Boot structural validation and the supported probe rules SHALL not require an absent tool to exist.

Rendered values SHALL be neutralized in two regimes, by field kind. **Model and account-identity values** (`model.*`, `user.name`, `user.email`) SHALL be escaped by replacing exactly `&`, `<`, and `>` with character references — short single-line strings with no legitimate markup. **Owner-authored values** (the `user.personalization.*` text fields) SHALL instead pass through a tag sanitizer enforcing exactly two rules:

1. **A value SHALL never close a tag it did not open within that same value.** A closing tag passes through only when it names a tag opened earlier in the same value (closing past unclosed intermediate openers is permitted, as in HTML recovery, so a prose mention that merely reads as an opening tag cannot cause a legitimate closer to be escaped). An unmatched closing tag, or one whose spelling is malformed or whitespace-padded, SHALL be entity-escaped regardless of what is open — fail closed, because a model may honor a spelling a strict parser rejects. This rule is deliberately template-agnostic: it protects whatever wrapper the surrounding template uses without the sanitizer knowing its name.
2. **A reserved tag name SHALL never be emitted as a tag at all**, opening or closing, matched or not. Rule 1 alone is insufficient: a value that both opens and closes the wrapper's own name satisfies it while rendering a complete forged copy of the wrapper inside the real one. The reserved set SHALL contain the packaged default prompt's delimiter name. An operator whose replacement template wraps per-user content in a differently-named tag retains rule 1's protection but not rule 2's, and this limitation SHALL be documented rather than implied away.

Everything else — self-contained markup under a non-reserved name, unmatched opening tags, prose comparisons, ampersands — SHALL pass byte-for-byte, because owners legitimately author tag-structured preference text and entity-mangling it destroys the structure it exists to convey. In both regimes no other character SHALL be altered, so apostrophes, quotation marks, equals signs, backticks, and other prose punctuation survive verbatim; the engine's default escaping MUST NOT be used, because it converts all of those and mangles both prose and code fragments. Neutralization SHALL be applied when building the context and the value marked already-safe, so the engine emits it without a second pass. The engine's global escaping behavior MUST NOT be mutated: a created environment shares its utility object with the global one, so replacing that function process-wide would alter behavior for every other consumer.

The template **context** SHALL be an explicit, hand-constructed projection containing only values intended to be renderable. A database row, ORM entity, or configuration object MUST NOT be passed as context, so that no column, field, or secret becomes reachable merely because it exists on a record — including when the context is extended with per-user values. The renderable set SHALL be the complete explicit projection defined by `model-system-prompts`, including its chat collections and temporal paths, plus absent-safe conditional-only `tools.<exact-id>` predicates. Both template kinds SHALL use that same projection. Neither records nor unrequested capability flags become renderable.

Per-user paths SHALL be validated at execution-worker boot exactly like any other identifier, while their **values** resolve per execution attempt because no owner is in scope at worker startup. The loader SHALL therefore expose a template that the worker attempt path renders, rather than returning a string rendered at execution-worker boot. For templates without tool predicates, worker boot SHALL render each template with BOTH an absent and a populated per-user context, and SHALL fail if either renders empty. One probe is not sufficient: `unless` is a permitted helper over the per-user gates, so a template whose only content sits inside `{{#unless user}}` renders non-empty with no owner and empty for precisely the owners who personalized. The earlier claim that an absent per-user context yields the minimum possible output is therefore false, and probing one gate state would pass such a template at execution-worker boot and ship an empty prompt in production. A template that references no per-user path SHALL remain valid and MUST NOT fail worker startup; that model simply forgoes per-user context.

A missing, unreadable, non-file, or empty configured prompt SHALL fail worker startup naming the model id and field; it MUST NOT silently use the project default. An allowlisted path whose value is simply absent SHALL NOT fail worker startup — it renders empty, so that a conditional over a possibly-absent value is expressible; this SHALL apply to per-user paths at execution-worker boot, where no value can exist by construction. The built-in project prompt SHALL be validated at worker startup as a packaged application asset.

The **packaged project-default prompt** SHALL reference the per-user paths, each inside a conditional, so that a stock installation applies an owner's personalization with no operator action and an owner's `shareAccountIdentity` toggle governs their account identity directly. An operator who replaces the default with a prompt referencing no per-user path SHALL silently forgo personalization for that model; this consequence SHALL be documented, and it is accepted rather than reported, because per-model activation reporting is out of scope.

The resolved public model catalog and all user-facing APIs MUST omit `systemPromptFile` and every resolved host path. The resolved prompt contents and a source label MAY be exposed only through the owner-authorized run context receipt defined by the `model-system-prompts` capability. Config errors and operator logs MUST NOT print prompt contents.

#### Scenario: Relative model prompt path resolves

- **WHEN** a model declares `systemPromptFile: "prompts/reasoning-model.md"`
- **THEN** the loader resolves it relative to the active `llame.config.json` directory
- **AND** the model uses the normalized non-empty file contents as its complete prompt

#### Scenario: Absolute model prompt path resolves

- **WHEN** a model declares a valid absolute `systemPromptFile`
- **THEN** the loader reads that exact file at worker startup
- **AND** no additional path sandbox is applied beyond the administrator-controlled process permissions

#### Scenario: Prompt override is omitted

- **WHEN** a model entry omits `systemPromptFile`
- **THEN** the resolved model uses the packaged project-default prompt
- **AND** startup does not require a model-specific file

#### Scenario: Configured prompt file is invalid

- **WHEN** `systemPromptFile` resolves to a missing, unreadable, non-file, or empty prompt
- **THEN** worker startup fails naming the model id and field
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
- **THEN** worker startup fails naming the model id and that path
- **AND** no prompt contents are printed

#### Scenario: Path only appears allowlisted in its display form

- **WHEN** a configured prompt file uses a bracketed path whose display string matches an allowlisted path but whose parsed segments do not, or a parent-context path
- **THEN** worker startup fails naming the model id and that path
- **AND** the template is not accepted to render empty at request time

#### Scenario: Conditional has the wrong argument count

- **WHEN** a configured prompt file uses an `if` or `unless` block with no parameter or more than one
- **THEN** worker startup fails with the capability's own configuration error, naming the model id and the construct
- **AND** the failure does not surface later as an unwrapped engine error at render time

#### Scenario: Conditional declares block parameters

- **WHEN** a configured prompt file declares block parameters on a conditional
- **THEN** worker startup fails naming the model id and the construct

#### Scenario: Template requests unescaped output

- **WHEN** a configured prompt file emits a value through unescaped output
- **THEN** worker startup fails naming the model id and that expression
- **AND** the template is not loaded with escaping bypassed

#### Scenario: Template references a fragment

- **WHEN** a configured prompt file references a partial in any of its syntactic forms
- **THEN** worker startup fails naming the model id and the construct

#### Scenario: Template invokes a helper

- **WHEN** a configured prompt file invokes any helper outside the shared `if`/`unless`/bounded-`each` rules
- **THEN** worker startup fails naming the model id and the helper
- **AND** `if` and `unless` continue to load successfully

#### Scenario: Comment is permitted

- **WHEN** a configured prompt file contains a template comment
- **THEN** worker startup succeeds and the comment does not appear in rendered output

#### Scenario: Helper smuggled through a block hash argument

- **WHEN** a configured prompt file passes a hash argument holding a subexpression to an `if` or `unless` block
- **THEN** worker startup fails naming the model id and the helper invocation
- **AND** the helper is never executed at render time

#### Scenario: Conditional holds the only literal content

- **WHEN** a configured prompt file consists solely of a conditional block whose body carries its only literal text
- **THEN** worker startup succeeds rather than rejecting the template as empty
- **AND** the block renders its content when the tested path has a value

#### Scenario: Allowlisted value is missing at render time

- **WHEN** an allowlisted context path has no value and the surrounding template produces nonempty final text
- **THEN** the expression renders as empty and rendering succeeds
- **AND** the missing value itself causes no startup or attempt failure

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
- **AND** their values resolve per execution attempt instead

#### Scenario: Template names an unknown per-user field

- **WHEN** a configured prompt file references a per-user path outside the allowlist
- **THEN** worker startup fails naming the model id and that path
- **AND** the allowlist is not silently extended

#### Scenario: Template references no per-user path

- **WHEN** an operator's configured prompt file references no per-user context path
- **THEN** worker startup succeeds
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

- **WHEN** the packaged project-default prompt is validated at worker startup
- **THEN** it references the per-user paths, each inside a conditional
- **AND** a stock installation applies an owner's personalization without an operator editing any file

API-only processes SHALL validate configuration shape and model references without loading prompt-file contents. A process hosting a Run consumer SHALL perform file loading and executable-template validation before it consumes jobs. Tool-aware templates SHALL follow the absent-tool and actual-attempt empty-render rules in `tool-prompt-templates`; an absent tool cannot fail worker boot.

## ADDED Requirements

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

- **WHEN** a valid registered-tool override checks an unregistered `tools.grep`
- **THEN** worker boot succeeds and that predicate is false
- **AND** an override map entry targeting the unregistered grep tool itself is rejected

#### Scenario: Worker restart applies file edits

- **WHEN** a worker restarts after a valid file edit
- **THEN** its next execution attempt renders the new file
- **AND** running workers retain their existing boot-loaded source

#### Scenario: API-only process schedules work without file access

- **WHEN** configuration shape is valid and an API-only process has no mounted prompt files
- **THEN** it can accept the selected model's Run
- **AND** only its executing worker needs to load and validate those files
