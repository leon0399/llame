---
status: accepted
---

# Context narration has a floor and a ceiling

llame states its own context changes in-band rather than applying them
silently. We decided that the narration itself carries two bounds. The floor is
a review test. llame narrates a change the model would misread its own history
without. Where another harness narrates a change that llame applies silently,
the silent side writes its reason down. The ceiling is the cost of the
narration. A notice is permanent history that every later request pays for until
a compaction absorbs it. The rail narrates events and one named exception, and
it never re-states the standing context the frozen baseline already owns.

## Considered options

- Narrate less. OpenAI's `truncation: "auto"` drops input items with no marker
  to the model, and developers report the silent loss as a correctness failure.
  The floor exists because of that shape.
- Narrate freely. Claude Code refreshes todo state after every tool call, and
  its users filed [claude-code
  #4464](https://github.com/anthropics/claude-code/issues/4464) over the tokens
  that the reminders consume. State refresh fights context rot, but it charges
  every later request. llame answers context rot with the frozen baseline and
  compaction, and the exception below keeps one door open.

## Consequences

- The floor is a review question, not a checklist. A new cut, switch, or
  injection asks "would the model misread its own history without this", not
  "does another harness have it".
- The ceiling forbids re-stating unchanged state for recency. Standing context
  lives in the frozen baseline and changes only through the baseline contract.
- The named exception is model-authored state that a tool stores on the model's
  behalf. A feature that re-states it on the rail argues its token cost in its
  proposal. A todo reminder is the expected first case.
- Tool results that speak for the harness, such as a "not permitted" refusal,
  are outside this decision. Tool specs own that channel.
- The comparison is against named systems, not a moving average. The
  [narration survey](../research/harness-transparency/2026-08-12-narrating-context-changes.md)
  records what other harnesses do, and this decision claims no invention of
  narration.

This decision bounds [Context changes are narrated, not
silent](../../VISION.md#context-changes-are-narrated-not-silent). Producer
precedence and notice placement stay with the
[`context-injection`](../../openspec/specs/context-injection/spec.md) spec.
