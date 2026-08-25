## Context

`messages.parts` already stores AI SDK UI-message-shaped parts. The defect is
not the use of parts; it is replay-time authorship. A stored `data-context` part
currently contains `{ v, producer, form, runId, payload }`, and request assembly
uses today's renderer, sanitizer, and ordering rules to reconstruct model text.
The same class of reconstruction exists around user text, sender attribution,
and compacted tool observations.

The target invariant is application-level and best-effort: given stored
application/UI parts, later turns preserve prior model-bearing content and
order before appending new context. It does not promise provider-wire byte
identity. AI SDK/provider serialization can evolve, and the existing assistant
tool projector remains an explicit exception pending #599 because stored tool
parts do not currently prove multi-step boundaries.

Compactions are separate first-class rows. Their raw `summary` is needed for UI
and recursive summarization. Their replay form, however, must be stored as a
complete replacement for the superseded prefix, not reconstructed from summary
plus a semantic tool ledger.

## Goals / Non-Goals

**Goals:**

- Persist final server-authored reminder text and author-time order.
- Make replay a content-transparent conversion from stored UI parts into the
  AI SDK input vocabulary.
- Sanitize user text once, before persistence.
- Materialize every new compaction's complete replacement history, including
  bounded compacted tool observations.
- Preserve existing owner/private, public-egress, search, and RLS boundaries.

**Non-Goals:**

- Provider-wire or provider-cache byte guarantees.
- A second `model_messages` transcript or any duplicate per-message history.
- Backfilling existing metadata-only reminder parts.
- Supporting old compaction rows or mixed application revisions.
- Redesigning ordinary assistant/tool persistence in this change; #599 owns
  that research.
- Replaying reasoning, source display parts, cap notices, provider signatures,
  or other declared display-only artifacts.
- Closing #154. This proposal only records the replacement-history shape that
  future private fork work must preserve.

## Decisions

### Keep `data-context` v1 and add required final text

New server-authored context parts use the existing SDK-conventional data-part
shape:

```ts
type PersistedContextItemPart = {
  type: "data-context";
  data: {
    v: 1;
    producer: string;
    form?: string;
    runId: string;
    payload: Record<string, unknown>;
    text: string;
  };
};
```

Writers require `data.text` to be non-empty and store the complete final block,
including the opening and closing `<system-reminder>` delimiters. Readers keep
whitespace-only text verbatim, filter only the empty string, and do not trim or
normalize surviving content.

There is no v2 compatibility protocol. The product is in alpha preview; the
new v1 shape is the only supported writer contract. Historical rows lacking
`data.text` remain valid stored UI data but are not model-bearing. They are
omitted without regenerating text from metadata.

Keeping text beneath `data` matches AI SDK `data-*` parts and retains metadata
needed by owner UI and machine behavior. A hybrid top-level `text` field adds no
value. A text-only stored part would discard model-switch and provenance data.

### Text and metadata have disjoint authority

`data.text` alone controls replay. `producer`, `form`, `runId`, and `payload`
remain available for validated machine behavior, owner UI, provenance, and
diagnostics. If they disagree, the model receives `data.text`; the system never
parses or regenerates text to reconcile the mismatch.

An unknown producer or form does not block a structurally valid non-empty text
value from replay. Producer-specific machine behavior still validates its own
metadata and fails closed independently.

### Author once, then preserve parts and order

The accepting API validates producer inputs, neutralizes any untrusted values,
renders the complete reminder, and persists it in the canonical producer order
before the user-message/Run/snapshot transaction commits. Retries and workers
receive that stored form.

At the AI SDK transition, each non-empty `data-context.data.text` is mapped in
place to:

```json
{ "type": "text", "text": "<system-reminder>...</system-reminder>" }
```

Other model-bearing parts retain their stored order and are handed to the SDK
as parts. The application does not concatenate them into one string or re-sort
context items through the current producer precedence list. Empty context text
is omitted; all surviving parts replay verbatim.

The SDK remains responsible for converting UI messages/parts into provider
model messages. Therefore this contract protects application content and
ordering, not SDK-generated role grouping or provider serialization.

### Sanitize user text before persistence

Every submitted user text part is neutralized before it is stored. The stored
part boundaries and order are retained. Request assembly does not sanitize,
prefix sender ids, join parts, or otherwise rewrite them later.

Assistant output is not sanitized. Reasoning remains persisted for display but
is excluded from model replay. Existing accepted messages are assumed to carry
at least one part; no new empty-message policy is added.

This changes storage semantics for user text: the database contains the safe
application form rather than the original unsanitized submission. That is
intentional; retaining both would duplicate data and create competing replay
authorities.

### Store compaction as message-shaped replacement history

Replace `tool_observation_ledger` with a required JSONB
`replacement_history`. It uses the same application/UI part vocabulary as
ordinary stored messages:

```ts
type CompactionReplacementMessage = {
  role: "user" | "assistant";
  parts: MessagePart[];
};

type PersistedCompaction = {
  summary: string;
  replacementHistory: CompactionReplacementMessage[];
};
```

Every new ordinary or transition compaction atomically stores a non-empty raw
`summary` and a non-empty `replacementHistory`. The first record is one user
message with one text part containing the complete final compaction reminder:

```json
{
  "role": "user",
  "parts": [
    {
      "type": "text",
      "text": "<system-reminder>...complete summary checkpoint...</system-reminder>"
    }
  ]
}
```

Subsequent records contain any retained compacted tool observations. Compaction
still correlates complete call/result pairs by `toolCallId`, applies the current
per-pair and total budgets, clears payloads, preserves structured outcome, and
prefers newer pairs. It then stores the final AI SDK UI `tool-*` part instead of
storing semantic fields from which a later reader rebuilds that part. Each
retained pair occupies its own assistant replacement record because current
stored data does not prove which calls were parallel or where step boundaries
occurred. A bounded omission marker, when required, is likewise stored as a
final assistant text record rather than regenerated.

Replay inserts `replacementHistory` before the retained live window and passes
its records through the same SDK conversion boundary. It does not re-render the
checkpoint, re-project or re-clear tool observations, recalculate budgets, or
reorder replacement records.

A later compaction consumes the previous replacement history plus newly
absorbed live messages, then materializes a wholly new replacement history.
The raw summary remains separate because recursive summarization and owner UI
must not parse it back out of the `<system-reminder>` envelope.

There is no legacy fallback and no empty-ledger sentinel. Existing compactions
are outside the supported alpha contract; the schema/application cutover is a
single revision.

### Keep Run receipts and egress boundaries separate

`runs.context_items` remains an owner-scoped audit record of what one inference
received. For a persisted reminder it copies the same stored text used by the
request. This is not a second transcript: `messages.parts` and compaction
`replacement_history` are replay authority; the Run record is inference audit
evidence.

Owner-authenticated message responses return the stored parts array in the same
order. Context parts remain hidden from ordinary transcript rendering. Public
shares, shared/public forks, ordinary exports, list excerpts, and search select
only their existing public-safe content. A private owner fork copies message
parts wholesale. Future work on #154 must also preserve the applicable
compaction replacement history rather than reconstructing it.

## Risks / Trade-offs

- **Stored unsafe text no longer changes when a sanitizer is fixed.** Validate
  and neutralize before persistence. A historical security correction requires
  an explicit reviewed data transition, not a silent renderer update.
- **Text and metadata can disagree after a defect or corruption.** Generate
  both in one transaction; text wins for replay, while metadata consumers
  validate and fail closed.
- **Old metadata-only reminders disappear from future model context.** This is
  accepted. Retaining provenance without inventing historical prose is more
  honest than backfilling with today's renderer.
- **The alpha cutover rejects old compactions.** Accepted because there are no
  known testing-instance compactions and the user explicitly chose one
  contract. This assumption must be verified before implementation.
- **Assistant history is not yet a pure SDK conversion.** #599 records the
  bounded follow-up. Reworking it here without persisted step boundaries would
  replace one lossy guess with another.
- **Final tool UI parts duplicate some information summarized in prose.** This
  is deliberate continuity, bounded to identity/outcome observations. It is
  not a duplicate full transcript.

## Migration Plan

This is an alpha hard cutover, not a compatibility rollout:

1. Verify the target database contains no compaction rows; stop if that
   assumption is false.
2. Change the compaction schema from `tool_observation_ledger` to required
   `replacement_history` and deploy the matching application revision as one
   unit. Do not add a null fallback, data-only checkpoint renderer, or ledger
   compatibility reader.
3. Cut context writers/readers over together: new v1 parts require final text;
   existing context parts without text remain stored and replay as nothing.
4. Verify every new context writer stores non-empty text, every new compaction
   stores non-empty replacement history, and no replay path invokes a reminder
   or compaction renderer for stored history.

Rollback is application/schema rollback to the pre-change alpha database
contract. It does not rewrite newly stored parts or promise cross-version
readability. Do not run old and new writers/workers concurrently.
