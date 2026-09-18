## MODIFIED Requirements

### Requirement: User-authored text is neutralized before persistence

Every client-submitted user text part SHALL be neutralized before it is stored,
using the reserved-delimiter rules the instance-config capability defines. The
sanitized stored value SHALL be the sole replay form; the application SHALL NOT
retain a second unsanitized transcript or sanitize the value again during later
request assembly.

Sanitization SHALL preserve message-part boundaries and order. Replay SHALL NOT
join text parts manually or prefix sender identifiers. Assistant output SHALL
NOT be neutralized. Persisted reasoning SHALL NOT be neutralized either; it
is display-only everywhere except the same-Chat provider replay that
`reasoning-output` defines, where it is replayed byte-identically.

Tool-result neutralization and ordinary assistant/tool replay remain governed
by `tool-calling`; their current custom projection is an explicit best-effort
exception pending #599 rather than part of this change.

#### Scenario: A user forges an envelope

- **WHEN** a submitted user text part contains a reserved delimiter in tag form
- **THEN** the accepting path neutralizes it before persistence
- **AND** every later replay uses that stored sanitized text unchanged

#### Scenario: A message has several text parts

- **WHEN** an accepted user message contains several text parts
- **THEN** each sanitized part is stored and replayed in its original position
- **AND** the application does not concatenate the parts into a replacement
  string

#### Scenario: Two users participate in one chat

- **WHEN** stored user turns have different `senderUserId` values
- **THEN** later model replay uses each turn's stored parts without injecting
  sender labels

#### Scenario: An assistant turn discusses the envelope

- **WHEN** an assistant turn contains the reserved delimiter as subject matter
- **THEN** its replayed visible text is byte-identical to what the model produced
  and is not neutralized
- **AND** persisted reasoning is excluded from that visible text and, when
  `reasoning-output` replays it, is likewise byte-identical and not
  neutralized

#### Scenario: A tool result contains an envelope

- **WHEN** a tool result contains a reserved delimiter in tag form
- **THEN** the `tool-calling` projection neutralizes it under its existing
  contract
- **AND** this change does not redefine ordinary tool-part persistence

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly SHALL treat `messages.parts` as the durable application/UI
history. It SHALL preserve model-bearing stored parts and their order, omit
declared display-only parts except reasoning parts, which `reasoning-output`
returns to the provider for the Chat that stores them, and map each surviving
`data-context` part to one
ordinary SDK text part containing `data.text`. It SHALL then pass the ordered
parts to the AI SDK rather than manually constructing a joined transcript.

This SHALL be an application-level best-effort invariant, not a promise of
provider-wire byte identity. SDK conversion, role grouping, and provider
serialization MAY evolve. The current ordinary assistant/tool projection SHALL
remain a documented exception pending #599 because stored parts do not prove
step boundaries.

The current top-level system prompt is outside message history and MAY change.
Compaction MAY replace only the prefix it explicitly supersedes, using the
materialized replacement history required by `model-system-prompts` and
`tool-calling`.

#### Scenario: Context data crosses the SDK boundary

- **WHEN** a stored user message contains non-empty `data-context.data.text`
- **THEN** the transition supplies one `{ type: "text", text: data.text }` part
  in the same position
- **AND** no producer renderer, sanitizer, sorter, or manual join runs

#### Scenario: SDK serialization changes

- **WHEN** an SDK or provider release changes its wire representation while
  accepting the same ordered UI parts
- **THEN** the application-level replay contract remains satisfied
- **AND** the system does not claim provider-wire or cache-byte identity

#### Scenario: Reasoning parts cross the boundary for their own Chat

- **WHEN** request assembly builds a Run's request from stored parts that include
  reasoning parts
- **THEN** those parts are passed to the AI SDK in their stored positions with any
  provider metadata they carry
- **AND** every other declared display-only part is still omitted
