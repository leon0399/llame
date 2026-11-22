## ADDED Requirements

### Requirement: Import labels print the canonical selector

The `<file path="…">` label of an imported target and the not-imported line of a target MUST print
its selector in the canonical selector spelling. A target without a selector MUST print unchanged.
The message of the owner MUST keep each marker as the owner wrote it.

#### Scenario: A bare range prints with its unit

- **WHEN** a Chat has the bound Workspace `/repo` and its prompt contains `@README.md:30-35`
- **THEN** the import item labels the file `README.md:L30-35`
- **AND** the stored owner message still contains `@README.md:30-35`

#### Scenario: A target that is not imported prints with its unit

- **WHEN** the `read` group rejects the target of `@README.md:raw:30-35`
- **THEN** the item names `README.md:raw:L30-35` only as not imported
