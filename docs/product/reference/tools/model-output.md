---
summary: "What a model receives for every tool result: the reserved-name neutralization, and the display data it never sees"
read_when:
  - you need to know how a tool result reaches the model, or why a tag or a field was altered
  - you are writing or debugging a tool result whose text a model must read verbatim
spec: tool-calling
---

# Model output

## Purpose

Every tool result reaches a model through one rendering function, and that
function neutralizes one thing only: a tag-shaped token naming a reserved
wrapper element has its angle brackets escaped, however it is spelled
(`<tool-result>`, `< tool-result>`, `</TOOL-RESULT >`). The reserved names are
`system-reminder`, `tool-call`, `tool-result`, `user_chat_history`,
`user_personalization`, `skill`, and `available_skills`. Everything else passes
verbatim, including an unmatched closer such as `</div>`. The rule covers a
text rendering, a JSON string value, a JSON key, and an error message alike; a
tool result no longer escapes every `<` and `>`.

## Behavior

The rendering is the same for a live result, a result replayed on a later turn,
and a result kept by a Continue Run, so a model reads one shape of a call
whatever turn it sees the call in.

A `display` key on a result is stored with the tool part for the chat UI and is
never rendered to a model. An image read's inline thumbnail lives at
`display.thumbnail`; a part stored before that key moved keeps a top-level
`thumbnail` that the UI still shows.
