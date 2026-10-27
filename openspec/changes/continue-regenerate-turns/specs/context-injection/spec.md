## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Some server-authored contributions to the model-visible conversation of a Chat are not part of
the system prompt. The system MUST inject each of them as a **context item** on one rail. The system MUST show
an item inside one canonical `<system-reminder>` envelope. An item MUST NOT add a top-level
delimiter name of its own.

A compaction checkpoint MUST stay a rail context item with producer `compaction`, form
`checkpoint`, and rail residency for envelope semantics. It MUST NOT be a storage exception. Its
durable form MUST be an ordinary persisted `data-context` part on a `checkpoint` row. Replay MUST
convert that row to one user-role text message, as it converts each other persisted rail part.
`model-system-prompts` MUST own the coverage boundary and the replay-selection contract of the row.

The wire role MUST stay `user`. The system MUST NOT invent a provider-level role for injected
context. Items MUST NOT become separate conversation messages when a message already exists to
carry them. Items attached to a turn MUST go inside the triggering user message of that turn.

An item authored **between the model steps of one Run** is an in-Run item, and no user message
carries it. The system MUST store it as a `data-context` part on the assistant message of that Run. It goes
directly after the last tool part of the step whose results triggered it. The model MUST receive
it as a user-role text message after the last tool result of that step. This applies to the step
after the trigger and to each later step of the same Run, at the same position. In a Run, the
system MUST compute that placement from the live model messages of the step. It removes any earlier
copy of the item and inserts the item after the tool-result message that carries the matching tool
call. Thus the result is the same whether or not the model client keeps the message override of an
earlier step. The item MUST use the same envelope, frame, and vocabulary as an attached item. The
system MUST persist an in-Run item on that assistant message in the dispatch transaction of the
first model request that carries it. This applies whatever the outcome of the Run. Each terminal outcome
MUST keep it after the last tool part of its triggering step.

Each item MUST have its **own text content block** in that message. It MUST NOT join another item
or the user's text in one block. Thus the separation between server-authored content and
user-authored content is structural, not a text convention that user input can copy.

#### Scenario: Two items are injected on one turn

- **WHEN** the system injects two context items before a user's message
- **THEN** each item is in its own `<system-reminder>` envelope in its own text content block
- **AND** the visible text of the user is in a further block of the same message
- **AND** the system creates no additional conversation message

#### Scenario: A turn carries no injected item

- **WHEN** a turn has no context item to inject
- **THEN** the user message carries only the visible text of the user
- **AND** its serialized form is the same as the form of a turn from before this capability

#### Scenario: An item is not attached to a turn

- **WHEN** the producer of an item has no triggering user message to attach to
- **THEN** the message that its producer already owns carries the item
- **AND** the item uses the same envelope, frame, and vocabulary as an attached item

#### Scenario: An in-Run item follows its triggering tool result

- **WHEN** a producer authors an item after a tool result inside a Run
- **THEN** the system stores the item on the assistant message of the Run after that tool part
- **AND** each later model step of that Run receives it as a user-role message directly after that tool result
- **AND** the item stays on the assistant message whatever the outcome of the Run, until a dispatch replaces the reply
- **AND** only the dispatch of a retry of the same Run, or of a follow-up Run from `turn-actions`, replaces the reply
- **AND** that reset removes the item together with the output of that attempt

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction publishes a checkpoint row for a superseded prefix
- **THEN** the row carries one persisted `data-context` part whose text is the complete final checkpoint envelope
- **AND** the envelope and the stored part keep producer `compaction` and form `checkpoint`, and replay uses that stored text with no rebuild from metadata

#### Scenario: A failed Run keeps the items it sent

- **WHEN** the worker of a Run dies after the first model request of the Run carried accepted-turn items, with an instruction bundle
- **THEN** those items stay on the triggering user message after the Run settles as failed
- **AND** the request of the next turn carries each stored item once and loads none of them again

#### Scenario: A retry keeps its stored accepted-turn items

- **WHEN** a retry of a Run starts after an earlier attempt dispatched a request that carried accepted-turn items
- **THEN** those items stay on the triggering user message unchanged and in place, and the request of the retry carries each of them once
- **AND** the retry derives each accepted-turn producer again and counts as told the stored items and the told, seen, and baseline state that their dispatch advanced
- **AND** thus it authors no second `temporal` or model-switch item for the same turn and loads no stored instruction file again
- **AND** it stores only the items that this comparison newly yields, in its own dispatch transaction
- **AND** it stores them after the last stored context item, in producer order among its own new items
- **AND** its preparation reads history only through the triggering user message
- **AND** only the dispatch transaction of the retry replaces the assistant output and the in-Run items of the earlier attempt, when it resets the reply

#### Scenario: A retry that fails before dispatching changes nothing

- **WHEN** a retry of a Run fails before its own dispatch transaction commits, after an earlier attempt of the Run dispatched
- **THEN** the assistant message, the output, the in-Run items, and the stored accepted-turn items of the earlier attempt stay unchanged
- **AND** the retry stores no item and advances no told or baseline state

#### Scenario: A follow-up Run keeps the turn's stored items

- **WHEN** the first Run of a turn stored a `temporal` item and failed, and the owner regenerates the turn
- **THEN** the request of the Regenerate Run carries the stored `temporal` item unchanged
- **AND** the triggering user message holds one `temporal` item

#### Scenario: A follow-up Run appends a new availability change

- **WHEN** an operator enables a new tool after the first Run of a turn dispatched, and the owner continues the turn
- **THEN** the Continue Run compares tool availability with the first Run
- **AND** it stores one `tool-availability` item after the last stored context item of the triggering user message

#### Scenario: A Regenerate replaces the model-switch item

- **WHEN** the first Run of a turn stored a model-switch item from model `A` to model `B`
- **AND** the owner regenerates the turn with model `A`, the model of the prior reply
- **THEN** the dispatch transaction of the Regenerate Run removes that item from the triggering user message
- **AND** the Regenerate request carries no model-switch item

The system MUST persist in conversation history each persisted-literal rail item that a model
request carries. It MUST do this in the dispatch transaction of that request, whatever the outcome
of the Run.
Items that the accepted user turn triggers go on the triggering user message, before its first
model request. Items that an assistant tool call triggers go on the assistant message of the Run,
after the last tool part of the triggering step. The request MUST carry exactly the stored text of
those items. An attempt whose dispatch transaction does not commit MUST dispatch nothing. A retry
of the same Run MUST keep each item that an earlier dispatch stored on the triggering user
message, unchanged and in place. It MUST derive each accepted-turn producer
again, and count as told those stored items and the told, seen, and baseline state that their
dispatch advanced. It MUST store only the items that this comparison newly yields. It stores them in its own dispatch transaction,
after the last stored context item and before the user text. Its own new items follow producer
order. This keep-and-append rule MUST apply only to items that the
dispatch transaction of an earlier attempt stored. A retry of a Run whose earlier attempts never
dispatched MUST store each item that it yields at its producer rank, as a first attempt does. The
rank is relative to the `prompt-imports` and `skill-activation` facts persisted before dispatch.

A follow-up Run from `turn-actions` MUST follow the same keep-and-append rule. The rule applies to
each item that an earlier Run of the triggering user message stored at its dispatch. The model-switch
item is the one exception. A Regenerate dispatch MUST remove each `effective-context-change` item
stored on the triggering user message. It then stores the item that its own model comparison
yields, if any.

A retry MUST create or reset the assistant message of the Run to `running` inside its own dispatch
transaction, not before it reads history. Its preparation MUST read history only through the
triggering user message, so its own assistant message never enters its request. That reset MUST
remove the in-Run items of a dead attempt together with the output of that attempt. A retry that
fails before its own dispatch MUST leave the assistant message, output, and items of the earlier
attempt unchanged. The persisted items and the persisted output of a failed, cancelled, expired, or
superseded attempt stay part of the record as the user saw it. They enter later model context like
any other committed turn, until a follow-up Run replaces the reply. Real accepted-message facts
stay persisted-literal; acceptance of a user message is not publication of the context of a failed
attempt. Committed parts keep the exact prepared text and the current envelope and order. A
compaction checkpoint row and the epoch state published with it are not contributions of a
dispatch transaction. They commit in their own transaction before the model step that they
precede, and a later failure of that attempt MUST NOT retract them.

### Requirement: Co-occurring items have a total author-time order

The system can inject more than one item on the same turn. The authoring and request-preparation
path MUST then persist them in a fixed producer precedence order. They go before the triggering
user text in the same message:

1. `effective-context-change`
2. `regenerate`
3. `tool-availability`
4. `workspace`
5. `instructions`
6. `skill-catalog`
7. `skill-activation`
8. `prompt-imports`
9. `recency-digest`
10. `temporal`

When one producer contributes more than one item, the system MUST store those items in emission
order. A producer added later MUST extend this authoring list in the rail specification.

In-Run items MUST be in the order of the model step that triggered them. In a step, they MUST be in
this same producer precedence. The system never sorts them again against the attached items of the
triggering user message.

Replay MUST keep the stored part order. It MUST NOT sort historical items again through the current
precedence list, and it MUST NOT merge adjacent text parts. A `checkpoint` row of its own carries
the compaction checkpoint, and it follows the placement rule of that capability, not this list of
attached items.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, an availability change, and a chat-list change come with one user message
- **THEN** their final text blocks persist in the fixed author-time order
- **AND** each later replay keeps the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in the emission order of the producer
- **AND** the system does not merge or suppress either item

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item comes with another context item
- **THEN** authoring persists the temporal item last among the attached items
- **AND** replay keeps that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes the author-time precedence
- **THEN** new items follow the new authoring order
- **AND** the current messages keep their original stored order

When worker preparation adds attempt-owned items next to message facts that already persisted, the
final request MUST apply this same producer order. It MUST keep the internal order of each producer
and all user-authored content. The transaction that dispatches the first model request MUST store
that final order atomically on the triggering user message. It puts each item at its producer rank,
around the `prompt-imports` and `skill-activation` facts persisted before dispatch. A retry of the
same Run MUST keep the order that the dispatch transaction of an earlier attempt stored, unchanged
and in place. It MUST store each item that it newly yields after the last stored
context item and before the user text. Its own new items follow producer order. This applies also when the
producer of that item ranks before a stored item. A retry of a Run whose earlier attempts never
dispatched MUST instead store each item at its producer rank, as a first attempt does. When an earlier
Run of the triggering user message dispatched, a follow-up Run from `turn-actions` MUST follow the
rule of a retry after a dispatch.

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** a Workspace state change and an effective skill catalog change come with one user message
- **THEN** the `workspace` item comes before the `skill-catalog` item, and both come before the user text
- **AND** replay keeps those stored positions

#### Scenario: Workspace snapshot and root instructions share a turn

- **WHEN** an accepted turn sets up the Workspace snapshot again and stages the root instruction chain
- **THEN** the `workspace` item comes before the `instructions` item, and both come before any `skill-catalog` item

#### Scenario: Skill activation and prompt imports share a turn

- **WHEN** an explicit skill activation and prompt imports come with one user message
- **THEN** each `skill-activation` item comes before the `prompt-imports` item, and both come before the user text
- **AND** replay keeps those stored positions

#### Scenario: A retry's new item follows the stored items

- **WHEN** an earlier attempt of a Run stored `instructions` and `skill-catalog` items in its dispatch transaction, and a retry of the Run detaches the Workspace binding
- **THEN** the retry stores its `workspace` detach narration after the stored items and before the user text, although `workspace` ranks before `instructions`
- **AND** the stored items keep their positions, and replay keeps the order that results

#### Scenario: A retry of a Run that never dispatched orders items by producer rank

- **WHEN** an earlier attempt of a Run persisted a `prompt-imports` item and failed before its dispatch transaction committed
- **AND** a retry yields `workspace`, `instructions`, and `temporal` items
- **THEN** the dispatch transaction of the retry stores the `workspace` and `instructions` items before the `prompt-imports` item
- **AND** it stores the `temporal` item after it, as a first attempt does
- **AND** all of them come before the user text

#### Scenario: A Regenerate notice follows the stored items

- **WHEN** the first Run of a turn stored a `temporal` item and dispatched, and a Regenerate of that turn yields a `regenerate` notice
- **THEN** the Regenerate dispatch stores the notice after the `temporal` item and before the user text

### Requirement: An item is either persisted-literal or bind-time

Each item MUST be one of two kinds:

- **persisted-literal**: durable storage holds the complete final text that replay uses; or
- **bind-time**: the system computes the item for one request, and no durable historical text
  exists.

Replay MUST NOT use the metadata of a persisted-literal item as a source to rebuild its prose,
frame, attributes, sanitization, or order. A persisted context part with absent or empty text is
inert stored data, not a third render mode. The system MUST NOT persist a bind-time item
into message history, because a stored statement about the current request can become false
later.

#### Scenario: A persisted-derived item is replayed

- **WHEN** a conversation holds a context part with non-empty final text
- **THEN** replay uses that text directly
- **AND** renderer changes do not change it

#### Scenario: A data-only item is replayed

- **WHEN** a stored context part has no non-empty final text
- **THEN** it adds no model-visible part
- **AND** replay does not use its metadata to make one

#### Scenario: A bind-time item is replayed

- **WHEN** the system assembles a request for a turn that had a bind-time item before
- **THEN** no old copy of that item is in history

The system MUST persist an attempt-generated item for later conversation history as a
persisted-literal part. It MUST do this in the dispatch transaction of the first model request
that carries the item. That request MUST use the exact stored text. A failure of the
attempt MUST NOT discard the item. Only two dispatch transactions remove an attempt's in-Run
items, together with its output. The first is the dispatch of a retry of the same Run, which
replaces the attempt's non-completed reply. The second is the dispatch of a follow-up Run from
`turn-actions`, which replaces the reply. A Continue Run puts back the in-Run items of its kept
parts. A Regenerate dispatch also removes the model-switch items of the triggering user message,
as the rail requirement states. A compaction checkpoint row is not a contribution of a dispatch
transaction. It publishes
with the epoch state that it re-bakes, before the step that it precedes, and that state stays
after a failure of the attempt. This persistence adds no new wire-format item kind, and it does
not let a bind-time producer persist into message history. Content that the system copied from
outside the Chat into a persisted message part MUST stay after its source is deleted. That
limitation MUST stay documented.

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another Chat, and that Chat is deleted later
- **THEN** the persisted reminder part does not change
- **AND** the documentation states the deletion limitation

#### Scenario: A follow-up dispatch replaces in-Run items with the reply

- **WHEN** a `failed` reply holds an in-Run item after its first settled tool call and another after its unfinished step, and a Continue Run dispatches
- **THEN** the Continue reply holds the first item in its stored position
- **AND** the reply does not hold the second item, which only the event log of the failed Run keeps
