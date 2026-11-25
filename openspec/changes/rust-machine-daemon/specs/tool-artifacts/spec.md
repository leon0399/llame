## MODIFIED Requirements

### Requirement: An artifact needs a way to read it

Except for the durable settled-job copies specified below, the system MUST store an artifact only when the Run can read it. The Run can
read it through `read` when `read` is in `tools.allowed` and the `read` group
admits its `artifact://` locator. The Run can also read it when its `bash`
runs on the llame host and gets host files. Otherwise the
tool MUST return its bounded inline result. The result MUST then state how
many lines, files, or results it left out. Retaining a settled-job copy MUST
NOT itself grant permission to read its artifact or disclose its backing path.
The existing authorized host-file materialization and notice rules still apply.

#### Scenario: A grep-only Run gets no artifact

- **WHEN** `grep` is allowlisted, `read` and `bash` are not, and a `grep` result does not fit inline
- **THEN** the system stores no artifact
- **AND** the result states how many files it left out

### Requirement: A result that does not fit is stored as an artifact

When a tool result does not fit the inline bound of its tool, the system
MUST store the whole result as an artifact. The inline bound is the result
cap, or the bound that the tool declares. A result that fits MUST NOT create
an artifact, except for the durable settled-job copies specified below.
The tool part MUST store the inline result and the artifact locator. It MUST
NOT store the content after the inline part.

#### Scenario: A large bash output is stored

- **WHEN** a `bash` command prints 3 MB to stdout
- **THEN** the system stores an artifact that holds all 3 MB
- **AND** the tool part holds the inline text and the artifact locator

#### Scenario: A small result creates no artifact

- **WHEN** a `grep` call finds 4 passages that fit inline
- **THEN** the system creates no artifact
- **AND** the result names no artifact locator

### Requirement: An artifact has a locator scoped to its Chat

Each artifact MUST have the locator `artifact://<toolName>-<n>`. `<toolName>`
is the name of the tool that made it. `<n>` MUST come from one counter for
each Chat. The counter MUST start at 1 and MUST give each artifact a different
number. A part MUST add one path segment, as in `artifact://bash-12/stdout`.
A `bash` artifact MUST always name its parts by stream. Other artifacts with
one part MUST have no part segment. A durable settled daemon-job copy MUST retain both stream parts even when only one stream spills inline.

#### Scenario: Numbers increase across tools

- **WHEN** the first artifact of a Chat comes from `grep` and the second comes from `bash`
- **THEN** their locators are `artifact://grep-1` and `artifact://bash-2`

#### Scenario: Concurrent calls get different numbers

- **WHEN** two read-only calls in one model step each create an artifact at the same time
- **THEN** the two artifacts have different numbers

#### Scenario: A bash artifact has one part for each stream

- **WHEN** both streams of a `bash` call do not fit inline
- **THEN** the artifact has the parts `artifact://bash-<n>/stdout` and `artifact://bash-<n>/stderr`

#### Scenario: Only stdout spills

- **WHEN** only the stdout of a standalone `ssh://` `bash` call does not fit inline
- **THEN** the artifact has the one part `artifact://bash-<n>/stdout`

### Requirement: An artifact is complete or absent

The system MUST write an artifact and all its parts in one transaction. A
failed write MUST leave no artifact. Except for a durable daemon-job copy,
the tool MUST then return its bounded inline result with
`[full result not stored]` and no locator. A failed daemon-job artifact write
MUST instead roll back its settlement and retain the daemon output for
reconciliation under "Artifact failure preserves daemon reconciliation".

#### Scenario: A failed write keeps the inline result

- **WHEN** the database refuses the artifact write of a standalone `ssh://` `bash` call
- **THEN** the call returns its inline text and `[full result not stored]`
- **AND** no locator names a partial artifact

## REMOVED Requirements

### Requirement: A settled job stores output that does not fit as one artifact

**Reason**: Settled daemon jobs retain bounded available output, including short output.
**Migration**: See "Settled jobs preserve available output".

### Requirement: A job output stays readable without an artifact

**Reason**: Output increments no longer exist; a failed artifact write keeps settlement uncommitted instead.
**Migration**: See "Artifact failure preserves daemon reconciliation".

## ADDED Requirements

### Requirement: Settled jobs preserve available output

Every settled daemon job whose output remains available MUST retain one
bounded, credential-redacted artifact copy with one part for each output
stream, regardless of output size. This includes a daemon job that settled
`lost` but retained its streams. If the daemon definitively no longer has
the job or its output, the installation MUST settle it as `lost` without an
artifact and mark its output unavailable; it MUST NOT invent an empty
capture. An unreachable Machine alone MUST NOT prove the output absent.
Explicit owner deletion of its Chat MAY discard stopped output instead, as
specified in `background-jobs`. The artifact MUST use the number that the job reserved and the tool name of the
executor. It MUST name the Run and tool call that started the job. The
installation MUST commit the artifact and job settlement together before
releasing the daemon job. Foreground settlement MUST NOT create a background
job notice merely because it retains an artifact.

#### Scenario: A job artifact after the Run ended

- **WHEN** `job://bash-7` settles with 50,000 characters of `stdout`, one hour after its Run completed
- **THEN** `artifact://bash-7/stdout` holds the bounded, redacted captured output

#### Scenario: A short output retains an artifact

- **WHEN** a daemon job settles with 300 characters of output
- **THEN** the system retains its artifact copy and records the artifact identity on the job

#### Scenario: A lost job retains partial output

- **WHEN** a restarted daemon reports a job as `lost` and retains its output files
- **THEN** the committed artifact preserves the bounded, credential-redacted partial output with the unknown outcome

#### Scenario: The daemon no longer has a job's output

- **WHEN** reconciliation definitively finds that the job or its output is absent
- **THEN** it settles the job `lost` without an artifact and a read reports unavailable output
- **AND** it does not report an empty captured stream or start the command again

### Requirement: Artifact failure preserves daemon reconciliation

A failed artifact write MUST roll back the job settlement and leave its row
`running`. The installation MUST NOT release that daemon job; a later
reconciliation MUST retry from its retained output. A previously settled job
whose artifact is absent MUST report unavailable output instead of reading
removed increments or repeating the command.

#### Scenario: A failed write retains the daemon output

- **WHEN** the database refuses the artifact write while a job settles
- **THEN** its settlement does not commit and its daemon output remains available for reconciliation

#### Scenario: An older settled job has no artifact

- **WHEN** an older settled row has no artifact identity after the increments migration
- **THEN** a read reports unavailable output without starting another command
