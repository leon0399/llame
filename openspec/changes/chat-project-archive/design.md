## Context

Every chat/project row menu and the pinned-rail kebab ship a **disabled `Archive`** item (issue #192), per the repo rule that not-yet-built controls are disabled. The pinning rework (`item-pins`, design D5) established that *pin* state is per-user and lives in its own `pins` table. Archive is the opposite axis: an **owner action that mutates the resource itself**, meant to be seen by everyone. So archive is a plain `archived_at` column on `chats`/`projects`, not a per-user relation.

Grilling this change surfaced that "wire the button" was not self-contained. The chat list builds its Pinned group client-side and renders it out of order (bug #204), and there is no server-side "pinned vs not" filter for list rendering. Making the archived-pinned case consistent (an archived pinned chat must still show, with an indicator) requires a real `?pinned` list filter and a two-query web split — which simultaneously retires #204. So the change was **folded**: list-API rework + frontend refactor + archive, one change.

Today a chat is single-owner, so "archived for everyone" means "for the owner across all sessions." That is also the future-correct shape if multi-user viewing lands: the owner archives, all viewers see it gone.

## Goals / Non-Goals

**Goals:**

- A reversible, owner-scoped `archived_at` flag on `chats` and `projects`.
- Archive/unarchive as a `PATCH` partial update (`archived: boolean`), not an RPC verb.
- Server-side `?pinned` and `?archived` list filters on `/chats` and `/projects`, ordered by `updatedAt`.
- A web list split into a Pinned category and an "All" category (two queries) that retires #204 and shows archived pinned items with an indicator.
- A hard guard: archived items reject every write except unarchive and delete (`409`).
- The three existing Archive controls become Archive⇄Unarchive toggles.

**Non-Goals (explicitly deferred):**

- The Archived *view* (per-scope archived lists with an Unarchive action).
- Styling of the "Archived" indicator (later design change).
- UI treatment of the `409` guard (separate design change).
- An open-chat unarchive control — unarchive is reachable only from the pinned rail in this change.
- Unarchiving non-pinned archived items from the UI (reachable only via `?archived`/API or a future view).
- Reorderable / custom-ordered pins — all ordering is `updatedAt` for now.

## Decisions

### D1. `archived_at` is a column on the resource, not a per-user relation

Archive is global per item; pins are per-viewer. A per-user archive relation would be the wrong inversion. A nullable timestamp column is the minimal correct shape, readable as first-class state in responses. No RLS change: `archived_at` is a plain column under the existing `chats_owner`/`projects_owner` policies, and public/shared chats stay viewable when archived (see D8).

### D2. Reversible via `PATCH` flag; single-item GET returns archived (Q1)

`UpdateChatDto`/`UpdateProjectDto` gain `archived: boolean`. `true` sets `archived_at = now()`; `false` clears it; omitted leaves it unchanged. Idempotent. **Single-item `GET /chats/:id` and `GET /projects/:id` return archived items** (no archive filter) — the only way "the open chat stays active" and deep links resolve. Only the *collection* endpoints filter by default.

### D3. List params: `?archived=only|with`, `?pinned=only|with|exclude` (Q3, Q9)

- `?archived`: absent ⇒ **exclude** (non-archived only — the overview default); `only` ⇒ archived only; `with` ⇒ both. (No literal `exclude` value; absent is exclude.)
- `?pinned`: absent ⇒ **`with`** (both pinned + unpinned — preserves today's overview for any caller); `only` ⇒ pinned only; `exclude` ⇒ non-pinned only; `with` ⇒ both (explicit).

Page composition = two queries: Pinned category `GET /chats?pinned=only&archived=with`; "All" category `GET /chats?pinned=exclude` (archived defaults to exclude). Same shape on `/projects`. The `?projectId` chat-list filter composes with both.

### D4. Server filter via `EXISTS`/`NOT EXISTS`; order by `updatedAt` everywhere (Q10)

`findByOwner` (chats-repository.ts) and the projects list query filter with `WHERE EXISTS (SELECT 1 FROM pins WHERE pins.user_id = <owner> AND pins.item_type = 'chat' AND pins.item_id = chats.id)` for `pinned=only`, and `WHERE NOT EXISTS (…)` for `pinned=exclude`. **No JOIN** — EXISTS preserves the `select().from(chats)` shape and the `Chat[]` return, so last-message hydration is untouched. All branches `ORDER BY updatedAt desc`. **No `pinnedAt` ordering** — reorderable pins is a later feature; the Pinned category sorts by activity like everything else (Q10 follow-up).

### D5. Web: two-query split retires #204 (Q11)

The web stops deriving the Pinned group from the pins set and instead **queries** it. Query keys: `chatKeys.pinned()` → `?pinned=only&archived=with`; `chatKeys.list()` → `?pinned=exclude`. Render a discrete Pinned section on top, then the time-grouped rest (`groupChatsByTimePeriod` no longer splices Pinned out — the `list()` query already excludes pinned). #204 is gone because Pinned is a rendered section, never inserted into `Object.entries` ordering. Applies to **both** the chat list and the projects list (Projects already has Pinned / All projects categories). The dedicated pinned *rail* stays on `GET /pins` (unchanged except `archivedAt` on cards).

### D6. Overview excludes archived; pinned rail keeps + indicator; search untouched (Q7-B)

- Overview lists (`findByOwner` / projects list) exclude archived by default (`archived_at IS NULL` term, or `?archived=with` to include).
- The in-list Pinned group uses `pinned=only&archived=with`, so **archived pinned items appear there with an indicator** (Q7 option B — chosen for consistency with the rail; unpin is a manual action).
- The pinned *rail* (`listWithCards`) keeps archived items and returns `archivedAt` on the cards (the query must select `archived_at` from `chats`/`projects` — currently it selects only `{id,title}`/`{id,name}`).
- Search is unchanged — archived items remain searchable.

### D7. Archived items reject all writes except unarchive + delete (`409`) (Q4, Q5)

A shared `assertNotArchived(chat)` helper throws `ConflictException` (`409`, message "archived; unarchive or delete first"). Called in `chats.service.updateChat` (skip when `input.archived === false`), `projects.service.updateProject`, and `chatLoopService.persistUserMessageAndRun` (after the chat is resolved, pre-existing chat only — a chat we just created can't be archived). `409` (not `423`/`400`) because delete and unarchive remain permitted. Sending a message into an archived chat is refused — **no auto-unarchive**.

### D8. Public/shared chats stay viewable when archived (Q6)

`GET /shared/chats/:id` reads via `runAsPublic` + the `chats_public_read` policy, gated only on `visibility='public'`. Archive does **not** hide a public chat from its share link — shared chats are read-only, so viewing and forking remain allowed. Therefore **no RLS policy changes at all**; archive is purely an owner-list concern.

### D9. Cache plan for `setArchived` (Q12)

Extends the "pin rows survive archiving" rule (Q2-A) to the two-query world:

| Cache | Archive (→true) | Unarchive (→false) |
| --- | --- | --- |
| `pinned=exclude` list (chat & project) | remove item | **invalidate** (refetch; don't synthesize) |
| `pinned=only&archived=with` (Pinned cat.) | flip `archivedAt` in place | flip `archivedAt` back to null |
| `/pins` rail | flip `archivedAt` in place | flip back to null |
| `GET /chats/:id` (open view) | leave as-is (stays active) | leave as-is |

`onError` rolls back all optimistic edits (same pattern as the existing pin mutations). Toast on success.

### D10. Open-view archived treatment fully deferred (Q13)

When you archive the chat you're viewing, it stays open (D2) with no special banner; the composer stays enabled. A send returns the `409` (D7), rendered generically by the existing send-error path. The deferred UI change can later translate that into a proper "archived — unarchive to reply" state.

## Risks / Trade-offs

- **[Folded scope is large]** → one change now carries list-API + frontend + archive, two acceptance criteria. Mitigated by the explicit task split (filters → guard → web) and by isolating the `pins` JOIN/EXISTS perf behind `findByOwner`.
- **[`pins` EXISTS filter perf]** → covered by the existing PK `(user_id, item_type, item_id)` + `pins_user_pinned_idx`; result sets are small (per-user pins). No new index needed.
- **[Non-pinned archived item is un-unarchivable from UI]** → accepted (no Archived view); reachable via `?archived`/API and a future view.
- **[Pinned category order = `updatedAt`, not pin-recency]** → diverges slightly from the rail (which orders by `pinnedAt`); accepted until reorderable pins lands.
- **[409 has no UI message yet]** → API-only this change; deferred UI treatment.
- **[Archiving an item with an in-flight run]** → the open chat "stays active", so a run in progress keeps running; no block added (behavior change beyond scope).

## Migration Plan

1. Schema: drizzle-kit migration adding nullable `archived_at` timestamptz to `chats` and `projects` (no RLS change). `drizzle-kit check` passes.
2. DTOs + responses: `archived` on update DTOs; `archivedAt` on `ChatResponse`/`ChatListItemResponse`/`ProjectResponse`/`ChatRefCard`/`ProjectRefCard`; `?archived`/`?pinned` on list query DTOs (`IsIn`); `/pins` cards select `archivedAt`; regenerate `openapi.json`.
3. List filtering: `findByOwner` (chats) + projects list gain `EXISTS`/`NOT EXISTS` `pinned` filter + `archived` term, all `ORDER BY updatedAt desc`.
4. Guard: shared `assertNotArchived`; wire into `updateChat`, `updateProject`, `persistUserMessageAndRun` (pre-existing chat only).
5. Web: two-query list split (chat + projects) retiring #204; `archivedAt` types; `setArchived` mutation + cache plan (D9); three Archive controls → toggles; pinned-rail Archived indicator (styling deferred).
6. Verify: `pnpm --filter api build/test/typecheck/lint`; web `test/typecheck/lint`; RLS negative specs + `409` specs; `openspec validate chat-project-archive` clean.

## Open Questions

None blocking. Follow-ups tracked (not in this change): the Archived view + Unarchive action; indicator styling; `409` UI handling; open-chat unarchive control; unarchiving non-pinned archived items from the UI; reorderable/custom-ordered pins.
