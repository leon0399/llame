## Why

A Run that fails, is cancelled, expires, or crashes keeps its partial
assistant answer but discards every rail item the model saw
([#1177](https://github.com/leon0399/llame/issues/1177)). The next turn's seen
state is derived from what was published, so it loads the same instruction
files again, re-announces the same catalog, Workspace, digest, and
availability changes, and replays the failed Run's output without the context
that produced it. A live chat showed 11 instruction files (75 KB) reloaded
after a crash, and an `apps/api/AGENTS.md` bundle loaded mid-Run gone until the
directory was touched again.

The rule "publish staged context only with a successful turn" makes history
disagree with what the model was shown. It also leaves two inconsistencies:
`runs.context_items` is written at first dispatch for every Run, so failed Runs
already keep a record the spec says only successful Runs have, and the
model-switch item compares against the previous Run of any status while the
spec says "most recent successfully committed".

## What Changes

- **Every rail item is persisted when the request that first carries it
  dispatches, whatever the Run's outcome.** Accepted-turn items go on the user
  message before the Run's first model request; in-Run items are recorded as a
  `context.item` Run event before the step request that carries them, and the
  assistant message keeps them at their step position on every settlement.
- **Seen and told state commits with the items it accounts for.** The
  recency-digest baseline and told set, the skill-catalog baseline and told
  set, the Workspace told set and detach-reason clear, and the turn's tool
  availability record are written in the same transaction as the accepted-turn
  items, before the first request.
- **A retry of a dispatched Run reuses its persisted items** instead of
  authoring new ones. A new `runs.dispatched_at` marks that the Run's context
  reached the model.
- **Every comparison baseline follows dispatch, not success.** The model-switch,
  tool-availability, and epoch baselines read the most recent prior Run that
  dispatched, whatever its outcome, because its items are in history.
- **`runs.context_items` and `GET /api/v1/runs/:id/context-items` are
  removed.** The transcript records what the model saw; the column copied
  every rail item since the last checkpoint on every Run, and no UI calls the
  endpoint. **Breaking** for API clients of that endpoint.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-injection`: one dispatch transaction per attempt, reuse on retry,
  in-Run items as Run events, and removal of the per-Run record.
- `model-system-prompts`: the switch baseline and the publication wording.
- `instruction-files`: a failed attempt's loaded files stay seen.
- `chat-recency-digest`: baseline and told state commit at dispatch; one
  requirement renamed to "Digest baseline and disclosure state commit before
  dispatch".
- `tool-calling`: the availability baseline is the preceding dispatched turn;
  one requirement renamed to "Attempt availability is disclosed against the
  preceding dispatched turn".
- `mcp-tools`: namespace filtering compares against that same baseline.
- `durable-runs`: the final assistant projection keeps rail items.
- `temporal-anchor`: the temporal item is written at dispatch.
- `workspace-entry`: the detach reason clears at dispatch of the narrating
  turn.

## Impact

- `apps/api/src/runs` (staging, publication, settlement, durable
  reconstruction, repository), `apps/api/src/chats` (context builder), the
  skill, digest, and Workspace state writers, and `apps/api/src/compaction`
  comments.
- A migration dropping `runs.context_items` and adding `runs.dispatched_at`; OpenAPI and the generated web
  client lose the endpoint and its DTOs.
- Operator and reference docs that mention the context-item record;
  `CHANGELOG.md`.

## Acceptance

- A Run that fails, is cancelled, expires, or ends `outcome_unknown` after its
  first request leaves its accepted-turn items on the user message and its
  in-Run items on the assistant message at their positions.
- The next turn after such a Run loads no instruction file already loaded,
  emits no second catalog, Workspace, digest, or availability notice for the
  same change, and emits no model-switch item when it keeps the failed reply's
  model.
- A retried attempt of the same Run produces no duplicate item.
- `runs.context_items` no longer exists and the endpoint returns 404.

## Decisions for approval

- **P1 Everything the model saw commits before it sees it.** Items, told sets,
  baselines, and the availability record share one pre-dispatch transaction,
  so history and seen state cannot diverge. The alternative, publishing items
  at dispatch but advancing told sets only on success, re-announces every
  change after a failure.
- **P2 In-Run items travel as Run events.** The assistant message row stays
  created at settlement, and durable reconstruction already rebuilds the
  assistant turn from `run_events`; creating the row at dispatch would add a
  second write path for a partial reply.
- **P3 Baselines follow dispatch, not success or reply.** A failed Run on
  model `A` is in history with its switch item, so a next turn on `A` needs no
  item and a turn on `B` compares against `A`. The issue suggested the latest
  assistant reply, but a Run that dispatches and fails before any output has
  no reply yet did put its switch item in history, so `dispatched_at` is the
  marker.
- **P5 A retry of a dispatched Run neither re-authors nor compacts.** It
  reuses the dispatched items verbatim; only a Workspace detach is narrated
  again. If its request no longer fits, it fails `context_incompatible`.
- **P4 The per-Run record is deleted, not repaired.** Every entry is
  byte-identical to a persisted part, and nothing reads it.

## Non-goals

- Moving the digest, skill, and Workspace state out of `chats` columns (#1070).
- Changing what a checkpoint absorbs or how compaction re-baselines.
- Changing prompt-import or skill-activation persistence, which already
  happens before dispatch.
