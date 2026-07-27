## ADDED Requirements

### Requirement: Owners author a bounded personalization profile

The system SHALL let each user author their own personalization consisting of `preferredName` (short single-line text), `about` (free text for role, work context, and languages as prose), `responsePreferences` (free text for how answers should be delivered), `timezone` (an IANA time-zone identifier), an `enabled` toggle **defaulting to true**, and a `shareAccountIdentity` toggle **defaulting to false**. The two defaults are deliberately asymmetric: `enabled` gates only what the owner authored, so defaulting it on costs nothing (an owner who wrote nothing renders nothing) and their text takes effect the moment they write it, with no second switch to discover; `shareAccountIdentity` gates account-derived identity, where defaulting it on would let an operator referencing `user.email` move every existing user's address to the configured provider retroactively, with no action or awareness from those users. Each text field SHALL enforce a documented maximum length; the caps SHALL be generous enough for multi-paragraph authoring rather than a single sentence. Every field SHALL be optional, and a user who has authored nothing SHALL be indistinguishable in behavior from a user whose personalization is disabled. The system MUST NOT infer, derive, or auto-populate any field from conversation content.

#### Scenario: User authors a complete profile

- **WHEN** a user sets `preferredName`, `about`, `responsePreferences`, and `timezone` within the documented caps
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

#### Scenario: Timezone is not a valid identifier

- **WHEN** an update supplies a `timezone` that is not a recognized IANA identifier
- **THEN** the update is rejected with a validation error
- **AND** the previously stored timezone is unchanged

#### Scenario: No field is populated by inference

- **WHEN** a user discusses their name, occupation, or language preferences in a chat
- **THEN** no personalization field is created or modified as a result
- **AND** personalization changes only through an explicit owner-initiated update

### Requirement: Personalization is tenant-isolated at the datastore

Personalization state SHALL live in a tenant-owned table carrying the owner's user id, with row-level security `ENABLE`d **and** `FORCE`d and an owner policy evaluated against `current_setting('app.current_user_id', true)`. There SHALL be **no** public-read policy: personalization MUST NOT be readable through the public chat-sharing path or by the empty (public) identity, even for an owner who has shared a chat. Every read and write SHALL execute inside the owner's tenant scope, with application-level owner filters retained as defense-in-depth.

Because the `users` table carries no row-level security of its own, reads of account fields for prompt context SHALL be explicitly scoped to the authenticated owner's id in the query; there is no datastore backstop for that read, and this SHALL be stated where the read is implemented. Cross-tenant and public-identity negative tests SHALL run in the RLS harness.

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

#### Scenario: Account-field read is explicitly owner-scoped

- **WHEN** account fields are read to build prompt context
- **THEN** the query filters on the authenticated owner's id rather than relying on row-level security
- **AND** a test asserts no other user's account fields can be returned by that path

### Requirement: Per-user values reach the model through allowlisted template context

Personalization SHALL reach the model by extending the prompt-template context allowlist established by the Handlebars templating capability, not by introducing a second substitution mechanism. The allowlist SHALL gain exactly `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.personalization.timezone`, `user.name` (the account display name), and `user.email` (the account email address). Context path names SHALL match the API field names exactly, so the prompt vocabulary and the API contract cannot drift apart. The `enabled` toggle SHALL NOT be renderable: it controls whether the others appear, and is not content.

llame SHALL NOT provide a prepackaged block, section wrapper, or framing prose of its own. Operators own the structure, labels, ordering, and any explanatory or framing text, and use the built-in conditionals to omit a label together with an absent value. This is what the templating capability's conditionals exist for; a llame-owned composite block was considered and rejected because it is the one element an operator could not reshape.

When personalization is disabled, absent, or entirely empty, `user.personalization` SHALL be absent from the render context altogether — so a conditional over it is false and an operator can gate an entire block on it in one expression. Individual fields SHALL likewise be absent rather than present-and-empty, and a value that is empty **after trimming** SHALL be treated as absent. Omission rather than an empty value is required, not stylistic: escaped values are marked already-safe and such a wrapper is always truthy, so a wrapped empty value would make every conditional over it evaluate true. `user.name` and `user.email` SHALL render only when **both** `enabled` and `shareAccountIdentity` are true: `enabled` is the master switch over all per-user context, so turning it off stops identity injection along with everything else, while `shareAccountIdentity` additionally withholds identity from an owner who wants their authored personalization used but not their account details.

Every rendered value SHALL be escaped by the templating capability's escaping rules, so authored text cannot terminate, forge, or inject surrounding structure, and rendered output SHALL NOT be re-evaluated as a template.

Per-user values SHALL be read under the chat owner's tenant scope, projected into the render context, and substituted **before** the snapshot's prompt and content hashes are computed, then bound to the run atomically with the user message. The read MAY occur in a separate short tenant-scoped transaction from the snapshot write, so that asynchronous tool-schema resolution does not hold a database transaction open; a personalization edit committed between the read and the write MAY apply only to the next run.

The render context MUST remain an explicitly constructed projection: adding these paths MUST NOT be implemented by passing a personalization row, a user row, or any other record as context.

#### Scenario: Operator authors a residue-free block with conditionals

- **WHEN** an operator wraps a label and its value in a conditional over an allowlisted personalization path
- **THEN** the label and value render together when the owner has set that field
- **AND** neither the label nor any empty remnant renders when the owner has not

#### Scenario: An entire block is gated on personalization existing

- **WHEN** an operator wraps a whole personalization block in a conditional over `user.personalization` and the owner has authored nothing
- **THEN** the entire block including its wrapper is omitted
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: Disabling personalization also stops identity injection

- **WHEN** an owner sets `enabled` to false and a prompt references both `user.name` and personalization paths
- **THEN** none of those paths render any content
- **AND** the owner's identity is not transmitted to the provider

#### Scenario: Account identity renders only where an operator authored it

- **WHEN** an operator's prompt references `user.email` and the owner's personalization is enabled
- **THEN** the owner's escaped email address renders in place and reaches the configured provider
- **AND** a prompt that does not reference it transmits no email

#### Scenario: Default installation transmits no account identity

- **WHEN** an instance runs the packaged project-default prompt unmodified
- **THEN** no account display name or email address is substituted into any prompt, snapshot, or receipt
- **AND** account identity reaches a provider only after an operator adds the corresponding path

#### Scenario: Authored text cannot forge structure

- **WHEN** an owner authors text containing structural delimiters used by the operator's surrounding markup
- **THEN** the rendered output escapes those characters as content
- **AND** the surrounding prompt structure is unchanged

#### Scenario: Two users share one model

- **WHEN** two owners with different personalization run the same configured model
- **THEN** each run binds its own owner's rendered values
- **AND** neither owner's authored text appears in the other's prompt or snapshot

#### Scenario: Context extension does not pass records

- **WHEN** per-user paths are added to the render context
- **THEN** the context contains only explicitly projected scalar values
- **AND** no personalization row, user row, or other record is reachable through any context path

#### Scenario: A tool never takes identity from prompt text

- **WHEN** a tool requires the owner's email address
- **THEN** it reads that address from the authenticated session server-side
- **AND** it does not accept an address restated by the model or supplied in tool input

### Requirement: Response preferences carry bounded authority

Rendered `responsePreferences` SHALL be presented to the model as owner-authored delivery preferences of bounded authority. They SHALL rank below the operator-configured system prompt, and they MUST NOT grant capabilities, enable or advertise tools, relax tool-permission decisions, or override safety constraints. Preference text that attempts any of those SHALL have no such effect, and the advertised or executable tool set MUST remain exactly what the operator configuration and the tool gate resolve independently of personalization. Because operators own all framing prose, this bound SHALL be enforced structurally rather than by relying on wording in any particular prompt.

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

#### Scenario: Personalization is absent from logs

- **WHEN** an update or a render fails and the failure is logged
- **THEN** the log records the field name and failure kind
- **AND** no authored personalization content appears in the log or error response

#### Scenario: Deleting a field removes it from later runs

- **WHEN** an owner clears a personalization field
- **THEN** runs enqueued after that change carry no trace of the cleared value
- **AND** the owner's stored personalization no longer contains it

### Requirement: Activation state and injected cost are reported, not assumed

Because per-user values reach the model only where an operator referenced them, a configured prompt that references no per-user path SHALL simply forgo personalization for that model. That condition MUST NOT fail startup and MUST NOT fail a run. The system SHALL report, per configured model, whether any per-user path is referenced, and SHALL report an estimate of the tokens the owner's current values add to a request, so activation is never silently misreported to the owner.

#### Scenario: Operator prompt references no per-user path

- **WHEN** a model's configured prompt references no per-user context path and its owner has authored personalization
- **THEN** startup succeeds and runs for that model execute normally without personalization
- **AND** the reported activation state for that model is inactive

#### Scenario: Activation differs between models

- **WHEN** one configured model's prompt references per-user paths and another's does not
- **THEN** the reported activation state distinguishes the two models
- **AND** the owner can determine which models apply their personalization

#### Scenario: Owner inspects injected cost

- **WHEN** an owner retrieves their personalization
- **THEN** the response includes an estimate of the tokens their current values add per request
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
