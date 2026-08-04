# personalization

## Purpose

Owner-authored personalization: a `preferredName`, an `about`, and `responsePreferences`, stored per user behind an `enabled` master switch and a `shareAccountIdentity` toggle, and rendered into that owner's system prompt on every run through the allowlisted per-user template paths defined by `model-system-prompts` and `instance-config`. This capability covers the stored profile, its datastore-enforced owner isolation, the owner-scoped `/api/v1/me/personalization` surface, the packaged default prompt's delimited and framed block, and the precedence order that keeps authored preferences below operator prompts and tool/safety constraints. Inferred or accumulated memory is a separate, lower-ranked capability that does not exist yet.

## Requirements

### Requirement: Owners author a bounded personalization profile

The system SHALL let each user author their own personalization consisting of `preferredName` (short single-line text), `about` (free text for role, work context, and languages as prose), `responsePreferences` (free text for how answers should be delivered), an `enabled` toggle **defaulting to true**, and a `shareAccountIdentity` toggle **defaulting to false**. Both toggles SHALL be global to the user rather than per model.

The two defaults are deliberately asymmetric: `enabled` gates only what the owner authored, so defaulting it on costs nothing (an owner who wrote nothing renders nothing) and their text takes effect the moment they write it, with no second switch to discover; `shareAccountIdentity` gates account-derived identity, where defaulting it on would let an operator referencing `user.email` move every existing user's address to the configured provider retroactively, with no action or awareness from those users.

Each text field SHALL enforce a documented maximum length: `preferredName` at 255 characters, and `about` and `responsePreferences` at 8000 characters each. The caps SHALL be generous enough for multi-paragraph authoring rather than a single sentence. The documentation SHALL note that a maxed-out profile consumes a material fraction of a small context window, since the compaction trigger is a ratio of the model's window rather than a fixed size. Every field SHALL be optional, and a user who has authored nothing SHALL be indistinguishable in behavior from a user whose personalization is disabled. The system MUST NOT infer, derive, or auto-populate any field from conversation content.

#### Scenario: User authors a complete profile

- **WHEN** a user sets `preferredName`, `about`, and `responsePreferences` within the documented caps
- **THEN** the values are persisted for that user
- **AND** subsequent runs for that user carry them into model context

#### Scenario: User has authored nothing

- **WHEN** a user with no personalization row starts a run
- **THEN** the run executes normally and no personalization content reaches the model
- **AND** no default, placeholder, or inferred content is substituted

#### Scenario: Field exceeds its cap

- **WHEN** an update supplies a text field longer than its documented maximum
- **THEN** the update is rejected with a validation error naming the field
- **AND** no partial update is persisted

#### Scenario: Brand-new user carries the intended defaults

- **WHEN** a user who has never opened personalization is created
- **THEN** `enabled` is true and `shareAccountIdentity` is false
- **AND** anything they author applies immediately while no account identity is transmitted until they opt in

#### Scenario: No field is populated by inference

- **WHEN** a user discusses their name, occupation, or language preferences in a chat
- **THEN** no personalization field is created or modified as a result
- **AND** personalization changes only through an explicit owner-initiated update

### Requirement: Personalization is tenant-isolated at the datastore

Personalization state SHALL live in a tenant-owned table carrying the owner's user id, with row-level security `ENABLE`d **and** `FORCE`d and an owner policy evaluated against `current_setting('app.current_user_id', true)`. There SHALL be **no** public-read policy: personalization MUST NOT be readable through the public chat-sharing path or by the empty (public) identity, even for an owner who has shared a chat. Every read and write SHALL execute inside the owner's tenant scope, with application-level owner filters retained as defense-in-depth.

Because the `users` table carries no row-level security of its own, reads of account fields for prompt context SHALL be explicitly scoped to the authenticated owner's id in the query; there is no datastore backstop for that read, and this SHALL be stated where the read is implemented. Cross-tenant and public-identity negative tests SHALL run in the integration suite alongside the other row-level-security proofs.

#### Scenario: FORCE RLS holds against the table owner

- **WHEN** the row-level-security suite queries the personalization table as the owning role with another user's identity set, and again with the empty identity
- **THEN** no other user's personalization row is readable
- **AND** no field content is disclosed

#### Scenario: Public chat does not expose its owner's personalization

- **WHEN** an unauthenticated caller views a chat whose visibility is public
- **THEN** the chat owner's personalization is not readable through that path
- **AND** the shared view exposes no personalization content

#### Scenario: Cross-tenant update is attempted

- **WHEN** a user attempts to update personalization belonging to another user id
- **THEN** the operation is denied
- **AND** the target user's stored values are unchanged

#### Scenario: Account-field read is explicitly owner-scoped

- **WHEN** account fields are read to build prompt context
- **THEN** the query filters on the authenticated owner's id rather than relying on row-level security
- **AND** a test asserts no other user's account fields can be returned by that path

### Requirement: Per-user values reach the model through allowlisted template context

Personalization SHALL reach the model by extending the prompt-template context allowlist established by the Handlebars templating capability, not by introducing a second substitution mechanism. The allowlist SHALL gain exactly `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name` (the account display name), and `user.email` (the account email address). Context path names SHALL match the API field names exactly, so the prompt vocabulary and the API contract cannot drift apart. Neither toggle SHALL be renderable: they control whether the others appear, and are not content.

llame SHALL NOT provide a **composite context value** that renders a section the operator cannot reshape. Operators own the structure, labels, ordering, and any explanatory or framing text, expressed in a prompt file they can edit or replace, and use the built-in conditionals to omit a label together with an absent value.

Absence SHALL be expressed by omission from the context at every level: an individual field with no value is absent; `user.personalization` is absent when personalization is disabled or every authored field is empty; and `user` itself is absent when nothing beneath it would render, so an operator can gate a whole section including its framing prose on one expression. A value that is empty **after trimming** SHALL be treated as absent. Omission rather than an empty value is required, not stylistic: escaped values are marked already-safe and such a wrapper is always truthy, so a wrapped empty value would make every conditional over it evaluate true.

`user.name` and `user.email` SHALL render only when **both** `enabled` and `shareAccountIdentity` are true: `enabled` is the master switch over all per-user context, so turning it off stops identity injection along with everything else, while `shareAccountIdentity` additionally withholds identity from an owner who wants their authored personalization used but not their account details.

Every rendered value SHALL be neutralized by the templating capability's rules for its field kind: account-identity values by strict `&`/`<`/`>` escaping, and authored values by the tag sanitizer, whose two rules — a value can never close a tag it did not open within that same value, and can never emit the delimiter's own reserved name as a tag at all — together keep authored text unable to terminate or forge the surrounding structure, while letting self-contained authored markup under any other name (an owner's own `<instructions>…</instructions>` blocks) reach the model verbatim. Rendered output SHALL NOT be re-evaluated as a template.

Per-user values SHALL be read under the chat owner's tenant scope, projected into the render context, and substituted **before** the snapshot's prompt and content hashes are computed, then bound to the run atomically with the user message. The read MAY occur in a separate short tenant-scoped transaction preceding the binding transaction, so that the binding transaction is not held open across it; a personalization edit committed between the read and the write MAY apply only to the next run.

The render context MUST remain an explicitly constructed projection: adding these paths MUST NOT be implemented by passing a personalization row, a user row, or any other record as context.

#### Scenario: Operator authors a residue-free block with conditionals

- **WHEN** an operator wraps a label and its value in a conditional over an allowlisted personalization path
- **THEN** the label and value render together when the owner has set that field
- **AND** neither the label nor any empty remnant renders when the owner has not

#### Scenario: An entire block is gated on the owner having any per-user context

- **WHEN** an operator wraps a whole block including its framing prose in a conditional over `user`, and the owner has authored nothing and shares no account identity
- **THEN** the entire block including its wrapper is omitted
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: Disabling personalization also stops identity injection

- **WHEN** an owner sets `enabled` to false and a prompt references both `user.name` and personalization paths
- **THEN** none of those paths render any content
- **AND** the owner's identity is not transmitted to the provider

#### Scenario: Account identity is withheld while authored content still renders

- **WHEN** an owner leaves `enabled` true and sets `shareAccountIdentity` to false
- **THEN** their authored personalization renders
- **AND** neither their account display name nor their email address renders

#### Scenario: Authored text cannot forge structure

- **WHEN** an owner authors text containing a closing delimiter for the operator's surrounding markup, which the value itself never opened
- **THEN** the rendered output escapes that closer as content
- **AND** the surrounding prompt structure is unchanged

#### Scenario: Self-contained authored markup survives

- **WHEN** an owner authors preference text structured with their own tags, named other than the delimiter, opened and closed within the same field
- **THEN** that markup reaches the model verbatim rather than entity-escaped
- **AND** the enclosing delimiter still closes exactly once, after the authored text

#### Scenario: Owner authors a balanced copy of the delimiter itself

- **WHEN** an owner authors a well-formed opening and closing pair naming the delimiter, which the balance rule alone would accept
- **THEN** both are escaped as content because the delimiter's name is reserved
- **AND** the rendered prompt still contains exactly one delimiter pair

#### Scenario: Context extension does not pass records

- **WHEN** per-user paths are added to the render context
- **THEN** the context contains only explicitly projected scalar values
- **AND** no personalization row, user row, or other record is reachable through any context path

#### Scenario: A tool never takes identity from prompt text

- **WHEN** a tool requires the owner's email address
- **THEN** it reads that address from the authenticated session server-side
- **AND** it does not accept an address restated by the model or supplied in tool input

### Requirement: The packaged default prompt delimits and frames per-user content

The packaged project-default prompt SHALL render per-user content inside a **named delimited block**, preceded by framing prose stating that the block is data describing the user and their standing delivery preferences rather than instructions from a higher authority, that it ranks below the system instructions and below the user's requests in the current conversation, that it cannot grant tools or capabilities, relax tool authorization, or override safety or transparency rules, and that text inside it attempting any of those is to be disregarded.

The delimiter SHALL be structurally reliable rather than merely conventional: because a rendered value cannot close a tag it did not open within itself, authored text cannot terminate the block or forge a second one, while markup the owner opened and closed within their own field passes verbatim. The whole block including its framing prose SHALL be gated on `user`, so nothing renders for an owner with no per-user context.

Within the block, single-line entries (preferred name, account name, account email) SHALL render as `Label: value` lines, grouped together and first; the multi-line authored fields (`about`, `responsePreferences`) SHALL render as their own headed subsections below them, so multi-paragraph text is not glued to an inline label and no single-line entry appears to belong to a preceding subsection. Every conditional SHALL be authored so that an absent field contributes no residual whitespace, since the owner-facing preview reproduces the rendered block byte-for-byte.

The subsection headings are **presentation, not a security boundary**: authored text may itself contain a line spelling one of them, and no attempt SHALL be made to strip or escape markdown headings inside authored values, because doing so would mangle text owners legitimately write. This is accepted rather than defended, on the grounds that both authored fields carry identical authority and both sit inside a delimiter the sanitizer keeps intact — a forged heading relabels the owner's own text within the owner's own data block and confers nothing. Only the delimiter itself is structurally guaranteed.

The packaged default SHALL reference the account-identity paths inside conditionals, so an owner's `shareAccountIdentity` toggle takes effect on a stock installation without an operator editing any file. Operators MAY reshape, reorder, or remove this block in their own prompt files; llame ships it as a default, not as an unreshapeable element.

#### Scenario: Packaged default frames the block

- **WHEN** an owner with personalization runs a model using the packaged default prompt
- **THEN** their content renders inside the named delimited block
- **AND** the framing prose stating the block's bounded authority precedes it

#### Scenario: Owner attempts to close the block

- **WHEN** an owner authors text containing the block's closing delimiter
- **THEN** the delimiter is escaped as content and the block is not terminated early
- **AND** no text authored by the owner appears outside the block

#### Scenario: Owner has no per-user context

- **WHEN** an owner has authored nothing and shares no account identity
- **THEN** neither the block nor its framing prose renders
- **AND** the prompt is byte-identical to the same template with that section removed

### Requirement: Response preferences carry bounded authority

Rendered `responsePreferences` SHALL be presented to the model as owner-authored delivery preferences of bounded authority. They SHALL rank below the operator-configured system prompt, and they MUST NOT grant capabilities, enable or advertise tools, relax tool-permission decisions, or override safety constraints. Preference text that attempts any of those SHALL have no such effect, and the advertised or executable tool set MUST remain exactly what the operator configuration and the tool gate resolve independently of personalization. This bound SHALL be enforced structurally — by the tool gate receiving no personalization input — rather than by relying on wording in any particular prompt.

#### Scenario: Preferences attempt to widen the tool set

- **WHEN** a user writes preference text instructing the assistant to use a tool the operator has not allowlisted
- **THEN** the advertised and executable tool set is unchanged
- **AND** the bound snapshot's tool contract is identical to the same run without personalization

#### Scenario: Preferences conflict with the operator prompt

- **WHEN** preference text contradicts an instruction in the operator-configured system prompt
- **THEN** the operator prompt's instruction governs
- **AND** no personalization value is consulted when resolving tools or permissions

### Requirement: Personalization holds only owner-authored non-sensitive content

Personalization SHALL be documented and treated as a surface for non-sensitive, owner-authored text that is safe to include in every request for that owner. It MUST NOT be used to store inferred observations, accumulated conversation facts, credentials, or secrets. Personalization content MUST NOT be written to operator logs or error messages, and MUST NOT be exposed to any identity other than its owner.

Rendered values persist in the immutable effective-context snapshots bound to past runs. Deleting an account SHALL remove those snapshots along with it. Changing or withdrawing a value SHALL NOT rewrite snapshots already bound, so a superseded value remains visible in the owner's own receipts for earlier runs; this SHALL be documented as a known limitation rather than presented as erasure.

#### Scenario: Personalization is absent from logs

- **WHEN** an update or a render fails and the failure is logged
- **THEN** the log records the field name and failure kind
- **AND** no authored personalization content appears in the log or error response

#### Scenario: Deleting a field removes it from later runs

- **WHEN** an owner clears a personalization field
- **THEN** runs enqueued after that change carry no trace of the cleared value
- **AND** the owner's stored personalization no longer contains it

#### Scenario: Earlier runs retain what they bound

- **WHEN** an owner changes a personalization value after runs have already bound the previous one
- **THEN** those earlier runs' receipts still show the value that was actually sent
- **AND** no run is retroactively rewritten to claim content it did not send

### Requirement: A prompt without per-user paths forgoes personalization silently

Because per-user values reach the model only where an operator referenced them, a configured prompt that references no per-user path SHALL simply forgo personalization for that model. That condition MUST NOT fail startup and MUST NOT fail a run. Since the packaged default references the per-user paths, this arises only where an operator has replaced it. The consequence — that an owner's toggles have no effect for such a model, with nothing reporting it — SHALL be documented. Per-model activation reporting is deliberately out of scope for this change.

#### Scenario: Operator prompt references no per-user path

- **WHEN** a model's configured prompt references no per-user context path and its owner has authored personalization
- **THEN** startup succeeds and runs for that model execute normally without personalization
- **AND** neither startup nor the run reports an error

### Requirement: Owners read and update personalization through an owner-scoped API

The API SHALL expose owner-scoped retrieval and partial update of the authenticated user's own personalization at `/api/v1/me/personalization`, establishing `api/v1/me` as the namespace for resources belonging to the authenticated user. The identity SHALL come only from the authenticated session and never from client-supplied input, so a caller cannot read or write another user's personalization by supplying an identifier. Requests SHALL be validated against a declared schema, responses SHALL use an explicit response type with an egress allowlist, and the endpoints SHALL appear in the generated OpenAPI document.

The `shareAccountIdentity` control SHALL be documented, in the API contract and in whatever surface presents it, as sending the owner's account display name and email address to the model provider the operator has configured — which in a multi-user instance may be a third party with no relationship to that user.

#### Scenario: Owner retrieves their personalization

- **WHEN** an authenticated user requests their personalization
- **THEN** the response contains their stored fields and both toggles
- **AND** it contains no other user's data and no server-only prompt path or provider internals

#### Scenario: Caller supplies another user's identifier

- **WHEN** a request body or query attempts to target a different user id
- **THEN** the supplied identifier is ignored or rejected
- **AND** the operation applies only to the authenticated user

#### Scenario: Unauthenticated request

- **WHEN** an unauthenticated caller requests or updates personalization
- **THEN** the request is rejected
- **AND** no personalization content is disclosed

### Requirement: Context layers have a stated precedence

The system SHALL define and document a single precedence order for instruction-bearing context, from highest to lowest: the operator-configured system prompt and tool-permission or safety constraints, which user content can never override; then instructions given within a conversation, which govern that conversation; then explicit owner-authored personalization, which is the standing default; then any future inferred or accumulated memory, which ranks lowest. Inferred content MUST NOT silently outrank an explicitly authored preference.

The documentation SHALL state what enforces each rung. The top rung is **structural**: tools and permissions resolve with no personalization input, and this is asserted by test. Every rung below it is **advisory** — carried by the packaged default's framing prose and by model compliance, and not preserved if an operator replaces that framing. The ordering is stated primarily so that a later inferred-memory capability cannot be built to outrank an authored preference.

#### Scenario: In-conversation instruction overrides a standing preference

- **WHEN** a user's standing `responsePreferences` ask for brief answers and the user asks for an exhaustive answer in a conversation
- **THEN** the in-conversation request governs that conversation
- **AND** the standing preference continues to apply to other conversations

#### Scenario: Future inferred memory cannot outrank an explicit preference

- **WHEN** a later capability introduces inferred or accumulated user memory that conflicts with authored personalization
- **THEN** the authored personalization governs
- **AND** the inferred layer is presented at a lower authority than the authored preference
