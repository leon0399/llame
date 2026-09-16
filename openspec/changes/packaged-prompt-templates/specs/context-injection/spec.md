## ADDED Requirements

### Requirement: Producer item bodies are packaged templates rendered at author time

Each producer's model-facing body MUST be authored as a packaged template file owned by that producer and shipped with the executing process, rendered once when the item is authored or staged, and persisted under the existing persisted-literal rule. Packaged item templates SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one, and an edit SHALL take effect only for items authored by a process built from the edited source.

Packaged item templates are outside the boot-time validation, path allowlist, and value escaping that `instance-config` defines for configured prompt files. The producer SHALL remain responsible for neutralizing untrusted text before it is rendered, using the reserved-delimiter rules `instance-config` defines and covering exactly the values it neutralizes before this change: owner-authored text, other chats' titles and excerpts, operator-authored catalog descriptions and instruction bodies, summarizing-model output, and tool result text. Grammar-constrained identifiers and published host paths SHALL continue to render as they do today. The engine SHALL add no escaping of its own, so that rendered bytes are exactly what the producer prepared.

The rail envelope, its `producer` and `form` attributes, and the provenance statement SHALL remain produced by the rail around the rendered body; a packaged item template SHALL render the body only.

#### Scenario: Rendered item bytes are unchanged by the move to a template

- **WHEN** a producer that previously rendered its body from code renders the same payload from its packaged template
- **THEN** the persisted item text is byte-identical to the previous rendering
- **AND** the envelope and provenance statement are unchanged

#### Scenario: The one body this change re-specifies

- **WHEN** the `effective-context-change` body renders after this change
- **THEN** it names both models, as `model-system-prompts` requires
- **AND** it is the only surface whose rendered bytes differ from before this change

#### Scenario: Untrusted text carries a reserved delimiter

- **WHEN** an untrusted text value the producer neutralizes today contains the rail's reserved delimiter name as a tag
- **THEN** the rendered body carries it neutralized exactly as before the template migration
- **AND** the rendered body contains one envelope

#### Scenario: A template edit does not alter stored items

- **WHEN** a packaged item template changes in a later release
- **THEN** every item persisted before that release replays its stored text unchanged
- **AND** only items authored by the new release use the new wording

#### Scenario: No configuration selects a packaged item template

- **WHEN** an operator configuration attempts to name a replacement for a producer's item template
- **THEN** startup rejects the unknown key under the closed schema
- **AND** no producer body is read from an operator path

### Requirement: Packaged item templates render from producer-owned values only

A packaged item template SHALL render from its producer's own payload together with the view values that producer derives from the payload in the same module, such as booleans for closed kinds, human labels for closed reason codes, and pluralized or joined strings. No other value SHALL be supplied to it. In particular, the prefix projections that `model-system-prompts` defines for configured prompt files (`user.*`, `chats.*`, `skills.*`) SHALL NOT be supplied, so that no persisted-literal item can carry a copy of owner personal data or another chat's title or excerpt beyond what the producer's own payload already contains under its capability's rules. The recency-digest producer's own `entries` and pin changes are its payload and are unaffected.

The names `model`, `context`, and `tools` SHALL be reserved and SHALL NOT be used as producer value names. The temporal item SHALL render from its own stored instant and zone, never from the prefix temporal anchor.

#### Scenario: Owner personalization is not renderable in an item

- **WHEN** a packaged item template references a per-user personalization or account-identity path
- **THEN** the reference renders empty because no such value is supplied
- **AND** no persisted item text contains the owner's personalization or identity values

#### Scenario: The prefix digest projection is not renderable in an item

- **WHEN** a packaged item template references a `chats.*` prefix-projection path
- **THEN** the reference renders empty because no such value is supplied
- **AND** digest content reaches the rail only through the recency-digest producer's own payload

#### Scenario: A closed reason code renders its label

- **WHEN** a producer's payload carries a closed reason code with a human label today
- **THEN** the rendered body carries the same label as before the template migration
- **AND** the code itself does not appear in the body
