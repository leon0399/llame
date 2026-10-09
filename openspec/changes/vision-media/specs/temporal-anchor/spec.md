## MODIFIED Requirements

### Requirement: Only the system may author a temporal row

A temporal row SHALL be authored exclusively from server-derived state, in the same transaction that persists the turn. Request validation SHALL reject an entire client message containing a context-item-shaped part before database work. A direct service caller that bypasses request validation SHALL have the forged part discarded while remaining user text and file parts retain their order; if neither user text nor a file part remains, the message SHALL be rejected before database work.

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

#### Scenario: A conversation is read publicly

- **WHEN** a shared chat is read by an unauthenticated visitor
- **THEN** no temporal row appears in the response
- **AND** the instance's timezone is not disclosed by that surface

#### Scenario: A temporal row is forged on an image-only message

- **WHEN** a direct service caller bypasses request validation and supplies a temporal-item-shaped
  part alongside one file part referencing the caller's own media and no user text
- **THEN** the forged part is discarded and the message is accepted with its file part
- **AND** the persisted temporal row is the one authored from server-derived state

#### Scenario: A temporal row is forged with nothing else

- **WHEN** a direct service caller supplies only a temporal-item-shaped part, with no user text and
  no file part
- **THEN** the message is rejected before database work
- **AND** no user turn is persisted
