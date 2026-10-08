## Purpose

Prompt imports let an owner point at native `read` locators in a prompt while preserving the prompt text and adding bounded, owner-visible context before the Run asks its model. They use native locator behavior and permission authority without turning imported data into instructions.

## ADDED Requirements

### Requirement: Prompt text recognizes shared import markers

The system SHALL scan the owner's stored, neutralized prompt text using the shared marker grammar defined by the `import-markers` capability. Markers in inline code or fenced code SHALL remain ordinary text, and importing SHALL leave the stored user text exactly as typed, including marker spelling and placement.

#### Scenario: A prompt marker is recognized without rewriting the prompt

- **WHEN** the stored prompt contains a valid shared import marker outside code
- **THEN** the target is handed to prompt-import processing
- **AND** the stored user text remains exactly as typed

#### Scenario: Code text remains ordinary prompt text

- **WHEN** an inline code span or fenced code block contains an import-shaped string
- **THEN** no prompt import is created from that string
- **AND** the code text remains unchanged

### Requirement: Prompt targets resolve as native read locators

Each recognized target SHALL resolve exactly as the native `read` locator would, including its selectors: absolute host paths, `file:` aliases, Workspace-relative paths when a Workspace is bound, `kb://`, `skill://`, `http://`, and `https://`. A relative target on a Chat without a Workspace SHALL remain prose.

#### Scenario: A Workspace-relative target uses the bound Workspace

- **WHEN** a Chat is bound to `/repo` and its prompt contains `@README.md:30-35`
- **THEN** the target resolves as `/repo/README.md:30-35`
- **AND** its selector remains attached to the target

#### Scenario: Scheme locators retain their native authority

- **WHEN** a prompt contains valid absolute, `file:`, `kb://`, `skill://`, `http://`, or `https://` locators
- **THEN** each target is resolved by the corresponding native `read` authority
- **AND** no Workspace-relative projection changes a scheme locator

#### Scenario: An unbound relative target is prose

- **WHEN** a Chat has no Workspace and its prompt contains `@README.md`
- **THEN** the target remains prose
- **AND** no prompt import is attempted

### Requirement: Local and Knowledge targets are probed before admission

Before admission, each host-path or `kb://` target SHALL be probed with its selector removed, without making a permission decision or recording an audit event. If the probe finds no target, the marker SHALL remain prose: no read, audit event, model disclosure, or owner disclosure SHALL result.

#### Scenario: A missing host target stays prose

- **WHEN** a prompt names `@missing.md:10-12` and the selector-free host target does not exist
- **THEN** the marker remains prose and no read is issued
- **AND** no permission decision, audit event, model notice, or owner notice is produced

#### Scenario: A missing Knowledge target stays prose

- **WHEN** a prompt names a `kb://` target whose selector-free resource cannot be found for the Run owner
- **THEN** the marker remains prose
- **AND** no read or audit event is produced

### Requirement: Admitted prompt reads use system origin

Each distinct target that survives the probe SHALL be requested once through native `read` with system origin `prompt-import`, admitted by the `read` group under the Run's effective permission mode, and audited as requested/started/completed like explicit skill activation. A denied read SHALL audit requested/completed without started. The model SHALL not set this origin; no assistant tool part SHALL appear live or on replay. If `read` is absent from `tools.allowed`, nothing SHALL be imported.

#### Scenario: An admitted target produces a system-origin read audit

- **WHEN** an existing target is admitted by the `read` group
- **THEN** one native `read` is audited with origin `prompt-import` and requested, started, and completed events
- **AND** no assistant tool part is emitted for the read

#### Scenario: A denied target has no started event

- **WHEN** the `read` group denies a prompt target that exists
- **THEN** the target has requested and completed audit events with origin `prompt-import`
- **AND** it has no started event and no imported content

#### Scenario: The model cannot choose the prompt-import origin

- **WHEN** a model-supplied value attempts to set or replace a prompt-import read origin
- **THEN** the system ignores that value and retains the system-owned origin
- **AND** the model cannot turn the read into an assistant tool part

#### Scenario: Read is unavailable to prompt imports

- **WHEN** `read` is absent from `tools.allowed`
- **THEN** no prompt target is read or imported
- **AND** no prompt-import audit event is recorded

### Requirement: Imported results equal native read output

The imported body SHALL equal the model-facing output that native `read` returns for the same locator, with the locator's selectors honored, including read-provided context lines, Markdown ancestor headings, and representations such as `outline`.

#### Scenario: A ranged Workspace read imports native context

- **WHEN** a Chat bound to `/repo` has prompt text containing `@README.md:30-35`
- **THEN** the imported body is exactly what `read("/repo/README.md:30-35")` returns
- **AND** it includes context lines 29 and 36 and any Markdown ancestor headings returned by `read`

#### Scenario: A web outline imports the outline representation

- **WHEN** the prompt contains `@https://github.com/leon0399/llame/issues/1029:outline`
- **THEN** the imported body is the outline representation returned by native `read` for that locator
- **AND** the URL selector is not discarded

### Requirement: Prompt imports persist as one preceding rail item

The triggering user message SHALL persist exactly one `prompt-imports` rail item with form `notice` before the Run's first model request and before the user text. It SHALL contain one file block per imported target labelled by the locator as written, neutralize reserved delimiters in bodies, and carry the third-party precedence statement. Denied or failed targets SHALL be named only as not imported, without content.

#### Scenario: Successful imports precede unchanged user text

- **WHEN** a prompt imports two targets before its Run's first model request
- **THEN** the triggering user message contains one `prompt-imports` notice before the user text
- **AND** it has one locator-labelled file block for each imported target while the user text remains unchanged

#### Scenario: Imported content carries precedence framing

- **WHEN** a prompt-imports item contains file content from a host, Knowledge, skill, or web target
- **THEN** the item carries its third-party precedence statement
- **AND** the statement ranks that content below system instructions and user requests and denies it authority to grant tools or relax authorization

#### Scenario: Reserved delimiters do not close the item

- **WHEN** imported content contains a reserved context delimiter
- **THEN** the persisted file block contains the neutralized form
- **AND** the prompt-imports notice remains intact

#### Scenario: Denied or failed content is not included

- **WHEN** an admitted prompt target is denied or its read fails
- **THEN** the item names its locator only as not imported
- **AND** it includes no content from that target

### Requirement: Prompt-import work has bounded targets, output, and time

Prompt-import processing SHALL attempt at most 8 distinct targets in first-occurrence order, cap aggregate serialized item output at 128 KiB, and cap work at 30 seconds or the remaining Run deadline, whichever is sooner. A target beyond any bound SHALL not be read and SHALL be listed once as omitted.

#### Scenario: Targets beyond the count bound are omitted

- **WHEN** a prompt contains more than 8 distinct import targets in first-occurrence order
- **THEN** only the first 8 targets are attempted
- **AND** every later target is listed once as omitted without a read

#### Scenario: Output and work bounds stop further reads

- **WHEN** the serialized item would exceed 128 KiB, 30 seconds elapse, or the Run deadline arrives
- **THEN** further targets are not read
- **AND** each target skipped by the bound is listed once as omitted

### Requirement: Recovery reuses completed prompt imports

A retry or worker resumption SHALL reuse persisted completed prompt-import results without reading those targets again, and SHALL read only unattempted targets. A target changed on disk after the turn SHALL not be re-read.

#### Scenario: A retry reads only unfinished targets

- **WHEN** a worker resumes after some prompt targets completed and others were unattempted
- **THEN** completed results are reused without another read
- **AND** only the unattempted targets are read, in their original order

#### Scenario: A disk edit does not cause a historical reread

- **WHEN** a local target changes on disk after the turn's prompt-import result was persisted
- **THEN** recovery reuses the persisted result
- **AND** it does not read the edited target again

### Requirement: Imported content is not recursively imported

Markers inside an imported result SHALL be treated as data and SHALL not be parsed or followed, so prompt imports SHALL not recurse.

#### Scenario: Nested marker text remains data

- **WHEN** an imported file contains another valid-looking import marker
- **THEN** the nested marker is included only as imported content
- **AND** no second-level target is read or persisted

### Requirement: Admitted local imports trigger instruction loading

An admitted host-path or `kb://` prompt import SHALL trigger the instruction-file load for its target directory on the same accepted turn. The trigger set SHALL be recoverable from the persisted item so retries stage the same load. Denied, missing, `skill://`, and web targets SHALL not trigger it, and importing an instruction file itself SHALL neither load nor mark that file seen.

#### Scenario: An admitted local import loads its directory instructions

- **WHEN** a host or Knowledge target is admitted from a prompt
- **THEN** the target directory's instruction chain is loaded on that accepted turn
- **AND** the load is staged from the persisted prompt-import item on retry

#### Scenario: Non-triggering prompt targets load no instructions

- **WHEN** a prompt target is denied, missing, `skill://`, or `http://` or `https://`
- **THEN** it triggers no instruction-file load
- **AND** its outcome does not add an instruction item

#### Scenario: Importing an instruction file obeys the self-read rule

- **WHEN** a prompt imports an instruction file such as `@AGENTS.md`
- **THEN** that file is neither loaded as an instruction item nor marked as seen
- **AND** a later ordinary trigger may load it

### Requirement: Skill prompt targets are data reads

A `skill://` prompt target SHALL be read as data only; it SHALL not activate a skill, and skill activation SHALL continue to require `$skill` syntax.

#### Scenario: A skill locator does not activate the skill

- **WHEN** the prompt contains `@skill://review`
- **THEN** the `SKILL.md` text is imported as data
- **AND** no skill-activation item is produced

### Requirement: Prompt-import disclosure is owner-isolated

The owner-only chip on the triggering user message SHALL list imported, truncated, denied, failed, and omitted locators from private metadata. Datastore access SHALL enforce authenticated owner identity so another owner cannot read the item, its metadata, or its audit events through any API; public shares, exports, and search projections SHALL expose neither text nor metadata.

#### Scenario: The owner sees prompt-import outcomes

- **WHEN** a user message has imported, truncated, denied, failed, and omitted prompt targets
- **THEN** its owner's chip lists each corresponding locator and outcome
- **AND** the chip data comes from private metadata rather than model-visible text

#### Scenario: Another owner cannot inspect prompt-import history

- **WHEN** owner A has a prompt-import item and its prompt-import audit events
- **THEN** owner B cannot read that item, its metadata, or those events through any API
- **AND** datastore authorization uses the authenticated identity to enforce the isolation

#### Scenario: Public projections hide prompt imports

- **WHEN** a Chat with prompt-import items is shared, exported, or included in search projections
- **THEN** neither prompt-import text nor metadata is exposed

#### Scenario: Another owner's Knowledge Space is prose

- **WHEN** owner A's prompt names a `kb://` locator for a Space owned by owner B
- **THEN** the probe under owner A's identity finds no target, so the locator remains prose and is not imported
- **AND** no content, read, audit event, item, or owner disclosure for owner B is produced

### Requirement: Unresolvable prose is never imported

Prompt prose that names no resolvable target SHALL remain unchanged and SHALL cause no import or audit event, and an email address SHALL never be recognized as a marker.

#### Scenario: A casual at-mention is prose

- **WHEN** a bound Workspace has no path named `leo` and the prompt says `ping @leo`
- **THEN** the text remains prose and nothing is imported
- **AND** no read or audit event is recorded

#### Scenario: An email address is not a prompt marker

- **WHEN** the prompt contains `leo@example.com`
- **THEN** it remains ordinary text
- **AND** no prompt import or audit event is produced
