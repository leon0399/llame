## Purpose

Lets an owner act on the latest turn of a Chat after its Run ends: continue a failed turn from its
last completed step, or regenerate the turn from its user message.

## ADDED Requirements

### Requirement: An owner starts a follow-up Run on the latest turn

A follow-up Run is a Run that an owner starts on a user message that already has a Run. The owner
MUST start it through `POST /api/v1/chats/:chatId/messages/:userMessageId/runs`. The message MUST
be the user message with the highest `seq` of the Chat's user messages. The Chat MUST NOT be
archived. The answer MUST be the same UI message stream that a chat send returns.

#### Scenario: A follow-up request on the latest turn starts a Run

- **WHEN** the owner sends a valid follow-up request for the latest user message of a Chat with no live Run
- **THEN** the API creates a new Run for that message
- **AND** the first frame of the stream is a `start` frame whose `messageId` is the new Run's id

#### Scenario: A follow-up request on an older turn is refused

- **WHEN** the owner sends a follow-up request for a user message that has a newer user message after it
- **THEN** the API answers 409
- **AND** it creates no Run and changes no message

#### Scenario: A follow-up request on an archived Chat is refused

- **WHEN** the owner sends a follow-up request for the latest user message of an archived Chat
- **THEN** the API answers with the error that a chat send to that Chat gets
- **AND** it creates no Run

#### Scenario: A follow-up request for another owner's Chat reveals nothing

- **WHEN** user B sends a follow-up request that names a Chat or a user message of user A
- **THEN** the API answers 404 before it reads any job state
- **AND** it creates no Run, expires no Run, and changes no message of user A

### Requirement: A follow-up request passes single-flight admission

A follow-up request MUST pass the single-flight admission of a chat send in `durable-runs`. A live
Run in the Chat MUST cause a 409 answer. Admission MUST expire a stuck Run under the same rules as
for a new message. The action check MUST read the status of the message's latest Run after that
admission.

#### Scenario: A live Run blocks a follow-up request

- **WHEN** a Run of the Chat is live and the owner sends a follow-up request
- **THEN** the API answers 409 and the live Run continues without change

#### Scenario: A stuck Run is expired before the action check

- **WHEN** the latest Run of the latest user message is stuck and the owner sends a Continue request
- **THEN** admission expires that Run with a terminal `run.expired`
- **AND** the Continue check reads `expired` and the API admits the Continue Run

### Requirement: A follow-up request is validated before any write

The `action` field MUST be `continue` or `regenerate`. A Continue request MUST NOT name `modelId`
or `effort`. A Regenerate request MUST name `modelId`. Regenerate MUST validate `modelId`,
`effort`, and `permissionMode` in the order of a chat send. When `permissionMode` is absent, the
mode MUST be `default`. An invalid request MUST get a 400 answer and MUST write nothing.

#### Scenario: Continue rejects a model choice

- **WHEN** a Continue request names `modelId` or `effort`
- **THEN** the API answers 400 and creates no Run

#### Scenario: Regenerate needs a model

- **WHEN** a Regenerate request has no `modelId`
- **THEN** the API answers 400 and creates no Run

#### Scenario: Regenerate validates like a chat send

- **WHEN** a Regenerate request names a model that the catalog does not offer, an effort that the model does not declare, or a disabled mode
- **THEN** the API answers with the error that a chat send with the same values gets
- **AND** it creates no Run

### Requirement: Continue applies only after a failed, cancelled, or expired Run

Continue MUST start only when the latest Run of the triggering user message is `failed`,
`cancelled`, or `expired`. Any other status MUST get a 409 answer. The Continue Run MUST use the
model and the effort of that latest Run. It MUST use the permission mode of the Continue request.

#### Scenario: A completed turn cannot be continued

- **WHEN** the latest Run of the latest user message is `completed` and the owner sends a Continue request
- **THEN** the API answers 409 and creates no Run

#### Scenario: Continue keeps the model and the effort

- **WHEN** a `failed` Run used model `A` with effort `high`, and the owner continues it with `permissionMode: "bypass"`
- **THEN** the Continue Run records model `A`, effort `high`, and mode `bypass`

#### Scenario: Continue after a Run that failed before its reply

- **WHEN** the latest Run of the latest user message failed before it dispatched, so the message has no reply
- **THEN** the Continue Run keeps no part and its request starts from the triggering user message

### Requirement: Continue keeps the completed steps of the reply

A settled tool part is a tool part with a result. The kept parts MUST be the reply's parts through
the last settled tool part, and the context items directly after it. The parts after them are the
unfinished step. Continue MUST remove the unfinished step from the reply. The event log of the
continued Run MUST keep it. When the reply has no settled tool part, Continue MUST keep no part.

#### Scenario: Continue drops only the unfinished step

- **WHEN** a `failed` reply holds three settled tool calls with their text and reasoning, then partial text and partial reasoning
- **THEN** the kept parts are the three steps in stored order
- **AND** the partial text and the partial reasoning are not in the Continue Run's reply
- **AND** the event log of the failed Run still holds them

#### Scenario: Continue keeps an unknown outcome as recorded

- **WHEN** the last settled tool part of a `failed` reply holds an `outcome_unknown` result for `bash`
- **THEN** the Continue request gives the model that result as recorded
- **AND** the Continue Run does not execute that command again

### Requirement: Continue requests the next step of the same turn

A Continue request MUST carry the history through the triggering user message, then the kept
parts in stored order. Each kept reasoning part MUST carry its stored provider metadata. The
request MUST NOT add a user-role message after the last kept tool result. The Continue Run MUST
NOT execute a kept tool call again.

#### Scenario: Continue sends the kept steps with their reasoning

- **WHEN** the owner continues a `failed` Run whose kept parts hold a reasoning part with encrypted provider metadata and a settled tool call
- **THEN** the first model request carries that reasoning part with its metadata, the tool call, and the tool result after the triggering user message
- **AND** the request has no user-role message after that tool result

#### Scenario: Continue does not repeat a settled call

- **WHEN** the kept parts hold a settled `edit` call
- **THEN** the Continue Run does not invoke `edit` for that call
- **AND** the model receives the stored result of that call

### Requirement: The Continue Run log starts with the kept parts

The Continue Run's event log MUST record the kept parts before its first model event. Each
attempt of the Continue Run MUST start from those parts. A stream replay of the Continue Run MUST
show the kept parts, then the new parts. The final reply MUST hold the kept parts, then the new
parts, in stored order.

#### Scenario: A refresh shows the whole continued reply

- **WHEN** the owner reloads the Chat while a Continue Run streams its second new step
- **THEN** the resumed stream shows the kept parts, then the new parts

#### Scenario: A worker death does not lose the kept parts

- **WHEN** the worker of a Continue Run dies after its dispatch, and the queue starts a second attempt of that Run
- **THEN** the second attempt starts from the same kept parts
- **AND** the final reply holds the kept parts once, then the parts of the second attempt

#### Scenario: A failed Continue keeps the kept parts

- **WHEN** a Continue Run fails after one new settled tool call
- **THEN** the reply holds the kept parts, then the new step

### Requirement: Regenerate replaces the reply of the latest turn

Regenerate MUST start when the latest Run of the triggering user message is terminal, with any
terminal status. Its request MUST start from the history through the triggering user message. Its
dispatch MUST replace the reply, also a `completed` reply. The old reply MUST stay only in the old
Run's event log. A Regenerate that ends before its dispatch MUST leave the old reply unchanged.

#### Scenario: Regenerate replaces a completed answer with another model

- **WHEN** the owner regenerates a `completed` reply of model `A` with model `B`
- **THEN** the new Run's request carries no part of the old reply
- **AND** after the new Run completes, the reply holds only the new answer and records model `B`

#### Scenario: Regenerate a turn with no reply

- **WHEN** the first Run of the latest user message failed at pickup, so the message has no reply, and the owner regenerates it
- **THEN** the API admits the Regenerate Run and its dispatch creates the reply

#### Scenario: A Regenerate that fails before dispatch keeps the old reply

- **WHEN** a Regenerate Run fails during preparation before its first model request
- **THEN** the old reply keeps its parts, its usage, and its eligibility

#### Scenario: A replaced completed reply leaves search

- **WHEN** a Regenerate Run replaces a `completed` reply and then completes
- **THEN** `search_conversations` and `conversation_read` return no result for that reply

### Requirement: Regenerate discloses non-read-only tool calls to the new attempt

A non-read-only call is a tool part whose recorded classification is not `read_only`. A tool part
with no recorded classification is a non-read-only call, unless its tool name resolves to a
`read_only` tool. When the replaced reply holds a non-read-only call, the new reply MUST start with
one fixed
notice. The notice MUST say that this is a new attempt and that files or other state can have
changed.

#### Scenario: A discarded bash call adds the notice

- **WHEN** the owner regenerates a reply that holds a `bash` call that started
- **THEN** the first part of the new reply is the notice
- **AND** the model receives the notice directly after the triggering user message

#### Scenario: A read-only reply adds no notice

- **WHEN** the owner regenerates a reply whose tool calls are all `read_only`
- **THEN** the new reply has no notice

#### Scenario: A call that did not start adds no notice

- **WHEN** the only tool part of the replaced reply is a call that the availability gate rejected before it started
- **THEN** the new reply has no notice

### Requirement: The follow-up Run's usage replaces the reply's usage

The follow-up Run's usage MUST replace the reply's usage and MUST name the follow-up Run in
`runId`. The usage MUST NOT add the spend of an earlier Run. The effective-context action of the
reply MUST show the receipts of the follow-up Run.

#### Scenario: Continue usage counts only the new Run

- **WHEN** a Continue Run completes after a `failed` Run that reported usage
- **THEN** the reply's usage is the aggregate of the Continue Run's requests only
- **AND** its `runId` names the Continue Run

### Requirement: The latest turn shows Continue and Regenerate actions

The web MUST show Regenerate on the latest turn when its latest Run is terminal. It MUST show
Continue only when that Run is `failed`, `cancelled`, or `expired` and the reply holds a settled
tool part. A latest turn with no reply MUST show Regenerate. Older turns MUST NOT show either
action.

#### Scenario: A failed agentic turn shows both actions

- **WHEN** the latest Run failed after two settled tool calls
- **THEN** the latest turn shows Continue and Regenerate

#### Scenario: A failed turn with no completed step shows only Regenerate

- **WHEN** the latest Run failed before any tool call settled
- **THEN** the latest turn shows Regenerate and does not show Continue

#### Scenario: Older turns show no action

- **WHEN** a Chat has two turns
- **THEN** only the second turn shows the actions

### Requirement: Regenerate offers a repeat and a choice of settings

A plain Regenerate click MUST send the model, the effort, and the permission mode of the turn's
latest Run. The Regenerate menu MUST offer the composer's model, effort, and permission-mode
selectors. A choice in the menu MUST also set the composer selection. The menu's submit action
MUST send the composer values.

#### Scenario: A plain click repeats the old settings

- **WHEN** the latest Run used model `A`, effort `low`, and mode `bypass`, the composer shows model `B`, and the owner clicks Regenerate
- **THEN** the request names model `A`, effort `low`, and mode `bypass`
- **AND** the composer still shows model `B`

#### Scenario: A menu choice sets the composer

- **WHEN** the owner opens the Regenerate menu, selects model `C`, and submits
- **THEN** the request names model `C`
- **AND** the composer shows model `C` after the request

### Requirement: Regenerate asks before it discards non-read-only calls

Before a Regenerate whose reply holds a non-read-only call, or a tool part with no recorded
classification, the web MUST ask for confirmation. The dialog MUST name each such call by its
tool name. It MUST say that the effects stay and that the new answer cannot see them. A cancel
MUST send no request.

#### Scenario: A reply with edits asks first

- **WHEN** the owner clicks Regenerate on a reply that holds two `edit` calls and one `bash` call that started
- **THEN** a dialog names `edit` and `bash` before any request
- **AND** a cancel leaves the reply and sends nothing

#### Scenario: A read-only reply regenerates at once

- **WHEN** the owner clicks Regenerate on a reply whose tool calls are all `read_only`
- **THEN** the web sends the request without a dialog
