## MODIFIED Requirements

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
parts. A compaction checkpoint row is not a contribution of a dispatch transaction. It publishes
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

## ADDED Requirements

### Requirement: A follow-up Run keeps the turn's stored context items

A follow-up Run from `turn-actions` MUST treat each context item that an earlier Run stored on the
triggering user message as a retry of the same Run treats the items of an earlier attempt. It
MUST keep each such item unchanged and in place. It MUST NOT author a second `temporal`,
accepted-turn `instructions`, or `prompt-imports` item for the turn. It MUST store each new item
after the last stored context item.

#### Scenario: A follow-up Run adds no second temporal row

- **WHEN** the first Run of a turn stored a `temporal` item, failed, and the owner regenerates the turn
- **THEN** the Regenerate request carries the stored `temporal` item unchanged
- **AND** the triggering user message holds one `temporal` item

#### Scenario: A follow-up Run appends a new availability change

- **WHEN** an operator enables a new tool after the first Run of a turn dispatched, and the owner continues the turn
- **THEN** the Continue Run compares tool availability with the first Run
- **AND** it stores one `tool-availability` item after the last stored context item of the triggering user message

### Requirement: A Regenerate notice opens the new reply

The Regenerate notice from `turn-actions` is an in-Run item with producer `regenerate` and form
`notice`. The dispatch transaction of the Regenerate Run MUST store it as the first part of the
reset reply. The model MUST receive it as a user-role text block directly after the triggering
user message, on each step of the Run. Later turns MUST replay it at that position. The rail
producer list does not order it, because it is not on the user message.

#### Scenario: The notice reaches each step

- **WHEN** a Regenerate Run with the notice makes three model requests
- **THEN** each request carries the notice directly after the triggering user message

#### Scenario: A later turn replays the notice

- **WHEN** the owner sends a new message after a Regenerate Run that stored the notice
- **THEN** the new request carries the notice between that earlier user message and the content of its reply
