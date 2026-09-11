## Purpose

Provides operator-managed reusable skill packages with explicit and proactive activation, live resource reads, executable path disclosure, and durable owner-visible observations.

## ADDED Requirements

### Requirement: Configured directories publish one operator catalog

The system SHALL discover immediate skill directories beneath configured operator sources, with later sources overriding earlier sources by package name. Each package SHALL contain valid Agent Skills frontmatter with a name matching its directory and a non-empty description. Invalid winning packages SHALL be unavailable with an operator diagnostic and SHALL NOT fall back to earlier packages of the same name. Unrelated valid packages SHALL remain available. Discovery SHALL NOT implicitly include personal, workspace, bundled, or remote sources. An unreadable or oversized source SHALL make discovery unavailable rather than resolve precedence from an incomplete scan.

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

### Requirement: Invocation controls distinguish explicit selection from proactive use

Skills SHALL be eligible for proactive loading by default. `disable-model-invocation: true` or `agents/openai.yaml` `policy.allow_implicit_invocation: false` SHALL make a package manual-only; either disabling value SHALL win. Invalid control types SHALL invalidate the package. Manual-only packages SHALL be absent from proactive model catalog entries and SHALL require explicit selection in the current user turn for skill-locator body/resource reads. Authenticated owner inspection SHALL include manual-only packages. These controls SHALL NOT change ordinary absolute-path permissions or grant tool authority.

#### Scenario: Model combines skills

- **WHEN** a task matches two proactively eligible descriptions
- **THEN** the model can load both skills and neither activation replaces the other
- **AND** their unused resources are not eagerly injected

#### Scenario: Either control disables proactive loading

- **WHEN** one supported vendor control disables invocation and the other enables it
- **THEN** the skill is manual-only and a model-only skill-locator load is refused

### Requirement: Explicit mentions load skills before the first model request

The system SHALL recognize exact `$skill-name` tokens in user-authored text outside fenced code, inline code, and escaped dollar signs, with valid name boundaries. It SHALL load distinct selected skills in first-mention order before the Run's first model request, deduplicating repeated mentions within that user turn. Ordinary mentions SHALL remain model-selected. Activation SHALL use the same read availability, input validation, permission admission, live resolver, and result bounds as proactive reads. The user text SHALL be retained subject to existing reserved-delimiter sanitation; activation SHALL NOT remove mention tokens or perform argument substitution. Each activation result SHALL be persisted as an owner-visible context item rather than a fabricated model tool call. An unavailable, invalid, or denied selection SHALL produce a bounded failure item without stopping other selections or the Run.

#### Scenario: User selects two skills

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** both current instruction bodies are loaded in that order before the first model request, subject to read admission
- **AND** the retained user text, with existing delimiter sanitation applied, follows the activation items

#### Scenario: Example text is not an activation

- **WHEN** `$research` appears only in inline code, fenced code, or with an escaped dollar sign
- **THEN** it does not trigger explicit activation

#### Scenario: Explicit selection does not bypass permission

- **WHEN** the user selects a skill whose read is denied
- **THEN** no body is loaded and a persisted permission failure accompanies the user turn

### Requirement: Skill observations are live and replay remains historical

Each new skill-locator read SHALL re-evaluate current configured-source availability and read the current selected file. It SHALL NOT require equality with an earlier advertised or consumed revision. Completed observations SHALL persist selected source, resolved target, observed content identity, and actual model-facing content/truncation. Recovery and client replay SHALL reuse completed observations without re-reading. A resource edit SHALL NOT retroactively alter prior tool output or explicit activation text. No guarantee SHALL be made that bytes read earlier are the bytes an interpreter later executes.

#### Scenario: Resource changes after instruction loading

- **WHEN** the operator changes a reference before its next read
- **THEN** the new read returns current content without a changed-source refusal
- **AND** previously stored results remain unchanged

#### Scenario: Removal precedes the next reminder

- **WHEN** a package is removed during a Run that still advertises it
- **THEN** the next skill-locator load fails immediately
- **AND** no unsolicited catalog reminder is inserted in that active Run

#### Scenario: Retry follows completed explicit activation

- **WHEN** the worker resumes after activation was persisted and the package has since changed
- **THEN** the completed activation replays its stored text
- **AND** a separately requested new load can read the new content

### Requirement: References and scripts retain ordinary execution authority

Skill loading SHALL publish the selected package's real absolute directory and requested file path in model-visible output and owner-visible results, and SHALL state the base for relative package references. References and scripts SHALL be accessible on demand within the package. Loading SHALL NOT execute scripts, rewrite Bash command text, change Bash working directory, install dependencies, or grant permissions. Scripts SHALL use ordinary available tools and executor checks. Unsupported vendor execution extensions SHALL not execute and SHALL be disclosed as unsupported. Removing a catalog source SHALL NOT delete its files or revoke permitted absolute-path or Bash access to surviving files.

#### Scenario: Relative script invocation becomes a usable command

- **WHEN** a loaded package instructs the model to use `./scripts/extract.py`
- **THEN** model-visible output supplies the real package directory from which it can construct an absolute script path
- **AND** Bash receives exactly the model-submitted command with its explicit working directory

#### Scenario: Package removal is not filesystem revocation

- **WHEN** an operator removes a source from configuration and restarts, leaving its files on disk
- **THEN** new skill-locator loads cannot use that source
- **AND** ordinary permitted Bash access to the remaining files retains its existing behavior

#### Scenario: Global skill cannot read another owner's Knowledge

- **WHEN** a skill instructs an owner Run to read another owner's Knowledge locator
- **THEN** normal owner isolation rejects the read and skill trust grants no exception

### Requirement: Owners can inspect the current catalog

Authenticated owners SHALL be able to inspect the same system catalog through `GET /api/v1/skills`, including source paths, invocation eligibility, unavailable entries, diagnostics, and pagination or explicit omission metadata. Unauthenticated requests SHALL fail. This surface SHALL NOT publish credentials or allow catalog mutation. Skill read listing at `skill://` SHALL be bounded and filter manual-only entries unless selected in the current user turn. Catalog bodies SHALL remain absent until selected.

#### Scenario: Two owners inspect shared packages

- **WHEN** two authenticated owners inspect available skills
- **THEN** both see the operator catalog and neither receives the other's private Run or Knowledge data

#### Scenario: Large catalog is disclosed honestly

- **WHEN** the catalog exceeds a response or model metadata bound
- **THEN** complete entries are returned with explicit continuation or omission information
- **AND** omitted bodies are not loaded to build the listing
