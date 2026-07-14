# item-archive

## Purpose

Chats and projects carry an archive state — a nullable `archived_at` timestamp on the item's own row, set and cleared only by the item's owner. Archive is an owner-scoped, item-level state (not per-user), distinct from pinning. It is a personal-list curation mechanism: an archived chat or project remains viewable, forkable, and individually addressable. The API exposes archive via the existing `PATCH` partial-update path, not a separate RPC verb.

## Requirements

### Requirement: Archive is a global, owner-scoped state on the item

An item (a chat or a project) SHALL carry an archive state as a nullable `archived_at` timestamp on the item's own row — not as a per-user relation. Archiving is an **owner action** that affects every viewer of the item (the item is archived for everyone), in contrast to pinning, which is per-user. The archive state SHALL be set and cleared only by the item's owner under the existing owner-scoped datastore policies. A public or shared item SHALL remain viewable and forkable when archived — archive is a personal-list curation, not unpublishing; it SHALL NOT alter the public-read path.

#### Scenario: Archiving is owned by the item owner

- **WHEN** the owner archives a chat or project
- **THEN** the item's `archived_at` is set and the archive is effective for all viewers of that item

#### Scenario: Archive is not a per-user relation

- **WHEN** one viewer archives an item
- **THEN** the archive state is a single item-level flag, not an independent per-viewer state

#### Scenario: A shared chat stays viewable when archived

- **WHEN** a public/shared chat is archived
- **THEN** its share link still returns the chat (viewing and forking remain allowed) — archive does not retract publication

#### Scenario: Identity is server-derived

- **WHEN** a request attempts to archive an item using a client-supplied owner identity
- **THEN** the server authorizes against the authenticated session and ignores the client-supplied identity

### Requirement: Reversible archive and unarchive via partial update

Archiving and unarchiving SHALL be performed as a partial `PATCH /resource/:id` carrying an `archived: boolean` flag: `true` sets `archived_at` to the current time, `false` clears it, and an omitted flag leaves the state unchanged. The operation SHALL be idempotent. Archive SHALL NOT be exposed as a separate RPC verb. The single-item endpoints `GET /chats/:id` and `GET /projects/:id` SHALL return archived items (archive does not make a specific resource unaddressable).

#### Scenario: Archiving via PATCH flag

- **WHEN** a caller issues `PATCH /chats/:id` (or `/projects/:id`) with `archived: true`
- **THEN** the item's `archived_at` is set and the updated resource is returned

#### Scenario: Unarchiving via PATCH flag

- **WHEN** a caller issues `PATCH /chats/:id` (or `/projects/:id`) with `archived: false` on an archived item
- **THEN** the item's `archived_at` is cleared and the item is returned as not archived

#### Scenario: Archive is idempotent

- **WHEN** a caller archives an already-archived item (or unarchives an already-unarchived one)
- **THEN** the request succeeds and the resulting state is unchanged

#### Scenario: Single-item read returns archived

- **WHEN** a caller fetches an archived chat or project by id
- **THEN** the item is returned (so an open archived item stays addressable and deep links resolve)

### Requirement: List filtering by archive and pin state

The chat and project list endpoints (`GET /chats`, `GET /projects`) SHALL accept an `?archived` parameter with values `only` (archived only) and `with` (archived and non-archived); when the parameter is absent, archived items SHALL be excluded. They SHALL accept a `?pinned` parameter with values `only` (pinned only), `with` (both pinned and non-pinned), and `exclude` (non-pinned only); when absent, `?pinned` SHALL default to `with`. The `pinned` filter SHALL be enforced by checking membership in the caller's pins (`WHERE EXISTS` / `WHERE NOT EXISTS` on the `pins` table scoped to the caller and item type); all filtered result sets SHALL be ordered by `updatedAt` descending (no pin-recency ordering). The `?projectId` filter on `GET /chats` SHALL compose with both `?archived` and `?pinned`.

#### Scenario: Default list excludes archived

- **WHEN** a user lists chats or projects without `?archived`
- **THEN** archived items are absent from the result

#### Scenario: Archived surfaced by query param

- **WHEN** a user lists with `?archived=with`
- **THEN** both archived and non-archived items are returned

#### Scenario: Pinned-only filter

- **WHEN** a user lists with `?pinned=only`
- **THEN** only items the caller has pinned are returned (via an EXISTS check on the caller's pins)

#### Scenario: Non-pinned filter

- **WHEN** a user lists with `?pinned=exclude`
- **THEN** only items the caller has not pinned are returned (via a NOT EXISTS check)

#### Scenario: Lists ordered by updatedAt

- **WHEN** any filtered list is returned
- **THEN** items are ordered by `updatedAt` descending (pin-recency ordering is deferred)

### Requirement: Web list splits into Pinned and All categories (retires #204)

The web client SHALL render the chat list and the projects list as two categories built from two queries: a Pinned category from `?pinned=only&archived=with`, and an "All" category from `?pinned=exclude` (archived excluded by default). The Pinned category SHALL be a discrete rendered section above the time-grouped All category, so it is never interleaved among time groups (this retires bug #204). The Pinned category SHALL include archived pinned items (with an indicator, per the next requirement).

#### Scenario: Pinned is a discrete top section

- **WHEN** the chat or projects list renders
- **THEN** pinned items form a separate section above the time-grouped All items, never rendered between time groups

#### Scenario: Pinned category includes archived pinned items

- **WHEN** a pinned item is archived
- **THEN** it still appears in the Pinned category (with an indicator) rather than vanishing

#### Scenario: All category excludes pinned and archived

- **WHEN** the All category query (`?pinned=exclude`) returns
- **THEN** it contains non-pinned, non-archived items only, time-grouped

### Requirement: Pinned rail keeps archived items with an indicator

The pinned list (`GET /pins`) SHALL continue to include archived pinned items rather than silently dropping them, and each pin reference card (chat and project) SHALL carry `archivedAt` so the client can render an "Archived" indicator. Archived items in the rail SHALL NOT be unpinned or removed by archiving.

#### Scenario: Archived pinned item remains in the rail

- **WHEN** a user archives a pinned chat or project
- **THEN** the item still appears in the pinned list, carrying its `archivedAt`

#### Scenario: Pin card exposes archivedAt

- **WHEN** the pinned list is returned
- **THEN** each chat and project reference card includes `archivedAt` (nullable)

### Requirement: Archived items reject all writes except unarchive and delete

An archived item SHALL reject every mutating operation other than unarchive (`PATCH archived=false`) and delete (`DELETE`). Any other write — rename, title change, project filing/move, visibility change, or sending a message into an archived chat — SHALL be refused with `409 Conflict`. Sending a message into an archived chat SHALL NOT unarchive it.

#### Scenario: Rename of an archived item is refused

- **WHEN** a caller issues `PATCH /chats/:id` (or `/projects/:id`) with a new title/name on an archived item
- **THEN** the request is refused with `409` and no change is made

#### Scenario: Sending a message to an archived chat is refused

- **WHEN** a caller sends a message to an archived chat
- **THEN** the send is refused with `409` and the chat remains archived

#### Scenario: Unarchive and delete are still allowed

- **WHEN** a caller issues `PATCH ... archived:false` or `DELETE` on an archived item
- **THEN** the operation succeeds (unarchive clears `archived_at`; delete removes the item)

### Requirement: Web Archive control is an Archive⇄Unarchive toggle

The web client SHALL present Archive as a toggle on the chat row menu, the project row menu, and the pinned-rail kebab, labeled **Archive** when the item is not archived and **Unarchive** when it is, driven by the item's `archivedAt`. Archiving SHALL optimistically update the list caches (remove from the non-pinned list, flip `archivedAt` on pinned/rail caches) with a toast and SHALL NOT navigate away from an open item. For this change, unarchive SHALL be reachable only from the pinned rail (there is no Archived view and no open-item unarchive control); non-pinned archived items are not unarchivable from the UI.

#### Scenario: Toggle reflects archive state

- **WHEN** a user opens the menu for an archived item
- **THEN** the control reads Unarchive; for a non-archived item it reads Archive

#### Scenario: Archive optimistically updates caches

- **WHEN** a user archives an open item
- **THEN** it is removed from the non-pinned list cache, its `archivedAt` flips in the pinned/rail caches, with a toast, and the open view remains

#### Scenario: Unarchive reachable from pinned rail

- **WHEN** a user opens the pinned-rail kebab for an archived pinned item
- **THEN** the Unarchive action re-admits the item to the overview lists
