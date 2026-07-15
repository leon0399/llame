## Why

llame already accepts AI SDK-normalized reasoning deltas and its existing UI can render them, yet the database has no persisted reasoning parts or reasoning events. Its final message projection can also regroup reasoning, text, and tool activity, so a reloaded transcript can differ from a live run.

Native OpenAI output needs a live spike before implementation: the current client uses the generic Chat Completions model, and reasoning is not guaranteed on every request. Third-party OpenAI-compatible endpoints are best-effort only; llame must not infer their semantics or build an unsupported parser in this change.

## What Changes

- Run a bounded live native-OpenAI spike: deliberately hard prompts use configured `gpt-5.4-mini`, then configured `gpt-5.5` if the first model is inconclusive. Zero-reasoning runs remain valid; the spike must observe at least one reasoning span before it can validate collection.
- Implement only the native OpenAI request/stream path proven by that spike. The existing `reasoning` catalog boolean remains metadata-only; no configuration or reasoning-control behavior changes.
- Keep third-party OpenAI-compatible endpoints unchanged. They are best-effort consumers of any reasoning the existing AI SDK already normalizes; this change adds no vendor-specific request fields, parser, or middleware.
- Make displayable reasoning a durable, ordered assistant part: write each received delta before forwarding it to the browser, retain partial output from both failed and successful runs, and materialize the same order relative to text and tool parts on reload.
- Keep displayable reasoning indefinitely with its chat until normal chat/message deletion. Exclude it from future model context, compaction, search, and public shares.
- Retain opaque provider continuation state only while an active durable run needs it; never render it or retain it as chat history after run completion.
- Do not change the frontend; reuse its existing reasoning-part rendering.

## Capabilities

### New Capabilities

- `reasoning-output`: Native OpenAI collection subject to a live spike, ordered durable persistence/replay of normalized displayable reasoning, and retention/isolation rules.

### Modified Capabilities

- `durable-runs`: The replayable run transcript must preserve the occurrence order of reasoning, text, and tool activity in its final assistant-message projection.

## Impact

- Affects `apps/api` native OpenAI client path, run execution/event bridge, message-part persistence, and API-level tests.
- Uses the existing `ai` and `@ai-sdk/openai` dependencies. No migration, public API change, operator config change, or frontend change is required.
