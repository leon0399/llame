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
change to `queue` MUST get 400. During a compaction Run, a change to `steer` or `interrupt` MUST get 400.

#### Scenario: Withdraw returns the text for an edit

- **WHEN** the owner withdraws a pending queue item
- **THEN** the answer holds the parts and attachments of the item
- **AND** the item is `withdrawn` and is not delivered

#### Scenario: Steer now changes a queue item

- **WHEN** the owner changes a pending queue item to `steer` during a turn Run
- **THEN** the item is delivered at the next step boundary of that Run

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
Run. For a message item, the API MUST then store that item as a user message with the id of the item.
A command item MUST start a compaction Run instead. It MUST start a
Run for it with the settings of the item. When a send cannot use those settings, the API MUST
answer with the error of a chat send, and the item MUST stay pending.

#### Scenario: Steer now on a paused item

- **WHEN** the queue is paused and the owner changes its second item to `steer`
- **THEN** that item starts a Run, and the first item stays pending

#### Scenario: Steer now on a paused compact item

- **WHEN** the queue is paused, its first item is `/compact`, and the owner changes it to `steer`
- **THEN** a compaction Run starts with the settings of the item, and the Chat gets no user message

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
now, Interrupt now, delete, and edit. During a compaction Run, an `owner` item MUST offer only
delete and edit. A steer item MUST offer Interrupt now, delete, and edit. Edit
MUST withdraw the item and put its text and attachments into the composer.

#### Scenario: Edit puts the text back

- **WHEN** the owner chooses edit on a pending queue item
- **THEN** the item leaves the stack, and the composer holds its text and attachments

#### Scenario: A delivered item leaves the stack

- **WHEN** an action on an item gets 409 because the item was delivered
- **THEN** the stack drops the item, and the transcript shows its delivered message

#### Scenario: A queue item during a compaction Run offers no Steer now

- **WHEN** a compaction Run is live and a message item is pending
- **THEN** its row offers delete and edit, and no Steer now or Interrupt now

### Requirement: A segment attempt prepares its own accepted turn

The attempt of a segment MUST prepare its accepted turn as the first attempt of a Run prepares it
for its user message. This includes the accepted-turn context items. Prompt imports and `$skill`
mentions in a delivered message MUST take effect. The pre-step compaction check MUST run only
before the first model step of the Run, not at a segment start. A compaction at a step boundary
follows `model-system-prompts`.

#### Scenario: A steer with a skill mention

- **WHEN** a delivered steer names `$pdf` and the skill is available
- **THEN** the delivered message carries a `skill-activation` item before the steer text

#### Scenario: A segment start does not compact

- **WHEN** a steer starts a second segment, and the measured request at that boundary is below the compaction threshold
- **THEN** no compaction runs before the first model request of the second segment

### Requirement: A pending item at the final answer continues the Run

When the model gives a final answer, the transaction that would complete the Run MUST first look
for pending `steer` and `interrupt` items. A command item MUST first compact the Run. If it finds
one or more message or `notice` items, the Run MUST NOT complete. It MUST deliver them and send a
further model request. With only command items, the Run MUST complete after the compaction. A Run with no tools follows the same rule.

#### Scenario: A steer during the final answer

- **WHEN** the owner sends a steer while the model writes its final answer
- **THEN** the Run stays non-terminal after that answer
- **AND** its next model request carries the steer

#### Scenario: A steer after completion starts a Run

- **WHEN** the transaction that completes the Run commits before the steer is admitted, and no queue item is pending
- **THEN** the send finds no live Run and starts a new Run for the message

#### Scenario: A compact at the final answer

- **WHEN** the owner sends `/compact` as a steer while the model writes its final answer
- **THEN** a checkpoint absorbs that answer, and the Run completes with no further model request

### Requirement: The items delivered at one boundary form one user message

All `owner` message items of one boundary MUST become one user message, in their order. Each
message item MUST give one text part and its own attachments to that message. The message MUST
name the Chat owner as sender. Each delivered message item and `notice` item MUST record the id of
its message. The `notice` items of that boundary MUST become `job` context items of the same
message, in their order. With no message item, its `notice` items MUST go into one host message of
`background-jobs`.

#### Scenario: Two steers at one boundary

- **WHEN** the owner sends two steers during one tool call
- **THEN** the next boundary stores one user message with two text parts in send order
- **AND** both items record the id of that message

#### Scenario: A steer and a notice at one boundary

- **WHEN** a job settles and the owner then sends a steer during one tool call
- **THEN** the next boundary stores one user message with one `job` context item before the owner text
- **AND** both items record the id of that message

#### Scenario: A notice alone at one boundary

- **WHEN** a job settles during a tool call, and no owner item is pending
- **THEN** the next boundary stores one host message with one `job` context item
- **AND** the next segment of the Run answers that message

### Requirement: Each segment has its own step budget and retry scope

The configured step cap MUST count the steps of one segment. A segment that a compaction starts
MUST get only the steps that the segment before it did not use. A crash retry of the Run MUST restart
the current segment from its user message. It MUST keep the stored messages and replies of earlier
segments.

#### Scenario: A steer after the cap gives a new budget

- **WHEN** the step cap is 8, a segment reaches it, and a steer is pending at its final answer
- **THEN** the next segment can execute 8 further tool steps

#### Scenario: A crash retry keeps earlier segments

- **WHEN** the worker dies in the third segment of a Run, and the queue retries the Run
- **THEN** the retry sends history through the user message of the third segment
- **AND** the replies of the first two segments do not change

#### Scenario: A compaction keeps the step budget

- **WHEN** the step cap is 8, and a segment compacts after 5 steps with no owner message
- **THEN** the next segment can execute 3 further tool steps

### Requirement: A delivered message is a Run event

Each delivery MUST append one `run.delivered` event. The event MUST name the delivered message, its
items, and a `cause`. The cause is `interrupt` when an interrupt stopped the step or an interrupt
item is delivered. Otherwise it is `steer` when a message item is delivered, `compaction` when the
boundary compacted, and `notice` in the last case. A boundary that compacted MUST also name its
checkpoint. The Run stream MUST end
its current segment at that event and name the delivered message.

#### Scenario: A live client sees the delivery

- **WHEN** a client watches the stream of a Run that delivers a steer
- **THEN** the stream ends the current segment and names the delivered message
- **AND** a resume then streams the next segment

#### Scenario: A delivery of one notice names its cause

- **WHEN** a Run delivers one `notice` item and no owner item at a step boundary
- **THEN** the `run.delivered` event names the host message and the cause `notice`

#### Scenario: A compaction names its cause

- **WHEN** a Run compacts at a step boundary and continues with a host message
- **THEN** the `run.delivered` event has the cause `compaction`, and names that host message and the checkpoint

#### Scenario: An interrupt compaction keeps its cause

- **WHEN** the owner sends `/compact` as an interrupt during a tool call
- **THEN** the `run.delivered` event has the cause `interrupt` and names the checkpoint
- **AND** the closed reply records usage status `aborted` with `interrupted: true`

### Requirement: Stop interrupts when steers are pending

The Stop control and the Esc key MUST interrupt the Run when one or more `steer` message items are
pending. A pending command item MUST NOT make them interrupt.
Otherwise they MUST request cancellation of the Run. A draft in the composer MUST NOT change.

#### Scenario: Esc twice stops everything

- **WHEN** one steer and one queue item are pending, and the owner presses Esc
- **THEN** the steer is delivered as an interrupt in the same Run
- **AND** a second press after that delivery cancels the Run, and the queue item stays pending and paused

#### Scenario: Stop with only a pending compact

- **WHEN** only a `/compact` steer item is pending, and the owner presses Stop
- **THEN** the Run is cancelled, and the `/compact` item stays pending and paused

## ADDED Requirements

### Requirement: A command item compacts the Run once at its boundary

A command item is a pending `owner` item whose text is a `/compact` command. Other `owner` items are
message items. A boundary that delivers one or more command items MUST compact the Run once, before
it stores any delivered message. It MUST use the focus of the first command item. It MUST mark each
command item that the compaction read delivered with no message. A command item that arrives during
the compaction MUST stay pending until the next boundary.

#### Scenario: Two compact items at one boundary

- **WHEN** the owner sends `/compact` twice as steers during one tool call
- **THEN** the next boundary publishes one checkpoint, and both items are `delivered`

#### Scenario: A compact and a steer at one boundary

- **WHEN** the owner sends `/compact` and then a steer during one tool call
- **THEN** the next boundary publishes a checkpoint and then stores the steer as a user message after it

#### Scenario: A compact item withdrawn during the compaction

- **WHEN** the owner withdraws the only `/compact` item while its boundary compaction runs
- **THEN** the boundary publishes no checkpoint, and the Run continues as with no pending item

### Requirement: A compaction boundary stores a continue message

A step-boundary compaction can deliver no message item while the Run is mid-work. The Run MUST then
store one host message after the checkpoint and continue with it. That message MUST hold one
`compaction` notice item, after the `interrupted` item and the `notice` items of the boundary. At
the final answer, a host message for notices MUST hold no `compaction` item.

#### Scenario: A compaction in a tool loop continues the Run

- **WHEN** the owner sends `/compact` as a steer during the third tool call of a Run
- **THEN** a checkpoint follows the closed reply, a host message with a `compaction` item follows it
- **AND** the Run sends its next model request

#### Scenario: A job result during a compaction

- **WHEN** a job settles while a step-boundary compaction runs
- **THEN** the host message after the checkpoint holds the `job` item of that notice

#### Scenario: A compact at the final answer with a pending notice

- **WHEN** the owner sends `/compact` as a steer at the final answer, and a notice is pending
- **THEN** a checkpoint absorbs the answer, and a host message after it holds the `job` item and no `compaction` item

### Requirement: Owner items during a compaction Run are queue items

A compaction Run has no step boundary. During a compaction Run, the API MUST store every `owner`
item as `queue`, whatever `delivery` the send names. A compaction Run MUST NOT deliver a pending
item.

#### Scenario: A steer during a compaction Run is queued

- **WHEN** the owner sends a message with `delivery: "steer"` while a compaction Run is live
- **THEN** the API answers 202 with a pending item in mode `queue`
- **AND** the compaction Run ends with no user message

### Requirement: A compact steer wakes a Run that waits

A Run in `awaiting_jobs` has no live request. A command item that wakes it MUST compact before the
first model request of the woken attempt. That compaction MUST use the request that the attempt
prepared, and it MUST then continue as a step-boundary compaction does.

#### Scenario: Compact during a job wait

- **WHEN** a Run waits on a build job, and the owner sends `/compact` as a steer
- **THEN** the Run wakes, compacts, and continues with a host message after the checkpoint
- **AND** the build job keeps `running`
