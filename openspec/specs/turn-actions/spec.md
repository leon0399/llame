# turn-actions Specification

## Purpose

Lets an owner act on the latest turn of a Chat after its Run ends. The owner can continue a failed
turn from its last completed step, or regenerate the turn from its user message.

## Requirements

### Requirement: An owner starts a follow-up Run on the latest turn

A follow-up Run is a Run that an owner starts on a user message that already has a Run. The owner
MUST start it through `POST /api/v1/chats/:chatId/messages/:userMessageId/runs`. The message MUST
be the user message with the highest `seq` of the Chat's user messages. The newest Run of the Chat
MUST be a turn Run of that message. A checkpoint MUST NOT absorb that message. The Chat MUST NOT be
archived. The answer MUST be the same AG-UI 1.0 event stream that a chat send returns.

#### Scenario: A follow-up request on the latest turn starts a Run

- **WHEN** the owner sends a valid follow-up request for the latest user message of a Chat with no live Run
- **THEN** the API creates a new Run for that message
- **AND** the first event of the stream is `RUN_STARTED` whose `runId` is the new Run id and whose `threadId` is the Chat id

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

#### Scenario: A follow-up after a compaction Run is refused

- **WHEN** the newest Run of a Chat is a compaction Run, and the owner sends a Regenerate request for the latest user message
- **THEN** the API answers 409 and creates no Run

#### Scenario: A follow-up after a compact at the final answer is refused

- **WHEN** a turn Run compacted at its final answer and completed, and the owner sends a Regenerate request for its user message
- **THEN** the API answers 409 and creates no Run

### Requirement: A follow-up request passes single-flight admission

A follow-up request MUST pass the single-flight admission of a chat send in `durable-runs`. A live
Run in the Chat MUST cause a 409 answer. Admission MUST expire a stuck Run under the same rules as
for a new message. The action check MUST read the latest Run of the message after that admission.

#### Scenario: A live Run blocks a follow-up request

- **WHEN** a Run of the Chat is live and the owner sends a follow-up request
- **THEN** the API answers 409 and the live Run continues without change

#### Scenario: A stuck Run is expired before the action check

- **WHEN** the latest Run of the latest user message is stuck after it dispatched, and the owner sends a Continue request
- **THEN** admission expires that Run with a terminal `run.expired`
- **AND** the Continue check reads `expired` and the API admits the Continue Run

### Requirement: A follow-up request is validated before any write

The `action` field MUST be `continue` or `regenerate`. A malformed request MUST get a 400 answer. A
Continue request MUST NOT name `selector` or `effort`. It can name `candidate: "next"`, and no other
`candidate` value. A Regenerate request can name `selector` and `effort`. An omitted `selector` MUST
use the stored selection of the Chat, as `model-roles` defines. A request that names `modelId` MUST
get 400.

A selector, effort, or permission mode that a chat send cannot use MUST get the chat-send error. An
absent `permissionMode` MUST mean `default`. A refused request MUST write nothing, except the expiry
of a stuck Run that single-flight admission performs.

#### Scenario: Continue rejects a model choice

- **WHEN** a Continue request names `selector` or `effort`
- **THEN** the API answers 400 and creates no Run

#### Scenario: Regenerate needs a model

- **WHEN** a Regenerate request has no `selector`, and the Chat stores the selection `@coding`
- **THEN** the Regenerate Run uses `@coding`
- **AND** a Regenerate request that names `modelId` gets 400 and creates no Run

#### Scenario: Regenerate validates like a chat send

- **WHEN** a Regenerate request names a selector that the catalog does not offer, an effort that the model does not declare, or a disabled mode
- **THEN** the API answers with the error that a chat send with the same values gets
- **AND** it creates no Run

#### Scenario: Continue validates its permission mode

- **WHEN** a Continue request names a mode that `tools.permissionModes` does not enable
- **THEN** the API answers with the error that a chat send with that mode gets
- **AND** it creates no Run

#### Scenario: Continue rejects an unknown candidate value

- **WHEN** a Continue request names `candidate: "first"`
- **THEN** the API answers 400 and creates no Run

### Requirement: Continue applies only to the reply of a failed, cancelled, or expired Run

Continue MUST start only when the latest Run of the message is `failed`, `cancelled`, or `expired`.
The reply MUST exist, its usage MUST name that Run, and its usage status MUST NOT be `completed`.
Any other state MUST get a 409 answer. A Continue Run MUST use the selector of that Run, the model and the
effort of its last segment, and its selected effort. With `candidate: "next"`, it MUST use the next candidate of `model-roles`, and the
latest Run MUST be `failed`. The chat-send checks MUST accept the model and the effort again.

#### Scenario: A completed turn cannot be continued

- **WHEN** the latest Run of the latest user message is `completed`, and the owner sends a Continue request
- **THEN** the API answers 409 and creates no Run

#### Scenario: Continue keeps the model and the effort

- **WHEN** a `failed` Run used model `A` with effort `high`, and the owner continues it with `permissionMode: "bypass"`
- **THEN** the Continue Run records model `A`, effort `high`, and mode `bypass`

#### Scenario: A turn with no reply cannot be continued

- **WHEN** the latest Run of the latest user message failed before its dispatch, so the message has no reply
- **THEN** a Continue request gets 409

#### Scenario: Continue after a Regenerate that failed before dispatch is refused

- **WHEN** a reply belongs to a Run on model `A`, and a later Regenerate on model `B` failed before its dispatch
- **THEN** a Continue request gets 409, because the reply does not belong to the latest Run

#### Scenario: Continue on a removed model is refused

- **WHEN** the operator removed the model of the failed Run from the catalog, and the owner sends a Continue request
- **THEN** the API answers with the chat-send error for that model and creates no Run

#### Scenario: Continue after a switch keeps the effort of the last segment

- **WHEN** a `@coding` Run at effort `xhigh` switched to `deepseek` at `medium` and then failed, and the owner continues it
- **THEN** the Continue Run uses `deepseek` at `medium`, and its selected effort is `xhigh`

#### Scenario: Continue on the next candidate of a cancelled Run is refused

- **WHEN** the latest Run of a `@coding` turn is `cancelled`, and the owner sends Continue with `candidate: "next"`
- **THEN** the API answers 409 and creates no Run

### Requirement: Continue keeps the completed steps of the reply

A settled tool part is a tool part with a result. The kept parts MUST be the reply's parts through
the last settled tool part, and the context items directly after it. The parts after them are the
unfinished step. The dispatch of a Continue Run MUST remove the unfinished step from the reply. The
event log of the source Run MUST keep it. When the reply has no settled tool part, Continue MUST
keep no part.

#### Scenario: Continue drops only the unfinished step

- **WHEN** a `failed` reply holds three settled tool calls with their text and reasoning, then partial text and partial reasoning
- **THEN** the kept parts are the three steps in stored order
- **AND** after the Continue Run dispatches, the reply does not hold the partial text and the partial reasoning
- **AND** the event log of the failed Run still holds them

#### Scenario: A Continue that fails before dispatch changes nothing

- **WHEN** a Continue Run fails during preparation before its first model request
- **THEN** the reply keeps every part, the unfinished step included

#### Scenario: Continue keeps an unknown outcome as recorded

- **WHEN** the last settled tool part of a `failed` reply holds an `outcome_unknown` result for `bash`
- **THEN** the first model request of the Continue Run gives the model that result as recorded
- **AND** the Continue Run does not execute that command again

### Requirement: Continue requests the next step of the same turn

The first model request of a Continue Run MUST carry the history through the triggering user
message, then the kept parts. It MUST build them through the projection of `turn-replay`. Each kept
step MUST be one assistant message with its reasoning, its text, and its tool calls, then one
message with their results. Kept results MUST be complete. The request MUST NOT add a user-role
message, except a kept context item. The Run MUST NOT execute a kept call again. A Continue with
`candidate: "next"` keeps no parts. Its request carries the failed reply as history, then the host
message of `model-roles`.

#### Scenario: Continue sends the kept steps with their reasoning

- **WHEN** the owner continues a `failed` Run whose kept step holds a reasoning part with encrypted provider metadata and two parallel tool calls
- **THEN** the first model request carries one assistant message with that reasoning part, its metadata, and both calls, then both results
- **AND** the request has no user-role message after those results

#### Scenario: Sequential steps stay separate

- **WHEN** the kept parts hold call `t1` from one model response and call `t2` from the next response, with no text or reasoning between them
- **THEN** the first model request carries `t1` and its result, then a second assistant message with `t2`, then its result

#### Scenario: Continue sends long results in full

- **WHEN** the kept parts hold tool results of more than 100,000 characters in total
- **THEN** the first model request carries each kept result as the live loop sent it, with no omission marker

#### Scenario: Continue does not repeat a settled call

- **WHEN** the kept parts hold a settled `edit` call
- **THEN** the Continue Run does not invoke `edit` for that call
- **AND** the model receives the stored result of that call

#### Scenario: Kept parts that do not fit fail the Run

- **WHEN** the history through the triggering user message and the kept parts do not fit the model window, even after compaction of the history
- **THEN** the Continue Run fails with the context-incompatible error
- **AND** no compaction absorbs a kept part

#### Scenario: Continue on the next candidate sends the failed reply as history

- **WHEN** the owner continues a `failed` `@coding` Run on `codex` with `candidate: "next"`, and its reply holds a settled `edit` call and a reasoning part
- **THEN** the first request to `sonnet` carries the `edit` call and its result, then the host message
- **AND** it carries no reasoning part of `codex`, and `edit` does not run again

### Requirement: The Continue Run log starts with the kept parts

The event log of the Continue Run MUST record the kept parts before its first model event. Each
attempt of the first segment of the Continue Run MUST start from those parts. A later segment,
which a delivery of `run-steering` starts, MUST NOT start from them. A stream replay of the first
segment MUST show the kept text, reasoning, and tool parts, then the new parts. The reply of the
first segment MUST hold the kept parts once, then the new parts, in stored order.

#### Scenario: A refresh shows the whole continued reply

- **WHEN** the owner reloads the Chat while a Continue Run streams its second new step
- **THEN** the resumed stream shows the kept text, reasoning, and tool parts, then the new parts

#### Scenario: A worker death does not lose the kept parts

- **WHEN** the worker of a Continue Run dies after its dispatch and after it stored an in-Run item
- **AND** the queue starts a second attempt of that Run
- **THEN** the second attempt starts from the same kept parts
- **AND** the final reply holds each kept part and each kept context item once, then the parts of the second attempt

#### Scenario: A failed Continue keeps the kept parts

- **WHEN** a Continue Run fails after one new settled tool call
- **THEN** the reply holds the kept parts, then the new step

#### Scenario: A delivered message does not repeat the kept parts

- **WHEN** a Continue Run delivers a steer after its first new step
- **THEN** the reply of the delivered message holds only the parts of the second segment

### Requirement: Regenerate replaces the reply of the latest turn

Regenerate MUST start when the latest Run of the message is terminal, with any terminal status. Its
first model request MUST start from the history through the triggering user message. Its dispatch
MUST replace the reply, also a `completed` reply of an earlier Run. The old reply MUST stay only in
the event log of its Run. A Regenerate that ends before its dispatch MUST leave the old reply.

#### Scenario: Regenerate replaces a completed answer with another model

- **WHEN** the owner regenerates a `completed` reply of model `A` with model `B`
- **THEN** the first model request of the new Run carries no part of the old reply
- **AND** after the new Run completes, the reply holds only the new answer and records model `B`

#### Scenario: Regenerate a turn with no reply

- **WHEN** the first Run of the latest user message failed at pickup, so the message has no reply, and the owner regenerates it
- **THEN** the API admits the Regenerate Run and its dispatch creates the reply

#### Scenario: A Regenerate that fails before dispatch keeps the old reply

- **WHEN** a Regenerate Run fails during preparation before its first model request
- **THEN** the old reply keeps its parts, its usage, and its eligibility

#### Scenario: A later attempt keeps its own salvaged answer

- **WHEN** the first attempt of a Regenerate Run completes the reply, and the Run stays live and starts a second attempt
- **THEN** the second attempt does not reset the reply, and the Run settles `completed` with that answer

#### Scenario: A replaced completed reply leaves search

- **WHEN** a Regenerate Run replaces a `completed` reply and then completes
- **THEN** `search_conversations` and `conversation_read` return no result for that reply

### Requirement: Regenerate discloses non-read-only tool calls to the new attempt

A tool part with a recorded classification other than `read_only` is a non-read-only call. A part
with `classification: null` is not. A part with no `classification` field is one, unless its tool
name resolves to a `read_only` tool. When the replaced reply holds one, the Regenerate MUST add the
`regenerate` notice to the triggering user message, once for each turn.

#### Scenario: A discarded bash call adds the notice

- **WHEN** the owner regenerates a reply that holds a `bash` call that started
- **THEN** the triggering user message holds the `regenerate` notice after the Regenerate Run dispatches
- **AND** the model receives the notice inside the triggering user message

#### Scenario: A read-only reply adds no notice

- **WHEN** the owner regenerates a reply whose tool calls are all `read_only`
- **THEN** the turn gets no notice

#### Scenario: A call that did not start adds no notice

- **WHEN** the only tool part of the replaced reply records `classification: null`, because the availability gate or the permission policy rejected it
- **THEN** the turn gets no notice

#### Scenario: A second Regenerate keeps the notice

- **WHEN** a turn already holds the notice, and the owner regenerates a reply that holds only `read_only` calls
- **THEN** the turn still holds one notice, and the new request carries it

### Requirement: The follow-up Run's usage replaces the reply's usage

The usage of the follow-up Run MUST replace the usage of the reply and MUST name the follow-up Run in
`runId`. The usage MUST NOT add the spend of an earlier Run. When the replaced reply recorded usage,
the new usage MUST record `complete: false`. The effective-context action of the reply MUST show the
receipts of the follow-up Run. A Continue on the next candidate MUST NOT replace the usage of the
failed reply. It keeps that reply, and the new reply records the usage of the new model.

#### Scenario: Continue usage counts only the new Run

- **WHEN** a Continue Run completes after a `failed` Run that reported usage
- **THEN** the usage of the reply is the aggregate of the requests of the Continue Run only
- **AND** its `runId` names the Continue Run, and it records `complete: false`

#### Scenario: The context action follows the reply's Run

- **WHEN** the owner opens the effective-context action of a reply that a Continue Run finalized
- **THEN** it shows the receipts of the Continue Run

#### Scenario: The failed reply keeps its usage after a switch

- **WHEN** a Continue on the next candidate completes after a `failed` Run on `codex`
- **THEN** the reply of `codex` keeps its usage and its model
- **AND** the reply of the new model records the usage of the Continue Run

### Requirement: The chat history read reports the latest Run

`GET /api/v1/chats/:id/messages` MUST return `latestRun` from the same read as the messages. It is
the newest Run of the Chat. It has its id, kind, message id, status, and follow-up action. It also has
its model selector, model id, effort, accepted permission mode, and error. The kind MUST be `turn` or
`compaction`. The error MUST be the terminal message that the stream of the Run sends, or `null`. It
MUST be `null` for a Chat with no Run. It MUST follow the owner scope of the history read.

#### Scenario: The latest Run of a failed turn is reported

- **WHEN** the latest Run of a Chat failed before it dispatched, with model `A` and mode `bypass`
- **THEN** the history read reports that Run with status `failed`, model `A`, and mode `bypass`
- **AND** it reports the failure message of that Run as its error

#### Scenario: Another owner's latest Run is not reported

- **WHEN** user B reads the history of a Chat of user A
- **THEN** the API returns the current not-found response and no `latestRun`

#### Scenario: A compaction Run is the latest Run

- **WHEN** the newest Run of a Chat is a completed compaction Run
- **THEN** the history read reports that Run with kind `compaction` and message id `null`

#### Scenario: The latest Run names its role

- **WHEN** the latest Run of a Chat used `@coding` and failed on `codex`
- **THEN** the history read reports selector `@coding` and model id `codex`

### Requirement: A compaction Run offers no follow-up action

When `latestRun` is a compaction Run, the web MUST NOT show Continue or Regenerate. When that Run
is `failed` or `expired`, the transcript MUST show its error after the last turn. The web MUST NOT
show an assistant message or a reply notice for a compaction Run.

#### Scenario: A failed compaction shows its error

- **WHEN** the latest Run is a compaction Run that failed
- **THEN** the transcript shows the error of that Run and no Continue or Regenerate

#### Scenario: A compaction Run in a hidden tab raises no reply notice

- **WHEN** a compaction Run completes while the owner views another Chat
- **THEN** the web shows no reply notice and no unseen mark for it

#### Scenario: A reload during a compaction Run

- **WHEN** the owner reloads the page while a compaction Run is live
- **THEN** the transcript shows the compaction Run as live and shows no empty assistant message

### Requirement: The latest turn shows Continue and Regenerate actions

For a terminal `latestRun` of a turn that no checkpoint absorbed, the web MUST show Regenerate on the
latest turn. It MUST show Continue only when three conditions are true. `latestRun` produced the reply and is
`failed`, `cancelled`, or `expired`. The reply is not `completed`. The reply holds a settled tool part. It
MUST show "Continue on next candidate" when `model-roles` offers it. A latest turn with no visible reply MUST show a failed-turn row with the error of `latestRun` and
Regenerate. The row MUST also show Continue on next candidate when it applies. Older turns MUST NOT
show an action. Continue MUST send the permission mode of the composer.

#### Scenario: A failed agentic turn shows both actions

- **WHEN** the latest Run failed after two settled tool calls
- **THEN** the latest turn shows Continue and Regenerate

#### Scenario: A failed turn with no completed step shows only Regenerate

- **WHEN** the latest Run, with an exact selector, failed before any tool call settled
- **THEN** the latest turn shows Regenerate and does not show Continue

#### Scenario: A turn with no reply shows Regenerate

- **WHEN** the latest Run failed at pickup, so the latest turn has no reply
- **THEN** the latest turn shows Regenerate

#### Scenario: A failed turn with an empty reply shows its cause

- **WHEN** the latest Run failed at its provider call and stored a reply with no visible content
- **THEN** the latest turn shows a failed-turn row with the error of the Run and Regenerate
- **AND** the row stays visible without hover

#### Scenario: Older turns show no action

- **WHEN** a Chat has two turns
- **THEN** only the second turn shows the actions

#### Scenario: Continue sends the composer mode

- **WHEN** the composer shows mode `bypass`, and the owner clicks Continue
- **THEN** the request names `permissionMode: "bypass"` and no selector or effort

#### Scenario: A compacted turn shows no action

- **WHEN** a compaction Run, or a compaction at the final answer, absorbed the latest turn
- **THEN** the latest turn shows neither Continue nor Regenerate

#### Scenario: A failed role turn offers the next candidate

- **WHEN** the latest Run of a `@coding` turn failed before any tool call settled, and a next candidate exists
- **THEN** the latest turn shows "Continue on next candidate" and Regenerate

### Requirement: Regenerate offers a repeat and a choice of settings

A plain Regenerate click MUST send no `selector` and no `effort`, so the stored selection of the
Chat applies. It MUST send the accepted permission mode of `latestRun`. The Regenerate menu MUST offer
the selection, effort, and permission-mode controls of the composer. A choice in the menu MUST also
set the composer selection. The submit action of the menu MUST send the composer values.

#### Scenario: A plain click repeats the old settings

- **WHEN** the Chat stores `@coding` at effort `low`, and the latest Run used mode `bypass`
- **AND** the composer shows a new pick `B`, and the owner clicks Regenerate
- **THEN** the request names no selector and no effort, and it names mode `bypass`
- **AND** the Regenerate Run uses `@coding` at effort `low`, and the composer still shows `B`

#### Scenario: A menu choice sets the composer

- **WHEN** the owner opens the Regenerate menu, selects model `C`, and submits
- **THEN** the request names `selector` `C`
- **AND** the composer shows model `C` after the request

### Requirement: Regenerate asks before it discards non-read-only calls

Before a Regenerate whose reply holds a non-read-only call, the web MUST ask for confirmation. On
the web, a tool part with no `classification` field counts as one. The dialog MUST name each such
call by its tool name. It MUST say that the effects stay and that the new answer cannot see them. A
cancel MUST send no request.

#### Scenario: A reply with edits asks first

- **WHEN** the owner clicks Regenerate on a reply that holds two `edit` calls and one `bash` call that started
- **THEN** a dialog names `edit` and `bash` before any request
- **AND** a cancel leaves the reply and sends nothing

#### Scenario: A read-only reply regenerates at once

- **WHEN** the owner clicks Regenerate on a reply whose tool calls all record `classification: "read_only"`
- **THEN** the web sends the request without a dialog

### Requirement: The web shows one reply during a follow-up Run

While a follow-up Run of the latest turn is not terminal, the web MUST NOT show the replaced reply
beside its stream. After a reload, the web MUST use `latestRun` to hide that reply.

#### Scenario: A reload before the follow-up dispatch shows one reply

- **WHEN** the owner reloads the Chat while a Regenerate Run is still `queued`
- **THEN** the web shows the resumed stream of the Regenerate Run
- **AND** it does not show the old reply next to it

### Requirement: A turn that a host message started accepts follow-up Runs

A host message of `background-jobs` that has a Run MUST accept a follow-up Run under the rules
for a user message. The request MUST name the id of the host message. A Continue or a Regenerate
of that turn MUST keep the host message and its `job` context items.

#### Scenario: A Continue after a host-started Run failed

- **WHEN** a notice starts a Run, the Run fails, and the owner chooses Continue
- **THEN** the Continue Run starts on the host message, and its first request carries the same `job` context item
