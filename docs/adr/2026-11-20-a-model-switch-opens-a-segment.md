---
status: accepted
---

# A model switch within a Run opens a new segment

When a Run moves to another model partway through, the reply in progress
closes. The new model continues the same Run in a new reply. llame already
starts a segment this way when a steer or interrupt reaches a live Run.

Each reply is therefore served by exactly one model. Reasoning replay, usage,
cost, and the usage badge keep reading the model from the reply. A segment is
already its own attempt, so the new model gets its own prompt receipt.

The cost is visible. One Run can show two replies with no owner message
between them. A host message between the two replies carries a marker that
names the previous model.

## Considered options

- Record a model id on every stored part, and keep one usage entry per model in
  a reply. Replay, usage, cost, and the badge would all have to handle several
  models in one reply. oh-my-pi instead records the model per assistant
  message and decides replay per message, which is the shape we kept.
- Restart the attempt from its first step on the new model. Completed tool
  calls would run a second time.

## Consequences

- The partial output of the failed request stays in the database for
  provenance. The owner never sees it, and no model receives it again.
- Each request normalizes tool-call ids, so history written on one wire can be
  sent on another.

This was decided in
[Per-request model identity and cross-wire history](https://github.com/leon0399/llame/issues/1755),
for [model roles with fallback chains](https://github.com/leon0399/llame/issues/1772).
