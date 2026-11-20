## ADDED Requirements

### Requirement: Projects carry literal owner instructions

A Project MUST store optional owner-authored instructions as literal plain text. Instructions MUST start absent. The owner MUST save, replace, and clear them. The text MUST NOT resolve import markers, file references, or skill activations.

#### Scenario: A new Project has no instructions

- **WHEN** the owner creates a Project without instructions
- **THEN** its instructions are absent

#### Scenario: The owner replaces and clears instructions

- **WHEN** the owner saves instructions, replaces them, and then clears them
- **THEN** each successful read returns the latest stored value
- **AND** the final value is absent

#### Scenario: References remain literal text

- **WHEN** the owner saves instructions that contain `@policy.md` and `$review`
- **THEN** the Project stores those characters as text
- **AND** the system reads no file and activates no skill

### Requirement: Instruction updates use the owner Project resource

The Project response MUST include nullable `instructions`. `PATCH /api/v1/projects/:id` MUST accept `instructions`. Omission MUST preserve the value. `null` or whitespace-only text MUST clear it. The API MUST reject text above 16000 Unicode code points with status 400, without a change. Archived Projects MUST reject instruction edits with status 409.

#### Scenario: An omitted field preserves instructions

- **WHEN** the owner updates only the name of a Project that has instructions
- **THEN** the stored instructions remain unchanged

#### Scenario: The instruction bound includes non-BMP characters

- **WHEN** the owner saves 16000 non-BMP characters as instructions
- **THEN** the request succeeds
- **AND** 16001 such characters fail with status 400 without a change

#### Scenario: An archived Project rejects an instruction update

- **WHEN** the owner changes or clears instructions on an archived Project
- **THEN** the API returns status 409
- **AND** the stored instructions remain unchanged

### Requirement: Project instructions retain owner isolation

The system MUST permit only the owner to read or change a Project's instructions. The datastore MUST enforce this boundary with enabled and forced RLS. A request without authenticated identity MUST fail closed. A request for another owner's Project MUST return not found without its instructions. Instruction text MUST NOT enter operator logs or diagnostic errors.

#### Scenario: Another owner cannot read instructions

- **WHEN** another authenticated owner requests a Project by its ID
- **THEN** the API returns status 404 without Project instructions

#### Scenario: Another owner cannot change instructions

- **WHEN** another owner submits an instruction update through the API or a direct tenant-scoped datastore operation
- **THEN** no instruction value changes
- **AND** no Project instruction text returns

#### Scenario: Missing identity exposes no instructions

- **WHEN** a caller without authenticated identity requests or changes Project instructions
- **THEN** the request fails without Project content or a mutation

#### Scenario: Validation errors do not echo instructions

- **WHEN** instruction validation fails
- **THEN** diagnostics identify the field and failure
- **AND** they contain no submitted instruction text

### Requirement: Project instruction editing has durable effects

The Project page MUST let its owner edit, save, and clear real instructions. Successful edits MUST survive reload. Failed edits MUST NOT appear saved. The page MUST remove the fake Context-files interaction without an upload or storage replacement.

#### Scenario: Saved instructions survive reload

- **WHEN** the owner saves instructions from the Project page and reloads it
- **THEN** the page shows the saved text

#### Scenario: A failed save preserves the draft

- **WHEN** an instruction save fails
- **THEN** the page reports the failure and retains the unsaved draft
- **AND** it does not present the draft as stored instructions

#### Scenario: An archived Project has no instruction mutation

- **WHEN** the owner views an archived Project
- **THEN** its saved instructions remain readable
- **AND** the page offers no instruction edit that can succeed

#### Scenario: The fake Context-files interaction is absent

- **WHEN** the owner opens the Project page
- **THEN** no control creates sample Context files
