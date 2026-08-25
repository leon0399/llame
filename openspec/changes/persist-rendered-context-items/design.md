## Context

See proposal.md — Why. The current `data-context` part stores `{ v, producer, form, runId, payload }`; request assembly validates that semantic payload, dispatches to the current producer renderer, wraps the result in the current shared envelope, sorts the resulting items through the current producer list, and records the resulting text separately on the Run. The Run record is already an exact historical audit artifact, but it is not message-addressable replay state and is written only after the final request is prepared.

The message `parts` column is unconstrained JSONB, while `data-*` UI parts conventionally keep their payload beneath `data`. Compactions are separate first-class rows: `summary` is needed for lineage, UI, and subsequent compaction, but the complete checkpoint envelope is currently regenerated from it on every request.

Server-authored message-part changes are coordinated API/worker revision boundaries. Client message DTOs admit text parts only, direct service callers are sanitized, public shares and search omit context parts, and the owner UI reads structured model-switch metadata while hiding all context parts from the ordinary transcript.

## Goals / Non-Goals

**Goals:**

- Make a post-cutover context item's application-level text block and its position immutable for its lifetime.
- Keep structured metadata available without letting it become a second replay authority.
- Preserve active legacy compaction summaries without backfilling historical data.
- Keep client forgery, public egress, search exclusion, owner-only Run records, transition compaction, and model-switch UI behavior intact.
- Make future producer additions generic on the read path after the versioned cutover.

**Non-Goals:**

- Byte stability of the entire provider request. User-text neutralization, sender attribution, tool-observation projection, SDK/provider serialization, and effective system prompts retain their existing lifecycles.
- Enforcing the repository-wide lossless-replay invariant for every existing non-context-item projection. This slice makes context items and checkpoints comply; any remaining transformation is a separate explicit contract conflict rather than an implied exception.
- Backfilling, reshaping, or deleting existing data-only context parts.
- Removing producer payloads or redesigning the owner model-switch boundary.
- Introducing a generic historical-message mutation or revocation framework.
- Making context-item text visible in ordinary transcripts, public shares, exports, or search.

## Decisions

**Use a versioned AI-SDK data part with literal text inside `data`.** New parts use the existing `type: 'data-context'` discriminator and a new envelope revision:

```ts
type PersistedContextItemPart = {
  type: "data-context";
  data: {
    v: 2;
    producer: string;
    form?: string;
    runId: string;
    payload: Record<string, unknown>;
    text: string;
  };
};
```

`data.text` contains the complete final text block, not merely the producer body: opening tag and attributes, core provenance line, producer framing/body, and closing tag. Keeping `text` beneath `data` follows the SDK's `data-*` part shape and avoids inventing a hybrid text/data part. Alternative — a top-level `text` field — has no behavioral gain and makes web/UI typing less conventional. Alternative — replacing metadata with a text-only part — breaks model-switch UI and transition-compaction detection and forces control behavior into string parsing.

**Text and metadata have disjoint authority.** `data.text` alone controls model replay. `producer`, `form`, `runId`, and `payload` control classification, owner UI, transition-compaction gating, receipt labels, and diagnostics only. Replay validates the v2 core shape and uses `text` without producer dispatch. A producer-specific consumer validates its payload before acting; an invalid or unknown payload cannot make the replay path reinterpret text. A mismatch is possible only through a defect or storage corruption; the model receives `text`, while machine behavior fails closed against invalid metadata.

Alternative — re-render and compare at replay — recreates the defect: the comparison changes whenever legitimate wording changes. A text hash proves storage integrity only against itself and adds no useful coherence check, so none is stored.

**Render, neutralize, frame, and order exactly once in the accepting API.** Producer factories still accept typed semantic input and validate it. They immediately generate the complete block and return v2 metadata plus text. The chat binder builds the parts array in canonical producer order before the user-message/Run/snapshot transaction commits. The worker preserves array order and converts each v2 block directly to one provider text-content block. It does not sort context parts or call producer renderers.

This moves the trust boundary: recency titles/excerpts and any future untrusted producer inputs must be neutralized before persistence. A later sanitizer correction does not silently rewrite history. If a security defect requires historical correction, it needs an explicit reviewed data transition whose cache and conversation-integrity consequences are visible.

Alternative — keep replay-time sanitization around already-rendered text — makes exactness conditional on the sanitizer version and risks corrupting legitimate envelope markup. Alternative — retain semantic rendering but version every renderer forever — couples replay to an unbounded renderer archive, runtime timezone data, and historical bugs.

**Stored array order is historical authority.** The fixed precedence list remains the authoring rule. Replay no longer sorts. This is necessary because changing the list or teaching a worker a new producer must not reorder prior content blocks. The API already emits current producers in canonical order, so retaining a second sort in the worker buys no correctness and creates drift.

**Keep v1 parts stored but inert.** A v1 semantic-only `data-context` part contributes no block after cutover and is recorded as an empty contribution in later Run context records. There is no cleanup migration, backfill, current-renderer fallback, or compatibility renderer for message parts. The owner UI must accept both versions long enough to hide both safely; only v2 switch parts can power the structured boundary after cutover unless an existing v1 boundary is deliberately retained as display-only parsing.

Alternative — rewriting v1 parts with today's text — falsely asserts that today's renderer was what prior Runs saw. Alternative — deleting v1 parts — destroys audit/provenance data without reducing read complexity, because the version discriminator already handles it.

**Persist complete checkpoint text separately from raw compaction summary.** Add nullable `compactions.model_text`. Every new compaction writes non-empty `summary` and the complete rendered checkpoint to `model_text` atomically. Context assembly uses `model_text` verbatim when present. `summary` remains unchanged because it is the owner-visible and lineage/composition artifact; storing only the envelope would force later compaction to parse model-facing framing back out.

Existing rows have `model_text = NULL` and use the current legacy checkpoint renderer until superseded. This is the one explicit legacy exception. Dropping such a checkpoint would remove all history through `upto_seq`; backfilling it would claim an invented historical projection. A later compaction consumes the legacy projection during summarization and creates a new row with literal `model_text`.

Alternative — use `runs.context_items` as checkpoint storage — is rejected: the blob describes an entire request, has no stable per-message/per-compaction association, may not exist before execution, and can be replaced when transition compaction rebuilds the request.

**Run records remain a separate exact audit artifact.** Context assembly returns `RunContextItem` entries by copying v2 `data.text`, by capturing the chosen legacy checkpoint rendering, and by recording empty text for omitted v1 message parts. After transition compaction, the rebuilt request replaces this list exactly as today. The executor writes the final list only after request preparation succeeds. This duplication is intentional: the message/compaction record is replay authority; the Run row says what a particular inference actually received.

**Preserve current egress and ownership rules.** Owner-authenticated message responses may carry v2 metadata and text because the owner already receives private parts; the web client must swallow every `data-context` version generically and inspect only validated v2 model-switch metadata. Public-share DTOs, shared forks, ordinary exports, list excerpts, and search projections continue to select visible `type: 'text'` content only. Private owner forks copy the complete part verbatim, including original Run linkage, matching the current temporal-row behavior.

**The guarantee stops at application-level context blocks.** Tests freeze `ModelMessage` content-block text and order across an intentional renderer change. They do not assert provider-wire identity. Provider adapters may still change serialization, and other replay projections may still evolve. Documentation and test names must not inflate this bounded guarantee into whole-request cache stability.

## Risks / Trade-offs

- **A historical unsafe block cannot be repaired by a renderer update** → Neutralize and validate before commit; require an explicit reviewed data transition for a security correction instead of a silent replay mutation.
- **Text and metadata can disagree after corruption or a writer bug** → Generate both in one factory and transaction; make text authoritative for the model and validate metadata independently before machine action. Do not parse one from the other.
- **Mixed revisions drop v2 items** → Deploy compatible readers/workers before authoring v2, quiesce old API writers, and drain accepted Runs before cutover.
- **Legacy v1 reminders disappear from future model context** → Accept the bounded loss explicitly, retain rows and prior Run records, and do not misrepresent backfilled prose as historical truth.
- **Legacy checkpoints remain renderer-mutable** → Restrict the exception to `model_text IS NULL`; every new compaction closes it for the active history without a backfill.
- **Literal text duplicates semantic payload and Run audit text** → Accept modest JSONB growth in exchange for clear replay and audit authorities; context-item text already consumes provider tokens on every later turn.
- **Future producer text may be unbounded** → Keep producer-specific validation and bounding at authoring; this change does not introduce a generic truncation policy.

## Migration Plan

1. Land backward-compatible readers, v2 validators/types, nullable `compactions.model_text`, and tests while v1 writers remain active. Readers continue the existing v1 behavior during this preparation release.
2. Deploy compatible workers everywhere. Verify they can replay v2 text, preserve stored order, and read both nullable checkpoint forms before any API authors v2.
3. Quiesce old API writers and drain every accepted Run so no old API/new worker or new API/old worker pair crosses the writer boundary.
4. Deploy the writer cutover: producer factories persist v2 full text, new compactions require `model_text`, and readers switch v1 message parts to inert legacy behavior.
5. Deploy the web parser in step with the cutover so v2 model-switch metadata remains owner-visible while all context text stays hidden from ordinary transcript rendering.
6. Verify the database contains no post-cutover v1 parts and no post-cutover compaction with `model_text IS NULL`; do not alter pre-cutover rows.

Rollback: stop v2 authoring and drain accepted Runs before rolling workers or APIs back. V2 parts and `model_text` are additive JSON/column data and remain recoverable. Older workers will ignore v2 parts, so rollback restores service compatibility but may temporarily omit reminders authored during the v2 window; it MUST NOT rewrite them into v1. The nullable column remains in place. Once an older API is active, new compactions may again have `model_text IS NULL`, so reapplying the cutover requires repeating the writer drain and post-cutover invariant check.
