## Why

A Run that fails, is cancelled, expires, or loses its worker keeps the partial
answer it produced, yet every rail context item that answer was produced under
is discarded. The next turn derives its seen and told state from
`messages.parts`, finds nothing, and tells the model again: issue #1177 traces
a crash that reloaded a 75 KB instruction bundle (11 audited reads) and lost a
nested `apps/api/AGENTS.md` bundle from history. Every failure of a Run that
loaded context repeats this.

The same trace found `runs.context_items` duplicating `messages.parts`: every
entry is byte-identical to a persisted part, each Run re-copies every rail item
since the last checkpoint, failed Runs keep a record the spec forbids, and its
only reader is an endpoint no client calls.

## What Changes

- Every rail item a model request carries is persisted in `messages` in the
  transaction that dispatches that request, whatever the Run's outcome.
  Placement follows the trigger:
  - items triggered by the accepted user turn are stored on the triggering
    user message before its first model request;
  - items triggered by an assistant tool call are stored on that turn's
    assistant reply at their step position.
- The assistant reply row exists from the first model request with a
  non-completed `running` status. Every terminal path (completion, failure,
  cancellation, expiry, supersession, lost settlement) finalizes it from the
  Run's event log around the stored items; a retry's existing replacement of a
  non-completed reply removes a dead attempt's output and items together.
- Told and baseline state that records what history has told the model
  (Workspace told root and detach reason, recency-digest told set and
  baseline, skill-catalog told set, the tool-availability comparison record)
  advances in the same transaction that persists the item it accounts for.
- The model-switch baseline is the model recorded on the most recent prior
  assistant reply in effective history, whatever its status, so a switch the
  model was already told about is not announced again.
- A retry reuses the user message's stored accepted-turn items unchanged and
  derives its seen set from them, generalizing the existing `prompt-imports`
  and skill-activation precedent.
- **BREAKING (API)**: `runs.context_items` and
  `GET /api/v1/runs/{id}/context-items` are removed. The transcript is the
  record of what the model saw.

## Assumptions, confirmed with Leo (2026-10-10)

- The rule is "every item the model context sees is written to `messages`,
  always"; the items' lifetime follows the output they produced.
- User-turn-triggered items go on the user message, tool-call-triggered items
  on the assistant reply; the reply row is created at first dispatch rather
  than splitting the reply per model step.
- The seen set keeps deriving only from `messages.parts`.
- `runs.model_id`, `runs.effort`, and `runs.permission_mode` stay as the Run's
  execution inputs; readers that look back at finished turns use the assistant
  reply's recorded usage. Compaction keeps `completed_attempt_id`.
- `chats.workspace_told` stays a separate column (Leo has further plans for
  it).
- `system_prompt_receipts` and the in-memory tool declarations stay as they
  are; only rail items are in scope.
- Delivered as one stack: record removal and the model-switch reader, then
  user-message write-through, then reply-row write-through.

Assumptions that follow from those decisions but were not asked separately:

- Told and baseline columns keep their shape; only their write moves from
  successful settlement to the dispatch transaction (design D4). Leaving them
  success-only would re-announce persisted items after a failure.
- The model-switch baseline counts failed and cancelled replies (design D5),
  for the same reason.
- No backfill: past failed Runs stay as they are, and existing
  `runs.context_items` data is dropped with the column.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-injection`: the rail-item rule (items persist at dispatch on the
  message their trigger belongs to), author-time order, residency, the
  persisted-literal rule, worker-attempt cutover, explicit activations,
  catalog-notice scenarios, the activation/receipt requirement, and Workspace
  binding items stop saying staged items publish only with a successful
  attempt and stop referring to the per-Run record. "Successful Runs record
  the winning attempt's injected items" is removed.
- `instruction-files`: accepted-turn and in-Run bundles persist at dispatch;
  the "Failed attempt leaves nothing seen" scenario is replaced by one where a
  failed attempt's bundle stays seen; the owner chip stops naming the Run
  record.
- `model-system-prompts`: the switch item persists at dispatch with a baseline
  taken from the latest prior reply in history; inspection and private
  projections stop naming the Run record.
- `durable-runs`: the assistant reply exists from first dispatch and every
  terminal path finalizes it.
- `tool-calling`: availability reminders and their comparison record advance
  at dispatch; a retry reuses the stored reminder.
- `chat-recency-digest`: baseline and told state advance with the persisted
  digest item at dispatch.
- `workspace-entry`: the detach reason clears when the narrating item is
  persisted.
- `owner-chat-forks`: a fork taken during a Run does not copy the in-progress
  reply.
- `mcp-tools`: failed attempts no longer withhold model-visible history.
- `tool-prompt-templates`: a retry replays stored reminders.

Deliberately unchanged: `prompt-imports` and `agent-skills` (already persisted
before the first request), `temporal-anchor`, `search-projection`,
`conversation-reads`, `chat-search` (retryable replies stay excluded until
completed), `run-cancellation`, `run-usage-accounting`, `available-models`, and
`permission-modes`.

## Impact

- `apps/api/src/db/schema/chats.ts` and a migration dropping
  `runs.context_items`; `runs.controller.ts`, `runs.dto.ts`, `openapi.json`,
  and the generated web client lose the endpoint.
- `apps/api/src/runs/run-execution.service.ts` (dispatch transaction, staging,
  settlement, model-switch baseline), `runs-repository.ts`,
  `apps/api/src/chats/context-builder.ts`, `assistant-transcript.ts`,
  `messages-repository.ts`, the prompt-import/activation part repositories,
  `chat-loop.service.ts` (expiry and supersession paths), and
  `fork-copy.ts`.
- `apps/web` history adoption and render keys for a server reply that is still
  `running`.
- Tests that pin the old behavior, including the "publishes no staged rail
  part when the attempt fails", "leaves nothing seen when an attempt fails
  after loading", record-assertion, and "does not use a failed prior run as
  the availability baseline" cases (design.md lists them per layer).
- `SPEC.md` §9.3 and §9.8, `docs/product/reference/instruction-files.md`,
  `docs/product/reference/prompt-imports.md`, and `CHANGELOG.md`.

## Non-Goals

- Persisting the system prompt or tool declarations in `messages`.
- Splitting the assistant reply into one row per model step.
- Moving model or effort onto `messages` columns.
- Backfilling past failed Runs.
- Changing how retryable replies are excluded from search and conversation
  reads.

## Acceptance

- A Run whose worker dies after loading accepted-turn instructions leaves the
  bundle on the user message; the next turn loads nothing again.
- An in-Run instructions bundle loaded before a failure stays on the reply,
  after the step that triggered it.
- Failed, cancelled, and expired Runs, and a Run expired by a new message,
  leave no reply in the `running` state.
- A retry after a crash reuses the stored accepted-turn items and its request
  carries no second copy of them; the dead attempt's in-Run items disappear
  with its output.
- After a failed Run that announced a model switch, a Workspace snapshot, a
  digest update, or an availability change, the next turn does not announce
  it again.
- `runs.context_items` and `GET /api/v1/runs/{id}/context-items` no longer
  exist, and no other API exposes a Run-level item record.
