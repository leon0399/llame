---
summary: "Chat composer commands rename the current Chat without adding a user message"
read_when:
  - you want to rename a Chat from its composer
  - you need to know whether slash-prefixed text is a command or a message
spec: chat-creation
configured_by:
---

# Chat commands

Commands run when you send them to an existing Chat. A command does not add a
message to history or start a Chat Run. The command name is exact and
case-sensitive. Unknown names, including paths such as `/etc/hosts`, are
ordinary messages.

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

A command sent to another owner's Chat is not found. Archived Chats cannot be
renamed. A command that includes an attachment is rejected.
