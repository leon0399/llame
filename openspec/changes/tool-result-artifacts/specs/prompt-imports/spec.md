## MODIFIED Requirements

### Requirement: Prompt imports cover every native read scheme

Native `read` accepts a set of locator schemes. A user-prompt marker with one
of these schemes MUST get an outcome when the Run can reach its source. The
outcome is imported, denied, failed, or omitted. A scheme without a probe or
availability rule in this capability MUST import through one direct `read`,
with no probe. A marker whose scheme native `read` does not accept MUST stay
prose, with no read and no audit event. An `artifact://` marker MUST also stay
prose, because its locator names an artifact of the current Chat only.

#### Scenario: A marker for each read scheme gets an outcome

- **WHEN** the Run can reach the source of each locator scheme that native `read` accepts, `artifact://` excluded
- **AND** a prompt contains one valid marker for each of these schemes
- **THEN** the system attempts each target through `read`
- **AND** the owner chip shows each target as imported, denied, failed, or omitted

#### Scenario: A scheme that read does not accept stays prose

- **WHEN** a prompt contains `@foo://host/doc.md`, and native `read` does not accept the `foo` scheme
- **THEN** the marker stays prose
- **AND** the system records no read, no audit event, and no owner chip entry for it

#### Scenario: A scheme without a reachable source stays prose

- **WHEN** the configuration has no `ssh` section and a prompt contains `@ssh://box/etc/hostname`
- **THEN** the marker stays prose
- **AND** the system records no read and no audit event for it

#### Scenario: An artifact marker stays prose

- **WHEN** a prompt contains `@artifact://grep-7` and the Chat has that artifact
- **THEN** the marker stays prose
- **AND** the system records no read, no audit event, and no owner chip entry for it
