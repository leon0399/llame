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
    assistant reply at their step position, with the reply's part snapshot.
- The assistant reply row exists from the first model request with a
  non-completed `running` status whose usage records the Run, attempt, model,
  effort, and a bypass permission mode. One finalizer, shared by the chat
  module and the run worker, ends every terminal path (completion, failure,
  cancellation, worker expiry, retry exhaustion, cancellation before start,
  native recovery, pickup failure, the claim-time finish paths, expiry by a
  new message, lost settlement) and always writes terminal usage. A settler
  that holds the attempt's live output persists it with its in-Run items in
  place, so a completing turn is stored as today; any other settler rebuilds
  the reply from the event log of the attempt that last dispatched, around
  the stored items, or creates it from the Run's full log when no reply row
  exists. A retry resets the reply in its own dispatch transaction, which
  removes a dead attempt's output and in-Run items together; a retry that
  fails before dispatching leaves the earlier reply untouched.
- History, public shares, forks, and the chat-list preview skip a `running`
  reply; the live stream renders it, and it appears in history once it is
  finalized. A fork anchored on a `running` reply is not found.
- Told and baseline state that records what history has told the model
  (Workspace told root and detach reason, recency-digest told set and
  disclosure accounting, skill-catalog told set, the tool-availability
  comparison record) advances in the same transaction that persists the item
  it accounts for. The first digest baseline and the first skill-catalog
  freeze stay with the winning turn, because they live only in the system
  prompt.
- A Run counts as dispatched when it holds a tool-availability comparison
  record or completed. Epoch start, the digest supersession marker, and the
  availability baseline use the most recent prior dispatched Run, so a failed
  Run's persisted marker and baseline listing are not repeated.
- The model-switch baseline is the model recorded on the most recent prior
  assistant reply in the Chat below the triggering message, whatever its
  status and whether or not a checkpoint absorbed it, so a switch the model
  was already told about is not announced again.
- Accepted-turn items are inserted with a per-item identity, at producer rank
  on a Run's first dispatch. A retry after an earlier attempt dispatched
  keeps the items that dispatch stored, derives each producer again against
  those items and the state their dispatch advanced, and appends only what is
  new (for example a detach notice or a correcting availability reminder)
  after them, generalizing the existing `prompt-imports` and skill-activation
  precedent. A retry of a Run with no dispatched attempt stores everything as
  a first attempt does.
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
- Delivered as one stack: record removal, then user-message write-through,
  then reply-row write-through.

Assumptions that follow from those decisions but were not asked separately:

- Told and baseline columns keep their shape; only their write moves from
  successful settlement to the dispatch transaction (design D4). Leaving them
  success-only would re-announce persisted items after a failure.
- The model-switch baseline counts failed and cancelled replies and ignores
  checkpoints (design D5), for the same reason. It ships with the reply layer,
  the first layer in which every dispatched Run has a reply recording its
  model; the record and user-turn layers keep master's Run-based comparison.
- Epoch start and baselines follow the most recent dispatched Run, not the
  most recent completed one (design D11).
- A `running` reply stays out of owner-facing reads until it is finalized;
  the web app needs no change (design D10).
- No backfill: past failed Runs stay as they are, and existing
  `runs.context_items` data is dropped with the column.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-injection`: items persist at dispatch on the message their
  trigger belongs to, and staged items stop publishing only with a successful
  attempt or referring to the per-Run record, in "Server-authored context is
  injected as discrete items on one rail", "Co-occurring items have a total
  author-time order", "Residency determines whether a change re-renders the
  prompt or appends an item", "A prefix change is announced only when history
  was conditioned on the old value", "Compaction is the rail's re-baseline
  boundary", "An item is either persisted-literal or bind-time", "Worker-attempt
  cutover preserves existing conversation state", "Explicit activations are
  rail items carrying current instructions", "Catalog notices announce added
  and removed skills on the next user turn" (the told set commits in the
  dispatch transaction that persists the notice), "Skill activations remain
  separate from immutable enqueue receipts", and "Workspace binding changes
  are rail-resident context items". "Successful Runs record the winning
  attempt's injected items" is removed.
- `instruction-files`: accepted-turn and in-Run bundles persist at dispatch
  in "Entry, native file tools, and accepted turns are the only triggers" and
  "A file is loaded once per compaction epoch, derived from effective
  history"; the "Failed attempt leaves nothing seen" scenario keeps its title
  and now covers a retry dropping the superseded attempt's in-Run bundle with
  its output, while a failed Run's bundles stay seen; "Owners see which files
  were loaded, truncated, or denied" stops naming the Run record.
- `model-system-prompts`: "A model switch replaces the top-level prompt and
  preserves portable history" and "Model switches use canonical persisted
  context text and metadata" persist the switch item at dispatch with the
  latest prior reply in the Chat as baseline; "Every execution attempt
  resolves its effective context in the worker" keeps dispatched-turn
  comparison records and the D2 retry rule; "Compaction publishes a
  summary-only checkpoint before the Run's first model step" follows the new
  baseline; "Owners can inspect the exact effective context without seeing
  host paths" and "Context receipts and control metadata remain private
  projections" stop naming the Run record.
- `durable-runs`: "Run claiming and completion are crash-safe" creates or
  resets the reply in the dispatch transaction and finalizes it on every
  terminal path; "Final assistant-message projection preserves replay order"
  keeps the live collector's parts for settlers that hold it, rebuilds the
  reply from the last dispatching attempt's events around its stored items
  for settlers that do not, and keeps a `running` reply out of owner-facing
  reads.
- `tool-calling`: "Attempt availability is disclosed against the preceding
  successful turn" is renamed to "Attempt availability is disclosed against
  the preceding dispatched turn" and, with "Availability comparison retains
  only committed tool identities and states", writes the comparison record at
  dispatch, compares against the most recent dispatched Run, and lets a retry
  append a correcting reminder against the stored record.
- `chat-recency-digest`: "Digest baseline and disclosure state publish with
  the successful attempt" is renamed to "Digest baselines publish with the
  successful attempt and disclosure state with the dispatched request"; told
  set and disclosure accounting commit at dispatch, and a failed Run's
  supersession marker is not repeated.
- `workspace-entry`: "Each Run attempt re-checks the binding and detaches
  invalid state" clears the detach reason when the narrating item is
  persisted and narrates a retry's detach after the stored items.
- `owner-chat-forks`: "The owner selects a durable prefix" does not copy an
  in-progress reply and rejects an anchor naming one as not found.
- `mcp-tools`: "Disconnect withdraws tools and reconnect requires fresh
  discovery" stops withholding a failed attempt's model-visible history, and
  "MCP namespace filtering remains exact and lifecycle-safe" compares against
  the most recent dispatched turn.
- `tool-prompt-templates`: "Packaged cross-tool guidance follows membership"
  replays stored reminders on a retry.
- `run-usage-accounting`: "Usage records whether it is complete" defines the
  `running` usage and does not count the Run's own `running` usage as an
  earlier reply; "Every terminal assistant turn keeps its known usage" makes
  every finalizer write terminal status and identity fields, with
  `complete: false` and no token counts when the finalizer's own attempt is
  not the one named in the reply usage.

Deliberately unchanged: `prompt-imports` and `agent-skills` (already persisted
before the first request), `temporal-anchor`, `search-projection`,
`conversation-reads`, `chat-search` (retryable replies stay excluded until
completed), `run-cancellation`, `available-models`, and `permission-modes`.

## Impact

- `apps/api/src/db/schema/chats.ts` and a migration dropping
  `runs.context_items`; `runs.controller.ts`, `runs.dto.ts`, `openapi.json`,
  and the generated web client lose the endpoint.
- `apps/api/src/runs/run-execution.service.ts` (dispatch transaction, staging,
  settlement, model-switch baseline, epoch start), `runs-worker.service.ts`,
  `runs-repository.ts`, `apps/api/src/chats/context-builder.ts`,
  `assistant-transcript.ts`, `assistant-completion.ts`,
  `messages-repository.ts` (the shared reply finalizer), the
  prompt-import/activation part repositories, `chat-loop.service.ts` (the
  admission expiry path), the history, share, and chat-list reads, and
  `fork-copy.ts`.
- No `apps/web` change; its history tests and the chat-flow, tool-loop, and
  stop-from-submission e2e specs run as a regression check.
- Tests that pin the old behavior, including the "publishes no staged rail
  part when the attempt fails", "leaves nothing seen when an attempt fails
  after loading", record-assertion, and "does not use a failed prior run as
  the availability baseline" cases (tasks.md lists them per layer).
- `SPEC.md` §9.3, §9.7 (the availability baseline becomes the most recent
  prior dispatched Run), and §9.8; the `model-system-prompts` Purpose
  sentence, rewritten at finalize to persistence at dispatch;
  `docs/product/reference/instruction-files.md`,
  `docs/product/reference/prompt-imports.md`, and `CHANGELOG.md`.

## Non-Goals

- Persisting the system prompt or tool declarations in `messages`.
- Splitting the assistant reply into one row per model step.
- Moving model or effort onto `messages` columns.
- Backfilling past failed Runs.
- Changing how retryable replies are excluded from search and conversation
  reads.
- Changing the web app.

## Acceptance

- A Run whose worker dies after loading accepted-turn instructions leaves the
  bundle on the user message; the next turn loads nothing again.
- An in-Run instructions bundle loaded before a failure stays on the reply,
  after the step that triggered it, together with the output of the attempt
  that loaded it, including when native recovery settles the Run.
- Failed, cancelled, and expired Runs, a Run expired by a new message, and
  every other terminal path leave no reply in the `running` state, and every
  finalized reply carries terminal usage with its status and model.
- A retry after a crash keeps the stored accepted-turn items, its request
  carries no second copy of them, and it appends only what changed since; the
  dead attempt's in-Run items disappear with its output once the retry
  dispatches.
- After a failed Run that announced a model switch, a digest update, a
  supersession marker, or an availability change, the next turn does not
  announce it again.
- After a failed Run whose request carried an ordinary Workspace snapshot for
  a changed binding, the next turn does not repeat the snapshot.
- History, shares, forks, and the chat-list preview never show a `running`
  reply, and a fork anchored on one is not found.
- `runs.context_items` and `GET /api/v1/runs/{id}/context-items` no longer
  exist, and no other API exposes a Run-level item record.
