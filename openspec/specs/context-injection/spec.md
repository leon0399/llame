# context-injection

## Purpose

The single rail on which llame injects server-authored context into a chat's model-visible conversation: one envelope, one provenance framing an operator cannot delete, one vocabulary of producer, form, and residency, and one durable record of what was actually injected. Producers own what their item says and when it fires; this capability owns everything they share, so that adding a context surface is an additive change rather than a new convention.

## Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

A compaction checkpoint SHALL remain a rail context item with producer `compaction`, form `checkpoint`, and rail residency for envelope and Run-receipt semantics. It SHALL NOT be a storage exception: its durable representation SHALL be an ordinary persisted `data-context` part on a `checkpoint` row, and replay SHALL convert that row to one user-role text message exactly as it converts every other persisted rail part. `model-system-prompts` SHALL own the row's coverage boundary and replay-selection contract.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

An item authored **between the model steps of one Run** — an in-Run item — has no user message to carry it. It SHALL be stored as a `data-context` part on that Run's assistant message, immediately after the last tool part of the step whose results triggered it, and SHALL be supplied to the model as a user-role text message placed after that step's last tool result on the step that follows the trigger and on every later step of the same Run at the same position. Within a Run, that placement SHALL be computed from the step's live model messages by removing any earlier copy of the item and inserting it after the tool-result message that carries the matching tool call, so that the result is identical whether or not the model client retains an earlier step's message override. It SHALL use the same envelope, framing, and vocabulary as an attached item. In-Run items SHALL be staged in memory and published with the assistant message only when the attempt wins; a failed or superseded attempt SHALL publish none.

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

#### Scenario: An in-Run item follows its triggering tool result

- **WHEN** a producer authors an item after a tool result inside a Run
- **THEN** the item is stored on the Run's assistant message after that tool part
- **AND** every later model step of that Run receives it as a user-role message directly after that tool result
- **AND** a failed attempt publishes neither the item nor a seen record of it

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction publishes a checkpoint row for a superseded prefix
- **THEN** the row carries one persisted `data-context` part whose text is the
  complete final checkpoint envelope
- **AND** the envelope and Run receipt retain producer `compaction` and form
  `checkpoint`, and replay uses that stored text without metadata
  reconstruction

Worker-attempt contributions intended for conversation history SHALL be staged in memory before the model request that first carries them and published only with successful turn completion: turn-attached items in the triggering message, in-Run items on the Run's assistant message. Failed or superseded attempts SHALL not publish those staged rail parts; the attempt's own persisted output remains part of the record as the user saw it and enters later model context like any other committed turn. Legitimate accepted-message facts remain persisted-literal; accepting a user message is not publishing a failed attempt's context. Committed parts retain the exact prepared text and existing envelope/order. A compaction checkpoint row and the epoch state published with it are not staged contributions: they commit in their own transaction before the model step they precede, and a later failure of that attempt SHALL NOT retract them.

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

A compaction checkpoint SHALL declare producer `compaction`, form `checkpoint`,
and rail residency on an ordinary persisted `data-context` part, and SHALL
carry the complete final canonical envelope beneath `data.text` like every
other persisted item. It SHALL NOT need a second storage shape to preserve its
semantic form.

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

A `checkpoint` row is the one exception to that inertness. A checkpoint message
whose `data.text` is empty or missing SHALL fail request preparation closed
rather than replay as an inert part, because an inert checkpoint would hide every
row it absorbed and silently shrink the model-visible history. It SHALL NOT be
backfilled or reconstructed from its raw summary either.

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
- **AND** a `checkpoint` row is not treated as one of those inert parts: its
  request fails preparation instead of replaying without the rows it absorbed

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

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the authoring/request-preparation path SHALL persist them in a fixed producer precedence order, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `workspace`
4. `instructions`
5. `skill-catalog`
6. `skill-activation`
7. `recency-digest`
8. `temporal`

When one producer contributes more than one item, those items SHALL be stored in emission order. A producer added later SHALL extend this authoring list in the rail specification.

In-Run items SHALL be ordered by the model step that triggered them and, within a step, by this same producer precedence; they are never re-sorted against the attached items of the triggering user message.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical items through the current precedence list or merge adjacent text parts. The compaction checkpoint is carried by a `checkpoint` row of its own and follows that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany one user message
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

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. Successful publication SHALL store that final ordering atomically; a failed attempt SHALL publish no staged rail items, while its own assistant output persists as the record of that turn.

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** a Workspace state change and an effective skill catalog change accompany one user message
- **THEN** the `workspace` item precedes the `skill-catalog` item and both precede the user text
- **AND** replay preserves those stored positions

#### Scenario: Workspace snapshot and root instructions share a turn

- **WHEN** an accepted turn re-establishes the Workspace snapshot and stages the root instruction chain
- **THEN** the `workspace` item precedes the `instructions` item and both precede any `skill-catalog` item

### Requirement: Residency determines whether a change re-renders the prompt or appends an item

Every context contribution SHALL be classified by **residency**:

- **prefix-resident** — re-supplied in full on every request as part of the system prompt. Updating it means re-rendering the prompt. It is cheap to read on every turn and expensive to change, because a change invalidates the cached prefix for the whole conversation.
- **rail-resident** — appended once as a context item and never re-sent. Updating it means appending another item. It is cheap to add and paid for in every later turn until a checkpoint absorbs it.
- **rail-only** — a small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline. It MAY be kept only on the rail: a `snapshot` is emitted when the state changes and re-emitted after a checkpoint, rather than adding it to the system prompt. The Workspace producer uses this class.

A new context surface SHALL be classified by this procedure:

1. A contribution that is an **account of something that happened** SHALL be rail-resident.
2. A contribution that is a **complete statement of current state** which changes **less often than a checkpoint** SHALL be prefix-resident.
3. A complete statement of current state which changes **more often than a checkpoint** SHALL be a frozen prefix-resident baseline plus rail-resident deltas, re-baked when a checkpoint is published, unless it qualifies as rail-only under step 4. A frequently-changing complete statement SHALL NOT be placed in the prefix, because that forfeits prefix caching for the whole conversation on every change.
4. A small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline MAY be rail-only, emitted as a `snapshot` on change and re-emitted after a checkpoint.

A re-bake or re-emission at a checkpoint SHALL take effect for the very request that checkpoint precedes, and SHALL survive a failure of that attempt.

Residency SHALL be recorded for every contribution in the per-run record required below, so that a later audit reads one list regardless of where a contribution lived.

#### Scenario: A new surface reports an event

- **WHEN** a new context surface reports that something occurred
- **THEN** it is rail-resident
- **AND** it is not added to the system prompt

#### Scenario: A new surface states rarely-changing state

- **WHEN** a new context surface states current state that changes less often than the chat publishes checkpoints
- **THEN** it is prefix-resident
- **AND** a change to it re-renders the prompt rather than appending an item

#### Scenario: A new surface states frequently-changing state

- **WHEN** a new context surface states current state that changes more often than the chat publishes checkpoints
- **THEN** it is a frozen prefix baseline with rail-resident deltas
- **AND** the baseline is re-resolved when a checkpoint is published rather than on every change

#### Scenario: A new surface states compact current state

- **WHEN** a new context surface states a small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline
- **THEN** it MAY be rail-only, with a `snapshot` emitted when the state changes
- **AND** the snapshot is re-emitted after a checkpoint rather than changing the system prompt

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

### Requirement: Compaction is the rail's re-baseline boundary

A published compaction checkpoint SHALL be the single boundary at which rail state is re-established. A producer whose items express deltas against a baseline SHALL treat a newly published checkpoint as starting a fresh baseline, rather than comparing across it. A producer whose contribution is a frozen prefix baseline SHALL re-resolve it when a checkpoint is published and at no other time.

The checkpoint and the epoch state published with it commit before the model step they precede, so a producer re-baselines for the very request that follows the checkpoint rather than for a later turn. A failure of that attempt SHALL NOT retract them, and a retry reuses them.

This rule SHALL be stated once for the rail and inherited, rather than derived independently per producer.

Standing context that is re-supplied on every request SHALL be excluded from the summary a compaction writes, so that a checkpoint does not freeze a stale copy of a value the next request supplies fresh. This exclusion SHALL be documented as resting on instruction and model compliance rather than structural enforcement.

#### Scenario: A delta producer crosses a compaction

- **WHEN** a checkpoint is published before a model step
- **THEN** a delta producer establishes a fresh baseline for that very request rather than comparing against pre-checkpoint state
- **AND** no transition is reported across the boundary

#### Scenario: A frozen baseline crosses a compaction

- **WHEN** a chat with a frozen prefix baseline publishes a checkpoint
- **THEN** the baseline is re-resolved in the same transaction, before the model step that follows
- **AND** it is not re-resolved by any other event

Frozen per-chat digest and temporal baselines retain their owning lifecycles. This requirement SHALL not freeze owner-variable resolution, runtime tool catalogs, or descriptions across attempts. Availability comparisons use the previous successful turn's minimal id/state record within the current epoch; failed attempts never establish such a comparison baseline, and the epoch state a checkpoint publishes with itself survives the failure of the attempt it preceded. A new rail epoch SHALL begin when the active checkpoint's absorbed-through sequence is at or above the sequence of the previous completed Run's triggering user message. That boundary SHALL NOT be decided by comparing checkpoint creation times, and SHALL NOT be read off the sequence of an assistant row, because a retried assistant row keeps its sequence below a checkpoint published between its attempts.

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

An attempt-generated item intended for later conversation history SHALL be staged as a pending persisted-literal contribution. Its exact prepared text is used in the current request, then atomically committed on successful completion. A failure discards that pending contribution. A compaction checkpoint row is not a pending contribution: it is published with the epoch state it re-bakes before the step it precedes, and that state survives the attempt's failure. This staging does not add a new wire-format item kind or permit a bind-time-only producer to persist into message history.

### Requirement: Worker-attempt cutover preserves existing conversation state

The new successful-attempt publication rule and the retention of failed-attempt output SHALL
apply to attempts executed after the coordinated runtime cutover. Cutover SHALL
preserve existing messages and reminders, digest baseline/told-set state, and
the epoch identity a live checkpoint publishes under, without rebuilding,
clearing, or adding
retrospective replay filters. Existing state SHALL retain its ordinary
compaction, digest, and owner-access rules. These prospective rules SHALL NOT
claim to remove failed pre-cutover Run contributions from existing history or
aggregates. The separate system-receipt and tool-catalog storage migration
remains required and SHALL NOT authorize rewriting conversation state.

#### Scenario: An existing Chat crosses the worker-attempt cutover

- **WHEN** an existing Chat has stored reminders, an active checkpoint, and digest disclosure state
- **THEN** cutover preserves their contents and existing replay eligibility without reconstruction
- **AND** later compaction and digest updates follow their ordinary lifecycle

#### Scenario: A post-cutover attempt fails in an existing Chat

- **WHEN** a newly prepared attempt fails after cutover
- **THEN** its persisted partial output remains part of the record, while its staged rail items and digest updates do not publish and the comparison baseline does not advance
- **AND** pre-existing conversation state is not retrospectively filtered or reset

### Requirement: Successful Runs record the winning attempt's injected items

Each successfully completed Run SHALL record the winning attempt's context items injected into the requests it executed, as
they appeared in the final application request and in every later model step of that attempt, together with each item's
producer, form, and residency. In-Run items SHALL follow the final request's items in step order. The record SHALL be owner-scoped and enforced at
the datastore, and SHALL NOT be exposed to a non-owner, public share, ordinary
transcript export, or search projection.

For a persisted item, recording SHALL copy the same stored text used by the
request and SHALL NOT invoke a renderer. A data-only or empty context part that
contributed nothing SHALL still appear in the Run item record with empty text,
so intentional omission remains distinguishable from absence; metadata SHALL
NOT be rendered to fill it. A bind-time item SHALL record its final computed
text.

When request preparation rebuilds the request after a checkpoint published before
its first model step, the record SHALL describe the rebuilt request, including the
checkpoint's stored text. A Run whose preparation fails before dispatch SHALL
record no injected items.

The record SHALL identify the winning attempt and remain separate from its system-prompt-only receipt and the minimal availability comparison record. It SHALL commit with successful turn publication. Failed-attempt injected-item lists SHALL not become this record or model history; their system-only receipts and necessary operational events remain separate.
Content copied from outside the chat SHALL remain non-erasable through deletion
of its source once it has been written into a persisted reminder or Run record;
that limitation SHALL remain documented.

#### Scenario: A Run injects items

- **WHEN** a Run executes with persisted context text
- **THEN** its record copies the exact text used by the final request
- **AND** the record is readable only by the chat owner

#### Scenario: A Run injects an in-Run item

- **WHEN** a Run's winning attempt emits an item between model steps
- **THEN** the record lists it after the final request's items, with its producer, form, and residency
- **AND** its text is the stored part text, not a re-render

#### Scenario: A renderer's wording changes

- **WHEN** a producer renderer changes after an item and Run record were stored
- **THEN** both retain the original persisted text
- **AND** neither invokes the current renderer

#### Scenario: An inert context part accompanies a Run

- **WHEN** a stored context part has no non-empty text
- **THEN** it contributes no model part but remains in the Run context-item
  record with empty text
- **AND** metadata is not rendered to fill either location

#### Scenario: Two Runs render the same system prompt

- **WHEN** two successfully completed Runs render the same system prompt but inject different reminders
- **THEN** each Run records its own reminder text
- **AND** each identifies its own successful attempt and system-only receipt

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another chat that is later deleted
- **THEN** the persisted reminder and prior Run record remain unchanged
- **AND** the deletion limitation is not hidden

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly SHALL treat `messages.parts` as the durable application/UI
history. It SHALL preserve model-bearing stored parts and their order, omit
declared display-only parts except reasoning parts, which `reasoning-output`
returns to the provider for the Chat that stores them, and map each surviving
`data-context` part on a user message to one
ordinary SDK text part containing `data.text`. A `data-context` part stored on an
assistant message SHALL be mapped to one user-role message containing one text
part with `data.text`, emitted directly after the tool-result message of the
tool part that precedes it in stored order, or in its stored position when that
tool pair was omitted by the replay budget; it SHALL NOT be merged into the
assistant message's own content or into the tool-result message. A `data-context`
part on a `checkpoint` row SHALL be mapped to one user-role message containing one
text part with `data.text`, emitted in place of the rows through that checkpoint's
absorbed-through sequence and ahead of every later user and assistant row.
Selection is by that boundary rather than by the checkpoint row's own sequence: a
Run SHALL take the latest checkpoint whose absorbed-through sequence is below the
triggering user message's sequence, because a checkpoint published before the step
sits above the user row it was published for. It SHALL then pass the ordered parts
to the AI SDK rather than manually constructing a joined transcript.

This SHALL be an application-level best-effort invariant, not a promise of
provider-wire byte identity. SDK conversion, role grouping, and provider
serialization MAY evolve. The current ordinary assistant/tool projection SHALL
remain a documented exception pending #599 because stored parts do not prove
step boundaries.

The current top-level system prompt is outside message history and MAY change.
A checkpoint MAY replace only the prefix it explicitly supersedes, through the
coverage boundary and replay-selection rule required by `model-system-prompts`;
no other stored form of superseded history is replayed.

#### Scenario: A checkpoint row crosses the SDK boundary

- **WHEN** a chat's effective history is replayed for one triggering user message
- **THEN** the checkpoint supplied as one user-role message carrying its stored
  text is the latest checkpoint whose absorbed-through sequence is below that user
  message's sequence
- **AND** no user or assistant row through that checkpoint's absorbed-through
  sequence is supplied

#### Scenario: Context data crosses the SDK boundary

- **WHEN** a stored user message contains non-empty `data-context.data.text`
- **THEN** the transition supplies one `{ type: "text", text: data.text }` part
  in the same position
- **AND** no producer renderer, sanitizer, sorter, or manual join runs

#### Scenario: An assistant-message context part crosses the SDK boundary

- **WHEN** a stored assistant message contains a tool part followed by a non-empty `data-context` part
- **THEN** replay emits the tool-call and tool-result pair and then one user-role message with that text
- **AND** the tool pair's replay budget is not charged for the context text

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

### Requirement: The skill catalog is a frozen prefix baseline stored on the chat

The proactively eligible skill catalog for a Chat SHALL be computed from that Chat's effective skill sources, as defined by `agent-skills`, and SHALL be classified as a frozen prefix-resident baseline with rail-resident deltas. The baseline SHALL be the `skills` prompt projection defined by `model-system-prompts`: admitted entries in code-point name order, each with name and description, plus the count of proactively eligible entries omitted. Admission SHALL retain whole entries while the admitted count stays within 256 and the cumulative UTF-8 length of name and description stays within 16 KiB, so that template-owned per-entry markup cannot multiply the bound; omission SHALL be disclosed through that count whenever the baseline admits at least one entry, and the proactively eligible set SHALL remain inspectable through `read("skill://")` regardless.

The baseline and the names of the entries the Chat was last told SHALL be persisted on the Chat row under owner isolation, following the recency-digest precedent, together with the identity of the checkpoint message under which the baseline was resolved. Accepted-turn preparation SHALL reuse the stored baseline only when a baseline is persisted and its recorded identity equals the Chat's latest checkpoint message — a Chat that has published no checkpoint records both as absent and keeps reusing its first baseline — and SHALL otherwise resolve the current catalog from that Chat's effective skill sources and start a new baseline and told state in the same accepted-turn transaction as the user message and Run. No baseline SHALL be written for a Chat whose effective skill source set is empty. Package edits, model switches, and other prompt contributions SHALL NOT refresh the baseline. A checkpoint published before a Run's first model request SHALL re-resolve the baseline in the same transaction as that checkpoint, so the request that follows it renders the refreshed baseline. Caller-supplied owner identifiers SHALL NOT authorize baseline or told-state reads or mutations. The epoch that identity comparison serves SHALL be the rail epoch that `Compaction is the rail's re-baseline boundary` defines, which states its boundary once.

The baseline SHALL enter the prompt only through the template projection. A template that does not reference `skills` SHALL render no catalog, and no server-rendered block SHALL be appended outside the template. Operator-authored descriptions SHALL be neutralized before composing the prompt or any item and SHALL replay from persisted text without another sanitization pass.

#### Scenario: Catalog is frozen within an epoch

- **WHEN** a package description changes or the model is switched between two user turns with no compaction between them
- **THEN** the next Run's prompt renders the stored baseline byte-for-byte
- **AND** the effective-context snapshot is reused rather than re-minted for that reason

#### Scenario: Compaction starts a new baseline

- **WHEN** a Chat publishes a checkpoint after catalog notices have accumulated
- **THEN** that checkpoint's publication resolves the current catalog as its new baseline and told state
- **AND** old deltas are not applied again against that new baseline

#### Scenario: A pre-step checkpoint refreshes the baseline inside a Run

- **WHEN** context fitting publishes a checkpoint before a Run's first model request
- **THEN** that Run's request renders the baseline the checkpoint refreshed
- **AND** the next accepted turn reuses that baseline rather than resolving another

#### Scenario: Operator template omits the namespace

- **WHEN** a model's template never references `skills`
- **THEN** its prompt carries no catalog and boot succeeds
- **AND** explicit `$skill` activation on that model still loads instructions through the rail

#### Scenario: Another owner targets catalog state

- **WHEN** owner A attempts to read or mutate owner B's Chat baseline or told state
- **THEN** datastore enforcement refuses access using the authenticated identity
- **AND** supplying owner B's identifier does not authorize the operation

#### Scenario: Workspace sources contribute to a bound Chat's baseline

- **WHEN** a new baseline is resolved for a Chat bound to a Workspace containing a proactively eligible skill
- **THEN** that skill is included in the Chat's baseline subject to the ordinary admission bounds
- **AND** a Chat without that Workspace binding continues to resolve its baseline from its own effective sources

### Requirement: Explicit activations are rail items carrying current instructions

Each explicit `$skill` selection SHALL produce one `skill-activation` item with form `notice` in the triggering user message before the first model request. A successful item SHALL state which mention selected the skill, the absolute skill directory and instructions file, the instruction to resolve package-relative references and scripts against that directory while keeping task-relative inputs and choosing `cwd` explicitly, a precedence statement, and the current `SKILL.md` instruction body with its frontmatter removed, taken from the raw read with its ordinary truncation indicator. A failed selection SHALL produce a bounded item naming the mention and one closed reason from `not_found`, `unavailable`, `permission_denied`, and `read_failed`, without operator diagnostics in model text. Selections beyond the count, output, or work budget SHALL be accounted for by one bounded omission item listing their names.

Activation items SHALL use the existing canonical envelope, provenance, owner visibility, separate executed-context recording, stored-text replay, and author-time ordering. A completed explicit activation SHALL NOT be reloaded on recovery. Partial recovery SHALL preserve completed mention results and fill only unfinished selections in original order. Operator-supplied reserved delimiters SHALL be neutralized before composing and persisting activation text.

#### Scenario: Two explicit selections on one message

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** two activation items persist in that order ahead of the user text
- **AND** each carries its skill directory, instructions file, and frontmatter-stripped instruction body

#### Scenario: Selection fails after admission is denied

- **WHEN** an explicit selection's read is denied by permission policy
- **THEN** its item names the mention with reason `permission_denied` and no instructions
- **AND** the other selections and the Run proceed

#### Scenario: Skill text contains a forged reminder delimiter

- **WHEN** operator metadata or instructions contain reserved context delimiters
- **THEN** they are neutralized before prompt or context-item composition and cannot create another envelope
- **AND** recovery replays the persisted final text unchanged

### Requirement: Catalog notices announce added and removed skills on the next user turn

At each accepted user turn that continues a compaction epoch and whose bound model's template references the `skills` namespace, the current proactively eligible catalog from that Chat's effective skill sources, bounded as for the baseline, SHALL be compared with the Chat's told state by name only; descriptions SHALL NOT participate in the comparison and an addition SHALL render the entry's current description. A turn bound to a model whose template does not reference `skills` SHALL emit no catalog notice and SHALL leave the told state unchanged. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The told state SHALL be updated in the same accepted-turn transaction; a retried accepted message SHALL reuse its persisted state and a rollback SHALL expose none of those writes.

When a delta would exceed the baseline bound, one `skill-catalog` item with form `snapshot` SHALL instead state that the catalog was refreshed and earlier updates are superseded, listing the bounded current set with its omitted count; the told state SHALL then equal that snapshot. No notice SHALL be injected between model requests inside an existing Run; a removed package fails its next read under current availability and its removal is announced on the next user turn.

#### Scenario: Catalog changes between user messages

- **WHEN** one skill is added and another removed after a user turn in the same epoch
- **THEN** the next user turn carries one notice naming the addition with its description and the removal by name
- **AND** the immutable effective-context receipt retains the frozen baseline while the executed-context record captures the notice

#### Scenario: Template opts out of the catalog

- **WHEN** a skill is added while the Chat's bound model uses a template that never references `skills`
- **THEN** no catalog notice is emitted and the told state is unchanged
- **AND** after a switch to a model whose template renders the catalog, the next turn announces the additions since the baseline

#### Scenario: Description changes without membership change

- **WHEN** an advertised skill's description or `SKILL.md` content changes between user turns
- **THEN** no catalog notice is emitted in this change (tracked as [#821](https://github.com/leon0399/llame/issues/821))
- **AND** a later `skill://` read returns the current content

#### Scenario: Active Run sees a deleted skill

- **WHEN** a package disappears while a Run is making tool calls
- **THEN** its next skill read fails under current availability
- **AND** the removal notice waits for the next user turn

#### Scenario: Delta exceeds the bound

- **WHEN** the added and removed entries cannot be rendered within the baseline bound
- **THEN** a supersession snapshot with the bounded current set replaces the delta
- **AND** the told state equals the snapshot's admitted entries

#### Scenario: Told-state transaction is interrupted

- **WHEN** the accepted-turn transaction fails before commit after preparing a catalog notice
- **THEN** neither the message, Run linkage, notice, nor updated told state is visible
- **AND** retry produces one consistent accepted turn without repeated or skipped catalog changes

#### Scenario: Workspace source changes affect only that Chat's delta

- **WHEN** a Chat enters a Workspace containing a skill that was absent from its effective sources, or detaches from a Workspace whose skill was previously effective, within the same compaction epoch
- **THEN** the next accepted turn compares the current effective catalog and announces the resulting addition or removal for that Chat
- **AND** another Chat without that Workspace binding compares only its own effective sources

### Requirement: Skill activations remain separate from immutable enqueue receipts

The enqueue-bound effective-context receipt SHALL retain its immutable prompt/tool snapshot and SHALL NOT be extended with post-claim activation results. After final request preparation, the existing separate Run context-item record SHALL capture every context item actually sent, including skill catalog notices and activations alongside all existing producers. The endpoint SHALL expose that complete recorded array, not a skill-only projection. Authenticated owners SHALL inspect it through `GET /api/v1/runs/:id/context-items`; the response SHALL contain `items: null` before a final executed request has been recorded and the recorded array afterward. Preparation failure SHALL leave this record unrecorded. Non-owners SHALL receive not-found and this record SHALL remain excluded from public shares, exports, and search.

#### Scenario: Owner inspects before and after activation

- **WHEN** the owner reads the enqueue receipt before execution and again after skill activation
- **THEN** its snapshot content and hashes are unchanged
- **AND** the separate context-items response moves from unrecorded to the final executed items only when request preparation succeeds

#### Scenario: Activation succeeds but request preparation fails

- **WHEN** activation results have been persisted but window fitting fails before provider dispatch
- **THEN** those observations remain in the owner message while the executed-context record remains unrecorded
- **AND** the immutable enqueue receipt is not changed

### Requirement: Workspace binding changes are rail-resident context items

Before resolving effective skill sources, explicit `$skill` activation, Workspace MCP clients or catalog, the `workspace` producer's items, or the accepted-turn `instructions` load, attempt preparation SHALL finish the Workspace binding re-check and any detach. A detaching attempt SHALL contribute no Workspace skill activation, `skill://` resolution, Workspace tools, or accepted-turn `instructions` item and SHALL still narrate the detach. Skill-catalog baseline content already frozen at acceptance in the accepted-turn transaction before worker preparation MAY still list Workspace skills for that attempt; the next accepted turn's skill-catalog notice SHALL remove them.

At each accepted user turn, accepted-turn preparation SHALL compare the Chat's current Workspace
root, or its absence, with the root last narrated to the Chat, or the absence of any narration. For
that comparison, the stored `workspace_told` SHALL be treated as null whenever its
`workspace_told_from` names a different checkpoint message than the Chat's latest
checkpoint row; when those identities
match, the stored told root is used. When the current and comparison roots differ, the `workspace`
producer SHALL emit a rail-resident item with form `snapshot`: it SHALL name the canonical root
and state that the Workspace selects a working root but does not confine host authority, or, when a
previously narrated root is no longer bound, it SHALL state that no Workspace is entered. A detach
reason persisted during attempt preparation SHALL be consumed from the Chat's persisted state, not
inferred from the current unbound state, by emitting a separate rail-resident item with form
`notice` in the same turn. The notice SHALL name that reason, and the persisted reason SHALL be
cleared only when the Run that narrates it completes. The producer SHALL stage the narrated root,
or its absence, and the latest checkpoint message as `workspace_told` and `workspace_told_from`;
the same accepted-turn transaction that commits the successful turn SHALL write
both values, and the only other writer SHALL be a checkpoint's publication
transaction, which advances `workspace_told_from` to name its own row and resets
the told root, so the state is not left suppressed by a narration the checkpoint
superseded. The `workspace` producer re-derives its snapshot after that
transaction commits and before the model step the checkpoint precedes, so the
re-established state takes effect for that very request rather than on a later
turn. That snapshot is staged like any other: the successful turn the checkpoint
preceded records the re-narrated root and the checkpoint's identity in its own
accepted-turn transaction, so the next turn finds the root already told within
the epoch, and a failed attempt records neither value, leaving its retry to
re-derive the same snapshot.
Workspace state SHALL NOT be placed in the system prompt. Each successful Run that sends a
Workspace snapshot or notice SHALL include each exact item text, producer, form, and rail residency
in its owner-scoped Run context-item record under the existing recording rules.

#### Scenario: Changed binding is narrated on the rail

- **WHEN** an accepted turn observes a Workspace binding different from the last state narrated to the Chat
- **THEN** a rail-resident `workspace` snapshot names the canonical root and states that host authority is not confined when the turn has a bound root, or states that no Workspace is entered only when a previously narrated root has been detached
- **AND** if preparation detached the binding, a separate rail-resident `workspace` notice consumes the persisted detach reason in every case; when `workspace_told` named no root, no snapshot is emitted, and the Workspace state is not added to the system prompt

#### Scenario: Unchanged binding is not repeated

- **WHEN** an accepted turn observes the same Workspace state already narrated in the active context epoch
- **THEN** the producer emits no duplicate state-change snapshot
- **AND** the already-narrated state remains the comparison state

#### Scenario: Compaction re-establishes Workspace state

- **WHEN** a checkpoint becomes active for a Chat that is still bound and its stored
  `workspace_told_from` names an earlier checkpoint message or is null
- **THEN** the first request the checkpoint precedes treats the told state as null
  for comparison and carries a snapshot re-establishing the current root
- **AND** the snapshot remains rail-resident rather than changing the system prompt
- **AND** the successful turn records that root against the checkpoint's identity, so the next turn emits no second snapshot for the same root

#### Scenario: A never-bound Chat receives no Workspace notice

- **WHEN** a Chat that has never been bound to a Workspace accepts a turn, including the first turn after a compaction
- **THEN** no `workspace` snapshot or notice is emitted

#### Scenario: Run context record includes the Workspace notice

- **WHEN** a successful Run sends a Workspace snapshot or detach notice in its final request
- **THEN** the Run's owner-scoped context-item record contains each exact text with producer `workspace`, its form, and rail residency
- **AND** the record remains subject to the ordinary owner-isolation rules

#### Scenario: Detach reason waits for a completed narration

- **WHEN** attempt preparation persists a detach reason and that attempt fails before the Run narrating it completes
- **THEN** a retry consumes the reason from persisted Chat state and emits it as a separate `workspace` notice
- **AND** the reason remains persisted until the narration Run completes, while the Chat remains unbound

#### Scenario: Detach is ordered before Workspace contributions

- **WHEN** attempt preparation detaches a binding before the accepted turn resolves Workspace sources or tools
- **THEN** the turn contributes no Workspace skill activation, `skill://` resolution, or MCP tools
- **AND** its skill-catalog baseline content already frozen at acceptance MAY still list Workspace skills, while the next accepted turn's skill-catalog notice removes them
- **AND** it always emits the separate detach `notice`, while the snapshot stating that no Workspace is entered is emitted only when `workspace_told` names a root
