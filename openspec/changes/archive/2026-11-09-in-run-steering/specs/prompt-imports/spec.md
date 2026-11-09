## MODIFIED Requirements

### Requirement: Prompt imports persist as one preceding rail item

Before the first model request of the Run, the triggering message MUST persist one
`prompt-imports` rail item with form `notice`, before the user text. For a message that a delivery
of `run-steering` adds, this is the first model request of its segment. The item MUST hold one
locator-labelled file block for each imported target. It MUST neutralize reserved delimiters and
carry third-party precedence. It MUST name a denied or failed target only as not imported. Its
payload MUST record, for each attempted target, whether it was admitted. It MUST also record the
resolved absolute host path or canonical `kb://` locator, where one applies.

#### Scenario: Successful imports precede unchanged user text

- **WHEN** a prompt imports two targets before the first model request of its Run
- **THEN** the triggering user message contains one `prompt-imports` notice before the user text
- **AND** it has one locator-labelled file block for each imported target, and the user text does not change
- **AND** its private payload records the admission result of each attempted target
- **AND** it records the resolved absolute host locator or canonical Knowledge locator, where one applies

#### Scenario: Imported content carries precedence framing

- **WHEN** a prompt-imports item contains file content from a host, Knowledge, skill, or web target
- **THEN** the item carries its third-party precedence statement
- **AND** the statement ranks that content below system instructions and user requests
- **AND** it gives that content no authority to grant tools or relax authorization

#### Scenario: Reserved delimiters do not close the item

- **WHEN** imported content contains a reserved context delimiter
- **THEN** the persisted file block contains the neutralized form
- **AND** the prompt-imports notice stays intact

#### Scenario: Denied or failed content is not included

- **WHEN** a prompt target is denied, or the read of an admitted target fails
- **THEN** the item names its locator only as not imported
- **AND** it includes no content from that target

#### Scenario: A delivered steer imports a file

- **WHEN** a Run delivers a steer with an import marker for one admitted file
- **THEN** the delivered message holds one `prompt-imports` item before the steer text
