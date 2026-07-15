## 1. Evidence gate

- [x] 1.1 Define bounded deliberately hard native-OpenAI smoke prompts and record expected evidence without treating a zero-reasoning response as a run failure.
- [x] 1.2 Run the smoke against configured `gpt-5.4-mini`; when inconclusive, run it against configured `gpt-5.5`.
- [x] 1.3 Record the proven native request shape, normalized stream chunks, event ordering, persistence/reload result, and zero-reasoning result; stop for a scoped investigation if no reasoning span is observed.

## 2. Durable normalized-reasoning pipeline

- [x] 2.1 Add tests that drive normalized reasoning/text/tool interleavings through the existing model client and assert durable event order, browser stream order, and historical message order.
- [x] 2.2 Implement ordered assistant-part projection from durable events for both successful and failed terminal runs, retaining partial reasoning received before failure.
- [x] 2.3 Ensure each received reasoning delta is durably recorded before browser fan-out and reconnection replays every browser-visible delta.
- [x] 2.4 Preserve the existing exclusions from later model context, compaction, search, and public sharing; add regression coverage.

## 3. Native OpenAI path

- [x] 3.1 Implement only the native OpenAI request/stream behavior proven in task 1, without changing `models[].reasoning` semantics or configuration.
- [x] 3.2 Keep OpenRouter, Hugging Face, and other third-party OpenAI-compatible endpoints on their existing path; add tests that no vendor-specific request fields, raw parsing, tag extraction, or middleware is introduced.
- [x] 3.3 Handle opaque provider continuation state only if task 1 proves it is required for the active run; keep it private and delete it at the terminal run state.

## 4. Verification

- [x] 4.1 Run focused API tests for ordering, failure persistence, reconnect replay, retention exclusions, and native OpenAI request/stream behavior.
- [x] 4.2 Run relevant workspace lint, type-check, format check, and the required live native-OpenAI smoke; record the evidence and any intentionally inconclusive result.
