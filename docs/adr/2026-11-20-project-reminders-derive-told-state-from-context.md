---
status: proposed
---

# Project reminders derive told state from reconstructed context

The Project reminder compares its selected text with its own latest item in
the reconstructed context of the active compaction epoch. Its comparison keys
belong in that item's payload. It adds no Project-specific told-state columns.

## Considered options

Copy the Workspace producer's stored told-state columns. Those columns require
schema changes for each producer and separate rules for forks, retries, and
in-Run items. They can disagree with the context the model actually received.

Compare against the latest Project row. That row records current owner intent,
not what the Chat received. An edit before execution would erase the evidence
needed to explain a changed reminder.

## Consequences

A published checkpoint ends the comparison epoch. The producer finds no item in
that epoch and supplies the applicable Project context again. An in-Run item
counts whenever it remains in reconstructed context. Stored history supplies
its final text without a new render.

This decision concerns reminder comparison. The immutable Project selection of
an executing Run is a different recovery obligation. It cannot depend on the
continued presence of an earlier epoch's item in active model context.

The [Project discovery design](../../openspec/changes/project-discovery/design.md)
applies the
[runtime-plugin decision](https://github.com/leon0399/llame/issues/1489#issuecomment-6715360525)
to this producer. It does not introduce the plugin framework or migrate other
producers. This avoids a second, column-based convention before that refactor.
