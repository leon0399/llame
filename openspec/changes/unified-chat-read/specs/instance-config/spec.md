## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

A model entry can declare `systemPromptFile` as its complete system-prompt file. This MUST be a host path, not secret interpolation. Its contents are owner-visible. Omission MUST select the versioned packaged default. An override MUST replace that default completely. Models MUST NOT inherit or compose prompts.

Relative paths MUST resolve against the active configuration directory. Absolute paths MUST remain absolute. Worker boot MUST read files, normalize CRLF and CR to LF, and remove trailing whitespace only at the file end. Rendered content MUST be nonempty.

Files MUST use Handlebars templates. Worker boot MUST validate their parsed syntax trees. Errors MUST name the model and offending construct without prompt contents. Only literal content, value expressions, block expressions, and comments are permitted. All other nodes MUST fail validation.

Value expressions MUST name allowlisted paths without parameters. Validation MUST inspect parsed segments and depth, not display strings. Bracketed literal segments MUST NOT impersonate dotted paths. Parent-context paths MUST fail validation.

Blocks MUST use only permitted `if`, `unless`, or bounded `each` forms from model-system-prompts. Each MUST take exactly one permitted subject, without hash arguments or block parameters. Unescaped output, fragments, partials, and other helpers MUST fail validation before rendering.

A template without literal text MUST fail boot validation. Literal text inside a conditional MUST count. Missing allowlisted values MUST render empty, not fail expression resolution. Complete prompts and admitted descriptions MUST remain nonempty per attempt. Validation and boot probes MUST NOT require an absent tool to exist.

Model values and account identity values MUST escape exactly `&`, `<`, and `>` with character references. Owner-authored personalization fields MUST use the following tag rules instead:

1. A value MUST NOT close a tag it did not open. A closing tag can close an earlier opener across unclosed intermediate openers. The sanitizer MUST escape unmatched, malformed, or whitespace-padded closing tags.
2. Reserved tag names MUST never render as tags, even in balanced pairs. The reserved set MUST include the packaged delimiter. Documentation MUST disclose that custom delimiter names receive only the first rule unless reserved.

Other self-contained markup, unmatched openers, comparisons, and punctuation MUST remain byte-identical. Neutralization MUST happen during context construction. Context construction MUST mark values safe against another escaping pass. Code MUST NOT change the engine's global escape function, because created environments share its utility object.

Both template kinds MUST use one explicit renderable projection from model-system-prompts, including temporal paths and conditional-only `tools.<exact-id>` predicates. They MUST NOT receive database rows, ORM entities, configuration records, secrets, or unrequested capability flags. The projection MUST contain no `chats` namespace.

Worker boot MUST validate attempt-dependent paths without resolving owner data. Values MUST resolve per attempt through the exposed template. Without tool predicates, probes MUST vary `user`, `skills`, and `webSearch` independently across supported absent and populated states. Every probe MUST include an unconditional representative temporal anchor. Any empty probe MUST fail boot.

Lockstep optional gates and absent anchors are invalid probes. A prompt without per-user paths MUST remain valid.

Missing, unreadable, non-file, or empty configured files MUST fail boot naming the model and field, without fallback. Missing allowlisted values MUST remain empty, not configuration errors. Worker boot MUST validate the packaged default as an application asset.

The packaged default MUST reference per-user paths inside conditionals. It MUST apply personalization without operator edits and obey `shareAccountIdentity`. An override without those paths MUST forgo that context silently. Documentation MUST explain the consequence. No per-model activation report is required.

Public catalogs and APIs MUST omit `systemPromptFile` and all resolved host paths. Only an authorized owner receipt can expose resolved prompt contents and a source label. Configuration errors and operator logs MUST NOT print prompt contents.

#### Scenario: A mixed optional-context state renders empty

- **WHEN** a template passes lockstep probes but renders empty with absent `user`, populated `skills`, and absent `webSearch`
- **THEN** independent gate probes reject it at worker boot

#### Scenario: A template uses only temporal context

- **WHEN** an otherwise-valid template renders non-empty text using only `context.systemTime` and `context.systemTimezone`
- **THEN** every boot probe supplies the anchor and succeeds
- **AND** absence of optional context values does not invalidate it

#### Scenario: Relative model prompt path resolves

- **WHEN** a model declares `systemPromptFile: "prompts/reasoning-model.md"`
- **THEN** the loader resolves it relative to the active config file directory
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

- **WHEN** a configured template uses a deceptive bracketed display path with different parsed segments, or a parent-context path
- **THEN** boot rejects it naming the model and path
- **AND** it cannot silently render empty at request time

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

- **WHEN** an authored value contains balanced non-reserved markup and a separate closing tag without its own opener
- **THEN** the balanced markup renders verbatim
- **AND** the unmatched closing tag renders escaped and cannot close the surrounding structure

#### Scenario: Authored value spells the delimiter's own name as a balanced pair

- **WHEN** an owner's authored field contains a well-formed opening and closing tag pair naming the packaged prompt's delimiter
- **THEN** both tags are escaped as content even though the pair is balanced
- **AND** the rendered prompt contains exactly one opening and one closing delimiter, the template's own

#### Scenario: Packaged default carries the per-user block

- **WHEN** the packaged project-default prompt is validated at worker startup
- **THEN** it references the per-user paths, each inside a conditional
- **AND** a stock installation applies an owner's personalization without an operator editing any file

## ADDED Requirements

### Requirement: The retired conversation reader is not a configuration target

Startup MUST reject `conversation_read` in `tools.allowed`, `tools.promptFiles`, and `models[].toolPromptFiles`. Its error MUST identify the field and direct the operator to `read` with `chat://`. A stale permission-group key MUST remain inert under exact-id matching. It MUST NOT restore a declaration, executor, or authority.

#### Scenario: Old reader allowlist fails closed

- **WHEN** configuration allowlists `conversation_read`
- **THEN** startup fails with a migration diagnostic rather than a compatibility executor

#### Scenario: An old prompt override cannot survive retirement

- **WHEN** a model or instance overrides the `conversation_read` description
- **THEN** startup rejects that target even when no model admits it

### Requirement: Replaceable templates reject the retired chats namespace

Worker boot MUST reject `chats` and `chats.*` references in system prompts and tool descriptions. The diagnostic MUST identify the model or tool and the retired namespace. It MUST direct the operator to remove those references because the digest uses context items. It MUST expose no prompt contents, source Chat text, or host path.

#### Scenario: A custom digest template fails before model I/O

- **WHEN** a configured prompt references `chats.recent`
- **THEN** worker boot rejects it with an actionable diagnostic
- **AND** no model call or source Chat resolution occurs
