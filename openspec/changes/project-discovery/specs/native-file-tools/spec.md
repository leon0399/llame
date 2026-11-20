## ADDED Requirements

### Requirement: Project locators use the native read interface

Native `read` MUST accept `projects://` resources under the `project-discovery` capability. It MUST route them before local path or Workspace projection. Scheme acceptance MUST reach prompt imports through the existing native acceptance interface. Project reads MUST require no native executor and MUST NOT bind one.

#### Scenario: A Project read works without native execution

- **WHEN** an installation offers `read` without a native executor and the Run reads an admitted Project locator
- **THEN** the read returns the owner's Project data without `executor_unavailable`
- **AND** no executor binding changes

#### Scenario: A Workspace does not change Project authority

- **WHEN** a bound Chat reads `projects://`
- **THEN** the read uses the owner's Project datastore
- **AND** it does not read a file relative to the Workspace
