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
Archived Chats cannot be renamed.

## `/compact <focus>`

On an idle Chat, start a compaction Run that summarizes the conversation after
the active checkpoint. The Run uses the selected model, effort, and permission
mode. Its result is a checkpoint, not a user message. If there is no new
conversation to absorb, the API returns `Nothing to compact.` and starts no Run.

The optional focus is trimmed and limited to 1,000 characters. It guides the
summary without changing its required sections or redaction rules. The focus is
stored on the checkpoint for history display; later requests replay the summary
without the focus. Before a downgrade to a release that cannot read stored
focuses, the operator converts them; see
[chat commands for operators](../operator/chat-commands.md).

If the Chat has paused queue items, they stay pending during the compaction
Run and resume through the normal queue promotion when it completes.

During a live Run, `/compact` follows its delivery mode: `steer` compacts at
the next step boundary, while `interrupt` stops the in-flight step and compacts
at that boundary. The Run continues from the checkpoint with the owner's
current request as context. If summary generation fails, the Run continues
without compacting and records a failure note.

With a live Run, a queued `/compact` starts a separate compaction Run after the
current Run completes. A `steer` item compacts at the next step boundary; an
`interrupt` item stops the in-flight step and compacts there. A send without a
delivery mode to a live Run returns `Wait for the current Run to finish.` The
pending-delivery response includes `command: "compact"`; ordinary delivery
items have `command: null`. Steer now and Interrupt now are available for a
pending compact command during a live turn Run.

A compaction command sent to another owner's Chat is not found. Archived Chats
cannot be compacted. A command that includes an attachment is rejected.
