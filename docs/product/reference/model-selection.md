---
summary: "What the model picker offers, how a Chat keeps one model selection, and how a fallback hold returns it to the role's first candidate"
read_when:
  - you are picking a model or a model role and need to know what the next send uses
  - a Chat shows a held model and you need to know when it returns to the role
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
continues.

A pick of an effort alone keeps the current model and stores the effort. A send
that names an effort the resolved model does not declare is refused before
anything is written, and a refused send leaves the stored selection as it was.

A stored model selector that the configuration no longer offers is replaced by
the default selector on the next send that names none. The Chat then stores the
default selector with the effort it resolved.

## Fallback holds

A model role can fail over to a later candidate after a model request fails.
The Chat then keeps a fallback hold on the model that served the Run. The hold
records the model role, the held model, and the time it ends.

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
