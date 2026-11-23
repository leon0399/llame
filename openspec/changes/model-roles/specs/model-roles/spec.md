## Purpose

Operator-defined model roles let a send name an ordered list of models. The Chat stores its
selection and holds a fallback until a revert time. The owner can move a failed Run, or a Run in a
quota wait, to the next candidate.

## ADDED Requirements

### Requirement: The operator declares model roles

The config MUST accept a top-level `modelRoles` object. Each key is a role name that matches
`^[a-z][a-z0-9_-]{0,31}$`. Each value MUST hold a non-empty `candidates` array of
`{ model, effort? }` objects. It can hold `allowPaidFallback` and `failover`, which `model-failover`
owns. A send names a role as `@` and the role name.

#### Scenario: A role with two candidates boots

- **WHEN** `modelRoles.coding.candidates` names `codex` with effort `high`, then `sonnet`
- **THEN** startup succeeds, and `@coding` is a valid selector

#### Scenario: A role name with an upper-case letter fails startup

- **WHEN** `modelRoles` has the key `Coding`
- **THEN** startup fails, and the error names `modelRoles.Coding`

### Requirement: Role candidates are validated at startup

Each candidate `model` MUST name a `models[].id`. A model MUST NOT occur twice in one role. A
candidate `effort` MUST equal a declared level `value` of its model. A candidate of a model with no
`reasoning` MUST NOT declare `effort`. An empty `candidates` array MUST fail startup. Each failure
MUST name the role and the field.

#### Scenario: A candidate names an unknown model

- **WHEN** a candidate of `@coding` names `gpt-9`, and no `models[]` entry has that id
- **THEN** startup fails, and the error names `modelRoles.coding.candidates[0].model`

#### Scenario: A candidate effort is not declared by its model

- **WHEN** a candidate names model `sonnet` with effort `ultra`, and `sonnet` does not declare `ultra`
- **THEN** startup fails, and the error names the candidate and its `effort`

#### Scenario: The same model twice in one role

- **WHEN** `@coding` lists `codex` as its first and its third candidate
- **THEN** startup fails, and the error names `@coding`

### Requirement: A model id does not start with the role sign

A `models[].id` MUST NOT start with `@`. Startup MUST fail and name the model entry when one does.
Thus a selector that starts with `@` always names a role.

#### Scenario: A model id with the role sign

- **WHEN** a `models[]` entry has the id `@fast`
- **THEN** startup fails, and the error names that entry

### Requirement: A send names a selector or uses the stored selection

A chat send MUST accept an optional top-level `selector`: `@` with a role name, or a model id. The
API MUST validate it before it creates a message or a Run. A send without `selector` MUST use the
Chat's stored selection. A Chat with no stored selection MUST use `defaults.selector`. A request
with `modelId` MUST get 400.

#### Scenario: A send names a role

- **WHEN** the owner sends a message with `selector: "@coding"`
- **THEN** the API creates the message and a Run on the first candidate of `@coding`

#### Scenario: A send omits the selector

- **WHEN** the Chat stores the selection `@coding`, and the owner sends a message with no `selector`
- **THEN** the Run uses `@coding`

#### Scenario: An unknown selector

- **WHEN** a send names `@missing`, or a model id that the catalog does not offer
- **THEN** the API answers 422 with `code = "model_not_available"`
- **AND** it creates no message and no Run

#### Scenario: A blank selector

- **WHEN** a send names a blank or non-string `selector`
- **THEN** the API answers 400 and creates no message and no Run

#### Scenario: A send with the old field

- **WHEN** a send names `modelId`
- **THEN** the API answers 400 and creates no message and no Run

#### Scenario: A first send with no selector

- **WHEN** the first send of a new Chat names no `selector`, and `defaults.selector` is `@coding`
- **THEN** the Run uses `@coding`, and the Chat stores `@coding`

### Requirement: A selector resolves to one model at admission

A model-id selector MUST resolve to that model. A role selector MUST resolve to the held model when
the Chat holds a fallback of that role. In other cases it MUST resolve to the first candidate. A hold whose model is no longer a
candidate of the role MUST be cleared. The Run MUST record the selector and the resolved model.

#### Scenario: A held Chat resolves to the held model

- **WHEN** the Chat holds `sonnet` for `@coding` with a `revertAt` in the future, and the owner sends
  with no `selector`
- **THEN** the Run records `selector` `@coding` and `modelId` `sonnet`

#### Scenario: The held model left the role

- **WHEN** the Chat holds `sonnet` for `@coding`, and the operator removed `sonnet` from `@coding`
- **THEN** the next Run clears the hold and uses the first candidate

### Requirement: An exact model selector never switches

A Run whose selector is a model id MUST NOT change its model. It MUST NOT offer Continue on next
candidate. A failure of that model MUST fail the Run, or make it wait, as `provider-failures` and
`quota-wait` define.

#### Scenario: An exact model is unavailable

- **WHEN** a Run with selector `codex` fails with `overloaded` after its request retries
- **THEN** the Run is `failed` with `error.code` `overloaded`, and no other model receives a request

### Requirement: The Chat stores its selection

The Chat MUST store one selection: `selector`, `effort`, and an optional fallback hold
`{ modelId, effort, revertAt }`. Each accepted send, chat creation, or Regenerate MUST write it in
the transaction that creates its Run. The Chat read MUST return it to the owner.

#### Scenario: Another device shows the same selection

- **WHEN** the owner sends with `@coding` from one device and then opens the Chat on another device
- **THEN** the Chat read returns the selection `@coding`, and the picker shows `@coding`

#### Scenario: A refused send stores no selection

- **WHEN** a send that names `@coding` gets 422 for an undeclared effort
- **THEN** the stored selection of the Chat does not change

### Requirement: The selection of a Chat belongs to its owner

Only the owner of a Chat MUST read or change its selection. A request for the Chat of another
owner MUST get 404 and MUST NOT reveal the selection.

#### Scenario: Another owner reads a Chat

- **WHEN** user B reads a Chat of user A
- **THEN** the API answers 404, and the response holds no selection

### Requirement: A role send validates effort against the resolved model

The `effort` of a send MUST be a declared level of the resolved model. That model is the held model
when the Chat holds a fallback, and the first candidate in other cases. An omitted `effort` MUST resolve to the
`effort` of that candidate. A candidate with no `effort` MUST use the model's `defaultEffort`.

#### Scenario: An omitted effort on a role send

- **WHEN** the first candidate of `@coding` is `codex` with effort `high`, and a send omits `effort`
- **THEN** the Run uses effort `high`

#### Scenario: An effort that only the held model declares

- **WHEN** the Chat holds `sonnet`, and a send names an effort that `sonnet` declares and `codex` does not
- **THEN** the API accepts the send, and the Run uses that effort on `sonnet`

### Requirement: The effort after a switch follows the selected effort

After a switch, the new model MUST use the effort of the Run when the new model declares that level.
In other cases it MUST use the `effort` of its candidate, then its own `defaultEffort`. A model with
no `reasoning` MUST get no effort. The reply MUST record the effort that it used.

#### Scenario: The new model declares the selected level

- **WHEN** a Run at effort `high` switches to `sonnet`, and `sonnet` declares `high`
- **THEN** the requests to `sonnet` carry effort `high`

#### Scenario: The new model does not declare the selected level

- **WHEN** a Run at effort `xhigh` switches to `deepseek`, whose candidate declares effort `medium`
- **THEN** the requests to `deepseek` carry effort `medium`, and its reply records `medium`

### Requirement: A switch holds the Chat on the new candidate

A switch to a later candidate MUST store a fallback hold on the Chat in the transaction that opens
the switch. The hold MUST name the new model, its effort, and `revertAt`. `revertAt` MUST be the
failure's reset time, else its retry hint, else 5 minutes after the switch.

#### Scenario: A usage limit sets the hold to the reset

- **WHEN** a `@coding` Run switches after a Codex usage limit that resets at 14:00
- **THEN** the Chat holds the new candidate with `revertAt` 14:00

#### Scenario: An auth failure sets a short hold

- **WHEN** a `@coding` Run switches after an `auth` failure with no reset time and no hint
- **THEN** `revertAt` is 5 minutes after the switch

### Requirement: The Chat returns to the primary after revertAt

The first Run that starts after `revertAt` MUST clear the hold and resolve the role again. The
switch back MUST use the model-switch item of `model-system-prompts`. A Run MUST NOT switch back to
the primary before it ends.

#### Scenario: A send after the reset

- **WHEN** the Chat holds `sonnet` for `@coding` until 14:00, and the owner sends at 14:05
- **THEN** the Run uses the first candidate, the hold is cleared, and the request carries a model-switch item

#### Scenario: A long Run passes revertAt

- **WHEN** a Run on the held model is still live after `revertAt`
- **THEN** each later request of that Run uses the held model

### Requirement: An owner pick clears the hold

A send, chat creation, or Regenerate that names `selector` MUST clear the hold. A role selector then
resolves to the first candidate. A send that changes only `effort` MUST keep the hold and MUST store
the new effort on the hold.

#### Scenario: The owner picks the role again

- **WHEN** the Chat holds `sonnet` for `@coding`, and the owner sends with `selector: "@coding"`
- **THEN** the Run uses the first candidate, and the Chat holds no fallback

#### Scenario: The owner changes only the effort

- **WHEN** the Chat holds `sonnet` for `@coding`, and the owner sends with no `selector` and effort `low`
- **THEN** the Run uses `sonnet` at effort `low`, and the hold stays with effort `low`

### Requirement: A pending item resolves its selector when its Run starts

A queue item and a job notice MUST store a selector, not a resolved model. The Run that the item
starts MUST resolve that selector against the hold of the Chat at that time. A job notice MUST use the
selector of the Run that started its job.

#### Scenario: A queue item after a switch

- **WHEN** the owner queues an item for `@coding`, and the live Run then switches the Chat to `sonnet`
- **THEN** the Run of the queue item starts on `sonnet`

### Requirement: An owner fork copies the selection and the hold

An owner fork MUST copy the selection of its source Chat, with its hold and `revertAt` unchanged. A
shared fork MUST NOT copy a selection or a hold. Its first send without `selector` MUST use
`defaults.selector`.

#### Scenario: A fork of a held Chat

- **WHEN** the owner forks a Chat that holds `sonnet` for `@coding` until 14:00
- **THEN** the fork holds `sonnet` for `@coding` until 14:00

#### Scenario: A shared fork gets no hold

- **WHEN** user B forks a public share of a Chat that holds `sonnet`
- **THEN** the fork of user B has no stored selection and no hold

### Requirement: A model switch inside a Run opens a segment

A model switch inside a Run MUST cut the failed send as `provider-failures` defines and close the
reply. It MUST store a host message that carries the switch item and make it the message of the Run.
It MUST start a new attempt on the new model, with no new claim. The Run MUST record the new model
and effort.

#### Scenario: The transcript after a switch

- **WHEN** a `@coding` Run fails on `codex` and switches to `sonnet`
- **THEN** the Chat holds the reply of `codex`, a host message with the switch item, and a reply of `sonnet`
- **AND** each reply records the model that served it

#### Scenario: The failed send is not kept

- **WHEN** a send streams text with no tool call and then fails, and the Run switches
- **THEN** the closed reply does not hold that text, and no later request carries it

#### Scenario: Settled tool calls stay

- **WHEN** a send streams a `read` call that settles, then breaks, and the Run switches
- **THEN** the closed reply holds the `read` part with its result
- **AND** the first request on the new model carries the `read` call with its result

### Requirement: The switch item names both models and the reason

The host message MUST carry one context item with producer `effective-context-change`, form `notice`,
and cause `failover`. Its text MUST name the prior model, the new model, and the failure label of
`provider-failures`. It MUST tell the model to check whether earlier tool calls took effect before it
repeats them.

#### Scenario: A switch after an overload

- **WHEN** a Run switches from `codex` to `sonnet` after `overloaded`
- **THEN** the switch item names both models and the label of `overloaded`
- **AND** the first request on `sonnet` carries it after the closed reply

### Requirement: A switch is a Run event

A switch MUST append one `model.switched` event. The event MUST name the prior model, the new model,
the failure class, and the host message. It MUST also name the cause: `owner` for an owner action,
`policy` for an automatic switch. A reload MUST show the switch.

#### Scenario: A reload after a switch

- **WHEN** the owner reloads a Chat after a switch from `codex` to `sonnet`
- **THEN** the event stream replays the `model.switched` event, and the transcript shows the boundary

### Requirement: Each request normalizes tool-call ids

Each model request MUST map each replayed tool-call id to an id that matches `^[a-zA-Z0-9_-]{1,64}$`.
The map MUST be deterministic for one request and MUST make each id unique. The system MUST NOT change
a stored id.

#### Scenario: A foreign id reaches another wire

- **WHEN** a reply on one wire stored a tool-call id with a `.` character, and a later request goes to another wire
- **THEN** that request carries an id that matches the pattern for both the call and its result
- **AND** the stored part keeps its original id

### Requirement: The owner continues a failed reply on the next candidate

A Continue request with `candidate: "next"` MUST start a Continue Run on the next candidate of the
failed Run. Its first segment MUST be a model switch with cause `owner`. The Chat MUST hold the new
candidate. The latest Run MUST be `failed`, and its selector MUST be a role.

#### Scenario: Continue on the next candidate

- **WHEN** a `@coding` Run on `codex` failed after two settled tool calls, and the owner sends Continue with `candidate: "next"`
- **THEN** a Continue Run starts on `sonnet` with the two settled calls kept
- **AND** the Chat holds `sonnet`

#### Scenario: A Run with an exact selector

- **WHEN** the failed Run has the selector `codex`, and the owner sends Continue with `candidate: "next"`
- **THEN** the API answers 409 and creates no Run

### Requirement: The owner moves a waiting Run to the next candidate

`POST /api/v1/chats/:chatId/runs/:runId/next-candidate` MUST end the quota wait of a role Run in
`awaiting_quota`. The same Run MUST continue in a model switch with cause `owner`. A Run in another
state MUST get 409. A Run of another owner MUST get 404.

#### Scenario: A weekly limit ends early

- **WHEN** a `@coding` Run waits for a Codex reset in five days, and the owner calls the action
- **THEN** the Run leaves `awaiting_quota`, and its next request goes to `sonnet`

#### Scenario: Another owner calls the action

- **WHEN** user B calls the action for a waiting Run of user A
- **THEN** the API answers 404, and the Run stays in `awaiting_quota`

### Requirement: The next candidate follows the current model in the role

The next candidate MUST be the candidate after the current model in the role's current config. The
chain MUST NOT wrap to the first candidate. When the current model is the last candidate, or is not in
the role, no next candidate exists, and the action MUST get 409.

#### Scenario: The last candidate fails

- **WHEN** a `@coding` Run on its last candidate fails, and the owner sends Continue with `candidate: "next"`
- **THEN** the API answers 409 and creates no Run

### Requirement: The web offers the next candidate

The latest turn MUST show "Continue on next candidate" when the next-candidate action applies. The
quota-wait box MUST show the same action. The action MUST name the next model and MUST label it paid
when its resolved billing is `usage`.

#### Scenario: A paid next candidate

- **WHEN** the next candidate of a failed `@coding` Run has billing `usage`
- **THEN** the action names that model and shows a paid label

### Requirement: The models endpoint publishes the roles

`GET /api/v1/models` MUST return `roles`. Each role has its selector and its candidates in order.
Each candidate has its `modelId`, its declared `effort` when present, and `paid`. `paid` MUST be true
when the resolved billing of the model is `usage`. The response MUST NOT return any other billing data.

#### Scenario: The picker reads a role

- **WHEN** the config declares `@coding` with `codex` and `openrouter-sonnet`
- **THEN** the response holds `@coding` with both candidates in order, and `paid` is true only for the `usage` model

### Requirement: The web picker shows the stored selection

The picker MUST offer each role and each model. It MUST show the stored selection of the Chat. When
the Chat holds a fallback, the picker MUST show the role, the held model, and the local `revertAt`.
A pick in the picker MUST make the next send name `selector`.

#### Scenario: A held Chat in the picker

- **WHEN** the Chat holds `sonnet` for `@coding` until 14:00
- **THEN** the picker shows `@coding`, `sonnet`, and 14:00

### Requirement: Existing Chats and Runs get a selector

For each Chat with a turn Run, the migration MUST store a selection with no hold. The selection
holds the model id and the effort of the latest turn Run. It MUST set the `selector` of each Run to its `modelId`. It MUST
change the model id of each pending item and job to a selector with the same value. It MUST NOT delete
a Chat, a message, or a Run.

#### Scenario: An old Chat keeps its model

- **WHEN** the migration runs on a Chat whose latest turn Run used `codex` at effort `high`
- **THEN** the Chat stores the selector `codex` with effort `high`, and its next send without `selector` uses `codex`
