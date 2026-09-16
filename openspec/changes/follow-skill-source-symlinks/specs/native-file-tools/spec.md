## MODIFIED Requirements

### Requirement: Skill locators provide live read-only package access

`read` SHALL accept `skill://<name>[:selector]` for a package's `SKILL.md`, `skill://<name>/<path>[:selector]` for supporting files, `skill://<name>/` for its directory, and `skill://` for the current bounded catalog. The catalog form SHALL support pagination through native directory range selectors. Skill names SHALL follow the Agent Skills name grammar. Resource segments SHALL follow the Knowledge locator's once-only decoding, selector separation, size/depth, and traversal validation rules. Native directory/read/range/raw/truncation behavior SHALL apply except for the explicit catalog representation. `edit` and `write` SHALL reject skill locators as unsupported operations without effects.

The resolver SHALL re-evaluate the current winning package on each call through the catalog port. It SHALL take the current turn's explicit selection set as a parameter: a manual-only package's body or resource read SHALL return a bounded structured refusal naming explicit selection unless that set contains the package, and the catalog listing SHALL omit manual-only packages not in that set. The Run supplies the set derived from its triggering user message to every skill read it performs, model-initiated reads included; a caller with no turn context supplies an empty set. Symbolic links beneath a source or inside a package follow ordinary operating-system semantics as `agent-skills` specifies; the resolver SHALL NOT resolve or contain them. Missing/invalid packages, unsupported operations, and invalid resource paths SHALL return bounded structured errors. The resolver SHALL NOT read special files.

Results SHALL carry the logical locator, selected source, absolute `resolvedPath`, and absolute `skillDirectory`, both as discovered beneath the configured source rather than resolved real paths. These paths and an instruction to resolve package-relative references/script paths into absolute paths using `skillDirectory` SHALL be present in model-facing output as well as owner metadata. That instruction SHALL distinguish task-relative inputs and explicit `cwd` from package-relative paths; the tool SHALL NOT rewrite commands. The result bound SHALL reserve space for this envelope before truncating resource content; if the envelope cannot fit, the read SHALL fail with a bounded error. This publication exception SHALL apply only to operator skill paths, not Knowledge paths. Ordinary permission admission SHALL match a pure canonical projection of the submitted skill locator before any resource open: decode resource segments once, validate and re-encode through the shared locator grammar, and omit read selectors. It SHALL never substitute a physical path. Existing configured/default read rules SHALL apply to that projection, including credential-path rejects; no skill-specific permission bypass or duplicate deny list SHALL be introduced.

#### Scenario: Skill resource exposes the execution base

- **WHEN** the model reads `skill://pdf/scripts/extract.py`
- **THEN** the result includes the current script content and model-visible real file/package paths
- **AND** no script executes during the read

#### Scenario: Skill root and directory differ

- **WHEN** the model reads `skill://pdf` and then `skill://pdf/`
- **THEN** the first reads `SKILL.md` and the second lists the package directory

#### Scenario: Raw root read returns the instructions verbatim

- **WHEN** the model reads `skill://pdf:raw`
- **THEN** the result carries the current `SKILL.md` bytes without line-number prefixes
- **AND** the skill result envelope with `skillDirectory` and `resolvedPath` is still present

#### Scenario: Manual-only package is not selected this turn

- **WHEN** a read targets `skill://review` and `review` is manual-only and absent from the turn's selection set
- **THEN** the read returns a bounded refusal naming explicit selection without opening the file
- **AND** `skill://` does not list `review`

#### Scenario: Mutation is unsupported

- **WHEN** an edit or write targets `skill://pdf/SKILL.md`
- **THEN** it returns an unsupported-operation error without a mutation attempt or filesystem effect
