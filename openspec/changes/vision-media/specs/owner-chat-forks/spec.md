## MODIFIED Requirements

### Requirement: A shared or public fork receives no checkpoint row

A shared or public fork SHALL copy user and assistant rows as text-only rows and SHALL NOT copy a
`checkpoint` row. Each copied row SHALL carry only the source row's text parts; owner `file` parts
and their `media://` locators SHALL be omitted, and a user row whose only parts were `file` parts
SHALL NOT be copied. A copied row whose reply target was not copied SHALL carry no reply target.
The fork SHALL NOT create, copy, or reference any media object, so its owner gains no access to the source owner's
images. An owner fork is unaffected and copies `file` parts verbatim as literal parts.

#### Scenario: A shared fork receives no checkpoint row

- **WHEN** another user forks a compacted Chat through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it holds no `checkpoint` row and discloses no checkpoint text or raw summary

#### Scenario: A shared fork omits attachments

- **WHEN** another user forks through the shared/public route a public Chat whose user message
  stores text part `see this` and an owner `file` part
- **THEN** the copied user row holds exactly the text part `see this`
- **AND** no copied row holds a `file` part or a `media://` locator

#### Scenario: An image-only row is not copied into a shared fork

- **WHEN** a public Chat's history is `U1 A1 U2 A2`, `U2` stores owner `file` parts and no text part,
  and another user forks it through the shared/public route
- **THEN** the fork holds `U1 A1 A2` with dense sequences from 1
- **AND** the copy of `A2` carries no reply target

#### Scenario: A shared fork confers no access to the source owner's media

- **WHEN** another user forks a public Chat whose messages reference the source owner's media
- **THEN** no media object is created for, copied to, or referenced by the fork
- **AND** the fork owner's media lookup of each source media id finds nothing

#### Scenario: An owner fork keeps attachments

- **WHEN** the owner forks their own Chat whose user message stores text and owner `file` parts
- **THEN** the copied row holds the same `file` parts in the same order with the same `media://`
  locators
- **AND** no media object is created or duplicated by the fork
