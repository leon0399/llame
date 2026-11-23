---
summary: "What the model picker offers, how a Chat keeps one model selection, and how the owner switches a turn to the role's next candidate"
read_when:
  - you are picking a model or a model role and need to know what the next send uses
  - a Chat shows a held model and you need to know when it returns to the role
  - you need to know when Continue on next candidate is offered and what it changes
  - you need to know what Regenerate and a fork keep of the model selection
spec: available-models
configured_by: ../operator/providers/routing.md
---

# Model selection

The composer's model picker sets the model selector and the effort of a Chat's
next send. The Chat stores one selection and shows it on every device. The
operator defines the model roles that the picker offers and the default
selector. See [provider accounts and model
wires](../operator/providers/routing.md#model-roles-and-default-selectors).

## The picker

The picker lists every model role first, written `@name`, then every model. A
model role is an ordered list of model entries. A send that names the role uses
its first candidate, called the primary. The effort picker offers the levels
that the resolved model declares.

The picker shows the stored selection of the Chat. A Chat opened on another
device shows the same selection, because the Chat read returns it. A new Chat
shows the default selector until its first send stores a selection.

A pick applies to the next send. It never changes the model of a Run that is
already live: a steer that names a model selector stores the pick for the next
send, and the live Run keeps its model.

## The stored selection

A Chat stores one selection: a model selector and an effort, or neither. Your
browser names a model selector in a send only after you pick one in the picker.
The first send of a new Chat names the selection that the picker shows. A later
send names none, so the stored selection applies.

Four owner requests write the selection: a send in any delivery mode, the first
message of a new Chat, Regenerate, and `/compact`. Continue writes nothing: it
keeps the model selector, the model, and the effort of the failed Run that it
continues. Continue on next candidate writes no selector or effort either. It
writes only a fallback hold.

A pick of an effort alone keeps the current model and stores the effort. A send
that names an effort the resolved model does not declare is refused before
anything is written, and a refused send leaves the stored selection as it was.

A stored model selector that the configuration no longer offers is replaced by
the default selector on the next send that names none. The Chat then stores the
default selector with the effort it resolved.

## Fallback holds

A fallback hold keeps a Chat on a later candidate of its model role.
[Continue on next candidate](#continue-on-next-candidate) writes it, and the
hold records the model role, the held model, and the time it ends.

While the hold applies, a send that names no model selector uses the held model
instead of the role's first candidate. The picker shows the model role, the
held model, and the revert time in your browser's local time. A named effort is
checked against the held model, so a level that only the held model declares is
accepted.

The hold stops applying at its revert time, when the operator removes its model
from the role, or when you pick a model selector. The first send after that uses
the role's first candidate and clears the hold. The transcript shows the model
switch after that send. Picking the role again clears the hold at once, so the
next send uses the first candidate.

A pick of an effort alone keeps the hold and its model, with the new effort. A
Run that is live when the revert time passes keeps the held model to its end,
and Continue never clears the hold.

## Continue on next candidate

The owner can move a turn to the next candidate of its model role. The action
appears under a failed reply and on the failed-turn row. It also appears in the
[quota-wait box](continue-a-turn.md#waiting-for-a-provider-reset) while a Run
waits for its reset.

The action is offered only when the Run's selector names a model role, and the
role lists a candidate after the model of the Run. It is not offered for an
exact model selector, for the last candidate, for a compaction Run, or when the
model is no longer in the role. Unlike Continue, it needs no settled step: a
failed role turn offers it even when the reply holds no tool result.

The action names the next candidate. A candidate billed per token is labeled
paid.

On a failed reply, the reply keeps its output and its usage, and its model stays
the one that failed. The next model answers in a new reply, after a boundary
that names the failed model, the new model, and the failure. The request of the
new reply carries the failed reply as history.

On a Run in a quota wait, the action ends the wait and the same Run continues on
the next candidate. Its reply closes with the failure, the boundary names it,
and the next model answers in a new reply.

The switch writes a fallback hold on the new model. The hold ends at the reset
time of the failure, else after its retry hint, else five minutes after the
switch. The new model uses the selected effort of the Run when it declares that
level, and otherwise the effort of its role candidate, then its default effort.

The hold is written only when the Chat still stores the selection that the Run
read at admission, with the same revision. A pick after that read wins, so the
Chat then keeps your pick and no hold.

## Automatic failover

An operator can enable automatic failover per Run origin (`owner` or `agent`)
and failure group (`availability`, `access`, or `quota`). Every cell is off by
default. A role can override individual cells while inheriting the rest of the
instance matrix. Automatic switches write the same fallback hold as the owner
action and use a boundary that names the failed model and failure.

For quota failures, `on` switches instead of waiting. A
`switchAfterSeconds` cell waits only when `60 < reset distance <= threshold`
and the reset is within `runs.quotaWaitMaxSeconds`; a `quota_exhausted` failure
without a reset, a farther reset, or an over-cap reset switches. An off cell
retains the existing wait behavior. Compaction Runs never fail over.

Automatic switching skips a per-token candidate when leaving a
`subscription` or `free` model unless the role enables `allowPaidFallback`.
This gate does not restrict the owner's Continue on next candidate action.
Title generation with a role selector walks its candidates in order, with the
same paid-candidate gate, but creates no hold or quota wait. The worker reads
the current policy at each failure, so a restart changes the next decision and
does not alter an existing quota wait.

## Regenerate

A plain Regenerate names no model selector and no effort, so the stored
selection applies. It sends the permission mode that the latest Run was
accepted with, whatever the composer shows. The Regenerate menu offers the same
selection and effort controls as the composer. A pick in the menu sets the
composer too, and the menu's Regenerate button sends the composer values.

## Forks

An owner fork copies the selection of its source Chat, with its fallback hold
and revert time unchanged. A shared fork stores no selection and no hold, so its
first send without a pick uses the default selector.
