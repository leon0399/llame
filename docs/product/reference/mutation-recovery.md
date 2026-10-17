---
summary: "How a native mutation is fenced before it changes bytes, and what to do when an attempt's outcome is unknown"
read_when:
  - a mutation attempt may have run and you need to know whether it is safe to retry
  - you need to know what a redelivered Run does with a started mutation
spec: native-file-tools
configured_by:
  - ../operator/native-files.md
---

# Mutation recovery

## Executor binding

The first absolute-path native operation binds its Run to the configured executor
identity. A different executor cannot resolve those physical paths on
reattachment. Mutations are ordered in the host process, including symlink
aliases; external editors and other uncoordinated processes are outside that
guarantee.

## Attempt fence

Before an edit or write changes bytes, on either scheme, its attempt is committed
to the existing owner-scoped Run event log — for `kb://`, recorded against the
locator, never the resolved host path. The result is committed before the model
continues.

A recovered open attempt returns `outcome_unknown`; a queue retry of a Run that
started a mutation terminates instead of replaying its model loop. Reconnecting
clients replay recorded activity without running tools again.

A `kb://` mutation uses this same fence without binding or requiring an executor
identity, so a retry on a different worker still reports `outcome_unknown` rather
than `executor_unavailable`.

The fence survives `bypass`: it is not a permission-group clause, so it applies
under every permission mode; see [permission modes](permission-modes.md).

## Unknown outcome

After an unknown outcome, read the file's current state before authoring a new
attempt. Do not assume a timeout means the file was unchanged.

A `bash` attempt is fenced the same way before start. A live unproven stop
records `outcome_unknown` as a tool observation, tells the model to inspect the
workspace before retrying, and leaves the Run continuing with later bash calls
admitted. An in-flight shell process group can still survive a worker crash; a
replacement worker may admit a new bash command beside it. The durable attempt
record still prevents Run recovery from replaying the unfinished command, and
that recovery path terminates the Run with `outcome_unknown`.

## Configured by

[native files](../operator/native-files.md) enables the host executor and the
`edit`, `write`, and `bash` entries the fence covers.
