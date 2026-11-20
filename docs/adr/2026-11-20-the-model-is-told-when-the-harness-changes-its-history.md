---
status: accepted
---

# The model is told when the harness changed its history

When llame removes, replaces, or cuts part of what the model produced, the
next request says so in a context item. The model does not have to infer the
event from a gap in its history. The first case of this decision is the
`provider-failure` notice. It follows the last kept tool result after a send
fails with a started tool call. It states that the provider failed, that each
call has its result, and that the output after the last result is not kept.

We chose this because a gap in history reads like the model's own choice.
Without the notice, a model whose sentence vanished after a tool result sees a
reply that simply stopped there, and it may repeat work or claim progress it
never reported. llame already tells the model about an owner interrupt, a
discarded Regenerate attempt, and a compaction. A provider failure is the same
kind of event.

The notice is stored in the reply in every outcome: when the Run continues,
waits for a quota reset, fails, or is cancelled. An owner Continue, and every
later turn that replays the reply, carries it.

## Considered options

- History alone, as oh-my-pi does when it keeps a failed turn. It costs no
  tokens, but the model cannot tell lost output from output it never wrote.
- A notice only when the Run continues automatically. An owner Continue after
  a failure would then resume without the explanation that an automatic
  continuation gets.

## Consequences

- Each notice is permanent history. It costs tokens in every later request
  until a compaction absorbs it, and removing a producer later leaves its
  stored items in existing Chats.
- A new harness event that alters history gets a notice in the same change,
  with a fixed text and a place in the producer precedence of
  `context-injection`.

This was decided in the grilling for
[continue a Run after a send that broke with started tool calls](https://github.com/leon0399/llame/issues/1828).
