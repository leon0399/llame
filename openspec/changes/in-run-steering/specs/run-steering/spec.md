## Purpose

Defines how a message that arrives while a Run is active reaches that Run or the next Run: the
per-Chat delivery queue, the steer, interrupt, and queue delivery modes, the segments of a Run,
the settlement of work that an interrupt stops, and the owner's controls for pending items.

## ADDED Requirements

### Requirement: A send with a delivery mode becomes a pending item during an active Run

A chat send can name `delivery` with the value `steer`, `interrupt`, or `queue`. When the Chat has
a non-terminal Run, the API MUST store the message as a pending item of that Chat. It MUST NOT
create a Run or a message row. It MUST answer 202 with the item. The send MUST pass the same
validation as a chat send, which includes neutralization of the text and the media ownership
check.

#### Scenario: A steer during a Run is accepted as a pending item

- **WHEN** the owner sends a message with `delivery: "steer"` while a Run of the Chat is `running_model`
- **THEN** the API answers 202 with a pending item in mode `steer`
- **AND** the Chat gets no new Run and no new message row

#### Scenario: A send without a delivery mode still gets 409

- **WHEN** the owner sends a message without `delivery` while a Run of the Chat is live
- **THEN** the API answers 409, as `durable-runs` requires

#### Scenario: An invalid pending item writes nothing

- **WHEN** a send with `delivery: "queue"` names a model that the catalog does not offer
- **THEN** the API answers with the error of a chat send with that model
- **AND** it stores no pending item

### Requirement: A send to an idle Chat starts a Run for every delivery mode

When the Chat has no non-terminal Run, a chat send MUST start a Run as a chat send without
`delivery` does. The `delivery` value MUST have no other effect. Paused queue items MUST stay
pending and MUST NOT go before this message.

#### Scenario: A queue send to an idle Chat starts at once

- **WHEN** the owner sends a message with `delivery: "queue"` to a Chat with no live Run
- **THEN** the API starts a Run for the message and answers with its stream

### Requirement: Admission of a pending item is idempotent on the message id

The id of the sent message MUST become the id of the pending item. A send that repeats the id of
a pending, delivered, or withdrawn item MUST answer with that item. It MUST NOT store a second
item. A send whose id names an existing message MUST get 409 as a duplicate.

#### Scenario: A retried send returns the stored item

- **WHEN** the client sends the same steer twice with one message id
- **THEN** both answers name the same item, and the Chat holds one pending item

### Requirement: A pending item records a producer and a sender

Each pending item MUST record its producer kind, its sender reference, its mode, its parts, and its
attachments. It MUST also record the model, effort, and permission mode of the send, its state, and
its order. The
state is `pending`, `delivered`, or `withdrawn`. This capability MUST accept only the producer
kind `owner`, whose sender reference is empty.

#### Scenario: An owner item names its producer

- **WHEN** the owner sends a steer during a Run
- **THEN** the stored item has producer kind `owner` and no sender reference

### Requirement: Pending items are visible and writable only for the Chat owner

A pending item MUST be readable and writable only in the tenant scope of the Chat owner. The
datastore MUST enforce this with row-level security. A request that names the Chat or an item of
another owner MUST get the not-found answer. It MUST NOT reveal or change that item.

#### Scenario: Another owner cannot see or change an item

- **WHEN** user B lists, withdraws, or changes a pending item in a Chat of user A
- **THEN** the API answers 404, and the item of user A does not change

#### Scenario: Another owner cannot add an item

- **WHEN** user B sends a steer to a Chat of user A that has a live Run
- **THEN** the API answers 404, and the Chat of user A gets no pending item

### Requirement: The owner lists and changes pending items

`GET /api/v1/chats/:chatId/deliveries` MUST return the `pending` items of the Chat in their
order. `DELETE` on one item MUST withdraw it and return its parts and attachments. `PATCH` with
`mode` MUST change a `queue` item to `steer`, or a `steer` or `queue` item to `interrupt`. A
change to `queue` MUST get 400.

#### Scenario: Withdraw returns the text for an edit

- **WHEN** the owner withdraws a pending queue item
- **THEN** the answer holds the parts and attachments of the item
- **AND** the item is `withdrawn` and is not delivered

#### Scenario: Steer now changes a queue item

- **WHEN** the owner changes a pending queue item to `steer` during a Run
- **THEN** the item is delivered at the next step boundary of that Run

### Requirement: An action on a delivered item gets 409

A withdrawal or a mode change MUST apply only to an item in state `pending`. The state check and
the write MUST be one conditional update. An action on a `delivered` or `withdrawn` item MUST get
409 and MUST NOT change the item.

#### Scenario: A withdrawal that loses the race to delivery

- **WHEN** a Run delivers a steer item, and the owner then sends a withdrawal for it
- **THEN** the API answers 409
- **AND** the item stays `delivered`, and its message stays in the Chat

### Requirement: Steer delivers at the next step boundary

A step boundary is the point after a model step and all tool results of that step, before the
next model request of the Run. At each step boundary, the Run MUST deliver every `steer` item
that is pending. A steer MUST NOT stop a model response or a tool call.

#### Scenario: A steer during a tool call waits for the result

- **WHEN** the owner sends a steer while a `bash` call of the Run runs
- **THEN** the call finishes and its result is stored
- **AND** the next model request of the same Run carries the steer after that result

#### Scenario: A steer during a model response waits for the step end

- **WHEN** the owner sends a steer while the model streams a response with a tool call
- **THEN** the response and its tool call complete
- **AND** the steer is delivered after the result of that call

### Requirement: A steer that is pending at the final answer continues the Run

When the model gives a final answer, the transaction that would complete the Run MUST first look
for pending `steer` items. If it finds one or more, the Run MUST NOT complete. It MUST deliver
them and send a further model request. A Run with no tools follows the same rule.

#### Scenario: A steer during the final answer

- **WHEN** the owner sends a steer while the model writes its final answer
- **THEN** the Run stays non-terminal after that answer
- **AND** its next model request carries the steer

#### Scenario: A steer after completion starts a Run

- **WHEN** the transaction that completes the Run commits before the steer is admitted
- **THEN** the send finds no live Run and starts a new Run for the message

### Requirement: The items delivered at one boundary form one user message

All items that one boundary delivers MUST become one user message, in their order. Each item
MUST give one text part and its own attachments to that message. The message MUST name the Chat
owner as sender. Each delivered item MUST record the id of that message.

#### Scenario: Two steers at one boundary

- **WHEN** the owner sends two steers during one tool call
- **THEN** the next boundary stores one user message with two text parts in send order
- **AND** both items record the id of that message

### Requirement: A delivered message starts a segment with its own reply

A segment is the part of a Run that answers one user message. The first segment answers the
message that started the Run. A delivered message MUST close the reply of the current segment
and MUST start a segment. The reply of the new segment MUST answer the delivered message.

#### Scenario: The transcript order after a steer

- **WHEN** a Run delivers one steer after its second step
- **THEN** the Chat holds the first user message and the reply of the first segment
- **AND** the delivered message and the reply of the second segment follow, in that order

### Requirement: A delivered message belongs to the Run that delivered it

A delivered message MUST record the id of the Run that delivered it. For `turn-actions`, that
Run is a Run of the delivered message. A later follow-up Run on that message becomes its latest
Run.

#### Scenario: Continue on a delivered message

- **WHEN** a Run fails in its second segment, and the owner continues the latest turn
- **THEN** the follow-up request names the delivered message
- **AND** the Continue Run keeps the settled parts of the second segment reply

### Requirement: Each segment has its own step budget and retry scope

The configured step cap MUST count the steps of one segment. A crash retry of the Run MUST
restart the current segment from its user message. It MUST keep the stored messages and replies
of earlier segments.

#### Scenario: A steer after the cap gives a new budget

- **WHEN** the step cap is 8, a segment reaches it, and a steer is pending at its final answer
- **THEN** the next segment can execute 8 further tool steps

#### Scenario: A crash retry keeps earlier segments

- **WHEN** the worker dies in the third segment of a Run, and the queue retries the Run
- **THEN** the retry sends history through the user message of the third segment
- **AND** the replies of the first two segments do not change

### Requirement: A delivered item reaches the model exactly once

The transaction that stores a delivered message MUST mark its items `delivered` and MUST check
that the attempt is still current. A crash before that transaction MUST leave the items
`pending`. A crash after it MUST NOT deliver them again.

#### Scenario: A crash before delivery keeps the item

- **WHEN** the worker dies after a step and before the delivery transaction commits
- **THEN** the item stays `pending`, and the retried attempt delivers it once

#### Scenario: A superseded attempt cannot deliver

- **WHEN** a superseded attempt tries to deliver an item after a newer attempt claimed the Run
- **THEN** the delivery transaction fails, and the item does not change

### Requirement: A steer or an interrupt keeps the settings of the Run

A delivered steer or interrupt MUST NOT change the model, the effort, or the permission mode of
the Run. The settings that the item records MUST have no effect on that Run.

#### Scenario: A steer sent with another model

- **WHEN** the composer shows model `B` and the owner steers a Run on model `A`
- **THEN** the next segment of the Run uses model `A`

### Requirement: Queue items start one Run each after a completed Run

The transaction that completes a Run MUST take the first pending `queue` item of the Chat. It
MUST store that item as a user message and create a Run for it with the settings of the item. A
Run that does not complete MUST NOT start a queue item.

#### Scenario: Three queue items run in order

- **WHEN** three queue items are pending and the Run completes
- **THEN** the first item starts a Run with its own model, effort, and permission mode
- **AND** the second item starts a Run only after that Run completes

#### Scenario: A queue item that a send cannot use stays pending

- **WHEN** the model of the first queue item left the catalog before the Run completes
- **THEN** the item stays `pending`, no Run starts, and the queue is paused

### Requirement: The queue pauses after a Run that does not complete

When a Run ends `failed`, `cancelled`, or `expired`, its pending `steer` items MUST become `queue`
items before the other queue items, in their order. No pending item MUST start a Run until the
owner sends a message or changes an item to `steer` or `interrupt`.

#### Scenario: A failed Run pauses the queue

- **WHEN** a Run fails while one steer and two queue items are pending
- **THEN** three queue items are pending, with the former steer first
- **AND** no Run starts until the owner acts

### Requirement: A mode change on a paused item starts a Run

The owner can change a pending item to `steer` or `interrupt` while the Chat has no non-terminal
Run. The API MUST then store that item as a user message. It MUST start a Run for it with the
settings of the item.

#### Scenario: Steer now on a paused item

- **WHEN** the queue is paused and the owner changes its second item to `steer`
- **THEN** that item starts a Run, and the first item stays pending

### Requirement: Interrupt stops the current step and continues the Run

An `interrupt` item MUST stop the current step of the Run at once. The model request MUST abort.
The Run MUST settle the open tool calls under their interrupt fate. It MUST then deliver the item
and every pending `steer` item, and continue. The Run MUST NOT become terminal.

#### Scenario: An interrupt during a model response

- **WHEN** the owner sends an interrupt while the model streams text
- **THEN** the response stops, and the Run stays non-terminal
- **AND** the next model request of the same Run carries the interrupt

#### Scenario: An interrupt takes the pending steers along

- **WHEN** one steer is pending and the owner sends an interrupt
- **THEN** one delivered message holds the steer and the interrupt, in their order

### Requirement: Every tool declares an interrupt fate

Each tool MUST declare one interrupt fate: `cancel`, `finish`, or `background`. Native `edit` and
`write` MUST declare `finish`. Each other tool MUST declare `cancel`. No tool can declare
`background` until a capability defines that fate.

#### Scenario: A write finishes before the interrupt applies

- **WHEN** the owner interrupts while a native `write` call runs
- **THEN** the write completes, and its result is stored
- **AND** the interrupt is then delivered

### Requirement: A cancelled call settles under its tool rules

An interrupt MUST abort each open call whose fate is `cancel`. A `read_only` call MUST settle as
`cancelled` with the text: "The owner interrupted this call before it finished. It made no
change." A `bash` call MUST settle under the cancellation rules of `bash-execution`. A sent MCP
call MUST settle as `outcome_unknown`.

#### Scenario: An interrupt kills a long command

- **WHEN** the owner interrupts while a `bash` call runs for 60 seconds
- **THEN** the command stops, and the call settles as `bash-execution` requires for a cancellation
- **AND** the Run continues with the interrupt

### Requirement: A call that did not start gets a not-executed result

When an interrupt stops a step before a call of that step started, the call MUST settle with the
outcome `cancelled`. Its result text MUST be: "This call did not run. The owner interrupted the
step before it started. Run it again if you still need it."

#### Scenario: Two calls of one step, one started

- **WHEN** a step requests a `bash` call and a `read` call, and only the `bash` call started before the interrupt
- **THEN** the `read` call gets the not-executed result
- **AND** the `bash` call settles under its fate

### Requirement: An interrupted reply keeps its complete output

The reply of an interrupted segment MUST keep its text and its settled tool calls. Later model
requests MUST carry them. They MUST carry each reasoning part that completed with provider
metadata and has a later kept part. The reasoning part that the interrupt cut MUST be
display-only.

#### Scenario: The cut reasoning part never replays

- **WHEN** an interrupt stops a response during its second reasoning part
- **THEN** the first reasoning part replays with its provider metadata
- **AND** the second reasoning part stays in the transcript and no request carries it

### Requirement: An interrupted notice comes before the delivered message

The delivered message of an interrupt MUST carry one context item with producer `interrupted`
and form `notice`, before the owner text. Its body MUST state: "The owner interrupted your
previous step. Your response stopped before it was complete."

#### Scenario: The notice comes first

- **WHEN** a Run delivers an interrupt
- **THEN** the delivered message holds the `interrupted` item, then the owner text

### Requirement: The interrupted notice names stopped calls

When the interrupt stopped a `bash` or MCP call, the `interrupted` item MUST name each such call
by its tool name and call id. It MUST then state: "These calls started and were stopped. Their
effects are unknown. Inspect the current state before you repeat one."

#### Scenario: A killed command is named

- **WHEN** an interrupt kills a `bash` call
- **THEN** the `interrupted` item names that call and states that its effects are unknown

### Requirement: Interrupt and cancellation reach the worker in every topology

An interrupt and a cancellation MUST reach the worker that executes the Run, also in another
process. The stored item and the recorded cancellation MUST stay the source of truth. When the
signal is lost, the Run MUST find the interrupt at its next step boundary at the latest.

#### Scenario: An interrupt reaches a dedicated worker

- **WHEN** the API and the worker run in different processes, and the owner interrupts a model response
- **THEN** the response stops without a wait for a step boundary

### Requirement: A delivered message is a Run event

Each delivery MUST append one `run.delivered` event. The event MUST name the delivered message, its
items, and a `cause` of `steer` or `interrupt`. The Run stream MUST end its
current segment at that event and name the delivered message.

#### Scenario: A live client sees the delivery

- **WHEN** a client watches the stream of a Run that delivers a steer
- **THEN** the stream ends the current segment and names the delivered message
- **AND** a resume then streams the next segment

### Requirement: Pending items reach every owner device live

Each change to a pending item MUST reach the live subscribers of the Chat owner. A reload MUST
show the same pending items as a live client.

#### Scenario: A second tab sees a new item

- **WHEN** the owner sends a queue item from one browser tab
- **THEN** a second tab on the same Chat shows the item without a reload

### Requirement: A fork copies no pending item

A fork of a Chat MUST NOT copy its pending items. The delivered messages are messages and follow
the copy rules of `owner-chat-forks`.

#### Scenario: A fork during a paused queue

- **WHEN** the owner forks a Chat that has two pending queue items
- **THEN** the fork has no pending item

### Requirement: The composer offers delivery modes while a Run is active

While a Run of the Chat is active, the web composer MUST show a split Send button with the modes
Steer, Interrupt, and Queue. Enter MUST send a steer. Mod+Enter MUST send a queue item. When no
Run is active, the composer MUST show the plain Send button.

#### Scenario: Enter steers during a Run

- **WHEN** a Run is active and the owner types text and presses Enter
- **THEN** the web sends the message with `delivery: "steer"`

#### Scenario: Queue is an explicit choice

- **WHEN** a Run is active and the owner chooses Queue in the Send menu
- **THEN** the web sends the message with `delivery: "queue"`

### Requirement: The web shows pending items above the composer

The web MUST show each pending item above the composer in its order. A queue item MUST offer
Steer now, Interrupt now, delete, and edit. A steer item MUST offer Interrupt now and delete. Edit
MUST withdraw the item and put its text and attachments into the composer.

#### Scenario: Edit puts the text back

- **WHEN** the owner chooses edit on a pending queue item
- **THEN** the item leaves the stack, and the composer holds its text and attachments

#### Scenario: A delivered item leaves the stack

- **WHEN** an action on an item gets 409 because the item was delivered
- **THEN** the stack drops the item, and the transcript shows its delivered message

### Requirement: Stop interrupts when steers are pending

The Stop control and the Esc key MUST interrupt the Run when one or more `steer` items are
pending. Otherwise they MUST request cancellation of the Run. A draft in the composer MUST NOT
change.

#### Scenario: Esc twice stops everything

- **WHEN** one steer and one queue item are pending, and the owner presses Esc twice
- **THEN** the first press delivers the steer as an interrupt in the same Run
- **AND** the second press cancels the Run, and the queue item stays pending and paused

### Requirement: The transcript shows delivered messages and interrupts

The web MUST show a delivered message as an owner message between the replies of its segments.
It MUST show the `interrupted` item as a muted notice. It MUST show a paused queue with a label
that states that nothing runs until the owner acts.

#### Scenario: A reload shows the segments

- **WHEN** the owner reloads a Chat whose Run delivered one interrupt
- **THEN** the transcript shows the first reply, the interrupted notice, the owner message, and the second reply
