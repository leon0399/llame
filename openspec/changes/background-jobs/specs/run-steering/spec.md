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

## ADDED Requirements

### Requirement: A notice item is delivered as a steer is

At each step boundary, the Run MUST deliver every pending `notice` item with the pending `steer`
items, in their order. A notice MUST NOT stop a model response. An interrupt MUST also deliver
every pending `notice` item. When the model gives a final answer and a `notice` item is pending,
the Run MUST NOT complete. It MUST deliver the item and send a further model request.

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
