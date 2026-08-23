# @workspace/harness

llame's agent harness core, extracted from `apps/api` so any host — the API's
durable run worker or a local CLI — can drive the same tool loop.

## Contents

- **Tool contracts** (`src/tools/types.ts`) — classified tools
  (SPEC §13.5's seven-value enum), structured `ToolResult`s, and a trusted
  context seam hosts extend with their own identity transport.
- **Tool runner** (`src/tools/tool-runner.ts`) — fail-closed execution:
  schema validation, per-call timeouts composed with the caller's abort
  signal, an approval gate in front of every non-read-only call (absent or
  failing gate denies), never-throws error mapping, and result truncation.
- **Schema utilities** (`src/tools/schema-utils.ts`) — Zod/JSON-Schema
  admission and SDK conversion (moved verbatim from `apps/api`).
- **Result truncation** (`src/tools/result-truncation.ts`) — the ~16KB cap
  with shape preservation and visible markers (#294 lineage).
- **Model client** (`src/models/`) — provider-neutral `ModelClient`
  contract plus the OpenAI-compatible Chat Completions implementation with
  step-cap enforcement and hallucinated-tool-call refusals (moved verbatim).
- **Run loop** (`src/run.ts`) — `executeRun` binds a context receipt (model,
  effective prompt, advertised tools, step cap) as the first narration event,
  then drives the AI SDK tool loop; every harness action is a `RunEvent`.
- **Session log** (`src/session.ts`) — append-only JSONL; the log is the
  single source of model context ("model-visible means logged"); run events
  ride along for owner-side audit but are never projected back into context.

## Consumers

Import from `@workspace/harness`. The built `dist` is what resolves at
runtime and typecheck time — build it first:

```bash
pnpm --filter @workspace/harness build
```

Tests are co-located (`src/**/*.test.ts`, Vitest node environment,
globals enabled to match the suites that moved here verbatim).
