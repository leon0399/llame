## MODIFIED Requirements

### Requirement: Prompt targets resolve as native read locators

Each target MUST resolve as native `read` resolves it, with its selector.
This includes absolute host paths, `file:` aliases, and paths relative to the
bound Workspace. It also includes each locator scheme that native `read`
accepts, except `artifact://` and `job://`. An unbound relative target MUST stay prose. An
absolute or `file:` host target can run unbound only with `read` in
`tools.allowed` and a native executor. A `kb://` target can run unbound only
with `read` in `tools.allowed` and a Knowledge root.

#### Scenario: A Workspace-relative target uses the bound Workspace

- **WHEN** a Chat has the bound Workspace `/repo` and its prompt contains `@README.md:30-35`
- **THEN** the target resolves as `/repo/README.md:30-35`
- **AND** its selector stays on the target

#### Scenario: Scheme locators retain their native authority

- **WHEN** a prompt contains valid absolute, `file:`, `kb://`, `skill://`, `media://`, `machine://`, `ssh://`, `http://`, or `https://` locators
- **THEN** the native `read` authority for each locator resolves that target
- **AND** no Workspace-relative projection changes a scheme locator

#### Scenario: An unbound relative target is prose

- **WHEN** a Chat has no Workspace and its prompt contains `@README.md`
- **THEN** the target stays prose
- **AND** the system attempts no prompt import

### Requirement: Prompt imports cover every native read scheme

Native `read` accepts a set of locator schemes. A user-prompt marker with one
of these schemes MUST get an outcome when the Run can reach its source. The
outcome is imported, denied, failed, or omitted. A scheme without a probe or
availability rule in this capability MUST import through one direct `read`,
with no probe. A marker whose scheme native `read` does not accept MUST stay
prose, with no read and no audit event. An `artifact://` or `job://` marker MUST also stay
prose, because its locator names an artifact or a job of the current Chat only.

#### Scenario: A marker for each read scheme gets an outcome

- **WHEN** the Run can reach the source of each locator scheme that native `read` accepts, `artifact://` and `job://` excluded
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

#### Scenario: A job marker stays prose

- **WHEN** a prompt contains `@job://bash-4/stdout` and the Chat has that job
- **THEN** the marker stays prose
- **AND** the system records no read, no audit event, and no owner chip entry for it
