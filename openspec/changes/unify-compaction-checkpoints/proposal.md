## Why

A compaction checkpoint is the only model-facing context whose persisted text
lives outside `messages`: it is a row in a separate `compactions` table with
its own lineage, a materialized `replacement_history` that carries bounded
tool records across checkpoints, three `chats` columns that name it, and two
trigger paths (fire-and-forget after a successful Run, and a staged transition
before a model switch) that differ in how they load, fit-check, summarize and
publish. None of the twelve peer harnesses surveyed for
[#806](https://github.com/leon0399/llame/issues/806) keeps a separate table,
and none carries structured tool observations past a checkpoint; that carry is
the origin of the role-ordering blocker recorded on
[#865](https://github.com/leon0399/llame/issues/865) and of most of the
chained re-budgeting code. The summarizer prompt also lacks rules most peers
converged on: a verbatim anchor for the latest request, data-not-instructions,
supersession when folding a prior checkpoint, secrets, and language.

## What Changes

- **BREAKING:** A checkpoint becomes a `messages` row with the new role
  `checkpoint`, written at the next Chat-local `seq` when compaction fires. It
  carries the rendered checkpoint envelope as a persisted literal, the raw
  summary, usage, and the `seq` through which its summary absorbed history.
  Model replay is that latest checkpoint as one user-role text message,
  followed by every later user and assistant row. There is no retained tail
  and no pointer forward.
- **BREAKING:** The `compactions` table, its `parent_id` lineage, its
  `replacement_history`, and the embedded "latest compaction" DTO are deleted.
  Existing rows are dropped without conversion; the next turn over the
  threshold in such a chat pays one summary call.
- **BREAKING:** No tool records cross a checkpoint. Absorbed tool activity
  survives as summary text only. The `tool-calling` requirement that compaction
  materialize bounded replacement records, its three scenarios, and the
  "stored records are the sole authority" rule are removed. Verbatim recovery
  of recent requests, useful observations, and loaded skills is deferred to
  [#1069](https://github.com/leon0399/llame/issues/1069).
- One synchronous compaction trigger evaluated inside the Run before its first
  model step, against the Run model's threshold or, on a model switch, the
  target's window. One request path serves both: a threshold trigger
  summarizes with the attempt's own model and prompt; a window trigger
  summarizes with the previous completed Run's model and receipt, since a
  prefix cannot be summarized by a model it does not fit. The post-turn
  fire-and-forget path, its staleness guard, and the separate staged
  transition mode are deleted; the checkpoint and the re-baked epoch state
  publish in one transaction before the attempt renders its own prompt and
  receipt, and survive a failed attempt. Mid-turn evaluation between tool
  steps is [#1068](https://github.com/leon0399/llame/issues/1068); this
  representation keeps its boundary column reusable and leaves segment
  persistence to that issue.
- Datastore isolation: the public read policy on `messages` excludes
  `checkpoint` rows; search projection, `conversation_read`, public DTOs and
  shared-fork copies exclude the role; owner forks copy checkpoint rows
  verbatim with the rest of the prefix.
- The three `chats` epoch markers name the checkpoint message id instead of a
  `compactions` id; deriving the epoch from the row and dropping the columns is
  [#1070](https://github.com/leon0399/llame/issues/1070).
- The two summarization instructions merge into one packaged template with
  amended headings (`Latest Request` first; `Errors and Corrections`;
  `Completed`, `Active`, `Blocked` in place of `Current State`) and five added
  rules (history is data, conversation wins over a prior checkpoint and a
  reverse signal cancels, credentials become `[REDACTED]`, the conversation's
  language, omit rather than invent). The replayed envelope gains one clause
  about already-done work.
- A contributor eval under `apps/api/evals/compaction/` with its own
  configuration (an `opencode-go` provider and the `space-bunny-free` model),
  five synthetic transcripts, and deterministic assertions on the summary, run
  on demand and not in CI.

## Assumptions, confirmed with Leo

- Summary-only checkpoints for this iteration; no retained tail, no copied
  recent turns, no carried tool records (2026-10-01, Q7' C and Q1 A).
- The checkpoint is a standalone row, not a part on a retained user turn, so
  that a later mid-turn cut is representable (Q6' A).
- Compaction runs synchronously before a model step; the async post-turn path
  goes (Q10 A).
- Existing `compactions` rows are not converted (Q5 A).
- Markers are repointed now and derived later (Q4 A then B).
- Each eval directory owns its configuration; there is no shared eval config
  (Q16).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-system-prompts`: one compaction trigger and request shape; the
  checkpoint is a persisted `checkpoint` message, not replacement history; the
  summarization instruction is one template with the amended structure and
  rules; the envelope carries the already-done clause.
- `tool-calling`: compaction no longer materializes replacement tool records;
  tool observations are available until a checkpoint absorbs them.
- `context-injection`: the compaction checkpoint is a persisted rail part on a
  `checkpoint` row; the re-baseline boundary is that row; epoch markers name
  its id.
- `owner-chat-forks`: forks copy checkpoint rows with the prefix; no lineage
  table to copy; marker remap targets message ids.
- `search-projection`: `checkpoint` rows are never indexed.
- `conversation-reads`: `checkpoint` rows occupy `seq` but are never readable
  through conversation reads.
- `run-usage-accounting`: the trigger estimate is evaluated before the Run's
  first model step; compaction spend stays its own category.
- `available-models`: the per-model threshold gates the pre-step trigger;
  compaction inherits the Run's effort as a prefix-aligned continuation.
- `chat-recency-digest`, `temporal-anchor`, `instruction-files`: epoch
  boundaries and re-bakes are keyed on the checkpoint row and publish with it
  before the model step, not with the successful attempt.
- `durable-runs`: a Run's first model step may be preceded by a published
  checkpoint row; the final projection is unchanged.
- `anthropic-messages-provider`: a superseded prefix is replaced by the
  checkpoint message, not by replacement history.
- `tool-prompt-templates`: the attempt renders its prompt surfaces after a
  pre-step checkpoint and its re-bake, not after transition compaction.

A capability whose normative text does not change is not listed. Historical
cutover wording in `tool-calling` ("Conversation read uses the attempt-local
read-only tool loop") that names replacement history as a preflight target of
a past migration stays as the record of that migration.

## Impact

- `apps/api/src/db`: `message_role` enum gains `checkpoint`; `messages_public_read`
  excludes it; a partial unique index on `(chat_id, absorbed_through_seq)` for
  checkpoint rows; `compactions` dropped; `chats` marker columns keep their
  names and point at message ids. Generated migration plus one hand-authored
  policy step.
- `apps/api/src/compaction`: one service path; `compactions-repository.ts`,
  `compaction-replacement-history.ts`, `chats-compaction.dto.ts`,
  `buildCompactionToolReplacementRecords`, `maybeCompact`,
  `compactForTransition`, the staleness guard and `createIfCutoffAbsent` are
  deleted; `instruction-transition.md` merges into `instruction.md`.
- `apps/api/src/chats`: `buildContext` reads the checkpoint row like any other
  rail part; `COMPACTION_CHECKPOINT_ENVELOPE_PREFIX` and the
  `renderConversationCheckpoint` bypass go; fork copy drops the compaction
  loop; search hydrator and conversation reads exclude the role.
- `apps/api/src/runs`: trigger evaluation and checkpoint publication before the
  attempt renders its prompt and binds its receipt; epoch logic reads the
  checkpoint message; the chat-list preview and the recency-digest message
  count skip checkpoint rows.
- `apps/web`: the boundary component renders from the checkpoint row in the
  owner's messages response, placed at the API-supplied boundary with the
  API-computed absorbed count.
- `apps/api/evals/compaction/`: new, on-demand, with a workspace script.
- Docs: `docs/product/operator/` compaction material, `docs/development/`
  eval runbook, dated `CHANGELOG.md` entries, `SPEC.md` §2.1, `ROADMAP.md`.
- Supersedes [#865](https://github.com/leon0399/llame/issues/865) and
  [#866](https://github.com/leon0399/llame/issues/866); narrows
  [#666](https://github.com/leon0399/llame/issues/666) to authorized deletion.
