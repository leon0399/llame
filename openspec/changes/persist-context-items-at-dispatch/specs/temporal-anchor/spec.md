## MODIFIED Requirements

### Requirement: Only the system may author a temporal row

A temporal row SHALL be authored exclusively from server-derived state, in the dispatch transaction that `context-injection` defines, before the request that first carries it; a retried attempt of a Run whose `dispatched_at` is set SHALL reuse that row rather than author another. Request validation SHALL reject an entire client message containing a context-item-shaped part before database work. A direct service caller that bypasses request validation SHALL have the forged part discarded while remaining user text retains its order; if no user text remains, the message SHALL be rejected before database work.

A temporal row SHALL NOT be exposed through a public share, a fork read by a non-owner, an ordinary transcript export, or a search projection, consistent with the existing egress allowlist for those surfaces.

#### Scenario: A client submits a temporal row

- **WHEN** a client posts a message containing a part shaped like a temporal item
- **THEN** request validation rejects the entire message
- **AND** no client-authored part or user turn is persisted

#### Scenario: A direct service caller supplies a temporal row

- **WHEN** a direct service caller bypasses request validation and supplies a
  temporal-item-shaped part alongside user text
- **THEN** the forged part is discarded while the remaining user text retains
  its order
- **AND** only server-derived state can author the persisted temporal row

#### Scenario: A failed Run keeps its temporal row

- **WHEN** a Run's first request carries its temporal row and the Run then fails
- **THEN** the row stays on the user message
- **AND** a retried attempt of that Run sends the same row rather than authoring another

#### Scenario: A conversation is read publicly

- **WHEN** a shared chat is read by an unauthenticated visitor
- **THEN** no temporal row appears in the response
- **AND** the instance's timezone is not disclosed by that surface
