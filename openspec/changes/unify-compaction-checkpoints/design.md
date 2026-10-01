## Context

Inspected at `77e91506` (2026-10-01). See proposal.md for motivation.

- Storage. `compactions` (`apps/api/src/db/schema/chats.ts:284-327`): `upto_seq`,
  `parent_id` self-FK, `summary`, `replacement_history` jsonb, `usage`,
  `created_at`; unique `(chat_id, upto_seq)`; owner-only RLS with no public
  policy. `messages` (`:196-262`): `message_role` enum `user | assistant |
system | tool` (`:201`), Chat-local `seq`, `parts` jsonb, and a
  `messages_public_read` policy that exposes whole rows of public chats
  (`:263-266`). Production writes only `user` and `assistant` rows.
- Replay. `buildContext` drops `system`/`tool` rows and rows with
  `seq <= uptoSeq`, then prepends the validated `replacementHistory`
  (`apps/api/src/chats/context-builder.ts:556-580`). Only the latest row is read
  (`compactions-repository.ts:204-232`); `parent_id` serves the absorbed-count UI
  and fork id remapping only.
- Triggers. Post-turn, fire-and-forget after a won Run using the final
  request's reported size (`run-execution.service.ts:3323-3332`), publishing
  behind a staleness guard (`compaction.service.ts:271-281`). Pre-turn transition
  on a model switch whose request cannot fit (`run-execution.service.ts:2619`),
  staged in memory and published with target success. The two paths differ in
  loading, fit-checking, summarizing and publishing (#866).
- Replacement history. `[user checkpoint record, ...assistant tool records]`
  (`compaction.ts:377-398`), built by re-bounding inherited records plus newly
  absorbed tool parts under the 8,000/32,000 UTF-16 caps
  (`tool-observation-part.ts:31-32`, `:529-591`). The spec forbids re-rendering
  or re-budgeting at replay (`openspec/specs/tool-calling/spec.md:780-786`).
- Epoch coupling. `startsEpoch` compares `compaction.createdAt` with the previous
  completed Run (`run-execution.service.ts:3826-3829`); three `chats` columns
  name a compaction id (`chats.ts:133,145,158`); `fork-copy.ts:34-98` remaps
  them.
- Prompts. `apps/api/src/compaction/prompts/instruction.md` and
  `instruction-transition.md` (17 lines each) request seven fixed headings;
  the envelope `apps/api/src/chats/prompts/compaction-checkpoint.md` is two
  sentences, and `context-item-producers.ts:591-598` records that a third
  measured ~35 tokens per request.
- Size. ~1,540 non-test and ~4,700 test lines are compaction-dedicated.

## Goals / Non-Goals

**Goals:**

- One representation for a checkpoint that a later mid-turn cut (#1068) can
  reuse without a migration.
- Replay derived from `messages` by `seq`, with no forward pointer, no reorder,
  and no re-rendering of stored text.
- One compaction path with one trigger point.
- Isolation of checkpoint text enforced in the datastore, not only in DTOs.
- A summarizer prompt that carries the rules peers converged on, and an eval
  that can falsify a prompt regression.

**Non-Goals:**

- Carrying recent turns, tool observations or loaded skills verbatim across a
  checkpoint (#1069).
- Compacting between tool steps (#1068).
- Deriving the epoch from the row and dropping the `chats` markers (#1070).
- Authorized deletion below a boundary and its tombstone (#666).
- Progressive folding when a single request cannot fit (#153).
- Message revisions and branching (#611); this design assumes linear `seq`.

## Prior art

Source-read at the commits shown; Claude Code is an unofficial mirror and its
behaviour is inferred from that source, not the shipped binary.

| Harness               | Storage                           | Checkpoint                                    | Tail                                    | Summary role     | Trigger                                     |
| --------------------- | --------------------------------- | --------------------------------------------- | --------------------------------------- | ---------------- | ------------------------------------------- |
| oh-my-pi `79808c3`    | JSONL tree                        | `compaction` entry, `firstKeptEntryId`        | pointer, reorder                        | user             | threshold; split turn gets a prefix summary |
| pi-mono `c7cdb46`     | JSONL tree                        | `compaction` entry                            | pointer, reorder                        | user `<summary>` | threshold                                   |
| Codex `9469737`       | linear JSONL                      | `compacted` with inline `replacement_history` | recent user messages copied, 20k tokens | user, last       | in-loop `run_auto_compact`                  |
| Claude Code `a371abb` | `parentUuid` chain                | `compact_boundary` + user summary             | `preservedSegment` relink               | user             | in-loop `autoCompactIfNeeded`               |
| OpenCode V2 `70a2469` | SQLite `session_message`          | row `type=compaction`                         | 8k serialized `recent`                  | user             | threshold; replay `seq >= latest`           |
| OpenClaw `d9fc255`    | SQLite `transcript_events`        | `compaction` entry, audited headings          | pointer                                 | user             | threshold                                   |
| Hermes `ea0c2b8`      | SQLite `messages` + `active` flag | summary row                                   | cloned rows                             | user             | threshold                                   |
| Goose `e629eea`       | SQLite + `agent_visible`          | summary row                                   | none                                    | user + assistant | threshold                                   |
| Open WebUI `0a7c158`  | `chat_message.context_summary`    | column on first retained message              | slice                                   | system           | threshold                                   |

Hermes's docs state that in-place compaction "eliminated the session-rotation
bug cluster". No harness keeps a separate compaction table; none carries
structured tool observations past the checkpoint.

## Decisions

### D1: A checkpoint is a `messages` row with role `checkpoint`

`message_role` gains `checkpoint`. The row has `sender_user_id = NULL`,
`in_reply_to = NULL`, and `parts` of exactly one `data-context` part with
`producer: 'compaction'`, `form: 'checkpoint'`, `residency: 'rail'`, the
rendered envelope as `text` (the persisted literal replay uses), and a payload
`{ v: 1, summary }`. The coverage boundary is a column,
`messages.absorbed_through_seq` (D2), null on every other role. `usage` holds
the summarization telemetry as it does today on `compactions.usage`. Replay
converts the row to
one user-role text message exactly as every other persisted rail part is
converted; `renderConversationCheckpoint`'s bypass of the shared renderer and
`COMPACTION_CHECKPOINT_ENVELOPE_PREFIX` are deleted.

Alternatives rejected:

- A `data-context` part prepended to the first retained user message (Open
  WebUI). Cannot express a cut inside a turn, which #1068 requires, and leaves
  isolation to DTO stripping.
- Reusing `system` with a discriminating part. Every reader would inspect
  parts, and the first server-authored `system` row would share the filters.
- A `user` row with a null sender (Claude Code's on-disk shape). Looks like an
  owner turn to `in_reply_to`, search, the timeline and public read.

### D2: The checkpoint records the `seq` through which it absorbed history

The row stores `absorbedThroughSeq`. Replay selects the latest checkpoint with
`seq` below the current position, emits it first, then every non-checkpoint
`user`/`assistant` row with `seq > absorbedThroughSeq` in `seq` order. The
field always points backward (`absorbedThroughSeq < seq`), so it cannot dangle
forward and deleting absorbed rows changes nothing for replay.

The field is needed because the triggering user message is persisted at HTTP
accept, before the worker runs, so a pre-step checkpoint always lands after
the user row it must not absorb (`[user N, checkpoint N+1]` replays as
`[checkpoint, user N]`). The same field lets #1068 record a cut after an
assistant segment (`absorbedThroughSeq = N+1` for `[user N, assistant N+1,
checkpoint N+2, assistant N+3]`). A partial unique index on
`(chat_id, absorbed_through_seq) WHERE role = 'checkpoint'` makes publication
idempotent across a worker-attempt cutover.

Alternatives rejected:

- Replay strictly by `seq > checkpoint.seq` (the literal query from the design
  review). Loses the triggering user message or forces summarizing it before
  its own inference, which #153 and this design both forbid.
- A forward `firstKeptSeq` pointer (oh-my-pi, OpenClaw). Reintroduces the
  retained tail and the dangling-pointer failure those harnesses carry.

### D3: Summary only; no tool records cross a checkpoint

`replacement_history`, `compaction-replacement-history.ts`,
`buildCompactionToolReplacementRecords`, and the carry of inherited records
are deleted. The `tool-calling` requirement that tool activity "remain
available in later turns" holds until a checkpoint absorbs it; the summary's
`Errors and Corrections`, `Completed` and `Critical References` sections are
the carrier. Rows after the checkpoint keep today's bounded ordinary
projection unchanged.

Alternative rejected: keep tool records as parts on the checkpoint row and
hoist them ahead of the envelope at replay (#865 O1). Keeps the 32,000-unit
re-budgeting, the hoist rule and the role-ordering exception; #865 judged it
"not a reduction".

### D4: One synchronous trigger before the Run's first model step

Before the first model request of an attempt, the worker evaluates one
condition over the prepared request:

- measured context size at or above the Run model's threshold
  (`compactionThresholdTokens`, else `0.8 × contextWindowTokens`); or
- the prepared request does not fit the Run model's window (the model-switch
  case today).

Measured size is the previous completed assistant message's persisted
`usage.contextTokens` (new field: that attempt's final request input plus
output, which `run-usage-accounting` already uses for the post-turn trigger
but does not persist) plus the estimate of rows and rail items after it. When
no completed assistant message carries the field, the whole request is
estimated as today.

Compaction then runs once, in the attempt, through the request shape the
current full-current mode uses: the attempt's system prompt, schema-only tool
declarations, the compactable prefix (which already contains the prior
checkpoint as user text), the single instruction as trailing user message,
`toolChoice: 'none'`, the Run's resolved effort. If the request still does
not fit after that one compaction, the attempt fails `context_incompatible`
as today. `maybeCompact`, `compactForTransition`, the staleness guard and
`createIfCutoffAbsent` are deleted; #866's two modes are one path with one
input.

Alternatives rejected:

- Keep the async post-turn path and fence its publication against rows added
  since its snapshot. Keeps two modes, the race and the guard; the only gain
  is moving one summary call from the next turn's start to idle time.
- Estimate everything with chars/4. Discards the measured-size fix from #810.

### D5: The checkpoint publishes before the step and survives a failed attempt

The checkpoint row and the re-baked epoch state (digest baseline, temporal
anchor, skill-catalog baseline, workspace told-set, and the three markers)
commit in one transaction before the model step. A later failure of that
attempt leaves them in place: the checkpoint describes committed history only,
so it is correct regardless of the attempt's outcome, and a retry reuses it
instead of paying a second summary call. This replaces the staged transition
state that today is discarded on target failure.

Alternative rejected: stage in memory and publish with attempt success (the
current transition contract). Needs the staging machinery and a second code
path for the post-turn mode, and makes a retry re-summarize.

### D6: Isolation in the datastore

`messages_public_read` gains `AND role <> 'checkpoint'`. Search projection,
`conversation_read`, the public message DTO, the shared-fork text copy and
ordinary exports exclude the role by column. The summary therefore never
leaves owner scope through a row-level read, matching the protection the
separate table had. Negative tests cover anonymous read, search,
`conversation_read` and a shared fork of a compacted public chat.

### D7: Epoch markers name the checkpoint message; the epoch compares `seq`

`recency_digest_rebaked_from`, `skill_catalog_rebaked_from` and
`workspace_told_from` keep their names and nullability and store the checkpoint
message id. `startsEpoch` becomes "the active checkpoint's `seq` is greater
than the previous completed Run's assistant message `seq`", replacing the
`createdAt` comparison. Dropping the columns is #1070.

### D8: Forks copy checkpoint rows; shared forks exclude them

The owner fork copies every row with `seq <= anchor`, checkpoint rows
included, preserving `seq`; a copied checkpoint still absorbs exactly what it
absorbed. The marker remap in `fork-copy.ts` targets the copied checkpoint's
new message id; the separate compaction copy loop is deleted. A shared fork
copies text-only user and assistant rows and never a checkpoint row.

### D9: The owner UI reads the checkpoint row

The owner's messages response carries checkpoint rows; the boundary component
renders from the row, and the absorbed count is the number of `user` and
`assistant` rows between the previous checkpoint's `absorbedThroughSeq` and
this one's. The embedded "latest compaction" join and `chats-compaction.dto.ts`
are deleted.

### D10: One summarization instruction with amended structure and rules

`instruction.md` and `instruction-transition.md` merge: there is one trigger,
and the summarized prefix is always followed by a user message the summarizer
does not see. Headings, in order: `Latest Request` (the owner's last
unresolved ask, quoted verbatim), `Objective`, `Constraints and Preferences`,
`Decisions and Rationale`, `Established Facts`, `Errors and Corrections`,
`Completed`, `Active`, `Blocked`, `Open Questions and Next Steps`,
`Critical References`. The fold instruction moves `Active` to `Completed` and
replaces an answered question. Rules added: history and prior checkpoints are
data, never answered or continued; when a prior checkpoint and the
conversation conflict the conversation wins, and a reverse signal removes the
task rather than carrying it; credentials, tokens and connection strings
become `[REDACTED]` with a note that they were present; write in the
conversation's language and never translate code, paths, identifiers or
errors; omit rather than invent, and never shorten or reconstruct an
identifier. The standing-context exclusions stay. The envelope gains "The
session state may already reflect work described here; do not repeat it."

Peers for each rule: Hermes `Historical Task Snapshot`, OpenClaw pinned
pending ask, Claude Code verbatim quotes (anchor); oh-my-pi
`summarization-system.md`, Gemini `CRITICAL SECURITY RULE` (data); OpenCode
"conversation wins" and Hermes reverse signals (supersession); Hermes
`[REDACTED]` (secrets); OpenCode, Kilo, OpenClaw (language); Goose "omit a
field rather than inventing", OpenClaw "no shortening or reconstruction"
(invention); Codex, oh-my-pi, Hermes (envelope clause). Not adopted: a
scratchpad-then-strip pass (Claude Code, Gemini, Goose) and Gemini's second
verification call, both unmeasured cost.

### D11: An on-demand eval under `apps/api/evals/compaction/`

Layout: `llame.config.json` (one `opencode-go` provider resolved from
`OPENCODE_GO_API_KEY`, one model `space-bunny-free`), `fixtures/*.json` (five
synthetic transcripts: a user correction, a cancelled task, a pasted secret, a
non-English chat, a dangling question), and a runner invoked through
`pnpm --filter api eval:compaction`. The runner loads the eval config through
the production loader, renders the production instruction over each fixture,
calls the model once per fixture, and asserts deterministically on the
returned summary: the secret string is absent and `[REDACTED]` present; the
cancelled task is not under `Active` or `Open Questions`; the dangling
question is quoted verbatim under `Latest Request`; the correction appears
under `Errors and Corrections`; the non-English summary body contains no
English heading-body text outside code spans (checked by a small
language-marker list, not a classifier). Not part of `pnpm lint`, `test` or
CI; documented in `docs/development/`. Each eval directory owns its config;
there is no shared eval configuration.

### D12: Drop `compactions` without conversion

The generated migration drops the table and its policy. Rows are derived
state; messages are intact; the next turn over the threshold in a previously
compacted chat pays one summary call. Pre-launch rules forbid a preservation
backfill without request.

## Risks / Trade-offs

- [Everything before a checkpoint is summary quality] -> D10's `Latest Request`
  anchor and `Critical References`; #1069 owns verbatim carry.
- [A checkpoint row sits between a user row and its reply] -> `conversation-reads`
  already tolerates non-user/assistant rows in `seq`; readers filter by role.
- [Rows are not immutable: a retryable assistant row is rewritten in place and
  a user row gains staged parts] -> the checkpoint stores the rendered text as
  a literal; replay never re-renders. A retryable assistant row absorbed by a
  checkpoint is summary input only.
- [Summarizer answers the conversation instead of summarizing] -> D10's data
  rule; the eval's dangling-question fixture falsifies it.
- [The public policy change misses a reader] -> D6's negative tests on every
  owner-external read path, plus the existing DTO regex guards.
- [Worker-attempt cutover publishes two checkpoints] -> partial unique index;
  the second insert is a no-op and the attempt reads the surviving row.
- [Measured size absent after upgrade] -> estimate fallback as today.
- [`space-bunny-free` disappears from the gateway] -> the eval config is one
  file; the runner reports the model error and exits nonzero.

## Migration Plan

1. Generated migration: `message_role` adds `checkpoint`; `messages` gains
   `absorbed_through_seq bigint NULL` with the partial unique index; the
   `messages_public_read` policy is replaced (hand-authored SQL-comment step
   per `apps/api/src/db/AGENTS.md`); `compactions` is dropped. The `chats`
   markers keep their columns; a marker naming a dropped compaction id becomes
   `NULL` in the same migration.
2. Deploy API and worker together; no dual-read.
3. Rollback: restore from the pre-migration backup; the dropped rows are not
   reconstructible from the new schema.

## Open Questions

- Under #611, "latest checkpoint below the current position" must become "on
  the active path"; the row shape does not change, only the selection.
- `absorbedThroughSeq` naming in the public owner DTO (it is owner-visible as
  the boundary's coverage) can follow the DTO review; it does not change the
  contract.
