## MODIFIED Requirements

### Requirement: Configured directories publish one operator catalog

The system SHALL discover immediate skill directories beneath configured operator sources, with later sources overriding earlier sources by package name. Each package SHALL contain valid Agent Skills frontmatter with a name matching its directory and a non-empty description. Invalid winning packages SHALL be unavailable with an operator diagnostic and SHALL NOT fall back to earlier packages of the same name. Unrelated valid packages SHALL remain available. Discovery SHALL NOT implicitly include personal, workspace, bundled, or remote sources. An unreadable or oversized source SHALL make discovery unavailable rather than resolve precedence from an incomplete scan.

A configured source SHALL be trusted by being configured. An explicitly configured source that is itself a symbolic link SHALL resolve to its real root. An immediate child of a source that is a symbolic link SHALL resolve to its real directory and SHALL be discovered as a package when that directory holds a `SKILL.md`, regardless of whether the real directory lies beneath any configured source; the published package directory SHALL be the real directory. A link that cannot be resolved or that resolves to something other than a directory SHALL be an unavailable entry with an operator diagnostic. Files inside a package, including `SKILL.md`, sidecar controls, and supporting resources, SHALL resolve only within that package's real directory, as the skill locator requirement of `native-file-tools` specifies.

#### Scenario: Directory contains several packages

- **WHEN** one configured source contains `pdf/SKILL.md` and `research/SKILL.md`
- **THEN** both packages are discovered without individual configuration entries

#### Scenario: Later source overrides the base

- **WHEN** two configured sources contain valid `review` packages
- **THEN** the later source supplies `review` and its selected source is inspectable

#### Scenario: Invalid override masks the base

- **WHEN** the later `review` package has malformed metadata
- **THEN** `review` is unavailable with a diagnostic and the earlier body is not substituted
- **AND** valid `pdf` remains available

#### Scenario: Package symlink resolves outside every configured source

- **WHEN** a configured source contains `research` as a symbolic link to a directory holding `SKILL.md` that lies under no configured source
- **THEN** `research` is discovered and available
- **AND** its published package directory is the link's real directory

#### Scenario: Dangling package symlink

- **WHEN** a configured source contains a symbolic link whose target does not exist or is not a directory
- **THEN** the entry is unavailable with a diagnostic naming the unresolved link
- **AND** other packages in the source remain available

#### Scenario: Package-internal link still cannot escape

- **WHEN** a discovered package's `SKILL.md` or a sidecar control is a symbolic link resolving outside the package's real directory
- **THEN** the package is unavailable with a diagnostic
- **AND** the outside file is not read
