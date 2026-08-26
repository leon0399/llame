## MODIFIED Requirements

### Requirement: Per-user pin entity

A **pin** SHALL be a reference from a **user** to a pinnable **item**, identified by the item's **type** and **id**, and owned by the pinning user. Pin state SHALL be a property of the (user, item) pair — never of the item alone — so that two users MAY hold independent pin state for the same item. A pin SHALL carry the timestamp at which it was created and an **owner-controlled rank** within that user's mixed pin set (across all item types). The rank SHALL be mutable only through the pin reorder operation; pinning an already-pinned item SHALL leave a single pin in place without resetting its rank. Pinning is idempotent: a user pinning an already-pinned item SHALL leave a single pin in place.

#### Scenario: Two users pin the same item independently

- **WHEN** user A pins an item that user B has not pinned
- **THEN** the item is pinned for user A and remains unpinned for user B; neither user's pin state affects the other's

#### Scenario: Pinning is idempotent

- **WHEN** a user pins an item they have already pinned
- **THEN** the item remains pinned with a single pin, its rank unchanged, and the request succeeds

#### Scenario: Unpinning is idempotent

- **WHEN** a user unpins an item that is not currently pinned by them
- **THEN** the request succeeds and the item is not pinned for that user

### Requirement: Unified pin API

The system SHALL expose pinning as a single REST resource keyed by item type and id, taking a validated request and returning an explicit response type, with the acting identity derived from the authenticated session. The surface SHALL be:

- a list operation returning the caller's pinned items in owner rank order,
- an idempotent pin operation addressed by item type and id,
- an idempotent unpin operation addressed by item type and id,
- a reorder operation that updates the caller's pin ranks across the mixed pin set.

Item type and id SHALL appear in the request path for pin and unpin. Reorder SHALL identify pins by the caller's authenticated identity plus each item's type and id — never by a client-supplied owner id. There SHALL NOT be a separate per-item-type pin surface (e.g. a verb handle on the chat or project resource).

#### Scenario: Pin and unpin address the item by type and id

- **WHEN** a user pins and later unpins an item
- **THEN** both operations identify the item by its type and id in the same resource, and each returns a well-typed response

#### Scenario: Reorder updates the caller's pin ranks

- **WHEN** a user submits a reorder listing exactly their hydratable pinned items (the same set `GET` would return) in a new order
- **THEN** subsequent pin list reads return those items in the submitted order
- **AND** no other user's pins are affected
- **AND** pin rows whose items no longer hydrate are removed during the reorder rather than blocking it

#### Scenario: Reorder rejects an incomplete or unknown hydratable set

- **WHEN** a user submits a reorder that omits a still-hydratable pin or includes an item they do not have pinned
- **THEN** the system rejects the request without changing ranks

#### Scenario: Reorder cannot target another user's pins

- **WHEN** a user attempts a reorder that would mutate pins owned by a different user
- **THEN** the request is denied or ignored for those pins and the other user's order is unchanged

#### Scenario: Legacy per-chat pin path is gone

- **WHEN** a client attempts to pin a chat through the former chat-update path
- **THEN** that path no longer accepts a pin instruction; pinning is available only through the unified pin resource

### Requirement: Unified pinned list

The system SHALL provide the caller's pinned items as a single list mixing all item types, ordered by the caller's owner-controlled rank (head first). Each entry SHALL carry its item type, id, pin timestamp, and a **type-appropriate reference** bearing the display metadata needed to render and open the item (at least a title or name). The reference SHALL be shaped per item type, so that a future item type may contribute its own presentation without changing the pin contract. A pinned reference whose item no longer exists or is no longer accessible to the caller SHALL be omitted from this list rather than surfaced as a broken entry; omitted entries SHALL NOT leave gaps that reorder remaining ranks on read.

#### Scenario: The pinned list mixes types in pin-recency order

- **WHEN** a user has pinned a project and a chat and assigned them an explicit owner rank order
- **THEN** the pinned list returns both in that owner rank order (not pin-recency), each carrying its type-appropriate reference with the metadata needed to display and open it

#### Scenario: A pin to a vanished item is omitted

- **WHEN** an item a user pinned is later deleted or becomes inaccessible to them
- **THEN** that entry does not appear in the pinned list, and the remaining pins are unaffected

### Requirement: Pins are the sole source of pin state

Pin state SHALL live only in the pinning subsystem. A pinnable resource's own representation (e.g. the chat or project list item) SHALL NOT carry pin state. Any surface that groups a resource list by pin status SHALL derive that grouping from the caller's pinned set, not from a pin field on the resource. When such a surface presents a type-filtered pinned group, that group SHALL appear in the relative order induced by the caller's mixed pin rank (filter-preserving projection), not by item activity time.

#### Scenario: A resource representation carries no pin field

- **WHEN** a user lists chats or projects
- **THEN** the returned resources carry no pin timestamp, pin rank, or pinned flag; pin state is obtained only from the pinned list

#### Scenario: Pinned resources form a group in their own list

- **WHEN** a user views the chat list or the project list
- **THEN** the resources whose id is in the caller's pinned set appear in a "Pinned" group above the rest of that list, ordered by the caller's pin rank among that type

## ADDED Requirements

### Requirement: Newly pinned items land at the head of the owner's rank

Creating a pin for an item the caller has not already pinned SHALL place that pin at the **head** of the caller's ranked pin list (highest priority / first in `GET /pins`). Existing pins SHALL retain their relative order among themselves. Re-pinning an already-pinned item SHALL NOT move it to the head.

#### Scenario: A new pin appears first

- **WHEN** a user with an existing ordered pin list pins a new item
- **THEN** `GET /pins` returns the new item first, followed by the previous pins in their prior relative order

#### Scenario: Re-pinning does not reshuffle

- **WHEN** a user pins an item that is already pinned at a non-head rank
- **THEN** the pin remains at its existing rank
