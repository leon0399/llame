## ADDED Requirements

### Requirement: Owners author a bounded personalization profile

The system SHALL let each user author their own personalization consisting of `preferredName` (short single-line text), `about` (free text for role, work context, and languages as prose), `responsePreferences` (free text for how answers should be delivered), `timezone` (an IANA time-zone identifier), and an `enabled` toggle. Each text field SHALL enforce a documented maximum length; the caps SHALL be generous enough for multi-paragraph authoring rather than a single sentence. Every field SHALL be optional, and a user who has authored nothing SHALL be indistinguishable in behavior from a user whose personalization is disabled. The system MUST NOT infer, derive, or auto-populate any field from conversation content.

#### Scenario: User authors a complete profile

- **WHEN** a user sets `preferredName`, `about`, `responsePreferences`, and `timezone` within the documented caps
- **THEN** the values are persisted for that user
- **AND** subsequent runs for that user carry them into model context

#### Scenario: User has authored nothing

- **WHEN** a user with no personalization row starts a run
- **THEN** the run executes normally with an empty personalization section
- **AND** no default, placeholder, or inferred content is substituted

#### Scenario: Field exceeds its cap

- **WHEN** an update supplies a text field longer than its documented maximum
- **THEN** the update is rejected with a validation error naming the field
- **AND** no partial update is persisted

#### Scenario: Timezone is not a valid identifier

- **WHEN** an update supplies a `timezone` that is not a recognized IANA identifier
- **THEN** the update is rejected with a validation error
- **AND** the previously stored timezone is unchanged

#### Scenario: No field is populated by inference

- **WHEN** a user discusses their name, occupation, or language preferences in a chat
- **THEN** no personalization field is created or modified as a result
- **AND** personalization changes only through an explicit owner-initiated update

### Requirement: Personalization is tenant-isolated at the datastore

Personalization state SHALL live in a tenant-owned table carrying the owner's user id, with row-level security `ENABLE`d **and** `FORCE`d and an owner policy evaluated against `current_setting('app.current_user_id', true)`. There SHALL be **no** public-read policy: personalization MUST NOT be readable through the public chat-sharing path or by the empty (public) identity, even for an owner who has shared a chat. Every read and write SHALL execute inside the owner's tenant scope, with application-level owner filters retained as defense-in-depth. Cross-tenant and public-identity negative tests SHALL run in the RLS harness.

#### Scenario: FORCE RLS holds against the table owner

- **WHEN** the RLS harness queries the personalization table as the owning role with another user's identity set, and again with the empty identity
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

### Requirement: Personalization reaches the model as a named section of the effective prompt

Enabled personalization SHALL be substituted into the selected model's effective system prompt through a closed, enumerated set of prompt-file expressions. Two forms SHALL be supported:

- a **composite** expression, `${user.personalization}`, that renders a complete llame-owned named section, including its framing text, omitting fields the owner left empty, and rendering as the empty string when personalization is absent, empty, or disabled;
- **per-field** expressions — `${user.personalization.preferredName}`, `${user.personalization.about}`, `${user.personalization.responsePreferences}`, and `${user.personalization.timezone}` — each rendering only that field's escaped value, or the empty string when it is unset, so an operator may author the surrounding structure, labels, headings, and ordering themselves.

One **account-identity** expression SHALL also be supported: `${user.name}`, rendering the requesting owner's account display name (`users.name`), escaped, or the empty string when that column is null. It SHALL NOT be part of the composite section, because the composite renders what the owner authored _for the assistant to read_ and an account name is not that. It SHALL be gated by the same `enabled` toggle, so a user who turns per-user context off stops having their identity injected at all rather than only part of it.

Expressions SHALL be namespaced under `user.`, matching the existing convention in which an expression's first segment names the **entity** the value belongs to (`model.id`, `model.name`). Field expression names SHALL match the API field names exactly (camelCase), so the prompt vocabulary and the API contract cannot drift apart. The `enabled` toggle SHALL NOT have an expression: it is a control over whether the others render, not renderable content.

Account-identity expressions beyond the display name — notably the account email address — SHALL NOT be introduced by this capability. Email is identity the user supplied for authentication rather than text authored for the assistant to read; injecting it would transmit it to the configured provider on every request for every user of a multi-user instance, persist it in immutable snapshot rows that have no purge path, and expose it to the compaction echo path — while serving no prompting need that `preferredName` does not serve better. A tool that legitimately needs the owner's email SHALL read it from the authenticated session server-side, never from prompt text the model could restate or a caller could influence.

Personalization SHALL be read under the chat owner's tenant scope, substituted **before** the snapshot's prompt and content hashes are computed, and bound to the run atomically with the user message. The read MAY occur in a separate short tenant-scoped transaction from the snapshot write, so that asynchronous tool-schema resolution does not hold a database transaction open; a personalization edit committed between the read and the write MAY apply only to the next run. Substitution MUST NOT compose two prompt files, MUST be single-pass and non-recursive, and MUST NOT re-interpret substituted values as further expressions. Every substituted value SHALL be escaped so authored text cannot terminate, forge, or inject surrounding structural markup.

Unlike `${model.name}`, an unset personalization value MUST NOT fail startup or fail a run: no owner exists at startup, and owner-authored data must never break execution. Per-field expressions therefore render empty rather than failing, and the operator owns whatever static scaffolding surrounds them. The packaged project-default prompt SHALL use the composite form, so a default installation cannot emit labels or headings with no content beneath them.

#### Scenario: Account display name renders outside the composite

- **WHEN** a prompt uses `${user.name}` and the owner's account has a display name
- **THEN** that escaped name is substituted in place
- **AND** it does not appear inside the composite personalization section

#### Scenario: Account has no display name

- **WHEN** a prompt uses `${user.name}` and the owner's `users.name` is null
- **THEN** the expression renders the empty string and the run executes normally
- **AND** startup is unaffected

#### Scenario: Disabling personalization also stops identity injection

- **WHEN** an owner sets `enabled` to false and a prompt uses both `${user.name}` and personalization expressions
- **THEN** none of them render any content
- **AND** the owner's identity is not transmitted to the provider

#### Scenario: Email is not an available expression

- **WHEN** a prompt file references the owner's account email address as an expression
- **THEN** startup fails naming it as an unsupported expression
- **AND** no account email is substituted into any prompt, snapshot, or receipt

#### Scenario: Composite expression renders a complete section

- **WHEN** a run is enqueued for an owner with enabled personalization and a prompt using the composite expression
- **THEN** the bound prompt contains one llame-owned named section carrying the authored values and its framing text
- **AND** fields the owner left empty are omitted from that section rather than appearing as empty labels

#### Scenario: Composite expression renders nothing when there is no personalization

- **WHEN** an owner has authored no personalization, or has disabled it, and the prompt uses the composite expression
- **THEN** the expression renders the empty string and no section, framing text, or label appears
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: Operator authors structure with per-field expressions

- **WHEN** an operator's prompt file places per-field expressions inside its own markup, headings, and labels
- **THEN** each expression renders only that field's escaped value in place
- **AND** llame adds no section wrapper, framing text, or ordering of its own

#### Scenario: Per-field expression with an unset value

- **WHEN** a prompt uses a per-field expression for a field the owner has not filled in
- **THEN** the expression renders the empty string, startup succeeds, and the run executes normally
- **AND** any surrounding label or heading the operator authored remains, because the operator owns that scaffolding

#### Scenario: Authored text cannot forge structure

- **WHEN** an owner authors text containing the composite section's delimiters or other structural markup
- **THEN** the rendered output escapes that text as content
- **AND** the surrounding prompt structure is unchanged

#### Scenario: Substituted values are not re-interpreted

- **WHEN** an owner authors text that itself looks like a supported prompt expression
- **THEN** the emitted text is literal and is not expanded
- **AND** no second substitution pass occurs

#### Scenario: Two users share one model

- **WHEN** two owners with different personalization run the same configured model
- **THEN** each run binds its own owner's substituted values
- **AND** neither owner's authored text appears in the other's prompt or snapshot

### Requirement: Response preferences carry bounded authority

Rendered `responsePreferences` SHALL be presented to the model as **owner-authored delivery preferences of bounded authority**. They SHALL rank below the operator-configured system prompt, and they MUST NOT grant capabilities, enable or advertise tools, relax tool-permission decisions, or override safety constraints. Preference text that attempts any of those SHALL have no such effect, and the advertised or executable tool set MUST remain exactly what the operator configuration and the tool gate resolve independently of personalization.

#### Scenario: Preferences attempt to widen the tool set

- **WHEN** a user writes preference text instructing the assistant to use a tool the operator has not allowlisted
- **THEN** the advertised and executable tool set is unchanged
- **AND** the bound snapshot's tool contract is identical to the same run without personalization

#### Scenario: Preferences conflict with the operator prompt

- **WHEN** preference text contradicts an instruction in the operator-configured system prompt
- **THEN** the operator prompt's instruction governs
- **AND** the preference is framed so the model treats it as a lower-authority delivery preference

### Requirement: Personalization holds only owner-authored non-sensitive content

Personalization SHALL be documented and treated as a surface for non-sensitive, owner-authored text that is safe to include in every request for that owner. It MUST NOT be used to store inferred observations, accumulated conversation facts, credentials, or secrets. Personalization content MUST NOT be written to operator logs or error messages, and MUST NOT be exposed to any identity other than its owner.

#### Scenario: Personalization is absent from logs

- **WHEN** an update or a render fails and the failure is logged
- **THEN** the log records the field name and failure kind
- **AND** no authored personalization content appears in the log or error response

#### Scenario: Deleting a field removes it from later runs

- **WHEN** an owner clears a personalization field
- **THEN** runs enqueued after that change carry no trace of the cleared value
- **AND** the owner's stored personalization no longer contains it

### Requirement: Activation state and injected cost are reported, not assumed

Because personalization is substituted into an operator-owned prompt, a configured prompt that omits every personalization expression SHALL simply forgo personalization for that model. That condition MUST NOT fail startup and MUST NOT fail a run. The system SHALL report, per configured model, whether personalization is active, and SHALL report an estimate of the tokens the rendered personalization adds to each request, so activation is never silently misreported to the owner.

#### Scenario: Operator override omits every personalization expression

- **WHEN** a model's configured prompt file contains no personalization expression and its owner has authored personalization
- **THEN** startup succeeds and runs for that model execute normally without personalization
- **AND** the reported activation state for that model is inactive

#### Scenario: Activation differs between models

- **WHEN** one configured model's prompt references a personalization expression and another's does not
- **THEN** the reported activation state distinguishes the two models
- **AND** the owner can determine which models apply their personalization

#### Scenario: Owner inspects injected cost

- **WHEN** an owner retrieves their personalization
- **THEN** the response includes an estimate of the tokens the rendered section adds per request
- **AND** the estimate reflects the currently stored content

### Requirement: Owners read and update personalization through an owner-scoped API

The API SHALL expose owner-scoped retrieval and partial update of the authenticated user's own personalization. The identity SHALL come only from the authenticated session and never from client-supplied input, so a caller cannot read or write another user's personalization by supplying an identifier. Requests SHALL be validated against a declared schema, responses SHALL use an explicit response type with an egress allowlist, and the endpoints SHALL appear in the generated OpenAPI document.

#### Scenario: Owner retrieves their personalization

- **WHEN** an authenticated user requests their personalization
- **THEN** the response contains their stored fields, per-model activation state, and the token estimate
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

#### Scenario: In-conversation instruction overrides a standing preference

- **WHEN** a user's standing `responsePreferences` ask for brief answers and the user asks for an exhaustive answer in a conversation
- **THEN** the in-conversation request governs that conversation
- **AND** the standing preference continues to apply to other conversations

#### Scenario: Future inferred memory cannot outrank an explicit preference

- **WHEN** a later capability introduces inferred or accumulated user memory that conflicts with authored personalization
- **THEN** the authored personalization governs
- **AND** the inferred layer is presented at a lower authority than the authored preference
