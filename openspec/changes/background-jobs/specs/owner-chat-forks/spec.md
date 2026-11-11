## MODIFIED Requirements

### Requirement: A shared or public fork receives no checkpoint row

A shared or public fork MUST copy user and assistant rows as text-only rows, and it MUST NOT copy
a `checkpoint` row. Each copied row MUST carry only the text parts of the source row. The fork
MUST omit owner `file` parts and their `media://` locators. A user row with no text part MUST
NOT be copied. That rule covers a row whose only parts were `file` parts and a host message of
`background-jobs`. A copied row whose reply target was not copied MUST carry no reply target. The
fork MUST NOT create, copy, or reference a media object, so its owner gets no access to the
images of the source owner. An owner fork is not affected, and it copies `file` parts and host
messages as literal rows.

#### Scenario: A shared fork receives no checkpoint row

- **WHEN** another user forks a compacted Chat through the shared or public route
- **THEN** the copy holds only the public transcript projection
- **AND** it holds no `checkpoint` row and discloses no checkpoint text or raw summary

#### Scenario: A shared fork omits attachments

- **WHEN** another user forks a public Chat whose user message stores the text part `see this` and an owner `file` part
- **THEN** the copied user row holds exactly the text part `see this`
- **AND** no copied row holds a `file` part or a `media://` locator

#### Scenario: An image-only row is not copied into a shared fork

- **WHEN** the history of a public Chat is `U1 A1 U2 A2`, `U2` stores owner `file` parts and no text part, and another user forks it
- **THEN** the fork holds `U1 A1 A2` with dense sequences from 1
- **AND** the copy of `A2` carries no reply target

#### Scenario: A shared fork confers no access to the source owner's media

- **WHEN** another user forks a public Chat whose messages reference the media of the source owner
- **THEN** no media object is created for the fork, copied to it, or referenced by it
- **AND** the media lookup of the fork owner finds nothing for each source media id

#### Scenario: An owner fork keeps attachments

- **WHEN** the owner forks their own Chat whose user message stores text and owner `file` parts
- **THEN** the copied row holds the same `file` parts in the same order with the same `media://` locators
- **AND** the fork creates and duplicates no media object

#### Scenario: A host message is not copied into a shared fork

- **WHEN** the history of a public Chat is `U1 A1 H A2`, `H` is a host message, and another user forks it
- **THEN** the fork holds `U1 A1 A2`, and the copy of `A2` carries no reply target
- **AND** no copied row holds job output
