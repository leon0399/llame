## MODIFIED Requirements

### Requirement: Per-user values reach the model through allowlisted template context

Personalization SHALL reach the model by extending the prompt-template context allowlist established by the Handlebars templating capability, not by introducing a second substitution mechanism. The allowlist SHALL gain exactly `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name` (the account display name), and `user.email` (the account email address). Context path names SHALL match the API field names exactly, so the prompt vocabulary and the API contract cannot drift apart. Neither toggle SHALL be renderable: they control whether the others appear, and are not content.

llame SHALL NOT provide a **composite context value** that renders a section the operator cannot reshape. Operators own the structure, labels, ordering, and any explanatory or framing text, expressed in a prompt file they can edit or replace, and use the built-in conditionals to omit a label together with an absent value.

Absence SHALL be expressed by omission from the context at every level: an individual field with no value is absent; `user.personalization` is absent when personalization is disabled or every authored field is empty; and `user` itself is absent when nothing beneath it would render, so an operator can gate a whole section including its framing prose on one expression. A value that is empty **after trimming** SHALL be treated as absent. Omission rather than an empty value is required, not stylistic: escaped values are marked already-safe and such a wrapper is always truthy, so a wrapped empty value would make every conditional over it evaluate true.

`user.name` and `user.email` SHALL render only when **both** `enabled` and `shareAccountIdentity` are true: `enabled` is the master switch over all per-user context, so turning it off stops identity injection along with everything else, while `shareAccountIdentity` additionally withholds identity from an owner who wants their authored personalization used but not their account details.

Every rendered value SHALL be neutralized by the templating capability's rules for its field kind: account-identity values by strict `&`/`<`/`>` escaping, and authored values by the tag sanitizer, whose two rules — a value can never close a tag it did not open within that same value, and can never emit the delimiter's own reserved name as a tag at all — together keep authored text unable to terminate or forge the surrounding structure, while letting self-contained authored markup under any other name (an owner's own `<instructions>…</instructions>` blocks) reach the model verbatim. Rendered output SHALL NOT be re-evaluated as a template.

For each execution attempt, the worker SHALL read current per-user values under the chat owner's tenant scope and project them into the shared system/description context before rendering. The rendered system text SHALL be recorded in that attempt's system-only receipt before provider I/O; rendered tool descriptions SHALL remain in memory. A later edit applies to the next attempt, including a retry, without rewriting an earlier receipt.

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

### Requirement: Response preferences carry bounded authority

Rendered `responsePreferences` SHALL be presented to the model as owner-authored delivery preferences of bounded authority. They SHALL rank below the operator-configured system prompt, and they MUST NOT grant capabilities, enable or advertise tools, relax tool-permission decisions, or override safety constraints. Preference text that attempts any of those SHALL have no such effect, and the advertised or executable tool set MUST remain exactly what the operator configuration and the tool gate resolve independently of personalization. This bound SHALL be enforced structurally — by the tool gate receiving no personalization input — rather than by relying on wording in any particular prompt.

#### Scenario: Preferences attempt to widen the tool set

- **WHEN** a user writes preference text instructing the assistant to use a tool the operator has not allowlisted
- **THEN** the advertised and executable tool set is unchanged
- **AND** admitted tool identities, schemas, classification, and invocation authority are identical to those resolved without personalization; operator-authored templates may vary rendered wording using the safe projection

#### Scenario: Preferences conflict with the operator prompt

- **WHEN** preference text contradicts an instruction in the operator-configured system prompt
- **THEN** the operator prompt's instruction governs
- **AND** no personalization value is consulted when resolving tools or permissions

### Requirement: Personalization holds only owner-authored non-sensitive content

Personalization SHALL be documented and treated as a surface for non-sensitive, owner-authored text that is safe to include in every request for that owner. It MUST NOT be used to store inferred observations, accumulated conversation facts, credentials, or secrets. Personalization content MUST NOT be written to operator logs or error messages, and MUST NOT be exposed to any identity other than its owner.

Values rendered into a system prompt SHALL persist in the immutable system-only receipt for that attempt. Deleting the account SHALL remove its receipts. Changing or withdrawing a value SHALL not rewrite earlier receipts; it SHALL affect the next execution attempt, including a queued Run or retry. Values rendered only into tool descriptions SHALL not create a persisted description receipt. Document the retention of earlier system text rather than claiming erasure.

#### Scenario: Personalization is absent from logs

- **WHEN** an update or a render fails and the failure is logged
- **THEN** the log records the field name and failure kind
- **AND** no authored personalization content appears in the log or error response

#### Scenario: Deleting a field removes it from later runs

- **WHEN** an owner clears a personalization field
- **THEN** execution attempts resolving after that change carry no trace of the cleared value
- **AND** the owner's stored personalization no longer contains it

#### Scenario: Earlier runs retain what they bound

- **WHEN** an owner changes a personalization value after attempts have recorded the previous one
- **THEN** those earlier runs' receipts still show the value that was actually sent
- **AND** no run is retroactively rewritten to claim content it did not send
