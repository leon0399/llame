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

## Oversized results

A result whose rendering is longer than 16,000 code units is cut in place, so
the shape the tool declared survives and the result carries `truncated: true`
plus a `truncationNotice` saying how much was omitted and that narrower
arguments recover it.

A tool declares how its result spills. `head` is the default: the system
stores the whole rendering as an artifact, then keeps the head of the shape
inline. The `artifact` field on the result is the locator, and the cap notice
names it, its line count, and `artifact://<tool>-<n>:1-`. A JSON rendering is
stored pretty-printed, one member or item on each line, so a long text value
stays readable by line. A rendering above `tools.artifacts.maxBytes` is not
stored, because cutting JSON would make it invalid; the notice then carries
`[full result not stored]`, as it does after a failed write, and the result
names no artifact. A Run that cannot read artifacts keeps today's bounded
result and no locator.

A tool that declares `spill: 'tool'` builds its own inline part and artifact, so
the result cap does not shorten it. See [artifacts](artifacts.md).
