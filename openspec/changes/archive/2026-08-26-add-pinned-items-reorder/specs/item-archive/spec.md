## MODIFIED Requirements

### Requirement: List filtering by archive and pin state

The chat and project list endpoints (`GET /chats`, `GET /projects`) SHALL accept an `?archived` parameter with values `only` (archived only) and `with` (archived and non-archived); when the parameter is absent, archived items SHALL be excluded. They SHALL accept a `?pinned` parameter with values `only` (pinned only), `with` (both pinned and non-pinned), and `exclude` (non-pinned only); when absent, `?pinned` SHALL default to `with`. The `pinned` filter SHALL be enforced by checking membership in the caller's pins (`WHERE EXISTS` / `WHERE NOT EXISTS` on the `pins` table scoped to the caller and item type). When `?pinned=only`, the result SHALL be ordered by the caller's pin rank for that item type (the type-filtered projection of the mixed pin order defined by `item-pins`). For every other `?pinned` value (`with`, `exclude`, or the default), the result SHALL be ordered by `updatedAt` descending. The `?projectId` filter on `GET /chats` SHALL compose with both `?archived` and `?pinned`.

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

- **WHEN** a user lists with `?pinned=exclude`, `?pinned=with`, or the default `?pinned` behavior
- **THEN** items are ordered by `updatedAt` descending

#### Scenario: Pinned-only lists follow pin rank

- **WHEN** a user lists with `?pinned=only` after assigning an explicit pin order
- **THEN** items appear in that owner's pin-rank order for the listed type (not by `updatedAt`)
