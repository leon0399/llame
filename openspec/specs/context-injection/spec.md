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

### Requirement: Every item declares a producer and a form, and unknown values render as nothing

Each context item SHALL declare the **producer** that authored it and MAY declare a **form** describing what kind of content it is. Producer answers who authored the item; form answers what kind of thing it is. The two SHALL be independent: several producers MAY share a form, and one producer MAY emit more than one form.

The form vocabulary SHALL be **semantic rather than visual**. It SHALL state what the content is, never how it is presented; ordering, emphasis, collapse behavior, and other presentation concerns SHALL NOT enter it. The vocabulary SHALL contain exactly the forms that have a producer:

- `notice` — a one-off account of something that happened; it supersedes nothing.
- `snapshot` — current state, where a later snapshot from the same producer supersedes an earlier one.
- `checkpoint` — a summary that supersedes this chat's own earlier history.

A form SHALL NOT be defined ahead of a producer that emits it. Anticipated forms without a producer SHALL be recorded as noncanonical research provenance rather than specified here, so that a future producer adopts an existing term rather than inventing a redundant one without any of them being normative before it is implemented.

An **absent** form SHALL be valid and SHALL render as opaque content. An **unrecognized** form SHALL be treated as absent. An **unrecognized** producer SHALL parse, SHALL be recorded as an injected item, and SHALL render as nothing — never as instruction. Rejecting an unrecognized producer or form outright is prohibited: that is what would make every extension a coordinated revision boundary. Rendering an unrecognized producer as content is equally prohibited, because a reader that cannot interpret an item cannot state its precedence or apply its framing.

Validation of an item's envelope, and of the payload of a **recognized** producer, SHALL remain strict, so that client-authored control metadata cannot be forged or smuggled through additional fields.

#### Scenario: Reader encounters an unrecognized producer

- **WHEN** a persisted item names a producer the reader does not recognize
- **THEN** the item parses and is recorded as injected
- **AND** nothing is rendered into the model-visible conversation for it

#### Scenario: Client supplies control metadata

- **WHEN** a client submits a message containing an item-shaped part
- **THEN** the part is discarded
- **AND** only server-derived state can author an item

#### Scenario: Reader encounters an unrecognized form

- **WHEN** a persisted item declares a form the reader does not recognize
- **THEN** it is treated as though no form were declared
- **AND** the item renders as opaque content rather than being rejected

### Requirement: Co-occurring items have a total order

When more than one item is injected on the same turn, they SHALL render in a **fixed producer precedence order**, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `recency-digest`
4. `temporal`

This list governs items **attached to a turn**. A producer whose item is carried by a message of its own — the compaction checkpoint is the only one today — is ordered by its placement rule instead, and SHALL NOT be read as absent from the vocabulary merely because it is absent from this list. A checkpoint necessarily leads the history it supersedes, which is a stronger constraint than any precedence order could express.

A producer added later SHALL be appended to this list, and the list SHALL be extended in the rail's own specification rather than negotiated between producers.

When one producer contributes **more than one item** on the same turn, those items SHALL render in the order that producer emitted them, ahead of the next producer's items. Emission order is load-bearing within a producer: a supersession and a subsequent delta from the same producer are only interpretable in the order they occurred, since a delta rendered before the supersession that precedes it reads as already superseded. Producers SHALL NOT order themselves relative to each other, and an item SHALL NOT be merged into, or suppressed by, another item. Identical inputs SHALL therefore produce identical model-visible output.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, an availability change, and a chat-list change all occur before one user message
- **THEN** their items render in the fixed producer precedence order, each in its own envelope
- **AND** none is merged, reordered relative to the specification, or suppressed

#### Scenario: One producer contributes two items on one turn

- **WHEN** a producer emits a supersession and a later delta before the same user message
- **THEN** both render under that producer's slot in the order they were emitted
- **AND** the delta does not precede the supersession it follows

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a turn carries both an availability change and the temporal item
- **THEN** the temporal item renders last among the attached items, immediately ahead of the user's visible text
- **AND** it renders in its own envelope like any other item

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

### Requirement: Reserved delimiter names are neutralized on untrusted rails

Content that llame did not author SHALL NOT be able to emit the rail's delimiter name as a tag when it is projected into model context. This SHALL apply to **visible user message text** and to **tool results**, which are respectively user-authored and remote-authored. The neutralization SHALL use the same two rules the instance-config capability defines for authored text: a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all.

Neutralization SHALL apply at render into model context and SHALL NOT alter stored content.

**Assistant output SHALL NOT be neutralized.** A model does not treat its own prior turns as authoritative, so an envelope-shaped fragment there carries no authority; and assistant turns legitimately contain the delimiter name as subject matter, which neutralization would corrupt on replay. This exclusion SHALL be documented as deliberate rather than as an oversight.

Because producers render prose from validated semantic values rather than persisting prose, the rail SHALL NOT depend on scanning its own rendered output.

#### Scenario: A user forges an envelope

- **WHEN** a user's message text contains the rail's delimiter name in tag form
- **THEN** the projected model context escapes it rather than emitting a second envelope
- **AND** the stored message is unchanged

#### Scenario: A tool result contains an envelope

- **WHEN** a tool returns content containing the rail's delimiter name in tag form
- **THEN** the projected model context escapes it
- **AND** the recorded tool result is unchanged

#### Scenario: An assistant turn discusses the envelope

- **WHEN** an assistant turn legitimately contains the delimiter name, such as inside a code sample
- **THEN** the replayed text is byte-identical to what the model produced
- **AND** no neutralization is applied to it

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

### Requirement: An item is either persisted-derived or bind-time

Every item SHALL be one of two kinds, and its kind SHALL be determined by whether a durable part exists for it:

- **persisted-derived** — a durable part records the item's semantics, so the item is reproduced identically whenever the conversation is replayed.
- **bind-time** — the item is computed while assembling one request and no durable part exists. A bind-time item SHALL NOT be persisted into conversation history, because a stored statement about the present instant becomes false on replay.

A durable part SHALL carry **semantics rather than rendered prose**: identifiers, closed reason codes, and validated values, never literal item text, remote-authored text, raw errors, or prompt contents.

#### Scenario: A persisted-derived item is replayed

- **WHEN** a conversation containing a persisted-derived item is replayed
- **THEN** the item is reproduced from its durable part
- **AND** the reproduction is identical across replays

#### Scenario: A bind-time item is replayed

- **WHEN** a request is assembled for a turn that previously carried a bind-time item
- **THEN** no stale copy of that item appears in the replayed history

### Requirement: Every Run records the items it injected

Each Run SHALL record the context items injected into the request it executed, as they were rendered, together with each item's producer, form, and residency. The record SHALL be **owner-scoped and enforced at the datastore**, and SHALL NOT be exposed to a non-owner, to a public share, to an ordinary transcript export, or to a search projection.

Recording SHALL NOT rely on re-rendering an item later: an item's rendered text is not reproducible from a durable part once its renderer changes, and a bind-time item is not reproducible at all. The record SHALL therefore be the authority for what a past Run injected, and SHALL include every item the Run injected — the bind-time checkpoint among them.

An item that rendered as nothing, because its producer was unrecognized, SHALL still appear in the record, marked as having contributed no text. Omitting it would turn a declared fail-closed omission into an undetectable loss, which is the opposite of what the record exists for.

The record SHALL state what was **actually sent**. When a request is rebuilt before dispatch — as transition compaction does — the record SHALL reflect the rebuilt request rather than the discarded one, and a Run whose preparation fails before any request is made SHALL record nothing rather than a request the model never received.

The record SHALL be kept **separately from the effective-context snapshot**, which is addressed by its content and reused across Runs whose prompt, declarations, source, and availability manifest are identical, while injected items vary per turn under exactly those conditions.

An item whose content originates **outside the chat it was injected into** SHALL be documented as not erasable through that content's own source: deleting the source, or withdrawing consent for it, does not reach a record already written. This SHALL be stated once at the rail level so that every producer carrying such content inherits the disclosure.

#### Scenario: A Run injects items

- **WHEN** a Run is executed with context items injected
- **THEN** its record lists them as rendered, with producer, form, and residency
- **AND** the record is readable only by the chat's owner

#### Scenario: A renderer's wording changes

- **WHEN** an item's rendered wording changes after a Run has executed
- **THEN** that Run's record still states what was injected at the time
- **AND** the recorded text is not re-derived from the current renderer

#### Scenario: Two Runs share an effective-context snapshot

- **WHEN** two Runs bind the same content-addressed snapshot but injected different items
- **THEN** each Run records its own items
- **AND** snapshot reuse is unaffected

#### Scenario: A source of injected content is deleted

- **WHEN** content injected into one chat originated in another chat that is later deleted
- **THEN** the deletion does not remove that content from records already written
- **AND** this limit is disclosed rather than implied
