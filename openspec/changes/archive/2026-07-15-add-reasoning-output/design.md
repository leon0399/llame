## Context

The API already normalizes AI SDK reasoning deltas into `reasoning.delta` run events, the run-event bridge already emits the AI SDK reasoning stream protocol, and the web client already renders reasoning parts. The current OpenAI client always targets Chat Completions. The run executor separately accumulates all reasoning, tools, and text and writes them in a fixed grouping, which can change their live occurrence order after a history reload.

The live configuration has native OpenAI plus two ad-hoc OpenAI-compatible endpoints. The catalog's `reasoning: true` boolean is currently metadata only and remains so. Native OpenAI behavior is proved by a bounded paid smoke, not inferred from provider docs. Third-party compatibility remains the provider's responsibility until a separately scoped spike establishes a supported extraction route.

## Goals / Non-Goals

**Goals:**

- Prove a native OpenAI displayable-reasoning request/stream path with a live smoke before coding it.
- Persist every normalized displayable reasoning delta received by llame in the same order as text and tool activity, before browser fan-out.
- Preserve partial output from successful and failed runs; retain displayable reasoning with the chat until deletion.
- Keep displayable reasoning private and display-only: it does not enter future model context, compaction, search, or public shares.

**Non-Goals:**

- Adding operator-facing reasoning settings, provider probing, config changes, or a config-schema migration.
- Promising extraction from OpenRouter, Hugging Face, or another OpenAI-compatible endpoint, or adding their request fields, raw parsers, or middleware.
- Changing the existing frontend reasoning component.
- Persisting opaque continuation state as chat history.

## Decisions

### Prove native OpenAI before choosing an adapter call shape

Before implementation, run deliberately hard prompts through configured `gpt-5.4-mini`; if no reasoning is observed after the bounded probe, repeat with configured `gpt-5.5`. The spike records the exact native OpenAI request options, normalized stream chunks, run-event sequence, and persisted/reloaded message parts. A response with no reasoning is a valid model response, not a run failure.

Only the request/adapter shape demonstrated by this smoke enters implementation. This avoids treating documentation or model-name guesses as proof. The existing `reasoning` catalog boolean remains metadata-only; it does not gate requests or become a runtime contract.

### Third-party compatibility stays passive

The existing OpenAI-compatible Chat Completions client remains unchanged for OpenRouter, Hugging Face, and other third-party endpoints. If the existing AI SDK path produces normalized `reasoning-delta` chunks, llame persists them. This change does not send vendor-specific extensions, parse unrecognized SSE fields, extract tags from text, or add middleware.

### Use one ordered assistant-part collector

The executor replaces separate reasoning, tool, and final-text grouping with an occurrence-ordered collector. Each received reasoning delta is appended to the durable run-event log before fan-out to the browser. A reasoning delta opens or appends a reasoning part; text or tool activity closes it. The final assistant message is projected from that durable sequence for both successful and failed runs.

The collector preserves whatever reached llame, even if either llame's worker or the upstream provider later fails. It must not regroup parts after reload.

### Separate displayable text from transient continuation state

Displayable reasoning persists as `{ type: "reasoning", text }` in chat history indefinitely, subject to normal deletion. It is omitted from later model context, compaction, search, and public shares.

Opaque provider continuation state is not displayable reasoning. When a proven native OpenAI path requires it to finish the active durable run, retain it as private run state only; do not render it, add it to subsequent chat context, or retain it once the run completes.

### UI remains unchanged

The existing message renderer remains untouched. This work only makes its already-supported reasoning parts arrive in the durable transcript and on the existing stream protocol.

## Risks / Trade-offs

- [Native OpenAI does not emit reasoning in the probe] → Escalate from `gpt-5.4-mini` to `gpt-5.5`; if still inconclusive, do not infer an implementation.
- [A third-party endpoint returns non-normalized reasoning] → It remains unsupported in this slice, rather than adding speculative extraction behavior.
- [A worker or upstream provider fails mid-stream] → Persist all reasoning that reached llame before the failure; project it alongside the terminal run status.
- [Live and reload transcript drift returns] → Add interleaving/reconnect/history tests against durable event order.

## Migration Plan

1. Complete and record the native OpenAI spike; implementation begins only after it proves a path.
2. Deploy with no database migration, config-file change, or frontend change. Existing messages retain their current parts unchanged.
3. Rollback is code-only. Previously stored displayable reasoning remains private chat history and stays excluded from context/search/shares.

## Open Questions

- The exact native OpenAI adapter/request shape is intentionally unresolved until the required live spike provides evidence.
