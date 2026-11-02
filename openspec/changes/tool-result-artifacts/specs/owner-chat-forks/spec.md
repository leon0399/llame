## ADDED Requirements

### Requirement: A fork copies the artifacts that its copied parts name

The fork MUST copy each artifact that a copied tool part names into the fork,
with the same locator. It MUST set the artifact counter of the fork to the
counter of the source. The copy MUST happen in the transaction that copies the
rows. The fork MUST NOT copy an artifact that no copied part names.

#### Scenario: A copied locator resolves in the fork

- **WHEN** the owner forks a Chat after a turn whose `grep` part names `artifact://grep-7`
- **THEN** `read("artifact://grep-7")` in the fork returns the same content
- **AND** the next artifact of the fork takes the number after the source counter

#### Scenario: A deleted source keeps the fork artifacts

- **WHEN** the owner deletes the source Chat after the fork
- **THEN** `artifact://grep-7` still reads in the fork

#### Scenario: An artifact after the prefix is not copied

- **WHEN** the source made `artifact://bash-9` in a turn after the selected prefix
- **THEN** the fork has no `artifact://bash-9`

#### Scenario: A shared fork copies no artifact

- **WHEN** another user forks the source through the shared or public route
- **THEN** the fork has no artifact, because it copies no tool part

#### Scenario: A part cannot copy an artifact of another Chat

- **WHEN** a copied tool part names `artifact://grep-9` and the source Chat has no such artifact
- **THEN** the fork copies no artifact for that locator
