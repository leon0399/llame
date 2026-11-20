---
status: accepted
---

# The model is told when output it already sent is cut from a reply that continues

When llame cuts output that the model already streamed and then asks the same
model to go on in that reply, the next request says so in a context item. The
first case is the `provider-failure` notice. After a send fails with a started
tool call, the notice follows the last kept tool result. It states that the
provider failed, that each call has its result, and that the output after the
last result is not kept.

We chose this because a cut in the middle of a reply reads like the model's own
choice. Without the notice, a model whose sentence vanished after a tool result
sees a reply that simply stopped there. It may then repeat work, or claim
progress it never reported. llame already tells the model when an owner
interrupt stops its step.

The notice is stored in the reply in every outcome: when the Run continues,
waits for a quota reset, fails, expires, or is interrupted or cancelled. An
owner Continue, and every later turn that replays the reply, carries it.

Two shipped cuts get no notice, because the model sees no gap. A request retry
replaces a whole send whose tool calls never started, so history reads as if
that send never happened. A withdrawn interrupt removes only reasoning, which
the model does not receive again.

## Considered options

- History alone, as oh-my-pi does when it keeps a failed turn. It costs no
  tokens, but the model cannot tell lost output from output it never wrote.
- A notice only when the Run continues automatically. An owner Continue after
  a failure would then resume without the explanation that an automatic
  continuation gets.

## Consequences

- Each notice is permanent history. It costs tokens in every later request
  until a compaction absorbs it, and a later removal of the producer leaves its
  stored items in existing Chats.
- A new cut of sent output in a reply that continues gets a notice in the same
  change, with a fixed text and a place in the producer precedence of
  `context-injection`.

This was decided in the grilling for
[continue a Run after a send that broke with started tool calls](https://github.com/leon0399/llame/issues/1828).
