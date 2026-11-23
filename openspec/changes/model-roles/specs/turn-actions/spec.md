## MODIFIED Requirements

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
Any other state MUST get a 409 answer. A Continue Run MUST use the selector, the model, and the effort
of that Run. With `candidate: "next"`, it MUST use the next candidate of `model-roles`, and the
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

#### Scenario: Continue on the next candidate of a cancelled Run is refused

- **WHEN** the latest Run of a `@coding` turn is `cancelled`, and the owner sends Continue with `candidate: "next"`
- **THEN** the API answers 409 and creates no Run

### Requirement: The follow-up Run's usage replaces the reply's usage

The usage of the follow-up Run MUST replace the usage of the reply and MUST name the follow-up Run in
`runId`. The usage MUST NOT add the spend of an earlier Run. When the replaced reply recorded usage,
the new usage MUST record `complete: false`. The effective-context action of the reply MUST show the
receipts of the follow-up Run. A Continue on the next candidate MUST NOT replace the usage of the
failed reply. Its model switch closes that reply, and the new reply records the usage of the new model.

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

### Requirement: The latest turn shows Continue and Regenerate actions

For a terminal `latestRun` of a turn that no checkpoint absorbed, the web MUST show Regenerate on the
latest turn. It MUST show Continue only when three conditions are true. `latestRun` produced the reply and is
`failed`, `cancelled`, or `expired`. The reply is not `completed`. The reply holds a settled tool part. It
MUST show "Continue on next candidate" when `model-roles` offers it. A latest turn with no visible
reply MUST show a failed-turn row with the error of `latestRun` and Regenerate. Older turns MUST NOT
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
