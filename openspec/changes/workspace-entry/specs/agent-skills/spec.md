## MODIFIED Requirements

### Requirement: Configured directories publish one operator catalog

The system SHALL discover immediate skill directories beneath configured operator sources, with later sources overriding earlier sources by package name. Each package SHALL contain valid Agent Skills frontmatter with a name matching its directory and a non-empty description. Invalid winning packages SHALL be unavailable with an operator diagnostic and SHALL NOT fall back to earlier packages of the same name. Unrelated valid packages SHALL remain available. System catalog discovery SHALL NOT implicitly include personal, Workspace, bundled, or remote sources. An unreadable or oversized source SHALL make discovery unavailable rather than resolve precedence from an incomplete scan.

The system catalog SHALL remain limited to configured operator sources: `GET /api/v1/skills` SHALL continue to expose the operator catalog only and SHALL NOT include Workspace skills. For a Chat entered into a Workspace, the Chat's effective skill sources SHALL consist of configured operator sources followed, in increasing override precedence, by that Workspace's `.claude/skills`, `.agents/skills`, and `.llame/skills` sources. Every Workspace source SHALL rank above every operator source, and a missing Workspace directory SHALL contribute no source. This extension SHALL apply only to the entered Chat; a Chat without an active Workspace binding SHALL use operator sources only. The Chat's catalog, `skill://` reads, and explicit `$skill` activation SHALL resolve against that Chat's effective sources. A Workspace skill SHALL be available to a `skill://` read in the same Run that enters the Workspace.

An operator source SHALL be trusted by being configured, and a Workspace source SHALL be trusted by successful Workspace entry for that Chat. Discovery and skill reads SHALL apply ordinary operating-system link semantics and SHALL NOT resolve, verify, or contain symbolic links: an immediate child of a source that is a symbolic link is a package when it resolves to a directory holding `SKILL.md`, wherever that directory lies; links inside a package are followed wherever they point; a child link that cannot be resolved SHALL be an unavailable entry with a diagnostic naming the unresolved link, and a child link that resolves to something other than a directory SHALL be an unavailable entry with a diagnostic naming the target kind where it is known. Package paths SHALL be published as discovered beneath their selected source, not as resolved real paths.

#### Scenario: Directory contains several packages

- **WHEN** one configured source contains `pdf/SKILL.md` and `research/SKILL.md`
- **THEN** both packages are discovered without individual configuration entries

#### Scenario: Later source overrides the base

- **WHEN** two configured operator sources contain valid `review` packages
- **THEN** the later source supplies `review` and its selected source is inspectable

#### Scenario: Invalid override masks the base

- **WHEN** the later `review` package has malformed metadata
- **THEN** `review` is unavailable with a diagnostic and the earlier body is not substituted
- **AND** valid `pdf` remains available

#### Scenario: Workspace sources override operator skills by name

- **WHEN** configured operator sources and all three Workspace skill directories contain valid packages named `review`
- **THEN** the package from `.llame/skills` supplies `review` for that Chat, ahead of `.agents/skills`, `.claude/skills`, and every operator source
- **AND** the system catalog continues to select only from operator sources

#### Scenario: Missing Workspace directories contribute nothing

- **WHEN** an entered Workspace has no `.claude/skills` directory and contains a package only under `.llame/skills`
- **THEN** the missing directory contributes no packages and the `.llame/skills` package remains available
- **AND** operator packages remain available beneath it in precedence

#### Scenario: Another Chat sees only operator sources

- **WHEN** one Chat is entered into a Workspace containing `workspace-only` and another Chat has no active Workspace binding
- **THEN** the entered Chat's effective catalog can include `workspace-only` while the other Chat's catalog and `skill://` listing include only operator packages
- **AND** `GET /api/v1/skills` includes only operator packages

#### Scenario: Workspace skill is loadable in the entering Run

- **WHEN** a Run successfully enters a Workspace and then reads a proactively eligible package from its Workspace skill sources
- **THEN** the `skill://` read succeeds in that same Run under ordinary read admission
- **AND** the read does not require a later user turn

#### Scenario: Package symlink resolves outside every configured source

- **WHEN** a configured source contains `research` as a symbolic link to a directory holding `SKILL.md` that lies under no configured source
- **THEN** `research` is discovered and available
- **AND** its published package directory is the link path beneath the configured source

#### Scenario: Link inside a package is followed

- **WHEN** a discovered package contains `references` as a symbolic link to a directory outside the package
- **THEN** `skill://<name>/references/<file>` reads the linked file
- **AND** no containment check is applied

#### Scenario: Dangling package symlink

- **WHEN** a selected source contains a symbolic link whose target does not exist, or one that resolves to a regular file
- **THEN** the entry is unavailable with a diagnostic naming the unresolved link or the target kind
- **AND** other packages in the source remain available
