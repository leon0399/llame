## Why

llame currently sends one hardcoded system prompt to every model, so switching models changes the executor without changing the behavioral contract even when the target model needs materially different instructions. The prompt used for a turn is also invisible after execution, which makes model changes and prompt configuration impossible for users to audit.

## What Changes

- Replace the hardcoded chat prompt with a project-owned default prompt and optional complete per-model prompt files resolved from `llame.config.json` at boot.
- Ship only a moderately detailed baseline project prompt in this slice; use the public [`system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) corpus as research provenance without copying a comprehensive vendor prompt into runtime behavior.
- Resolve each model's prompt independently; a model without an override uses the project default, and both default and override files support only `${model.id}`, `${model.name}`, and the `$${model.name}` literal escape—without inheritance, general config traversal, or runtime model failover.
- Snapshot the exact system prompt and advertised tool contract used by each model run so the chat owner can inspect the effective model context after configuration or prompt files change.
- On a user-selected model change, run the target model with its newly resolved complete system prompt, portable prior chat history, a short server-authored model-switch reminder, and the triggering user message.
- Before invoking a smaller-context target model, compact the historical prefix with the previous model's last immutable context snapshot when that source model remains available; keep the triggering user message outside the summary and fail transparently rather than truncate when no capable source model is available.
- Keep compaction as a separate two-part contract: generate a structured operational handoff using the completed chat turn's model, effective system prompt, and identical provider-facing tool declarations with tool execution disabled, then inject a deterministic synthetic user-role conversation checkpoint ahead of retained recent history on later turns.
- Surface the switch immediately before the triggering user message using a compact, expandable context boundary aligned with the existing compaction treatment.
- Keep prompt receipts and model-switch context owner-only and exclude reminder text, prompt contents, generated compaction summaries, and checkpoint envelopes from chat search, public sharing, and ordinary transcript export.
- Preserve strict model execution: an unavailable selected model fails transparently and is never replaced by another model.
- Track progressive bounded compaction for unavailable-source and public-fork overflow as follow-up [#153](https://github.com/leon0399/llame/issues/153); accept that case as unsupported in this slice.
- Defer concrete production-grade per-model prompt authoring and evaluation, administrator-wide prompt layering, user `AGENTS.md`/`SOUL.md`/`USER.md` customization, prompt inheritance/composition, and live mid-generation user switching.

## Capabilities

### New Capabilities

- `model-system-prompts`: Project-default and per-model prompt resolution, immutable per-run prompt/tool receipts, target-prompt replacement on model switches, model-facing switch reminders, compaction continuity, and owner-visible prompt/context surfacing.

### Modified Capabilities

- `instance-config`: Add a dedicated optional per-model prompt-file setting with strict boot-time validation and a project-default fallback; its resolved content is intentionally user-visible while its operator filesystem path remains internal.
- `search-projection`: Explicitly exclude model-switch context parts, effective prompt/tool receipts, generated compaction summaries, and checkpoint envelopes from the episodic chat-search corpus while leaving original user/assistant messages canonical and searchable.

## Impact

- `apps/api/src/instance-config`: JSON Schema, config types/loader, boot validation, and example configuration.
- `apps/api/src/models`: resolved model configuration and model-client construction.
- `apps/api/src/chats` and `apps/api/src/runs`: context assembly, durable prompt/tool snapshots, model-switch detection/reminders, history DTOs, tenant isolation, and public-share filtering.
- `apps/api/src/search`: negative corpus-boundary coverage for prompt and switch metadata.
- `apps/web`: model-switch boundary and owner-only effective-context inspector near the triggering user message.
- OpenAPI output, project prompt files, tests, documentation, roadmap, and changelog.
