## Stack delivery contract

This change MUST be delivered as one linear `gh stack`, with the existing
proposal branch adopted as the bottom layer:

```text
(master)
  <- fix-system-reminder-storage-shape
  <- rendered-context/context-parts
  <- rendered-context/compaction
  <- rendered-context/surfaces
  <- rendered-context/archive
```

Before implementation begins, create/adopt the complete chain non-interactively
and check out the first implementation layer:

```bash
gh stack init fix-system-reminder-storage-shape \
  rendered-context/context-parts \
  rendered-context/compaction \
  rendered-context/surfaces \
  rendered-context/archive
gh stack checkout rendered-context/context-parts
gh stack view --json
```

Foundational code MUST live below dependent code. Do not implement everything
on one branch and split it afterward.

The branches are review layers, not independently deployable releases. Merge
and verify the complete implementation stack before the alpha hard cutover; do
not deploy an intermediate layer.

Each task belongs to exactly one layer below. A task MUST change from `[ ]` to
`[x]` in the same PR that performs and verifies it. A higher layer MUST NOT
retroactively check a lower layer's task; instead, return to the owning branch,
commit the checkbox there, and run `gh stack rebase --upstack`. Lower-layer
tasks naturally remain checked in higher PR branches through stack ancestry.
Never mark a task complete based on intent or partial execution.

Before adding or starting the next layer, the current layer MUST have a clean
worktree, all of its tasks checked, and its layer-specific verification passing.
Use `gh stack submit --auto`/`gh stack view --json` for PR publication and state;
do not open or merge stack layers with ordinary `gh pr` merge commands.

## 1. Proposal layer — `fix-system-reminder-storage-shape`

This layer owns planning and the explicit follow-up boundaries only. It MUST NOT
contain the feature implementation.

- [x] 1.1 Generate and refine the `persist-rendered-context-items` proposal,
      design, delta specs, and implementation task plan.
- [x] 1.2 File #599 to research canonical AI SDK assistant-part persistence and
      add the scoped TODO beside the existing custom assistant/tool projector.
- [x] 1.3 Update `AGENTS.md` with the application-level best-effort replay
      invariant, SDK/provider boundary, display-only exclusions, compaction
      rewrite boundary, and #599 exception.
- [x] 1.4 Comment on #154 with the replacement-history example, reference it
      from the proposal commit/PR, and leave the issue open for its own change.
- [x] 1.5 Validate the planning layer with
      `openspec validate persist-rendered-context-items --strict`,
      `pnpm lint:markdown`, `pnpm --filter api lint`, `pnpm format:check`, and
      the repository pre-commit hooks.

## 2. Context-parts layer — `rendered-context/context-parts`

This layer owns stored context/user parts and their ordinary replay boundary. It
MUST NOT alter compaction persistence or public/UI projections beyond what its
focused tests require.

### 2.1 Persisted context contract

- [x] 2.1.1 Add failing API tests for the v1 `data-context` shape with complete
      `data.text`: non-empty text replays verbatim, the empty string is filtered,
      whitespace-only text survives, metadata-only parts are omitted, unknown
      producer/form values do not block text replay, and text wins over
      conflicting metadata. Metadata-only parts remain present as empty-text Run
      receipt entries.
- [x] 2.1.2 Update context-part types and validators so new server-authored parts
      require complete text while readers retain metadata-only historical parts
      without treating them as model-bearing.
- [x] 2.1.3 Add failing context-builder tests proving stored part order survives
      a renderer/precedence change and each surviving context part becomes one
      SDK text part without manual concatenation.
- [x] 2.1.4 Replace replay-time rendering, sorting, and metadata fallback with
      the minimal `data-context` to text-part conversion. Copy the same text into
      Run context receipts and retain empty receipt entries for inert parts.

### 2.2 Author-time rendering and user persistence

- [x] 2.2.1 Add failing producer tests requiring model-switch, availability,
      recency-digest delta/supersession, and temporal factories to persist their
      complete canonical envelope plus metadata after author-time
      neutralization.
- [x] 2.2.2 Refactor producer factories to validate semantic input and render
      complete v1 text exactly once before the accepting transaction commits.
- [x] 2.2.3 Add failing chat-binding tests proving every submitted user text part
      is sanitized before persistence while part boundaries/order remain intact;
      replay does not sanitize, join, or prefix sender ids.
- [x] 2.2.4 Move user-text sanitization to the accepting path, remove replay-time
      sender attribution and sanitization, and pass stored user parts through
      the SDK conversion boundary.
- [x] 2.2.5 Verify client-authored context parts remain rejected, one temporal
      part is stored per accepted user turn, and server-authored parts commit
      atomically in canonical author-time order with the user message, Run, and
      snapshot.

### 2.3 Layer verification

- [x] 2.3.1 Run the focused context-item, producer, context-builder, chat-binding,
      and Run-receipt unit/integration suites, confirming database-backed suites
      do not skip for missing Postgres.
- [x] 2.3.2 Run `openspec validate persist-rendered-context-items --strict`,
      `pnpm --filter api lint`, `pnpm --filter api typecheck`,
      `pnpm --filter api test`, `pnpm --filter api build`,
      `pnpm lint:markdown`, and `pnpm format:check`.

## 3. Compaction layer — `rendered-context/compaction`

This layer depends on the stored-parts conversion below it and owns the hard
compaction schema cutover, materialization, replay, and lineage behavior. It
MUST NOT contain public/UI projection work or final spec archival.

### 3.1 Schema and persistence

- [x] 3.1.1 Add failing schema/repository tests for required JSONB
      `replacement_history` and removal of `tool_observation_ledger`. Verify the
      cutover procedure quiesces API writers, drains or explicitly terminates
      accepted nonterminal Runs with compatible workers still running, stops
      workers only after that, and then finds no nonterminal Runs or compaction
      rows. Stop rather than inventing a backfill or compatibility path if
      either final precondition is false.
- [x] 3.1.2 Generate the Drizzle migration for the hard cutover, update schema
      types/snapshots, and verify a second generation produces no schema delta.
- [x] 3.1.3 Add failing ordinary and transition-compaction tests requiring one
      atomic write of non-empty raw `summary` plus non-empty message-shaped
      replacement history whose first record is the final user-role checkpoint
      text part.

### 3.2 Materialization and replay

- [x] 3.2.1 Replace ledger creation with materialization of the final bounded
      replacement records. Correlate complete pairs by `toolCallId`, preserve
      the existing pair/total budgets and cleared outcome semantics, store one
      final AI SDK UI `tool-*` part per assistant record, and store any omission
      marker as an assistant text record.
- [x] 3.2.2 Add failing replay tests proving replacement records retain stored
      roles, parts, and order after checkpoint/tool renderers or budgets change;
      replay performs no rendering, projection, clearing, re-budgeting, or
      legacy fallback.
- [x] 3.2.3 Update ordinary replay, cache-aligned compaction input, transition
      compaction, and recursive compaction to consume stored replacement history
      before the retained live window and write a wholly new replacement on the
      next compaction.
- [x] 3.2.4 Preserve RLS and internal-only boundaries for replacement history;
      it must not enter public DTOs, search indexes, or ordinary exports.

### 3.3 Layer verification

- [x] 3.3.1 Run focused repository, migration, RLS,
      ordinary/transition/recursive-compaction, cache-alignment, and replay
      suites, confirming database-backed suites do not skip for missing
      Postgres.
- [x] 3.3.2 Run `openspec validate persist-rendered-context-items --strict`,
      `pnpm --filter api lint`, `pnpm --filter api typecheck`,
      `pnpm --filter api test`, `pnpm --filter api build`,
      `pnpm lint:markdown`, and `pnpm format:check`.

## 4. Surfaces and release layer — `rendered-context/surfaces`

This layer owns API/web egress compatibility, private-fork behavior that is
already in scope, product records, and final whole-feature verification. It
MUST NOT implement #154 or #599 and MUST NOT sync/archive OpenSpec.

### 4.1 Privacy, fork, and UI boundaries

- [x] 4.1.1 Add failing API projection tests proving owner message responses
      return stored parts in order, ordinary UI rendering hides context parts,
      and public shares, public/shared forks, exports, lists, and search expose
      only their existing public-safe content.
- [x] 4.1.2 Update mappers only where required `data.text` demands it. Keep
      model-switch metadata owner-visible and context text non-rendered.
- [x] 4.1.3 Add private owner-fork coverage proving message parts are copied
      wholesale and a compacted source's full prefix remains available through
      the fork's existing uncompacted replay. Do not implement #154's
      compaction-aware fork parity; its follow-up must copy applicable
      replacement history.
- [x] 4.1.4 Verify reasoning, sources, cap notices, provider metadata, and other
      declared display-only parts remain excluded from model replay.
- [x] 4.1.5 Add a dated `CHANGELOG.md` entry describing stored reminder text,
      author-time user sanitization, and materialized compaction replacement
      history. This is unplanned corrective work; do not add it to `ROADMAP.md`.

### 4.2 Whole-feature verification

- [x] 4.2.1 Run affected API integration projects covering message acceptance,
      context assembly, ordinary/transition/recursive compaction, Run receipts,
      forks, public shares, search, migrations, and RLS. Confirm no database
      suite skipped for missing Postgres.
- [x] 4.2.2 Run `pnpm --filter web lint`, `pnpm --filter web typecheck`, and
      `pnpm --filter web test`.
- [x] 4.2.3 Run `openspec validate persist-rendered-context-items --strict`,
      `pnpm --filter api lint`, `pnpm --filter api typecheck`,
      `pnpm --filter api test`, and `pnpm lint:markdown`.
- [x] 4.2.4 Build affected workspaces sequentially with
      `pnpm --filter api build` followed by `pnpm --filter web build`, then run
      `pnpm format:check`. Do not substitute the unbounded root build.
- [ ] 4.2.5 Confirm every task in layers 1–4 is checked in its owning PR and the
      complete implementation stack is green before starting the archive layer.

## 5. Spec sync and archive layer — `rendered-context/archive`

This MUST be the final/top PR and MUST contain only canonical-spec sync,
OpenSpec archival/bookkeeping, and checks of those documentation changes. It
MUST NOT contain application code, migrations, tests, UI changes, changelog
changes, or deferred #154/#599 work.

- [ ] 5.1 Verify OpenSpec reports every apply-required artifact complete and no
      task from a lower layer remains unchecked.
- [ ] 5.2 Invoke `$openspec-sync-specs` for
      `persist-rendered-context-items`, review the intelligent merge into every
      affected `openspec/specs/*/spec.md`, verify no shipped scenario is lost,
      and strictly validate the active change.
- [ ] 5.3 Verify the synchronized canonical specs, completed active-change
      artifacts, `pnpm lint:markdown`, `pnpm format:check`, and diff checks; then
      mark every checkbox complete so archive preflight observes no unfinished
      task.

After every checkbox is complete, invoke `$openspec-archive-change` for
`persist-rendered-context-items` in this same layer and choose the already-synced
archive path rather than syncing twice. Verify the active change is absent, the
dated archive retains `.openspec.yaml` and the completed task record, canonical
specs remain exactly as synchronized earlier in the PR, and strict validation,
`pnpm lint:markdown`, and `pnpm format:check` still pass.

Archiving is intentionally described after the checklist rather than as a
self-referential unchecked task, so archive preflight can truthfully observe
zero incomplete tasks. The final PR still owns both the spec sync and archive
move and contains no runtime behavior.
