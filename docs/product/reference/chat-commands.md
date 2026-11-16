---
summary: "Chat composer commands rename or compact the current Chat without adding a user message"
read_when:
  - you want to rename or compact a Chat from its composer
  - you need to know whether slash-prefixed text is a command or a message
spec: turn-actions
---

# Chat commands

Commands run when you send them to an existing Chat. A command does not add its
text to message history. Names are exact and case-sensitive. Unknown names,
including paths such as `/etc/hosts`, are ordinary messages.

## `/rename <title>`

Set the Chat title to the trimmed text after `/rename`. The title must contain
1-200 characters. This works while a Run is active; the send's delivery mode
does not queue the title change.

## `/rename`

With no title, ask the configured title-generation model to name the Chat from
its recent owner and assistant turns. The request uses the dedicated title
model, not the Chat's selected model. If the Chat has no eligible conversation
rows, the API returns `Nothing to name.` If title generation is not configured,
the API reports that configuration error; a model failure or unusable title
returns an error without changing the title.

## `/compact`

On an idle Chat, start a compaction Run that summarizes the conversation after
the active checkpoint. The Run uses the selected model, effort, and permission
mode. Its result is a checkpoint, not a user message. If there is no new
conversation to absorb, the API returns `Nothing to compact.` and starts no Run.

If the Chat has paused queue items, they stay pending during the compaction
Run and resume through the normal queue promotion when it completes.

Focus text after `/compact` is not supported yet; the API returns
`Compact focus is not supported yet.` A Chat with a live Run returns
`Wait for the current Run to finish.` A compaction command sent to another
owner's Chat is not found. Archived Chats cannot be compacted. A command that
includes an attachment is rejected.

Archived Chats cannot be renamed.
