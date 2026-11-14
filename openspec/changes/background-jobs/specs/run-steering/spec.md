## MODIFIED Requirements

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

## ADDED Requirements

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
