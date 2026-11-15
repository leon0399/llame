# run-steering Specification

## Purpose

Defines how a message that arrives during a live Run reaches that Run or the next Run. It covers
the per-Chat delivery queue, the steer, interrupt, and queue modes, and the segments of a Run. It
also covers the work that an interrupt stops, and the owner's controls for pending items.

## Requirements

### Requirement: A send with a delivery mode becomes a pending item during a live Run

A chat send can name `delivery` with the value `steer`, `interrupt`, or `queue`. When the Chat has
a live Run, as `durable-runs` defines live, the API MUST store the message as a pending item. It
MUST NOT create a Run or a message row. It MUST answer 202 with the item. The send MUST pass the
validation of a chat send, with text neutralization and the media ownership check.

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

#### Scenario: A delivery send to a Chat with a stuck Run

- **WHEN** the only non-terminal Run of the Chat is stuck, and the owner sends a message with `delivery: "queue"`
- **THEN** admission expires the stuck Run, as `durable-runs` requires
- **AND** the message starts a Run, and no pending item is stored

### Requirement: A send to an idle Chat starts a Run for every delivery mode

When the Chat has no non-terminal Run, a chat send MUST start a Run as a chat send without
`delivery` does. The `delivery` value MUST have no other effect. Paused queue items MUST stay
pending, and they MUST NOT start before this message.

#### Scenario: A queue send to an idle Chat starts at once

- **WHEN** the owner sends a message with `delivery: "queue"` to a Chat with no live Run
- **THEN** the API starts a Run for the message and answers with its stream

#### Scenario: A send to a paused queue goes first

- **WHEN** two queue items are paused, and the owner sends a new message to the idle Chat
- **THEN** the new message starts a Run, and the two items stay pending

### Requirement: Admission of a pending item is idempotent on the message id

The id of the sent message MUST become the id of the pending item. A send that repeats the id of
a pending, delivered, or withdrawn item of the same Chat MUST answer with that item. It MUST NOT
store a second item or start a Run. An id of an item in another Chat MUST get 409 as a duplicate.
Admission MUST make this check before the check for duplicate message ids.

#### Scenario: A retried send returns the stored item

- **WHEN** the client sends the same queue item twice with one message id
- **THEN** both answers name the same item, and the Chat holds one pending item

#### Scenario: An item id from another Chat is a duplicate

- **WHEN** the owner sends a message with the id of a pending item in another Chat
- **THEN** the API answers 409, and neither Chat changes

#### Scenario: A retry after delivery starts no Run

- **WHEN** a Run delivered a steer item and completed, and the client sends the same message id again
- **THEN** the API answers with the delivered item and starts no Run

### Requirement: A pending item records a producer and a sender

Each pending item MUST record its producer kind, its sender reference, its mode, its parts, and its
attachments. It MUST also record the model, effort, and permission mode of the send, its state, and
its order. The state is `pending`, `delivered`, or `withdrawn`. This capability MUST accept the
producer kinds `owner` and `job`. An `owner` item MUST have an empty sender reference. A `job`
item MUST have the mode `notice`, no parts, and the job of `background-jobs` as its sender
reference. A `job` item MUST record the model, effort, and permission mode of the Run that
started the job.

#### Scenario: An owner item names its producer

- **WHEN** the owner sends a queue item during a Run
- **THEN** the stored item has producer kind `owner` and no sender reference

#### Scenario: A job item names its job

- **WHEN** a job that a Run on model `A` started settles
- **THEN** the stored item has producer kind `job`, the mode `notice`, and the job as sender reference
- **AND** the item records model `A`

### Requirement: Pending items belong to their Chat and its owner

A pending item MUST name a Chat of its owner. The datastore MUST enforce that match and MUST
enforce row-level security in the tenant scope of the owner. A request that names the Chat or an
item of another owner MUST get the not-found answer. It MUST NOT reveal or change that item.

#### Scenario: Another owner cannot see or change an item

- **WHEN** user B lists, withdraws, or changes a pending item in a Chat of user A
- **THEN** the API answers 404, and the item of user A does not change

#### Scenario: Another owner cannot add an item

- **WHEN** user B sends a queue item to a Chat of user A that has a live Run
- **THEN** the API answers 404, and the Chat of user A gets no pending item

#### Scenario: The datastore refuses a mismatched owner

- **WHEN** a write in the tenant scope of user B tries to store an item for a Chat of user A
- **THEN** the datastore refuses the write

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

- **WHEN** an item was delivered, and the owner then sends a withdrawal for it
- **THEN** the API answers 409
- **AND** the item stays `delivered`, and its message stays in the Chat

### Requirement: A delivered message gets its id from the system or the item

A user message that holds one promoted queue item MUST use the id of that item. A user message that
a boundary delivers MUST get a new id from the system. An edit MUST send its text again with a new
message id.

#### Scenario: A promoted item keeps its id

- **WHEN** a completed Run promotes a queue item
- **THEN** the new user message has the id of that item

### Requirement: Steer delivers at the next step boundary

A step boundary is the point after a model step and all tool results of that step, before the
next model request of the Run. At each step boundary, the Run MUST deliver every pending `steer`
item. A steer MUST NOT stop a model response, and it MUST NOT stop a tool call. A call of a tool
that yields under `tool-calling` is the one exception. That call returns early, and its work
continues.

#### Scenario: A steer during a tool call waits for the result

- **WHEN** the owner sends a steer while a `grep` call of the Run runs
- **THEN** the call finishes and its result is stored
- **AND** the next model request of the same Run carries the steer after that result

#### Scenario: A steer during a model response waits for the step end

- **WHEN** the owner sends a steer while the model streams a response with a tool call
- **THEN** the response and its tool call complete
- **AND** the steer is delivered after the result of that call

#### Scenario: A steer during a host command returns the call

- **WHEN** the owner sends a steer while a host `bash` call of the Run runs in the foreground
- **THEN** the call returns `backgrounded` with a job locator, and the command continues
- **AND** the next model request of the same Run carries the steer after that result

### Requirement: A pending item at the final answer continues the Run

When the model gives a final answer, the transaction that would complete the Run MUST first look
for pending `steer` and `interrupt` items. If it finds one or more, the Run MUST NOT complete. It
MUST deliver them and send a further model request. A Run with no tools follows the same rule.

#### Scenario: A steer during the final answer

- **WHEN** the owner sends a steer while the model writes its final answer
- **THEN** the Run stays non-terminal after that answer
- **AND** its next model request carries the steer

#### Scenario: A steer after completion starts a Run

- **WHEN** the transaction that completes the Run commits before the steer is admitted, and no queue item is pending
- **THEN** the send finds no live Run and starts a new Run for the message

### Requirement: The items delivered at one boundary form one user message

All `owner` items that one boundary delivers MUST become one user message, in their order. Each
`owner` item MUST give one text part and its own attachments to that message. The message MUST
name the Chat owner as sender. Each delivered item MUST record the id of its message. The
`notice` items of that boundary MUST become `job` context items of the same message, in their
order. When a boundary delivers no `owner` item, its `notice` items MUST go into one host message
of `background-jobs`.

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

### Requirement: A delivered message starts a segment and an attempt

A segment is the part of a Run that answers one user message. A delivery MUST close the reply of
the current segment. It MUST make the delivered message the message of the Run. It MUST start a
new attempt of the Run for that message in the same worker, with no new claim.

#### Scenario: The transcript order after a steer

- **WHEN** a Run delivers one steer after its second step
- **THEN** the Chat holds the first user message and the reply of the first segment
- **AND** the delivered message and the reply of the second segment follow, in that order

#### Scenario: Continue on a delivered message

- **WHEN** a Run fails in its second segment, and the owner continues the latest turn
- **THEN** the follow-up request names the delivered message, and the API accepts it
- **AND** the Continue Run keeps the settled parts of the second segment reply

### Requirement: A segment attempt prepares its own accepted turn

The attempt of a segment MUST prepare its accepted turn as the first attempt of a Run prepares it
for its user message. This includes the accepted-turn context items. Prompt imports and `$skill`
mentions in a delivered message MUST take effect. The compaction check MUST run only before the
first model step of the Run, not at a segment start.

#### Scenario: A steer with a skill mention

- **WHEN** a delivered steer names `$pdf` and the skill is available
- **THEN** the delivered message carries a `skill-activation` item before the steer text

#### Scenario: A segment start does not compact

- **WHEN** the reply of the first segment reports a final-request size above the compaction threshold, and a steer starts a second segment
- **THEN** no compaction runs before the first model request of the second segment

### Requirement: A follow-up Run applies its follow-up rules to its first segment only

The kept parts of a Continue Run and the `regenerate` notice of a Regenerate Run MUST apply only to
the first segment of that Run. A later segment MUST start from history through its delivered
message, as a segment of any Run does.

#### Scenario: A steer inside a Continue Run

- **WHEN** the owner steers a Continue Run after its first step
- **THEN** the reply of the delivered message does not hold the kept parts of the source reply
- **AND** the request of the second segment carries the kept parts once, in the first segment reply

#### Scenario: Regenerate on a delivered message

- **WHEN** the latest Run delivered a steer and failed, and the owner regenerates the latest turn
- **THEN** the Regenerate Run answers the delivered message and replaces only the reply of that message

### Requirement: A delivery does not restart the time limits of the Run

The wall-clock budget `runs.timeoutSeconds` and the execution ceiling MUST count from the claim of
the Run by its worker. A delivery MUST NOT restart either of them.

#### Scenario: A long steered Run reaches its budget

- **WHEN** the budget is one hour, and a Run takes a steer after 50 minutes
- **THEN** the Run expires one hour after the claim, during its second segment

### Requirement: A Chat title comes from the first message of its first Run

When the first Run of a Chat generates the Chat title, the title MUST come from the first message
of that Run. A delivered message MUST NOT replace it as the title source.

#### Scenario: A steer in the first Run

- **WHEN** the first Run of a new Chat delivers a steer, and then completes
- **THEN** the title comes from the first message of the Chat

### Requirement: A steer closes its segment reply as completed

A reply that a steer delivery closes MUST record usage status `completed`. A reply that an interrupt
delivery closes MUST record usage status `aborted`, `complete: false`, and `interrupted: true`, so
replay can tell it from a cancelled or expired reply. The Run MUST publish the usage of the closed
reply in its event stream before the `run.delivered` event.

#### Scenario: A live client sees the segment usage

- **WHEN** a Run delivers a steer
- **THEN** the stream shows the usage of the first segment reply before the delivery
- **AND** a reload shows the same usage

### Requirement: Each segment has its own step budget and retry scope

The configured step cap MUST count the steps of one segment. A crash retry of the Run MUST restart
the current segment from its user message. It MUST keep the stored messages and replies of earlier
segments.

#### Scenario: A steer after the cap gives a new budget

- **WHEN** the step cap is 8, a segment reaches it, and a steer is pending at its final answer
- **THEN** the next segment can execute 8 further tool steps

#### Scenario: A crash retry keeps earlier segments

- **WHEN** the worker dies in the third segment of a Run, and the queue retries the Run
- **THEN** the retry sends history through the user message of the third segment
- **AND** the replies of the first two segments do not change

### Requirement: A step end with nothing to deliver continues the segment

The Run can stop a step for a pending item that is gone at the delivery. The Run MUST then send the
next model request in the same segment. It MUST NOT complete.

#### Scenario: A withdrawal after the step end

- **WHEN** the Run stops a step for a pending steer, and the owner withdraws the steer before the delivery
- **THEN** the Run sends the next model request in the same segment and does not complete

### Requirement: A withdrawn interrupt keeps the cut reasoning out of the request

An interrupt can stop work, and the owner can withdraw the item before the delivery. The Run MUST
then continue the same reply. The reasoning part that the interrupt cut MUST NOT replay, and no
`interrupted` notice is added.

#### Scenario: A withdrawal after an interrupt stopped work

- **WHEN** an interrupt stops a response during a reasoning part, and the owner withdraws the item before the delivery
- **THEN** the Run continues the same reply, and its next request does not carry the cut reasoning part

### Requirement: A delivery does not happen after a cancellation

A delivery MUST NOT happen when a cancellation of the Run is recorded. The items MUST stay pending,
and the pause rule then applies to them.

#### Scenario: A cancellation and a steer at one boundary

- **WHEN** a cancellation is recorded, and its signal has not yet reached the worker at a step end with a pending steer
- **THEN** the steer is not delivered, and it becomes a queue item when the Run ends `cancelled`

### Requirement: A delivered item reaches the model exactly once

The transaction that stores a delivered message MUST mark its items `delivered` and MUST check
that the attempt is still current. A crash before that transaction MUST leave the items `pending`.
A crash after it MUST NOT deliver them again.

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

The transaction that completes a Run MUST take the first pending `queue` item of the Chat. It MUST
store that item as a user message and create a Run for it with the settings of the item. A Run that
does not complete MUST NOT start a queue item. A follow-up Run that completes also starts one.

#### Scenario: Three queue items run in order

- **WHEN** three queue items are pending and the Run completes
- **THEN** the first item starts a Run with its own model, effort, and permission mode
- **AND** the second item starts a Run only after that Run completes

#### Scenario: A queue item that a send cannot use stays pending

- **WHEN** the model of the first queue item left the catalog before the Run completes
- **THEN** the item stays `pending`, no Run starts, and the queue is paused

### Requirement: The queue pauses after a Run that does not complete

A Run can end `failed`, `cancelled`, or `expired`. Its pending `steer` and `interrupt` items MUST
then become `queue` items before the other queue items, in their order. A pending item MUST NOT
start a Run until the owner acts. The owner acts when they send a message, start a follow-up Run,
or change an item to `steer` or `interrupt`.

#### Scenario: A failed Run pauses the queue

- **WHEN** a Run fails while one steer and two queue items are pending
- **THEN** three queue items are pending, with the former steer first
- **AND** no Run starts until the owner acts

### Requirement: A mode change on a paused item starts a Run

The owner can change a pending item to `steer` or `interrupt` while the Chat has no non-terminal
Run. The API MUST then store that item as a user message with the id of the item. It MUST start a
Run for it with the settings of the item. When a send cannot use those settings, the API MUST
answer with the error of a chat send, and the item MUST stay pending.

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

### Requirement: An interrupt with no work in progress acts as a steer

The Run can have no model request and no tool call in progress. An `interrupt` item MUST then be
delivered at the next step boundary or final answer, as a steer is. This includes a `queued` Run
and an attempt that prepares its first request.

#### Scenario: An interrupt during compaction

- **WHEN** the owner sends an interrupt while the attempt runs its compaction check
- **THEN** the compaction completes, and the item is delivered after the first step of the segment

### Requirement: Every tool declares an interrupt fate

Each tool MUST declare one interrupt fate: `cancel`, `finish`, or `background`. `bash` and `wait`
MUST declare `background`. Each other `read_only` tool and each MCP tool MUST declare `cancel`.
Each other tool MUST declare `finish`. On an interrupt, a call with the fate `background` MUST
return early, and its work MUST continue as `tool-calling` defines. A `bash` call on an `ssh://`
or `machine://` directory cannot continue. It MUST settle as a call with the fate `cancel`.

#### Scenario: A write finishes before the interrupt applies

- **WHEN** the owner interrupts while a native `write` call runs
- **THEN** the write completes, and its result is stored
- **AND** the interrupt is then delivered

#### Scenario: Workspace entry finishes

- **WHEN** the owner interrupts while an `enter_workspace` call creates a worktree
- **THEN** the call completes, and the interrupt is then delivered

#### Scenario: A host command continues after an interrupt

- **WHEN** the owner interrupts while a host `bash` call runs in the foreground
- **THEN** the call returns `backgrounded` with a job locator, and the command continues
- **AND** the interrupted notice does not name that call as stopped

### Requirement: A cancelled call settles under its tool rules

An interrupt MUST abort each open call whose fate is `cancel`. A `read_only` call MUST settle as
`cancelled` with the text: "The owner interrupted this call before it finished. It made no
change." A `bash` call on an `ssh://` or `machine://` directory MUST settle under the
cancellation rules of `bash-execution`. A sent MCP call MUST settle as `outcome_unknown`.

#### Scenario: An interrupt kills a long command

- **WHEN** the owner interrupts while a `bash` call on an `ssh://` directory runs for 60 seconds
- **THEN** the command stops, and the call settles as `bash-execution` requires for a cancellation
- **AND** the Run continues with the interrupt

### Requirement: Interrupt settlement is at most once and distinguishable

Each call MUST settle once. A tool rejection that the interrupt signal causes MUST NOT settle the
call as `execution_failed`. The stored result of a call that an interrupt settles MUST carry a
marker that an interrupt settled it. The live stream and a reload MUST show the same outcome. A
stopped call with a recorded native attempt MUST get a recorded native result. A call that yields
under `tool-calling` returns its own result. That result MUST NOT carry the marker, and the
interrupted notice MUST NOT name the call as stopped.

#### Scenario: A late tool result does not replace the settlement

- **WHEN** a cancelled call returns a result after the interrupt settled it
- **THEN** the first settlement stands in the live stream and in history

#### Scenario: A call that yields carries no interrupt marker

- **WHEN** an interrupt makes a foreground host `bash` call return `backgrounded`
- **THEN** the stored result carries the cause `message` and no interrupt marker

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
requests MUST carry them. Its reasoning parts follow the rule of `reasoning-output` for a reply
that an interrupt closed. The reasoning part that the interrupt cut MUST stay in the transcript.

#### Scenario: The cut reasoning part never replays

- **WHEN** an interrupt stops a response during its second reasoning part
- **THEN** the first reasoning part replays with its provider metadata
- **AND** the second reasoning part stays in the transcript, and no request carries it

### Requirement: An interrupted notice comes first in the delivered message

The delivered message of an interrupt MUST carry one context item with producer `interrupted` and
form `notice`, before the owner text. Its body MUST state: "The owner interrupted your previous
step. Your response stopped before it was complete."

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
items, and a `cause` of `steer`, `interrupt`, or `notice`. The cause is `notice` when the
delivery holds only `notice` items and no interrupt stopped the step. The Run stream MUST end
its current segment at that event and name the delivered message.

#### Scenario: A live client sees the delivery

- **WHEN** a client watches the stream of a Run that delivers a steer
- **THEN** the stream ends the current segment and names the delivered message
- **AND** a resume then streams the next segment

#### Scenario: A delivery of one notice names its cause

- **WHEN** a Run delivers one `notice` item and no owner item at a step boundary
- **THEN** the `run.delivered` event names the host message and the cause `notice`

### Requirement: Pending items reach every owner device live

Each change to a pending item MUST reach the live subscribers of the Chat owner. A reload MUST show
the same pending items as a live client.

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

#### Scenario: Interrupt from the Send menu

- **WHEN** a Run is active and the owner chooses Interrupt in the Send menu
- **THEN** the web sends the message with `delivery: "interrupt"`

### Requirement: The web shows pending items above the composer

The web MUST show each pending item above the composer in its order. A queue item MUST offer Steer
now, Interrupt now, delete, and edit. A steer item MUST offer Interrupt now, delete, and edit. Edit
MUST withdraw the item and put its text and attachments into the composer.

#### Scenario: Edit puts the text back

- **WHEN** the owner chooses edit on a pending queue item
- **THEN** the item leaves the stack, and the composer holds its text and attachments

#### Scenario: A delivered item leaves the stack

- **WHEN** an action on an item gets 409 because the item was delivered
- **THEN** the stack drops the item, and the transcript shows its delivered message

### Requirement: Stop interrupts when steers are pending

The Stop control and the Esc key MUST interrupt the Run when one or more `steer` items are pending.
Otherwise they MUST request cancellation of the Run. A draft in the composer MUST NOT change.

#### Scenario: Esc twice stops everything

- **WHEN** one steer and one queue item are pending, and the owner presses Esc
- **THEN** the steer is delivered as an interrupt in the same Run
- **AND** a second press after that delivery cancels the Run, and the queue item stays pending and paused

### Requirement: The transcript shows delivered messages and interrupts

The web MUST show a delivered message of the owner as an owner message between the replies of
its segments. It MUST show a host message as `background-jobs` requires. It MUST show the
`interrupted` item as a muted notice. When the Chat has no live Run and one or more pending
`owner` items, the web MUST label the queue as paused.

#### Scenario: A reload shows the segments

- **WHEN** the owner reloads a Chat whose Run delivered one interrupt
- **THEN** the transcript shows the first reply, the interrupted notice, the owner message, and the second reply

#### Scenario: A failed Run shows a paused queue

- **WHEN** a Run fails while two queue items are pending
- **THEN** the stack labels the queue as paused, and the Continue action stays available

#### Scenario: A held notice alone does not label a paused queue

- **WHEN** the Chat has no live Run and its only pending item is a `notice` item
- **THEN** the stack shows the notice and no paused label

### Requirement: A notice item is delivered as a steer is

At each step boundary, the Run MUST deliver every pending `notice` item with the pending `steer`
items, in their order. A notice MUST NOT stop a model response. An interrupt MUST also deliver
every pending `notice` item. A pending `notice` item at the final answer MUST continue the Run
as a pending `steer` item does. A reply that a delivery with the cause `notice` closes MUST
record usage status `completed`.

#### Scenario: A job settles during the final answer

- **WHEN** a job settles while the model writes its final answer
- **THEN** the Run stays non-terminal after that answer
- **AND** its next model request carries the notice

#### Scenario: A job settles during a model response

- **WHEN** a job settles while the model streams a response with a tool call
- **THEN** the response and its tool call complete, and the notice is delivered after the result of that call

### Requirement: Only the system creates a notice item

A chat send MUST NOT create a `notice` item. A send whose `delivery` is `notice` MUST get 400. A
`PATCH` with `mode` on a `notice` item MUST get 400, and the item MUST NOT change. `DELETE` on a
pending `notice` item MUST withdraw it. `GET /api/v1/chats/:chatId/deliveries` MUST return each
pending `notice` item with its producer kind, its job locator, and the state of the job.

#### Scenario: The owner cannot make a notice an interrupt

- **WHEN** the owner sends `PATCH` with `mode: "interrupt"` for a pending `notice` item
- **THEN** the API answers 400, and the item stays a pending `notice` item

#### Scenario: A send cannot forge a notice

- **WHEN** a chat send names `delivery: "notice"`
- **THEN** the API answers 400, and no item is stored

### Requirement: A steer and a notice signal the worker

The admission of a `steer` item or a `notice` item MUST signal the worker that executes the Run,
also in another process. The worker MUST then make each open call of a tool that yields return
early. The stored item MUST stay the source of truth. When the signal is lost, the Run MUST find
the item at its next step boundary at the latest.

#### Scenario: A steer reaches a dedicated worker

- **WHEN** the API and the worker run in different processes, and the owner steers during a host `bash` call
- **THEN** the call returns `backgrounded` without a wait for its foreground bound

#### Scenario: A lost signal delays the steer

- **WHEN** the signal for a steer is lost while a host `bash` call runs
- **THEN** the call returns at its foreground bound, and the steer is delivered at that boundary

### Requirement: A delivered notice keeps the settings of the Run

A delivered `notice` item MUST NOT change the model, the effort, or the permission mode of the
Run. The settings that the item records MUST have no effect on a Run that already exists. They
apply only to a Run that the host starts, as `background-jobs` defines.

#### Scenario: A notice from a job of another model

- **WHEN** a job that a Run on model `A` started settles while a Run on model `B` executes
- **THEN** the next segment of that Run uses model `B`
