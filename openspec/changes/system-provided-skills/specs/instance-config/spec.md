## ADDED Requirements

### Requirement: Operator config declares skill source directories

Instance configuration SHALL accept `skills.directories` as an ordered array of at most 32 non-empty directory paths, defaulting to an empty array. Each source SHALL contain skill directories rather than require per-skill enumeration. Relative paths SHALL resolve against the configuration file directory; a leading `~/` SHALL resolve against the operator process home. Existing configuration interpolation SHALL apply without shell evaluation. No implicit home or repository scanning SHALL occur. Configuration changes SHALL use the existing restart boundary; changes to package files inside configured sources SHALL be observed live without restart. No per-owner source mutation API SHALL be introduced.

#### Scenario: Configuration is omitted

- **WHEN** the operator supplies no skills configuration
- **THEN** the catalog is empty and existing tool availability is unchanged

#### Scenario: Explicit home source

- **WHEN** the operator configures `~/.agents/skills`
- **THEN** immediate package directories beneath that explicitly selected source are discovered
- **AND** no other client home directories are scanned

#### Scenario: Package update does not require config reload

- **WHEN** a package file changes inside an already configured source
- **THEN** its next invocation reads current content without restarting the app
