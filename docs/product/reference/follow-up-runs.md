---
summary: "How a follow-up request acts on the latest turn, which Runs it may act on, and what a Continue Run keeps from a failed reply"
read_when:
  - you need to know which turn a follow-up request may act on
  - you need to know which parts of a failed reply a Continue Run keeps
  - you need to know what the chat history read reports about the latest Run
# The follow-up capability's own spec (`turn-actions`) joins this list when the
# change syncs its deltas; the admission rules stated here are durable-runs'.
spec: durable-runs
configured_by: ../operator/native-files.md
---

# Follow-up runs

A follow-up Run acts on a turn that already has a Run, instead of adding a
message. It starts on the Chat's latest user message, keeps the model of the
Run it acts on, and answers with the same stream a chat send returns.

## The request

`POST /api/v1/chats/:chatId/messages/:userMessageId/runs` asks for a follow-up
Run. The body names the follow-up in `action`, and may name a permission mode:

```json
{ "action": "continue", "permissionMode": "default" }
```

`permissionMode` is checked against the enabled modes exactly as a chat send
checks it, and an absent one means `default`. Continue takes its model and its
effort from the Run it continues, so it does not accept `modelId` or `effort`;
a request that names either is refused as malformed. A request without a
`userId`-derived identity, or for a Chat the caller does not own, answers not
found before any Run state is read.

## Admission

The request passes the admission a chat send passes. The Chat must not be
archived. The message must be a user message of that Chat with no user message
after it, so a follow-up on an older turn is refused. The Chat's row is locked
first, so the follow-up never races a chat send or another follow-up.

The Chat must then have no live Run. A Run whose job the queue still holds
blocks the request; a Run the queue can no longer execute is expired first, and
the follow-up reads that outcome. A refused request creates no Run, expires no
Run of another owner, and changes no message.

## Continue

Continue resumes the turn of a Run that ended without finishing: the latest Run
of the message must be `failed`, `cancelled`, or `expired`, and the reply must
exist, belong to that Run, and not be completed. Because the reply's Run is
checked, a Continue after a Regenerate that failed before its first model
request is refused: that reply belongs to an older Run.

The Run records the accepted action, the Run it continues, and the model, the
effort, and the accepted permission mode of the new Run itself. The earlier
Run keeps its own settings.

### Kept parts

A settled tool part is a tool call with a result. Continue keeps the reply's
parts through its last settled tool part, plus the context items directly after
it. Every part after them belongs to the unfinished step, which the new Run
replaces with its own parts. A reply with no settled tool part keeps nothing,
so a turn that failed before its first result has no part to continue.

The kept parts are recorded with the new Run, so every attempt of it starts from
the same completed steps: the model receives each kept step with its reasoning,
its text, and all its tool calls, then their results. A kept call is never
executed again, and its result is the result that was stored — including a
result whose outcome the earlier Run could not observe.

The accepted reply's earlier usage is replaced by the new Run's usage, which
records that it does not aggregate an earlier Run's spend.

## The latest-Run report

`GET /api/v1/chats/:id/messages` reports the Chat's newest Run beside the
messages, from the same read:

```json
{
  "messages": [],
  "latestRun": {
    "id": "…",
    "messageId": "…",
    "status": "failed",
    "followUpAction": null,
    "modelId": "…",
    "effort": "high",
    "permissionMode": "bypass"
  }
}
```

It is `null` for a Chat with no Run. `followUpAction` is the action that
started that Run, so a chat send reports `null` and a Continue reports
`continue`. The report follows the owner scope of the history read: another
owner's Chat answers not found and reports no Run.

## Configured by

[native files](../operator/native-files.md) enables the permission modes and
the instance-wide trust `bypass` represents. A Continue Run's model must still
be in the catalog the instance configures.
