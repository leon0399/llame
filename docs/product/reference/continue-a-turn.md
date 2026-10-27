---
summary: "How a failing turn is continued from its last completed step without repeating a settled tool call"
read_when:
  - you need to know when the Continue action is offered and what it refuses
  - you need to know what a continued Run sends to the model and what it keeps
spec: durable-runs
---

# Continue a turn

Continue resumes the latest user turn of a Chat after its Run ended. It keeps the
steps the earlier Run completed and asks the model for the next one. The model
receives every kept tool result again, and no kept call runs a second time.

## The request

An owner starts a follow-up Run with `POST
/api/v1/chats/:chatId/messages/:userMessageId/runs` and
`{"action": "continue"}`. The answer is the same UI-message stream a chat send
returns, and its first frame names the new Run's id.

The route accepts only the latest user message of a Chat that is not archived.
Every refusal below answers before it writes anything, except that admission
still expires a stuck Run of the Chat, exactly as a chat send does.

- A user message with a newer user message after it answers 409.
- Another owner's Chat or message answers 404, and nothing of its own is read or
  changed.
- A live Run in the Chat answers 409.
- A malformed body answers 400. Continue refuses `modelId` and `effort`,
  because it takes both from the Run it continues.
- A permission mode that the instance does not enable answers with the error a
  chat send with that mode gets. An absent mode means `default`.

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
