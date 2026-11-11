## MODIFIED Requirements

### Requirement: A send with a delivery mode becomes a pending item during a live Run

A chat send can name `delivery` with the value `steer`, `interrupt`, or `queue`. When the Chat has
a live Run, as `durable-runs` defines live, the API MUST store the message as a pending item. It
MUST NOT create a Run or a message row. It MUST answer 202 with the item. The send MUST pass the
validation of a chat send, with text neutralization and the media ownership check. A command send MUST
run as `chat-commands` defines.

#### Scenario: A steer during a Run is accepted as a pending item

- **WHEN** the owner sends a message with `delivery: "steer"` while a turn Run of the Chat is `running_model`
- **THEN** the API answers 202 with a pending item in mode `steer`
- **AND** the Chat gets no new Run and no new message row

#### Scenario: A send without a delivery mode still gets 409

- **WHEN** the owner sends a message without `delivery` while a Run of the Chat is live
- **THEN** the API answers 409, as `durable-runs` requires

#### Scenario: An invalid pending item writes nothing

- **WHEN** a send with `delivery: "queue"` names a model that the catalog does not offer
- **THEN** the API answers with the error of a chat send with that model
- **AND** it stores no pending item

#### Scenario: A delivery send to a Chat with a stuck Run

- **WHEN** the only non-terminal Run of the Chat is stuck, and the owner sends a message with `delivery: "queue"`
- **THEN** admission expires the stuck Run, as `durable-runs` requires
- **AND** the message starts a Run, and no pending item is stored

#### Scenario: A rename with a delivery mode during a Run

- **WHEN** a turn Run is live and the owner sends `/rename Foo` with `delivery: "steer"`
- **THEN** the API sets the title and stores no pending item

### Requirement: A send to an idle Chat starts a Run for every delivery mode

When the Chat has no non-terminal Run, a chat send MUST start a Run as a chat send without
`delivery` does. A command send MUST run as `chat-commands` defines and MUST NOT start a turn Run.
The `delivery` value MUST have no other effect. Paused queue items MUST stay
pending, and they MUST NOT start before this message.

#### Scenario: A queue send to an idle Chat starts at once

- **WHEN** the owner sends a message with `delivery: "queue"` to a Chat with no live Run
- **THEN** the API starts a Run for the message and answers with its stream

#### Scenario: A send to a paused queue goes first

- **WHEN** two queue items are paused, and the owner sends a new message to the idle Chat
- **THEN** the new message starts a Run, and the two items stay pending

#### Scenario: A command send to an idle Chat with a delivery mode

- **WHEN** the owner sends `/rename Foo` with `delivery: "queue"` to a Chat with no live Run
- **THEN** the API sets the title, stores no pending item, and starts no Run

### Requirement: The owner lists and changes pending items

`GET /api/v1/chats/:chatId/deliveries` MUST return the `pending` items of the Chat in their
order. `DELETE` on one item MUST withdraw it and return its parts and attachments. `PATCH` with
`mode` MUST change a `queue` item to `steer`, or a `steer` or `queue` item to `interrupt`. A
change to `queue` MUST get 400. A change of a command item MUST get 400. During a compaction Run,
a change to `steer` or `interrupt` MUST get 400.

#### Scenario: Withdraw returns the text for an edit

- **WHEN** the owner withdraws a pending queue item
- **THEN** the answer holds the parts and attachments of the item
- **AND** the item is `withdrawn` and is not delivered

#### Scenario: Steer now changes a queue item

- **WHEN** the owner changes a pending queue item to `steer` during a turn Run
- **THEN** the item is delivered at the next step boundary of that Run

#### Scenario: A command item refuses Steer now

- **WHEN** the owner changes a pending `/compact` item to `steer` or `interrupt`
- **THEN** the API answers 400, and the item stays pending in mode `queue`

#### Scenario: Steer now during a compaction Run

- **WHEN** a compaction Run is live and the owner changes a pending queue item to `steer`
- **THEN** the API answers 400, and the item stays pending in mode `queue`

### Requirement: Queue items start one Run each after a completed Run

The transaction that completes a Run MUST take the first pending `queue` item of the Chat. It MUST
store a message item as a user message and create a Run for it with the settings of the item. A
command item MUST start a compaction Run with its settings and focus, and MUST store no message. A Run that
does not complete MUST NOT start a queue item. A follow-up Run or a compaction Run that completes also starts one.

#### Scenario: Three queue items run in order

- **WHEN** three queue items are pending and the Run completes
- **THEN** the first item starts a Run with its own model, effort, and permission mode
- **AND** the second item starts a Run only after that Run completes

#### Scenario: A queue item that a send cannot use stays pending

- **WHEN** the model of the first queue item left the catalog before the Run completes
- **THEN** the item stays `pending`, no Run starts, and the queue is paused

#### Scenario: A queued compact starts a compaction Run

- **WHEN** a `/compact keep the plan` item is the first queue item and the Run completes
- **THEN** a compaction Run with the focus `keep the plan` and the settings of the item starts
- **AND** the Chat gets no user message for the item

#### Scenario: A completed compaction Run promotes the next item

- **WHEN** a compaction Run completes and a queue item is pending
- **THEN** that item starts a Run

### Requirement: A mode change on a paused item starts a Run

The owner can change a pending item to `steer` or `interrupt` while the Chat has no non-terminal
Run. This MUST NOT apply to a command item, which gets 400. The API MUST then store that item as a user message with the id of the item. It MUST start a
Run for it with the settings of the item. When a send cannot use those settings, the API MUST
answer with the error of a chat send, and the item MUST stay pending.

#### Scenario: Steer now on a paused item

- **WHEN** the queue is paused and the owner changes its second item to `steer`
- **THEN** that item starts a Run, and the first item stays pending

#### Scenario: A paused command item cannot start by a mode change

- **WHEN** the queue is paused, its first item is `/compact`, and the owner changes it to `steer`
- **THEN** the API answers 400, and the item stays pending

### Requirement: The queue pauses after a Run that does not complete

A Run can end `failed`, `cancelled`, or `expired`. Its pending `steer` and `interrupt` items MUST
then become `queue` items before the other queue items, in their order. A pending item MUST NOT
start a Run until the owner acts. The owner acts when they send a message, start a follow-up Run,
send `/compact`, or change an item to `steer` or `interrupt`.

#### Scenario: A failed Run pauses the queue

- **WHEN** a Run fails while one steer and two queue items are pending
- **THEN** three queue items are pending, with the former steer first
- **AND** no Run starts until the owner acts

#### Scenario: A compact on a paused queue

- **WHEN** the queue is paused with two queue items, and the owner sends `/compact` to the idle Chat
- **THEN** a compaction Run starts, and the two items stay pending until it completes

### Requirement: The web shows pending items above the composer

The web MUST show each pending item above the composer in its order. A queue item MUST offer Steer
now, Interrupt now, delete, and edit. A command item, and every item during a compaction Run, MUST
offer only delete and edit. A steer item MUST offer Interrupt now, delete, and edit. Edit
MUST withdraw the item and put its text and attachments into the composer.

#### Scenario: Edit puts the text back

- **WHEN** the owner chooses edit on a pending queue item
- **THEN** the item leaves the stack, and the composer holds its text and attachments

#### Scenario: A delivered item leaves the stack

- **WHEN** an action on an item gets 409 because the item was delivered
- **THEN** the stack drops the item, and the transcript shows its delivered message

#### Scenario: A command item offers no Steer now

- **WHEN** a `/compact` item is pending
- **THEN** its row offers delete and edit, and no Steer now or Interrupt now

#### Scenario: A queue item during a compaction Run offers no Steer now

- **WHEN** a compaction Run is live and a message item is pending
- **THEN** its row offers delete and edit, and no Steer now or Interrupt now

## ADDED Requirements

### Requirement: A command or a compaction Run makes a pending item a queue item

A command item is a pending `queue` item whose text is a `/compact` command. The API MUST store a
`/compact` send as `queue`, whatever `delivery` the send names. A command item that admission would
refuse MUST stay pending at promotion, as an item that a send cannot use. During a compaction Run, the API MUST store
every pending item as `queue`. A compaction Run MUST NOT deliver a steer or an interrupt.

#### Scenario: A compact command during a Run is a queue item

- **WHEN** the owner sends `/compact` with `delivery: "steer"` while a Run of the Chat is live
- **THEN** the API answers 202 with a pending item in mode `queue` that holds the text `/compact`

#### Scenario: A steer during a compaction Run is queued

- **WHEN** the owner sends a message with `delivery: "steer"` while a compaction Run is live
- **THEN** the API answers 202 with a pending item in mode `queue`
- **AND** the compaction Run ends with no user message
