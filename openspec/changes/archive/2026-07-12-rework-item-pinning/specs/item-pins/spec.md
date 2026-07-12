## ADDED Requirements

### Requirement: Per-user pin entity

A **pin** SHALL be a reference from a **user** to a pinnable **item**, identified by the item's **type** and **id**, and owned by the pinning user. Pin state SHALL be a property of the (user, item) pair — never of the item alone — so that two users MAY hold independent pin state for the same item. A pin SHALL carry the timestamp at which it was created and SHALL expose no other mutable field. Pinning is idempotent: a user pinning an already-pinned item SHALL leave a single pin in place.

#### Scenario: Two users pin the same item independently

- **WHEN** user A pins an item that user B has not pinned
- **THEN** the item is pinned for user A and remains unpinned for user B; neither user's pin state affects the other's

#### Scenario: Pinning is idempotent

- **WHEN** a user pins an item they have already pinned
- **THEN** the item remains pinned with a single pin, and the request succeeds

#### Scenario: Unpinning is idempotent

- **WHEN** a user unpins an item that is not currently pinned by them
- **THEN** the request succeeds and the item is not pinned for that user

### Requirement: Pins are isolated per user in the datastore

Pins SHALL be visible and mutable only to their owning user, enforced in the datastore (defense-in-depth), and SHALL fail closed when the caller's identity is absent. The acting identity SHALL be derived only from the authenticated session, never from client-supplied input. An unauthenticated (no-identity) read path SHALL return no pins.

#### Scenario: Listing pins returns only the caller's pins

- **WHEN** a user lists their pins
- **THEN** the response contains exactly the pins they own, and none belonging to any other user

#### Scenario: A user cannot read or remove another user's pin

- **WHEN** a user attempts to observe or unpin a pin owned by a different user
- **THEN** access is denied and no change is made

#### Scenario: Absent identity yields no pins

- **WHEN** a pin read runs without an authenticated identity (e.g. an unauthenticated/public path)
- **THEN** no pins are returned

### Requirement: A user may only pin an item they can access

Creating a pin SHALL be permitted only when the caller can currently access the referenced item under that item's own access rules, verified at write time in the datastore. A request to pin an item the caller cannot access SHALL be denied. This accessibility check is per item type and is the single place that later access models (e.g. multi-user chats) extend.

#### Scenario: Pinning an accessible item succeeds

- **WHEN** a user pins a chat or project they own
- **THEN** the pin is created

#### Scenario: Pinning an inaccessible item is denied

- **WHEN** a user attempts to pin an item they do not own and have no access to
- **THEN** the pin is not created and the request is denied

### Requirement: Unified pin API

The system SHALL expose pinning as a single REST resource keyed by item type and id, taking a validated request and returning an explicit response type, with the acting identity derived from the authenticated session. The surface SHALL be:

- a list operation returning the caller's pinned items,
- an idempotent pin operation addressed by item type and id,
- an idempotent unpin operation addressed by item type and id.

Item type and id SHALL appear in the request path for both write operations. There SHALL NOT be a separate per-item-type pin surface (e.g. a verb handle on the chat or project resource).

#### Scenario: Pin and unpin address the item by type and id

- **WHEN** a user pins and later unpins an item
- **THEN** both operations identify the item by its type and id in the same resource, and each returns a well-typed response

#### Scenario: Legacy per-chat pin path is gone

- **WHEN** a client attempts to pin a chat through the former chat-update path
- **THEN** that path no longer accepts a pin instruction; pinning is available only through the unified pin resource

### Requirement: Strongly-typed, extensible item type

The set of pinnable item types SHALL be a strongly-typed, closed enumeration enforced at the datastore boundary and mirrored in the application type system. The initial members SHALL be **chat** and **project**. Adding a future pinnable type SHALL be an additive extension of the enumeration and its accessibility check, requiring no change to the pin entity's shape or the pin API's contract.

#### Scenario: An unknown item type is rejected

- **WHEN** a pin request names an item type outside the defined enumeration
- **THEN** the request is rejected as invalid

#### Scenario: Chats and projects are pinnable

- **WHEN** a user pins a chat and pins a project
- **THEN** both pins are accepted and coexist for that user

### Requirement: Unified pinned list

The system SHALL provide the caller's pinned items as a single list mixing all item types, ordered most-recently-pinned first. Each entry SHALL carry its item type, id, pin timestamp, and a **type-appropriate reference** bearing the display metadata needed to render and open the item (at least a title or name). The reference SHALL be shaped per item type, so that a future item type may contribute its own presentation without changing the pin contract. A pinned reference whose item no longer exists or is no longer accessible to the caller SHALL be omitted from this list rather than surfaced as a broken entry.

#### Scenario: The pinned list mixes types in pin-recency order

- **WHEN** a user has pinned a project and then a chat
- **THEN** the pinned list returns both, most-recently-pinned first, each carrying its type-appropriate reference with the metadata needed to display and open it

#### Scenario: A pin to a vanished item is omitted

- **WHEN** an item a user pinned is later deleted or becomes inaccessible to them
- **THEN** that entry does not appear in the pinned list, and the remaining pins are unaffected

### Requirement: Pins are the sole source of pin state

Pin state SHALL live only in the pinning subsystem. A pinnable resource's own representation (e.g. the chat or project list item) SHALL NOT carry pin state. Any surface that groups a resource list by pin status SHALL derive that grouping from the caller's pinned set, not from a pin field on the resource.

#### Scenario: A resource representation carries no pin field

- **WHEN** a user lists chats or projects
- **THEN** the returned resources carry no pin timestamp or pinned flag; pin state is obtained only from the pinned list

#### Scenario: Pinned resources form a group in their own list

- **WHEN** a user views the chat list or the project list
- **THEN** the resources whose id is in the caller's pinned set appear in a "Pinned" group above the rest of that list, ordered most-recently-pinned first
