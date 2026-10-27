---
summary: "How a finished turn is continued from its last completed step, or regenerated from its user message"
read_when:
  - you need to know when the Continue and Regenerate actions are offered and what they refuse
  - you need to know what a continued or regenerated Run sends to the model and what it keeps
  - you need to know when a discarded attempt leaves a notice on the turn
spec: durable-runs
---

# Continue or regenerate a turn

Both actions act on the latest user turn of a Chat after its Run ended.
Continue keeps the steps the earlier Run completed and asks the model for the
next one; the model receives every kept tool result again, and no kept call
runs a second time. Regenerate discards the turn's answer and asks the model for
a new one from the user message alone.

## The request

An owner starts a follow-up Run with `POST
/api/v1/chats/:chatId/messages/:userMessageId/runs` and
`{"action": "continue"}` or `{"action": "regenerate"}`. The answer is the same
UI-message stream a chat send returns, and its first frame names the new Run's
id.

The route accepts only the latest user message of a Chat that is not archived.
Every refusal below answers before it writes anything, except that admission
still expires a stuck Run of the Chat, exactly as a chat send does.

- A user message with a newer user message after it answers 409.
- Another owner's Chat or message answers 404, and nothing of its own is read or
  changed.
- A live Run in the Chat answers 409.
- A malformed body answers 400. Continue refuses `modelId` and `effort`,
  because it takes both from the Run it continues. Regenerate requires
  `modelId` and accepts `effort`.
- A model, an effort, or a permission mode that a chat send cannot use answers
  with the error that chat send gets. An absent mode means `default`.

## When Continue applies

Continue starts only when the message's latest Run is `failed`, `cancelled`, or
`expired`, and only when the reply exists, its usage names that Run, and its
usage status is not `completed`. Any other state answers 409. A turn whose Run
never dispatched left no reply, so it cannot be continued either.

The new Run keeps the model and the effort of the Run it continues. Both pass the
chat-send checks again, so a model that the operator has since removed is
reported before any write.

## What is kept

A settled tool part is one with a result. The kept parts are the reply's parts
through its last settled tool part, plus the context items directly after it.
Everything after them is the step that did not finish: the Continue Run drops it
from the reply and the earlier Run's event log keeps it.

A reply with no settled tool part keeps nothing, and the Continue Run starts the
turn again from its user message.

The kept parts count toward the compaction threshold and the model window, and a
compaction never absorbs them. When the history through the trigger and the kept
parts do not fit even after compaction, the Run fails as context-incompatible and
Regenerate stays available.

## What the model receives

The first request carries the history through the triggering user message, then
the kept steps. A kept step is the set of calls one model response made, with the
reasoning and text that preceded them. Each step becomes one assistant message —
its reasoning with the provider metadata that authorizes it, its text, and all
its calls — followed by one message with their results. A kept in-Run item stays
in its own user-role message after its step's results, where the earlier Run put
it.

No replay budget applies: each kept result is sent as the earlier Run sent it.
The projection adds no user text of its own, so the request ends with the kept
results.

A kept result's media follows the same rules as a live step: a stored
`media://` reference replays from the media store, while an image the earlier Run
read without storing it replays as a not-retained placeholder, because a new Run
holds no unstored media.

## Persistence

Admission records the kept parts and the step of each kept call in the new Run's
event log, right after its creation, so every attempt of the new Run starts from
the same place. The reply keeps the earlier Run's parts until the new Run
dispatches; a Continue that fails before its first request therefore changes
nothing.

A stream replay shows the kept text, reasoning, and tool parts, then the new
parts. The final reply holds each kept part once, then the new parts in stored
order — also when the worker died after storing an in-Run item of its own.

The new Run replaces the reply's usage: it names the new Run, records
`complete: false` when the earlier reply recorded usage, and never adds the kept
steps' spend. The earlier Run's receipts stay readable through `GET
/api/v1/runs/:id`.

## Context items on the turn

A follow-up Run follows the retry rule for the turn's context items. It keeps
every stored item in place, derives each producer again with those items counted
as told, and appends only what is new after the last stored item. A turn
therefore keeps one `temporal` item, and an appended `tool-availability` item
compares against the most recent dispatched Run — which can be the earlier Run of
the same message.

The `prompt-imports` and `skill-activation` items are reused, not re-derived: a
Continue Run reads no import target again and activates no skill again. Its
instruction load skips every file whose bundle the kept parts already carry.

Continue keeps the turn's model, so the stored model-switch item stays valid and
no second one is authored.

## Regenerate a turn

Regenerate starts when the message's latest Run is terminal, whatever its
status, and whether or not it left a reply. A Run that failed at pickup leaves
no reply, and that turn needs Regenerate most. The new Run uses the model, the
effort, and the permission mode the request names, and each passes the chat-send
checks before anything is written.

The first request starts from the history through the triggering user message,
so it carries no part of the answer being discarded. Its dispatch replaces the
turn's reply — also a `completed` answer of an earlier Run — and the replaced
row stops being evidence: search, `conversation_read`, and timeline discovery
never return it again. The new answer is stored in that same row, so it is not
searchable either. A Regenerate that ends before its dispatch leaves the old
reply, its usage, and its evidence untouched, and a turn whose reply was never
`completed` takes no mark at all.

## The notice a discarded attempt leaves

An answer may have run tools whose effects outlive it. When the replaced reply
holds a call that can change files or other state, the turn gains a `regenerate`
notice on its user message:

> An earlier attempt at this turn was discarded after it ran tools that can
> change files or other state. Check the current state before you act on it.

A call counts when its recorded classification is anything but read-only, and a
reply written before that classification existed falls back to the tool
catalog: a tool the catalog does not know counts, and an MCP tool is unverified.
A call that never started — the availability gate or the permission policy
rejected it — does not count, and neither does a read-only call. The notice is
stored once for the turn, after the items already on the user message, so every
later Run of that turn and every later turn carries it. A tool-less Regenerate
carries it too.

## The model switch on a Regenerate

A stored model-switch item names the model of the Run that stored it, so the
first dispatch of a Regenerate removes it and stores the item that its own
comparison against the most recent prior reply yields — or none, when the
Regenerate returns to that reply's model. A retry of the same Regenerate keeps
what its first dispatch stored. Continue keeps the turn's model, so its stored
switch item stays valid.
