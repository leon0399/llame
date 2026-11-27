# Design

## Context

A bash job row (`chat_jobs`) is created when the call binds to the Machine
(`bash-job-registry-start.ts`). The run already splits the model's `i` from the
arguments (`splitToolIntent`) and keeps it on the open call. Settled output is
stored as an artifact (`tool_artifact_parts`) that `artifact://bash-N` and
`job://bash-N/<output>` already serve, sanitized at settlement.

## Goals / Non-Goals

**Goals:** a stable owner-facing name for each job, a view of a settled job's
command and output, and a model-facing name that survives compaction.

**Non-Goals:** streamed live output, drag-resize, backfilled intents.

## Decisions

- D1. Store `intent` and `command` on the job row at creation, passed through a
  display-only `ToolContext.toolIntent`. Rejected: a request-time lookup of the
  `tool.requested` event, which ties the job API to the event log's shape.
- D2. The output route reads the job's existing artifact parts. No output is
  copied. Each stream is cut to its last 64 KiB at a line boundary and reports
  its stored `size`.
- D3. The response is a `oneOf` with the string discriminator `status`:
  `stored` or `unavailable`, as the git-state route does. A boolean tag is not
  a valid OpenAPI discriminator, and it allowed meaningless pairs.
- D4. A running job answers 409: its output lives on the Machine until it
  settles. Live output is a separate change because streaming needs redaction
  holdback across chunk boundaries.
- D5. The panel is the outer column of the Session details sidebar, which widens
  by `--finished-jobs-width`. Both columns keep fixed widths, so no text rewraps
  while the width animates, and a later resizable panel changes one value.
- D6. In model context the intent is model-authored text inside a system
  reminder, so the notice neutralizes its reserved delimiters as it does for
  output, and every listing or record line collapses its whitespace.

## Risks / Trade-offs

- `command` is stored and shown as the model submitted it. A command that
  embeds a literal secret shows that secret to the owner, who already sees the
  same text in the tool call part. It does not reach any other owner.
- The output lookup uses the job's `kind` and `seq`, as `job://` does, and
  relies on settlement aligning the job's `seq` with a reused artifact.
