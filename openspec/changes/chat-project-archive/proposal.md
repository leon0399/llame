## Why

Every chat/project row menu and the pinned-rail kebab ship a **disabled `Archive`** item (issue #192), per the repo rule that not-yet-built controls are disabled, never dead clicks. Archive is a *global, owner-scoped* state — once the owner archives an item it is archived for everyone (unlike pinning, which is per-user). Making Archive real also forces a deeper fix we'd otherwise defer: the chat list's "Pinned" group is currently built client-side and renders out of order (bug #204), and there is no server-side notion of "pinned vs not" for list rendering. So this change ships Archive **and** reworks the list API + web list rendering: `?archived`/`?pinned` list filters and a split into a Pinned category and an "All" category (two queries), which retires #204 and gives a consistent, archive-aware list where archived pinned items surface with an indicator instead of vanishing.

## What Changes

- **`archived_at` column** added to `chats` and `projects` (nullable timestamptz, owner-scoped like the rest of those rows). Archive is a property of the *item*, not a per-user relation. **No RLS change** — `archived_at` is a plain column under the existing owner policies, and public/shared chats stay viewable and forkable when archived (archive is a personal-list curation, not unpublishing).
- **Reversible archive/unarchive via `PATCH /resource/:id`** carrying `archived: boolean` (idempotent). Single-item `GET /:id` returns archived items (so an open archived chat stays addressable and deep links resolve).
- **List query params on `GET /chats` and `GET /projects`**: `?archived=only|with` (absent ⇒ exclude) and `?pinned=only|with|exclude` (absent ⇒ `with`). Server filters via `WHERE EXISTS` / `WHERE NOT EXISTS` on `pins`; all branches order by `updatedAt desc` (no pin-recency ordering yet — reorderable pins is a later feature).
- **Web splits each list into two queries**: a Pinned category (`pinned=only&archived=with`) and an "All" category (`pinned=exclude`, archived excluded by default). This retires #204 by construction (Pinned is a discrete section, never interleaved via `Object.entries`). Applies to both the chat list and the projects list (which already has Pinned / All projects categories).
- **Search is untouched** — archived items stay searchable (the delete-vs-archive distinction).
- **Pinned rail keeps archived items** with an "Archived" indicator; `archivedAt` is added to the pin ref cards (`ChatRefCard`/`ProjectRefCard`) and selected in `listWithCards`.
- **Mutation guard**: an archived item rejects all writes except unarchive (`PATCH archived=false`) and delete (`DELETE`) → `409 Conflict`. Enforced by a shared `assertNotArchived` helper in `updateChat`, `updateProject`, and the message-send path (sending to an archived chat is refused — no auto-unarchive).
- **Web Archive button becomes an Archive⇄Unarchive toggle** on the chat row menu, the project row menu, and the pinned-rail kebab, driven by `archivedAt`. Optimistic cache plan (see design); for now, unarchive is reachable only from the pinned rail (no Archived view, no open-item unarchive control).

## Capabilities

### New Capabilities
- `item-archive`: the archive state on chats and projects (the `archived_at` column), reversible archive/unarchive via the `PATCH` flag, the `?archived`/`?pinned` list-filter contract (applied to both `/chats` and `/projects`), the `409` mutation guard on archived items, the pinned-rail inclusion with indicator, and the web Archive⇄Unarchive toggle + two-query list split (which retires #204).

### Modified Capabilities
- `projects`: the project list honors the `?archived`/`?pinned` filter contract (specified in `item-archive`); an archived project rejects every update except unarchive and delete (`409`).

## Impact

- **Schema (apps/api, sole DB owner)**: new nullable `archived_at` timestamptz on `chats` and `projects`; one drizzle-kit migration. **No RLS change** (column under existing owner policies; public-read policies unchanged — shared chats stay viewable when archived).
- **Security / tenancy**: archive is owner-only and datastore-enforced; cross-tenant archive/unarchive is denied (no existence oracle — maps to the same 404 as any inaccessible resource). A negative test pins that User B cannot archive/rename/delete-archive User A's item, and that archived items do not leak across tenants in owner lists.
- **API**: `UpdateChatDto`/`UpdateProjectDto` gain `archived`; responses + pin ref cards gain `archivedAt`; `ListChatsQueryDto`/`ListProjectsQueryDto` gain `?archived` (`only|with`) and `?pinned` (`only|with|exclude`) with `IsIn` validation; `findByOwner` (chats) and the projects list query gain the `EXISTS`/`NOT EXISTS` filter + `updatedAt` ordering; `/pins` cards select `archivedAt`; `openapi.json` regenerated.
- **Web**: two-query list restructure for chat + projects (retires #204); `archivedAt` mirrored in web types + pin ref cards; a single `setArchived(itemType, itemId, archived)` mutation with the optimistic cache plan; the three Archive controls become toggles; pinned-rail Archived indicator (indicator styling is a later change).
- **Out of scope (explicitly)**: the Archived *view* (per-scope archived lists with an Unarchive action); styling of the Archived indicator; UI treatment of the `409` guard (separate design change); an open-chat unarchive control; unarchiving non-pinned archived items from the UI (reachable only via `?archived`/API or a future view); reorderable/custom-ordered pins (all ordering is `updatedAt` for now).
