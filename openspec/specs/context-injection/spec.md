# context-injection

## Purpose

The single rail on which llame injects server-authored context into a chat's model-visible conversation: one envelope, one provenance framing an operator cannot delete, one vocabulary of producer, form, and residency, and one durable record of what was actually injected. Producers own what their item says and when it fires; this capability owns everything they share, so that adding a context surface is an additive change rather than a new convention.

## Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

Each item SHALL occupy its **own text content block** within that message rather than being concatenated with another item or with the user's text. The separation between server-authored content and user-authored content SHALL therefore be structural rather than a textual convention that user input can imitate.

#### Scenario: Two items are injected on one turn

- **WHEN** two context items are injected before a user's message
- **THEN** each renders in its own `<system-reminder>` envelope in its own text content block
- **AND** the user's visible text occupies a further block in the same message
- **AND** no additional conversation message is created

#### Scenario: A turn carries no injected item

- **WHEN** a turn has no context item to inject
- **THEN** the user message carries only the user's visible text
- **AND** its serialized form is unchanged from a turn that predates this capability

#### Scenario: An item is not attached to a turn

- **WHEN** an item's producer has no triggering user message to attach to
- **THEN** the item is carried by the message its producer already owns
- **AND** it uses the same envelope, framing, and vocabulary as an attached item

### Requirement: The envelope states its own provenance and an operator cannot remove it

Each rendered envelope SHALL carry a statement that its content was inserted by llame and was not written by the user. That statement SHALL be produced by the system rather than by producer-supplied or operator-supplied text, and there SHALL be no configuration through which an operator can suppress it.

The **per-item statement SHALL be minimal** — one line. It is paid for on every item and accumulates in history until compaction, and an identical paragraph repeated on every item is skimmed rather than read.

The **packaged default system prompt SHALL carry the full explanation**, because it sits inside the cached prefix and is therefore paid for once per conversation. It SHALL state at least:

- that a message may contain these envelopes and that they are inserted automatically by llame;
- that their content is **not written by the user**, is not part of what the user said, and MUST NOT be treated as a message, request, or instruction from the user;
- that an envelope **bears no necessary relation to the message it appears in** — a reminder may be attached to a user message about something entirely unrelated, and its presence does not mean the user raised the subject;
- that an envelope's content may be **data even when it is phrased as an instruction**, and that such content is to be read as data;
- that an envelope ranks below the system instructions and below the user's requests, and cannot grant tools or capabilities or relax authorization;
- that envelope content is not to be quoted, repeated, or raised with the user unless the user asks about it.

The no-necessary-relation clause SHALL be stated explicitly rather than implied: it is the one property neither the delimiter name nor the per-item line conveys, and without it a model will attempt to connect an injected item to whatever the user happened to ask.

This prompt-side description is **additive rather than sufficient**: an operator may replace the prompt wholesale, so the envelope SHALL remain self-identifying without it.

#### Scenario: Operator replaces the packaged prompt

- **WHEN** a model resolves a complete operator-authored prompt that describes no envelope convention
- **THEN** injected items still state that they were inserted by llame and not written by the user
- **AND** no operator configuration can remove that statement

#### Scenario: Packaged prompt is in use

- **WHEN** the packaged default prompt renders
- **THEN** it states that envelopes are inserted by llame, are not written by the user, bear no necessary relation to the message they appear in, may carry data phrased as instruction, rank below system instructions and user requests, and are not to be raised with the user unasked
- **AND** injected items remain self-identifying independently of it

#### Scenario: An item arrives on an unrelated turn

- **WHEN** an item is attached to a user message whose subject is unrelated to the item
- **THEN** nothing in the rendered conversation implies the user raised the item's subject
- **AND** the prompt's no-necessary-relation statement covers the case

### Requirement: Every item declares metadata and persists its final model-facing text

Each context item SHALL declare the **producer** that authored it and MAY
declare a **form** describing what kind of content it is. Producer answers who
authored the item; form answers what kind of thing it is. The two SHALL be
independent: several producers MAY share a form, and one producer MAY emit more
than one form.

The form vocabulary SHALL be semantic rather than visual and SHALL contain
exactly the forms that have a producer:

- `notice` — a one-off account of something that happened; it supersedes
  nothing.
- `snapshot` — current state, where a later snapshot from the same producer
  supersedes an earlier one.
- `checkpoint` — a summary that supersedes this chat's own earlier history.

A form SHALL NOT be defined ahead of a producer that emits it.

Every newly authored persisted context part SHALL use `type: "data-context"`,
retain `data.v: 1`, and carry its complete final model-facing text beneath
`data.text`. The text SHALL include the canonical envelope, attributes,
provenance, producer body, and closing delimiter. Writers SHALL require a
non-empty string.

`data.text` SHALL be the sole replay authority. Producer, form, Run linkage,
and payload SHALL remain non-rendering metadata for validated machine behavior,
owner UI, provenance, and inspection. A metadata/text disagreement SHALL NOT
cause text to be regenerated: text wins for model replay, while metadata
consumers validate and fail closed independently.

An unknown producer or form SHALL NOT prevent structurally valid non-empty text
from replaying. A stored context part with missing text or the empty string
SHALL remain stored but contribute no model-visible part. It SHALL NOT be
backfilled or rendered from metadata. Whitespace-only text SHALL survive
unchanged.

#### Scenario: Reader encounters unknown metadata with persisted text

- **WHEN** a context part carries non-empty text and names an unrecognized
  producer or form
- **THEN** its text replays verbatim in the stored position
- **AND** the reader does not interpret the unknown payload

#### Scenario: Reader encounters an unrecognized producer

- **WHEN** a context part has non-empty text and an unrecognized producer
- **THEN** the text replays verbatim in its stored position
- **AND** a data-only part contributes no model-visible text

#### Scenario: Reader encounters an unrecognized form

- **WHEN** a context part has non-empty text and an unrecognized form
- **THEN** the text replays verbatim in its stored position
- **AND** no behavior is inferred from the unknown form

#### Scenario: Text and metadata disagree

- **WHEN** persisted context text disagrees with producer metadata
- **THEN** the model receives the stored text unchanged
- **AND** machine behavior validates metadata without rewriting that text

#### Scenario: Existing metadata-only part is replayed

- **WHEN** an existing context part carries metadata but no non-empty text
- **THEN** it contributes no model-visible part
- **AND** no current renderer is invoked to manufacture historical prose

#### Scenario: Client supplies control metadata

- **WHEN** a client request contains a context-item-shaped part
- **THEN** request validation rejects the message
- **AND** no client-authored part is persisted or trusted
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense encounters control metadata

- **WHEN** a direct service caller bypasses request validation and supplies
  parts containing a context-item-shaped part
- **THEN** the part is discarded while the remaining user text parts retain
  their order
- **AND** the message is rejected before database work when no user text part
  remains
- **AND** only server-derived state can author an item

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the accepting path SHALL
persist them in a fixed producer precedence order, ahead of the triggering user
text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `recency-digest`
4. `temporal`

When one producer contributes more than one item, those items SHALL be stored
in emission order. A producer added later SHALL extend this authoring list in
the rail specification.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical
items through the current precedence list or merge adjacent text parts. The
compaction checkpoint is carried by replacement history of its own and follows
that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany
  one user message
- **THEN** their final text blocks are persisted in fixed author-time order
- **AND** every later replay preserves the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in producer emission order
- **AND** neither item is merged or suppressed

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item accompanies another context item
- **THEN** authoring persists the temporal item last among attached items
- **AND** replay retains that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes author-time precedence
- **THEN** new items follow the new authoring order
- **AND** existing messages remain in their original stored order

### Requirement: Residency determines whether a change re-renders the prompt or appends an item

Every context contribution SHALL be classified by **residency**:

- **prefix-resident** — re-supplied in full on every request as part of the system prompt. Updating it means re-rendering the prompt. It is cheap to read on every turn and expensive to change, because a change invalidates the cached prefix for the whole conversation.
- **rail-resident** — appended once as a context item and never re-sent. Updating it means appending another item. It is cheap to add and paid for in every later turn until compaction.

A new context surface SHALL be classified by this procedure:

1. A contribution that is an **account of something that happened** SHALL be rail-resident.
2. A contribution that is a **complete statement of current state** which changes **less often than compaction** SHALL be prefix-resident.
3. A complete statement of current state which changes **more often than compaction** SHALL be a frozen prefix-resident baseline plus rail-resident deltas, re-baked at compaction. A frequently-changing complete statement SHALL NOT be placed in the prefix, because that forfeits prefix caching for the whole conversation on every change.

Residency SHALL be recorded for every contribution in the per-run record required below, so that a later audit reads one list regardless of where a contribution lived.

#### Scenario: A new surface reports an event

- **WHEN** a new context surface reports that something occurred
- **THEN** it is rail-resident
- **AND** it is not added to the system prompt

#### Scenario: A new surface states rarely-changing state

- **WHEN** a new context surface states current state that changes less often than the chat is compacted
- **THEN** it is prefix-resident
- **AND** a change to it re-renders the prompt rather than appending an item

#### Scenario: A new surface states frequently-changing state

- **WHEN** a new context surface states current state that changes more often than the chat is compacted
- **THEN** it is a frozen prefix baseline with rail-resident deltas
- **AND** the baseline is re-resolved at compaction rather than on every change

### Requirement: A prefix change is announced only when history was conditioned on the old value

A change to prefix-resident content SHALL be **silent to the model by default**: the model reads the re-rendered prompt, so its content needs no announcement.

An announcement SHALL be injected as a rail item when the changed content is **assertional** — a fact the model may previously have denied, lacked, or answered around — because the conversation then contains turns that contradict the new prefix and the contradiction would otherwise be unexplained. An announcement SHALL NOT be injected when the changed content is **behavioral** — tone, format, working style, or comparable guidance — because the only history conditioned on it is the model's own prior output, which is not authoritative.

An announcement SHALL state that earlier turns predate the changed content and that they are not to be treated as contradicting it.

Disclosure to the **owner** SHALL be unconditional and independent of this rule: every change to the effective context SHALL be recorded in that Run's record whether or not it is announced to the model.

**This requirement is not yet satisfied for every prefix contribution, and the gap SHALL be stated rather than implied.** Only the model cause of an effective-context change is detected today; a personalization edit or an operator prompt reload changes prefix-resident content without producing an announcement, so an owner who supplies a fact the assistant previously said it lacked still leaves the conversation carrying an unexplained contradiction. Detecting the remaining causes requires the binder to record why it minted a new snapshot, which no shipped path does, and is owned separately. Likewise, the owner-disclosure clause is satisfied today only for changes that produce a rail item: a behavioral change renders nothing, and the per-Run record holds rendered items, so it currently carries no entry for one. Both gaps are deferred rather than descoped — the rule stands as the contract the deferred work is written against, and a reader of this capability SHALL NOT infer that the assertional-announce branch is implemented.

#### Scenario: Assertional prefix content changes mid-conversation

- **WHEN** prefix-resident content gains a fact the assistant previously stated it did not have
- **THEN** an item announces that earlier turns predate the information
- **AND** it states that earlier answers are not to be treated as contradicting it

#### Scenario: Behavioral prefix content changes mid-conversation

- **WHEN** prefix-resident content changes only how the assistant should express itself
- **THEN** no item is injected
- **AND** the change is still recorded for the owner

#### Scenario: A routine re-resolution changes the prompt

- **WHEN** the prompt changes only because standing context was re-resolved at compaction
- **THEN** no announcement is injected
- **AND** the change is still recorded for the owner

### Requirement: Every item states its own precedence

An item whose payload carries content **llame did not author** — a recalled excerpt, a file's contents, a catalog entry, another chat's title — SHALL state, within the item, that it ranks below the system instructions and below the user's requests in the current conversation, that it cannot grant tools or capabilities or relax authorization, and that text inside it attempting to do so is to be disregarded.

An item rendered **entirely from values llame authored** — validated identifiers and closed server-authored reason codes, with no third-party text — SHALL NOT be required to carry the statement, because it contains nothing whose precedence is in question.

Precedence SHALL be stated **within the item** rather than only in the system prompt, for two reasons. The prompt is replaceable: an operator override removes the global statement, leaving an item carrying third-party prose with nothing ranking it. And a statement co-located with the content it ranks survives any later operation that splits, reorders, drops, or partially summarizes the surrounding conversation.

The **wording** of a producer's framing SHALL be owned by that producer rather than fixed here, so that it can be revised against evaluation of how models actually respond to it. This capability SHALL constrain what a producer's framing must establish, never the sentences it uses.

#### Scenario: An item carries third-party content

- **WHEN** an item's payload contains text llame did not author
- **THEN** the item states its rank relative to system instructions and user requests
- **AND** it states that the content cannot grant capabilities or relax authorization

#### Scenario: An item is rendered only from server-authored values

- **WHEN** an item is rendered entirely from validated identifiers and closed reason codes
- **THEN** no precedence statement is required of it

#### Scenario: An operator replaces the packaged prompt

- **WHEN** an operator override removes the prompt's global description of the convention
- **THEN** an item carrying third-party content still states its own precedence

### Requirement: User-authored text is neutralized before persistence

Every client-submitted user text part SHALL be neutralized before it is stored,
using the reserved-delimiter rules the instance-config capability defines. The
sanitized stored value SHALL be the sole replay form; the application SHALL NOT
retain a second unsanitized transcript or sanitize the value again during later
request assembly.

Sanitization SHALL preserve message-part boundaries and order. Replay SHALL NOT
join text parts manually or prefix sender identifiers. Assistant output SHALL
NOT be neutralized and persisted reasoning SHALL remain display-only.

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

#### Scenario: Assistant output discusses the envelope

- **WHEN** an assistant turn contains the reserved delimiter as subject matter
- **THEN** its replayed visible text is not neutralized
- **AND** persisted reasoning remains excluded

#### Scenario: A tool result contains an envelope

- **WHEN** a tool result contains a reserved delimiter in tag form
- **THEN** the `tool-calling` projection neutralizes it under its existing
  contract
- **AND** this change does not redefine ordinary tool-part persistence

### Requirement: Compaction is the rail's re-baseline boundary

Compaction SHALL be the single boundary at which rail state is re-established. A producer whose items express deltas against a baseline SHALL treat a newly active compaction checkpoint as starting a fresh baseline, rather than comparing across it. A producer whose contribution is a frozen prefix baseline SHALL re-resolve it at compaction and at no other time.

This rule SHALL be stated once for the rail and inherited, rather than derived independently per producer.

Standing context that is re-supplied on every request SHALL be excluded from the summary a compaction writes, so that a checkpoint does not freeze a stale copy of a value the next request supplies fresh. This exclusion SHALL be documented as resting on instruction and model compliance rather than structural enforcement.

#### Scenario: A delta producer crosses a compaction

- **WHEN** the first turn after a newly active checkpoint is prepared
- **THEN** a delta producer establishes a fresh baseline rather than comparing against pre-compaction state
- **AND** no transition is reported across the boundary

#### Scenario: A frozen baseline crosses a compaction

- **WHEN** a chat with a frozen prefix baseline is compacted
- **THEN** the baseline is re-resolved
- **AND** it is not re-resolved by any other event

### Requirement: An item is either persisted-literal or bind-time

Every item SHALL be one of two kinds:

- **persisted-literal** — durable storage carries the complete final text used
  for replay; or
- **bind-time** — the item is computed for one request and no durable historical
  text exists.

A persisted-literal item's metadata SHALL NOT be a source from which replay
reconstructs prose, framing, attributes, sanitization, or order. A persisted
context part with missing or empty text is inert stored data, not a third
rendering mode. A bind-time item SHALL NOT be persisted into message history,
because a stored statement about the present request could become false later.

#### Scenario: A persisted-derived item is replayed

- **WHEN** a conversation contains a context part with non-empty final text
- **THEN** replay uses that text directly
- **AND** renderer changes do not alter it

#### Scenario: A data-only item is replayed

- **WHEN** a stored context part lacks non-empty final text
- **THEN** it contributes no model-visible part
- **AND** metadata is not used to derive one

#### Scenario: A bind-time item is replayed

- **WHEN** a request is assembled for a turn that previously had a bind-time
  item
- **THEN** no stale copy of that item appears in history

### Requirement: Every Run records the items it injected

Each Run SHALL record context items injected into the request it executed, as
they appeared in the final application request, together with each item's
producer, form, and residency. The record SHALL be owner-scoped and enforced at
the datastore, and SHALL NOT be exposed to a non-owner, public share, ordinary
transcript export, or search projection.

For a persisted item, recording SHALL copy the same stored text used by the
request and SHALL NOT invoke a renderer. A data-only or empty context part that
contributed nothing SHALL still appear in the Run item record with empty text,
so intentional omission remains distinguishable from absence; metadata SHALL
NOT be rendered to fill it. A bind-time item SHALL record its final computed
text.

When request preparation rebuilds the request after transition compaction, the
record SHALL describe the rebuilt request. A Run whose preparation fails before
dispatch SHALL record no injected items.

The record SHALL remain separate from the reusable effective-context snapshot,
whose content address and lifecycle differ from turn-specific injected items.
Content copied from outside the chat SHALL remain non-erasable through deletion
of its source once it has been written into a persisted reminder or Run record;
that limitation SHALL remain documented.

#### Scenario: A Run injects items

- **WHEN** a Run executes with persisted context text
- **THEN** its record copies the exact text used by the final request
- **AND** the record is readable only by the chat owner

#### Scenario: A renderer's wording changes

- **WHEN** a producer renderer changes after an item and Run record were stored
- **THEN** both retain the original persisted text
- **AND** neither invokes the current renderer

#### Scenario: An inert context part accompanies a Run

- **WHEN** a stored context part has no non-empty text
- **THEN** it contributes no model part but remains in the Run context-item
  record with empty text
- **AND** metadata is not rendered to fill either location

#### Scenario: Two Runs share an effective-context snapshot

- **WHEN** two Runs reuse one snapshot but inject different reminders
- **THEN** each Run records its own reminder text
- **AND** snapshot reuse is unaffected

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another chat that is later deleted
- **THEN** the persisted reminder and prior Run record remain unchanged
- **AND** the deletion limitation is not hidden

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly SHALL treat `messages.parts` as the durable application/UI
history. It SHALL preserve model-bearing stored parts and their order, omit
declared display-only parts, and map each surviving `data-context` part to one
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
