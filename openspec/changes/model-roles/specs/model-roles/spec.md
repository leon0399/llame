## Purpose

Operator-defined model roles let a send name an ordered list of models. The Chat stores its model
selection and a fallback hold until a revert time. The owner can move a failed Run, or a Run in a
quota wait, to the next candidate.

## ADDED Requirements

### Requirement: The operator declares model roles

The config MUST accept a top-level `modelRoles` object. Each key is a role name that matches
`^[a-z][a-z0-9_-]{0,31}$`. Each value MUST hold a non-empty `candidates` array of
`{ model, effort? }` objects. It can hold `allowPaidFallback` and `failover`, which `model-failover`
owns. A send names a role as `@` and the role name.

#### Scenario: A role with two candidates boots

- **WHEN** `modelRoles.coding.candidates` names `codex` with effort `high`, then `sonnet`
- **THEN** startup succeeds, and `@coding` is a valid model selector

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
Thus a model selector that starts with `@` always names a role. Any other model selector is an exact
selector.

#### Scenario: A model id with the role sign

- **WHEN** a `models[]` entry has the id `@fast`
- **THEN** startup fails, and the error names that entry

### Requirement: A send names a selector or uses the stored selection

A chat send MUST accept an optional top-level `selector`, which is a model selector. The API MUST
validate it before it creates a message or a Run. A send without `selector` MUST use the stored
selection of the Chat, or `defaults.selector` when the Chat stores none. A request with `modelId` MUST
get 400.

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

#### Scenario: No selector and no default

- **WHEN** a send names no `selector`, the Chat stores no selection, and `defaults.selector` is unset
- **THEN** the API answers 503 with `code = "model_configuration_invalid"`
- **AND** it creates no message and no Run

### Requirement: A selector resolves to one model at admission

An exact selector MUST resolve to its model. A role selector MUST resolve to the held model when a
fallback hold for that role applies. A hold applies before its `revertAt` while its model is still a
candidate of the role. In other cases the role MUST resolve to its first candidate. The
Run MUST record the model selector, the resolved model, and the effort that admission resolved.

#### Scenario: A held Chat resolves to the held model

- **WHEN** the Chat has a fallback hold on `sonnet` for `@coding` with a `revertAt` in the future, and the owner sends with no `selector`
- **THEN** the Run records `selector` `@coding` and `modelId` `sonnet`

#### Scenario: The held model left the role

- **WHEN** the Chat has a fallback hold on `sonnet` for `@coding`, and the operator removed `sonnet` from `@coding`
- **THEN** the next Run clears the hold and uses the first candidate

### Requirement: A stored selection that no longer resolves uses the default

A send without `selector` can find a stored model selector that the config no longer offers. The
API MUST then use `defaults.selector` and MUST store it with the effort that it resolved. The model-switch item of
`model-system-prompts` then tells the model of the change. A request that names the missing selector
MUST get 422.

#### Scenario: A stored model left the catalog

- **WHEN** the Chat stores the exact selector `gpt-4o`, the operator removed `gpt-4o`, and the owner sends with no `selector`
- **THEN** the Run uses `defaults.selector`, and the Chat stores it

### Requirement: An exact selector never switches

A Run whose model selector is exact MUST NOT change its model. It MUST NOT offer Continue on next
candidate. A failure of that model MUST fail the Run, or make it wait, as `provider-failures` and
`quota-wait` define.

#### Scenario: An exact model is unavailable

- **WHEN** a Run with selector `codex` fails with `overloaded` after its request retries
- **THEN** the Run is `failed` with `error.code` `overloaded`, and no other model receives a request

### Requirement: The Chat stores its selection

The Chat MUST store one selection: `selector`, `effort`, and an optional fallback hold
`{ selector, modelId, effort, revertAt }`. The Chat read MUST return it to the owner. A refused
request MUST NOT change it.

#### Scenario: Another device shows the same selection

- **WHEN** the owner sends with `@coding` from one device and then opens the Chat on another device
- **THEN** the Chat read returns the selection `@coding`, and the picker shows `@coding`

#### Scenario: A refused send stores no selection

- **WHEN** a send that names `@coding` gets 422 for an undeclared effort
- **THEN** the stored selection of the Chat does not change

#### Scenario: Another owner reads a Chat

- **WHEN** user B reads a Chat of user A, or sends to it with `selector: "@fast"`
- **THEN** the API answers 404, returns no selection or hold, and the selection of user A does not change

### Requirement: Owner requests write the selection

Four owner requests MUST write the selection: an accepted send in any delivery mode, a chat creation,
a Regenerate, and a `/compact`. Each writes in the transaction that accepts it. A request that names
`selector` MUST store it with the effort that admission resolved. A request that names only `effort`
MUST store that effort. A request on a Chat with no selection MUST store the selection that it
resolved. Each write MUST increase the revision of the selection.

#### Scenario: A pick resets the stored effort

- **WHEN** the Chat stores `codex` at effort `xhigh`, the owner sends with `selector: "@fast"`, and the first candidate of `@fast` declares no reasoning
- **THEN** the Chat stores `@fast` with no effort, and a later send with no `selector` and no `effort` is accepted

#### Scenario: A pick sent as a steer

- **WHEN** a Run on `@coding` is live, and the owner sends a steer with `selector: "@fast"`
- **THEN** the live Run keeps its model, and the Chat stores `@fast` for the next send

### Requirement: Other Run creators do not write the owner's choice

Continue, queue promotion, and job-notice Runs MUST NOT write the `selector` or the `effort` of the
selection. Any admission MUST clear a hold that `revertAt` passed, or whose model left its role.

#### Scenario: A queue item after revertAt

- **WHEN** a queue item with no `selector` starts after the `revertAt` of a hold on `sonnet` for `@coding`
- **THEN** its Run uses the first candidate of `@coding`, and the Chat has no fallback hold

### Requirement: An omitted effort follows one order

An omitted `effort` MUST resolve in this order. The effort of the fallback hold applies when the
hold applies. Then the stored effort applies, when the request names no `selector`. Then the
candidate `effort` of a role applies. Last, the `defaultEffort` of the model applies.

#### Scenario: An omitted effort after a role pick

- **WHEN** the first candidate of `@coding` is `codex` with effort `high`, and a send names `selector: "@coding"` and no `effort`
- **THEN** the Run uses effort `high`

#### Scenario: An omitted effort uses the stored effort

- **WHEN** the Chat stores `@coding` at effort `low`, and a send names no `selector` and no `effort`
- **THEN** the Run uses effort `low`

### Requirement: A send effort is validated against the resolved model

A named `effort` MUST be a declared level of the resolved model, which is the held model when the
fallback hold applies. The API MUST store a named effort on the hold when the hold applies, and on
the selection in other cases.

#### Scenario: An effort that only the held model declares

- **WHEN** the Chat has a fallback hold on `sonnet`, and a send names an effort that `sonnet` declares and `codex` does not
- **THEN** the API accepts the send, and the Run uses that effort on `sonnet`

### Requirement: The effort after a switch follows the selected effort

The Run MUST keep its selected effort, which admission resolved, apart from the effort of the
current segment. After a switch, the new model MUST use the selected effort when it declares that
level. In other cases it MUST use its candidate `effort`, then its `defaultEffort`.

#### Scenario: The new model declares the selected level

- **WHEN** a Run at effort `high` switches to `sonnet`, and `sonnet` declares `high`
- **THEN** the requests to `sonnet` carry effort `high`

#### Scenario: The new model does not declare the selected level

- **WHEN** a Run at effort `xhigh` switches to `deepseek`, whose candidate declares effort `medium`
- **THEN** the requests to `deepseek` carry effort `medium`, and its reply records `medium`

#### Scenario: A second switch compares with the selected effort

- **WHEN** a Run at effort `xhigh` switches to `deepseek` at `medium`, then to `opus`, which declares `xhigh`
- **THEN** the requests to `opus` carry effort `xhigh`

#### Scenario: A model with no reasoning gets no effort

- **WHEN** a Run at effort `high` switches to a model that declares no `reasoning`
- **THEN** the requests to that model carry no effort

### Requirement: A switch holds the Chat on the new candidate

A switch MUST store a fallback hold only when the selection keeps the revision that the Run read at
admission. The hold MUST name the selector of the Run, the new model, its effort, and `revertAt`. `revertAt` MUST be
the reset time of the failure, else its retry hint, else 5 minutes after the switch.

#### Scenario: A usage limit sets the hold to the reset

- **WHEN** a `@coding` Run switches after a Codex usage limit that resets at 14:00
- **THEN** the Chat has a fallback hold on the new candidate with `revertAt` 14:00

#### Scenario: An auth failure sets a short hold

- **WHEN** a `@coding` Run switches after an `auth` failure with no reset time and no hint
- **THEN** `revertAt` is 5 minutes after the switch

#### Scenario: The owner picked another selector

- **WHEN** a `@coding` Run switches, and the owner stored `@fast` with a steer before the switch
- **THEN** the Chat stores `@fast` with no fallback hold

#### Scenario: The owner picked the same role during the Run

- **WHEN** a `@coding` Run switches, and the owner sent a steer with `selector: "@coding"` before the switch
- **THEN** the Chat stores `@coding` with no fallback hold

### Requirement: The Chat returns to the primary after revertAt

The first admission after `revertAt` that resolves the stored selection MUST clear the hold. The role
then resolves to its first candidate. The model-switch item of `model-system-prompts` MUST announce
the return. A Continue MUST NOT clear the hold. A Run MUST NOT switch back before it ends.

#### Scenario: A send after the reset

- **WHEN** the Chat has a fallback hold on `sonnet` for `@coding` until 14:00, and the owner sends at 14:05
- **THEN** the Run uses the first candidate, the hold is cleared, and the request carries a model-switch item

#### Scenario: A long Run passes revertAt

- **WHEN** a Run on the held model is still live after `revertAt`
- **THEN** each later request of that Run uses the held model

### Requirement: An owner pick clears the hold

A request that names `selector` MUST clear the hold. A role selector then resolves to the first
candidate. A request that names only `effort` MUST keep the hold.

#### Scenario: The owner picks the role again

- **WHEN** the Chat has a fallback hold on `sonnet` for `@coding`, and the owner sends with `selector: "@coding"`
- **THEN** the Run uses the first candidate, and the Chat has no fallback hold

#### Scenario: The owner changes only the effort

- **WHEN** the Chat has a fallback hold on `sonnet` for `@coding`, and the owner sends with no `selector` and effort `low`
- **THEN** the Run uses `sonnet` at effort `low`, and the hold stays with effort `low`

### Requirement: A pending item resolves its selector when its Run starts

A pending item from the owner MUST store the `selector` and the `effort` that its send named, or none.
A job notice MUST store the selector and the origin of the Run that started its job. The Run of an
item MUST resolve its selector, or the stored selection when the item has none, when the Run starts.
A Run that resolves to a held model MUST use the effort of the hold.

#### Scenario: A queue item after a switch

- **WHEN** the owner queues an item with no `selector`, and the live `@coding` Run then switches the Chat to `sonnet`
- **THEN** the Run of the queue item starts on `sonnet`

#### Scenario: A queue item with its own selector

- **WHEN** the owner queues an item with `selector: "@fast"`
- **THEN** the Run of the item starts on the first candidate of `@fast`

### Requirement: An owner fork copies the selection and the hold

An owner fork MUST copy the selection of its source Chat, with its hold and `revertAt` unchanged. A
shared fork MUST NOT copy a selection or a hold. Its first send without `selector` MUST use
`defaults.selector`.

#### Scenario: A fork of a held Chat

- **WHEN** the owner forks a Chat that has a fallback hold on `sonnet` for `@coding` until 14:00
- **THEN** the fork has a fallback hold on `sonnet` for `@coding` until 14:00

#### Scenario: A shared fork gets no hold

- **WHEN** user B forks a public share of a Chat with a fallback hold
- **THEN** the fork of user B has no stored selection and no hold

### Requirement: A model switch inside a turn Run opens a segment

A switch MUST cut the failed send as `provider-failures` defines. It MUST close the reply with usage
status `error` and `complete: false`. It MUST deliver a host message with the switch item, with
delivery cause `failover`. The new segment MUST start a new attempt on the new model, with no carried
retry, wait, or step count.

#### Scenario: The transcript after a switch

- **WHEN** a `@coding` Run fails on `codex` and switches to `sonnet`
- **THEN** the Chat holds the reply of `codex`, a host message with the switch item, and a reply of `sonnet`
- **AND** each reply records the model that served it, and the reply of `codex` records usage status `error`

#### Scenario: The failed send is not kept

- **WHEN** a send streams text with no tool call and then fails, and the Run switches
- **THEN** the closed reply does not hold that text, and no later request carries it

#### Scenario: Settled tool calls stay

- **WHEN** a send streams a `read` call that settles, then breaks, and the Run switches
- **THEN** the closed reply holds the `read` part with its result
- **AND** the first request on the new model carries the `read` call with its result

#### Scenario: A steer that waits at the switch

- **WHEN** a steer is pending when a `@coding` Run switches from `codex` to `sonnet`
- **THEN** the host message of the switch holds the switch item first and the steer after it
- **AND** one `run.delivered` event with the cause `failover` names that host message

#### Scenario: The new segment starts its own retry count

- **WHEN** a Run switches after `overloaded` on its eleventh send, and the first send to the new model fails with `overloaded`
- **THEN** that send gets a request retry with retry number 1

### Requirement: A compaction Run does not switch

A compaction Run MUST NOT switch its model. Continue on next candidate MUST NOT apply to it. A
compaction Run on a role MUST use the model that its selector resolved at admission.

#### Scenario: A compaction Run in a quota wait

- **WHEN** a `/compact` Run on `@coding` waits in `awaiting_quota`
- **THEN** the quota-wait box does not offer Continue on next candidate

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

Each switch MUST append one `model.switched` event. It MUST name the prior and the new model with
their efforts, the failure class, and the host message. It MUST also name the origin of the switch:
`owner` or `policy`.
A switch inside a live Run MUST also append the `run.delivered` event of its host message.

#### Scenario: A reload after a switch

- **WHEN** the owner reloads a Chat after a switch from `codex` to `sonnet`
- **THEN** the history read returns the host message with the switch item, and the transcript shows the boundary

### Requirement: The transcript shows a switch boundary

The web MUST show a boundary at the host message of a switch. The boundary MUST name the prior model,
the new model, and the failure label. The live view and a reload MUST show the same boundary.

#### Scenario: The live view shows the switch

- **WHEN** a Run switches from `codex` to `sonnet` while the owner watches
- **THEN** the live view shows two replies with the boundary between them, before any reload

### Requirement: Each request normalizes tool-call ids

A request MUST keep a tool-call id that its own model produced, unless an earlier part of the
request has the same id. It MUST map every other replayed id to an id that matches
`^[a-zA-Z0-9_-]{1,40}$`. One map MUST cover the request and make each id unique in it. The system
MUST NOT change a stored id.

#### Scenario: A foreign id reaches another wire

- **WHEN** a reply on one wire stored a tool-call id with a `.` character, and a later request goes to another model
- **THEN** that request carries an id that matches the pattern for both the call and its result
- **AND** the stored part keeps its original id

#### Scenario: Two ids map to the same value

- **WHEN** two stored ids of one request differ only in characters outside the pattern
- **THEN** the request carries two different ids

### Requirement: The owner continues a failed reply on the next candidate

A Continue request with `candidate: "next"` MUST start a Continue Run on the next candidate of the
failed turn Run. The failed reply MUST keep its settled parts, its usage, and its model. Admission
MUST store a host message with the switch item and create the Continue Run on that message. The Run
MUST write a new reply.

#### Scenario: Continue on the next candidate

- **WHEN** a `@coding` Run on `codex` failed after two settled tool calls, and the owner sends Continue with `candidate: "next"`
- **THEN** a Continue Run starts on `sonnet`, and its first request carries the two settled calls with their results
- **AND** the Chat has a fallback hold on `sonnet`

#### Scenario: A Run with an exact selector

- **WHEN** the failed Run has the selector `codex`, and the owner sends Continue with `candidate: "next"`
- **THEN** the API answers 409 with `code = "next_candidate_unavailable"` and creates no Run

### Requirement: The owner moves a Run in a quota wait to the next candidate

`POST /api/v1/runs/:id/next-candidate` is Continue on next candidate for a turn Run in
`awaiting_quota` whose selector is a role. It MUST end the wait, and the same Run MUST continue on the
next candidate through a model switch. Another state or an exact selector MUST get 409. A Run of
another owner MUST get 404.

#### Scenario: A weekly limit ends early

- **WHEN** a `@coding` Run waits for a Codex reset in five days, and the owner calls the action
- **THEN** the Run leaves `awaiting_quota`, and its next request goes to `sonnet`

#### Scenario: Another owner calls the action

- **WHEN** user B calls the action for a Run of user A in a quota wait
- **THEN** the API answers 404, and the Run stays in `awaiting_quota`

#### Scenario: An exact selector in a quota wait

- **WHEN** a Run with the selector `codex` waits, and the owner calls the action
- **THEN** the API answers 409 with `code = "next_candidate_unavailable"`, and the Run keeps its wait

### Requirement: The next candidate follows the current model in the role

The next candidate MUST be the candidate after the current model in the current config of the role.
The chain MUST NOT wrap to the first candidate. When the current model is the last candidate, or is
not in the role, no next candidate exists. The action then MUST get 409 with `code =
"next_candidate_unavailable"`.

#### Scenario: The last candidate fails

- **WHEN** a `@coding` Run on its last candidate fails, and the owner sends Continue with `candidate: "next"`
- **THEN** the API answers 409 with `code = "next_candidate_unavailable"` and creates no Run

### Requirement: The web offers the next candidate

The latest turn MUST show Continue on next candidate when the action applies. The quota-wait box
MUST show the same action. The action MUST name the next model and MUST label it paid when its
resolved billing is `usage`.

#### Scenario: A paid next candidate

- **WHEN** the next candidate of a failed `@coding` Run has billing `usage`
- **THEN** the action names that model and shows a paid label

### Requirement: The models endpoint publishes the roles

`GET /api/v1/models` MUST return `roles`. Each role has its model selector and its candidates in
order. Each candidate has its `modelId`, its declared `effort` when present, and `paid`. `paid` MUST
be true when the resolved billing of the model is `usage`. The response MUST NOT return other billing
data.

#### Scenario: The picker reads a role

- **WHEN** the config declares `@coding` with `codex` and `openrouter-sonnet`
- **THEN** the response holds `@coding` with both candidates in order, and `paid` is true only for the `usage` model

### Requirement: The web picker shows the stored selection

The picker MUST offer each role and each model. It MUST show the stored selection of the Chat. With
a fallback hold, the picker MUST show the role, the held model, and the local `revertAt`. A pick
MUST make the next send name `selector`.

#### Scenario: A held Chat in the picker

- **WHEN** the Chat has a fallback hold on `sonnet` for `@coding` until 14:00
- **THEN** the picker shows `@coding`, `sonnet`, and 14:00

### Requirement: Existing Chats and Runs get a selector

For each Chat with a turn Run, the migration MUST store a selection with no hold. The selection holds
the model id and the effort of the latest turn Run. The migration MUST copy the `modelId` of each Run
to its `selector`, and its effort to its selected effort. It MUST NOT delete a Chat, a message, or a
Run.

#### Scenario: An old Chat keeps its model

- **WHEN** the migration runs on a Chat whose latest turn Run used `codex` at effort `high`
- **THEN** the Chat stores the selector `codex` with effort `high`, and its next send without `selector` uses `codex`

### Requirement: The migration keeps pending items valid

The migration MUST replace the `modelId` of each pending item and each job with a `selector` of the
same value. A pending item MUST stay valid after the migration.

#### Scenario: A queue item survives the migration

- **WHEN** a queue item recorded `modelId` `codex` before the migration
- **THEN** it records `selector` `codex` after it, and it starts its Run when the live Run completes
