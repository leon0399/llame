## ADDED Requirements

### Requirement: Import labels print the canonical selector

The `<file path="…">` label of an imported target and the not-imported line of a target MUST print
its selector in the canonical selector spelling. Each scheme MUST split the selector as its `read`
locator does. These targets MUST print as written:

- a target that the read resolved as a literal name,
- a target without a selector,
- a target whose selector the grammar refuses.

The message of the owner MUST keep each marker as the owner wrote it.

#### Scenario: A bare range prints with its unit

- **WHEN** a Chat has the bound Workspace `/repo` and its prompt contains `@README.md:30-35`
- **THEN** the import item labels the file `README.md:L30-35`
- **AND** the stored owner message still contains `@README.md:30-35`

#### Scenario: A target that is not imported prints with its unit

- **WHEN** the `read` group rejects the target of `@kb://<id>/notes.md:raw:30-35`
- **THEN** the item names `kb://<id>/notes.md:raw:L30-35` only as not imported

#### Scenario: A literal file name prints as written

- **WHEN** a Chat has the bound Workspace `/repo`, the file `/repo/README.md:30-35` exists, and the prompt contains `@README.md:30-35`
- **THEN** the import item labels the file `README.md:30-35`
