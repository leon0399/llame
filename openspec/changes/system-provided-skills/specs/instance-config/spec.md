## ADDED Requirements

### Requirement: Operator config declares skill source directories

Instance configuration SHALL accept `skills.directories` as an ordered array of at most 32 non-empty directory paths, defaulting to an empty array. Each source SHALL contain skill directories rather than require per-skill enumeration. Relative paths SHALL resolve against the configuration file directory; a leading `~/` SHALL resolve against the operator process home. These intentionally public path entries SHALL be literal path settings: `{env:...}` and `{path:...}` interpolation syntax SHALL be rejected before resolution, and shell evaluation SHALL NOT occur. Other configuration fields SHALL retain their existing interpolation behavior. No implicit home or repository scanning SHALL occur. Configuration changes SHALL use the existing restart boundary; changes to package files inside configured sources SHALL be observed live without restart. No per-owner source mutation API SHALL be introduced.

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

#### Scenario: Public source rejects secret interpolation

- **WHEN** a skill source contains `{env:SKILL_ROOT}` or `{path:/run/secrets/value}`
- **THEN** configuration validation fails before resolving that token, identifies the configuration field, and exposes no resolved value

#### Scenario: Collection root contains the skill directories

- **WHEN** `skills.directories` contains `/opt/skills` and `/opt/skills/pdf/SKILL.md` exists
- **THEN** the `pdf` package is discovered
- **AND** the operator does not configure `/opt/skills/pdf` for this layout; a source directory's own `SKILL.md` is not a discovered child package
