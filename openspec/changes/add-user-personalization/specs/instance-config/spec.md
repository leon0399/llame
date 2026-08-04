## MODIFIED Requirements

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, and require non-empty rendered content.

Prompt files SHALL be **Handlebars templates**. The loader SHALL parse each template at boot and validate its abstract syntax tree, failing startup and naming the model id together with the offending construct on anything it does not explicitly permit.

Validation SHALL permit only these node kinds: literal content, a value expression, a block expression, and a comment. Everything else SHALL be rejected. An allowlist is used because it is simpler than enumerating bad forms and does not need revisiting when the engine adds a node kind — partials, for example, exist in three syntactic forms that a blocklist would have to name individually.

Within permitted node kinds:

- a value expression SHALL reference an allowlisted context path and SHALL carry no parameters, since a parameterized value expression is a helper invocation;
- a context path SHALL be validated on its **parsed segments and depth**, not on its display string: a bracketed path such as `{{[model.id]}}` reports an allowlisted display string while parsing to a single literal segment, so accepting it would silently render empty instead of failing boot, and a parent-context path (`../`) escapes the projection entirely;
- a block expression SHALL be `if` or `unless`, SHALL take exactly one parameter, and SHALL carry neither hash arguments nor block parameters — a hash pair can hold a subexpression, which is a helper invocation the parameter check alone does not see; a wrong argument count left to the engine surfaces at render time as an unwrapped error naming neither the model nor the field; and `as |x|` binds a name outside the projected context;
- unescaped output SHALL be rejected.

Fragments stay rejected because `model-system-prompts` forbids prompt composition; with an allowlist this costs nothing to enforce.

A template SHALL be rejected at boot as empty when it contains no literal text at all. Literal text SHALL count wherever it appears, **including inside a conditional body** — a prompt may legitimately consist of nothing but an `if` block wrapping its only prose, and rejecting that would defeat the conditional idiom this capability exists to enable.

Template **rendering** SHALL be lenient where validation is strict: a context path that is allowlisted but has no value at render time SHALL render as empty rather than raising, so that data absent at request time can never fail a run. Boot-time validation SHALL be performed against the template rather than against any rendered output.

Rendered values SHALL be neutralized in two regimes, by field kind. **Model and account-identity values** (`model.*`, `user.name`, `user.email`) SHALL be escaped by replacing exactly `&`, `<`, and `>` with character references — short single-line strings with no legitimate markup. **Owner-authored values** (the `user.personalization.*` text fields) SHALL instead pass through a tag-balance sanitizer whose sole guarantee is that **a value can never close a tag it did not open within that same value**: a closing tag is passed through only when it names a tag opened earlier in the same value (closing past unclosed intermediate openers is permitted, as in HTML recovery), an unmatched or malformed closing tag is entity-escaped (fail closed), and everything else — self-contained markup, unmatched opening tags, prose comparisons, ampersands — passes byte-for-byte, because owners legitimately author tag-structured preference text and entity-mangling it destroys the structure it exists to convey. The guarantee is deliberately template-agnostic: it protects whatever wrapper the surrounding template uses without the sanitizer knowing its name. In both regimes no other character SHALL be altered, so apostrophes, quotation marks, equals signs, backticks, and other prose punctuation survive verbatim; the engine's default escaping MUST NOT be used, because it converts all of those and mangles both prose and code fragments. Neutralization SHALL be applied when building the context and the value marked already-safe, so the engine emits it without a second pass. The engine's global escaping behavior MUST NOT be mutated: a created environment shares its utility object with the global one, so replacing that function process-wide would alter behavior for every other consumer.

The template **context** SHALL be an explicit, hand-constructed projection containing only values intended to be renderable. A database row, ORM entity, or configuration object MUST NOT be passed as context, so that no column, field, or secret becomes reachable merely because it exists on a record — including when the context is extended with per-user values. The renderable set SHALL be the selected model's public id and configured public name, plus the **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`.

Per-user paths SHALL be validated at boot exactly like any other identifier, while their **values** resolve per run because no owner is in scope at startup. The loader SHALL therefore expose a template that the run path renders, rather than returning a string rendered at boot. Boot SHALL still render each template once, with the model context alone, to keep the existing non-empty-output guarantee; because an absent per-user context produces the minimum possible output, a template that renders non-empty at boot renders non-empty for every owner. A template that references no per-user path SHALL remain valid and MUST NOT fail startup; that model simply forgoes per-user context.

A missing, unreadable, non-file, or empty configured prompt SHALL fail startup naming the model id and field; it MUST NOT silently use the project default. An allowlisted path whose value is simply absent SHALL NOT fail startup — it renders empty, so that a conditional over a possibly-absent value is expressible; this SHALL apply to per-user paths at boot, where no value can exist by construction. The built-in project prompt SHALL be validated at startup as a packaged application asset.

The **packaged project-default prompt** SHALL reference the per-user paths, each inside a conditional, so that a stock installation applies an owner's personalization with no operator action and an owner's `shareAccountIdentity` toggle governs their account identity directly. An operator who replaces the default with a prompt referencing no per-user path SHALL silently forgo personalization for that model; this consequence SHALL be documented, and it is accepted rather than reported, because per-model activation reporting is out of scope for this change.

The resolved public model catalog and all user-facing APIs MUST omit `systemPromptFile` and every resolved host path. The resolved prompt contents and a source label MAY be exposed only through the owner-authorized run context receipt defined by the `model-system-prompts` capability. Config errors and operator logs MUST NOT print prompt contents.

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

- **WHEN** an owner's authored field contains self-contained tag markup and, elsewhere, a closing tag for a tag the value never opened
- **THEN** the self-contained markup renders verbatim
- **AND** the unmatched closing tag is escaped as content, so the surrounding template structure cannot be terminated from inside the value

#### Scenario: Packaged default carries the per-user block

- **WHEN** the packaged project-default prompt is validated at startup
- **THEN** it references the per-user paths, each inside a conditional
- **AND** a stock installation applies an owner's personalization without an operator editing any file
