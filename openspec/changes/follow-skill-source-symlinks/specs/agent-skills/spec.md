## MODIFIED Requirements

### Requirement: Configured directories publish one operator catalog

The system SHALL discover immediate skill directories beneath configured operator sources, with later sources overriding earlier sources by package name. Each package SHALL contain valid Agent Skills frontmatter with a name matching its directory and a non-empty description. Invalid winning packages SHALL be unavailable with an operator diagnostic and SHALL NOT fall back to earlier packages of the same name. Unrelated valid packages SHALL remain available. Discovery SHALL NOT implicitly include personal, workspace, bundled, or remote sources. An unreadable or oversized source SHALL make discovery unavailable rather than resolve precedence from an incomplete scan.

A configured source SHALL be trusted by being configured. Discovery and skill reads SHALL apply ordinary operating-system link semantics and SHALL NOT resolve, verify, or contain symbolic links: an immediate child of a source that is a symbolic link is a package when it resolves to a directory holding `SKILL.md`, wherever that directory lies; links inside a package are followed wherever they point; a child link that cannot be resolved SHALL be an unavailable entry with a diagnostic naming the unresolved link, and a child link that resolves to something other than a directory SHALL be an unavailable entry with a diagnostic naming the non-directory target where its kind is known, where today such a link inside a configured source is silently not a package. Package paths SHALL be published as discovered beneath the configured source, not as resolved real paths.

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
- **AND** its published package directory is the link path beneath the configured source

#### Scenario: Link inside a package is followed

- **WHEN** a discovered package contains `references` as a symbolic link to a directory outside the package
- **THEN** `skill://<name>/references/<file>` reads the linked file
- **AND** no containment check is applied

#### Scenario: Dangling package symlink

- **WHEN** a configured source contains a symbolic link whose target does not exist, or one that resolves to a regular file
- **THEN** the entry is unavailable with a diagnostic naming the unresolved link or the non-directory target
- **AND** other packages in the source remain available

### Requirement: References and scripts retain ordinary execution authority

Skill loading SHALL publish the selected package's absolute directory as discovered beneath its configured source and the requested file path in model-visible output and owner-visible results, and SHALL instruct the model to resolve package-relative references and script paths against that directory into absolute tool arguments while preserving task-relative inputs and choosing `cwd` explicitly when required. Explicit activation SHALL carry the same instruction. References and scripts SHALL be accessible on demand within the package. Loading SHALL NOT execute scripts, rewrite Bash command text, change Bash working directory, install dependencies, or grant permissions. Scripts SHALL use ordinary available tools and executor checks. Unsupported vendor execution extensions SHALL not execute and SHALL be disclosed as unsupported. Removing a catalog source SHALL NOT delete its files or revoke permitted absolute-path or Bash access to surviving files.

#### Scenario: Relative script invocation becomes a usable command

- **WHEN** a loaded package instructs the model to use `./scripts/extract.py`
- **THEN** model-visible output supplies the package directory as discovered, from which it can construct an absolute script path
- **AND** Bash receives exactly the model-submitted command with its explicit working directory

#### Scenario: Package removal is not filesystem revocation

- **WHEN** an operator removes a source from configuration and restarts, leaving its files on disk
- **THEN** new skill-locator loads cannot use that source
- **AND** ordinary permitted Bash access to the remaining files retains its existing behavior

#### Scenario: Global skill cannot read another owner's Knowledge

- **WHEN** a skill instructs an owner Run to read another owner's Knowledge locator
- **THEN** normal owner isolation rejects the read and skill trust grants no exception
