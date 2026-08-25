## 1. Persisted Context-Part Contract

- [ ] 1.1 Add failing API tests for the v1 `data-context` shape with complete
      `data.text`: non-empty text replays verbatim, the empty string is filtered,
      whitespace-only text survives, metadata-only parts are omitted, unknown
      producer/form values do not block text replay, and text wins over conflicting
      metadata.
- [ ] 1.2 Update context-part types and validators so new server-authored parts
      require complete text while readers retain metadata-only historical parts
      without treating them as model-bearing.
- [ ] 1.3 Add failing context-builder tests proving stored part order survives a
      renderer/precedence change and each surviving context part becomes one SDK
      text part without manual concatenation.
- [ ] 1.4 Replace replay-time rendering, sorting, and metadata fallback with the
      minimal `data-context` to text-part conversion. Copy the same text into Run
      context receipts.

## 2. Author-Time Rendering and User Persistence

- [ ] 2.1 Add failing producer tests requiring model-switch, availability,
      recency-digest delta/supersession, and temporal factories to persist their
      complete canonical envelope plus metadata after author-time neutralization.
- [ ] 2.2 Refactor producer factories to validate semantic input and render
      complete v1 text exactly once before the accepting transaction commits.
- [ ] 2.3 Add failing chat-binding tests proving every submitted user text part
      is sanitized before persistence while part boundaries/order remain intact;
      replay does not sanitize, join, or prefix sender ids.
- [ ] 2.4 Move user-text sanitization to the accepting path, remove replay-time
      sender attribution and sanitization, and pass stored user parts through the
      SDK conversion boundary.
- [ ] 2.5 Verify client-authored context parts remain rejected, one temporal part
      is stored per accepted user turn, and server-authored parts commit atomically
      in canonical author-time order with the user message, Run, and snapshot.

## 3. Materialized Compaction Replacement History

- [ ] 3.1 Add failing schema/repository tests for a required JSONB
      `replacement_history` and removal of `tool_observation_ledger`. Verify the
      implementation precondition that the target database has no compaction rows;
      stop rather than inventing a backfill if it does.
- [ ] 3.2 Generate the Drizzle migration for the hard cutover, update schema
      types/snapshots, and verify a second generation produces no schema delta.
- [ ] 3.3 Add failing ordinary and transition-compaction tests requiring one
      atomic write of non-empty raw `summary` plus non-empty message-shaped
      replacement history whose first record is the final user-role checkpoint
      text part.
- [ ] 3.4 Replace ledger creation with materialization of the final bounded
      replacement records. Correlate complete pairs by `toolCallId`, preserve the
      existing pair/total budgets and cleared outcome semantics, store one final
      AI SDK UI `tool-*` part per assistant record, and store any omission marker as
      an assistant text record.
- [ ] 3.5 Add failing replay tests proving replacement records retain stored
      roles, parts, and order after checkpoint/tool renderers or budgets change;
      replay performs no rendering, projection, clearing, re-budgeting, or legacy
      fallback.
- [ ] 3.6 Update ordinary replay, cache-aligned compaction input, transition
      compaction, and recursive compaction to consume stored replacement history
      before the retained live window and to write a wholly new replacement on the
      next compaction.
- [ ] 3.7 Preserve RLS and internal-only boundaries for replacement history; it
      must not enter public DTOs, search indexes, or ordinary exports.

## 4. Privacy, Fork, and UI Boundaries

- [ ] 4.1 Add failing API projection tests proving owner message responses return
      stored parts in order, ordinary UI rendering hides context parts, and public
      shares, public/shared forks, exports, lists, and search expose only their
      existing public-safe content.
- [ ] 4.2 Update mappers only where the new required `data.text` field demands
      it. Keep model-switch metadata owner-visible and context text non-rendered.
- [ ] 4.3 Add private owner-fork coverage proving message parts are copied
      wholesale. Do not implement #154's compaction-aware fork behavior in this
      change; its follow-up must copy applicable replacement history.
- [ ] 4.4 Verify reasoning, sources, cap notices, provider metadata, and other
      declared display-only parts remain excluded from model replay.

## 5. Assistant Projection Follow-up and Product Records

- [x] 5.1 Retain the scoped TODO linking #599 beside the existing custom
      assistant/tool projector. Do not refactor it in this implementation.
- [x] 5.2 Update `AGENTS.md` to state the application-level best-effort replay
      invariant, SDK/provider boundary, display-only exclusions, compaction rewrite
      boundary, and #599 exception.
- [x] 5.3 Comment on #154 with the concrete replacement-history example and note
      that private fork work must preserve it; reference #154 from the proposal
      commit/PR without closing it.
- [ ] 5.4 Add a dated `CHANGELOG.md` entry describing stored reminder text,
      author-time user sanitization, and materialized compaction replacement
      history. This is unplanned corrective work; do not add it to `ROADMAP.md`.

## 6. Verification

- [ ] 6.1 Run `openspec validate persist-rendered-context-items --strict`,
      `pnpm lint:markdown`, `pnpm --filter api lint`,
      `pnpm --filter api typecheck`, and `pnpm --filter api test`.
- [ ] 6.2 Run affected API integration projects covering message acceptance,
      context assembly, ordinary/transition/recursive compaction, Run receipts,
      forks, public shares, search, migrations, and RLS. Confirm no database suite
      skipped for missing Postgres.
- [ ] 6.3 Run `pnpm --filter web lint`, `pnpm --filter web typecheck`, and
      `pnpm --filter web test`.
- [ ] 6.4 Build affected workspaces sequentially with
      `pnpm --filter api build` followed by `pnpm --filter web build`, then run
      `pnpm format:check`. Do not substitute the unbounded root build.
