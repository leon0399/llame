## ADDED Requirements

### Requirement: A settled job stores output that does not fit as one artifact

A settled job of `background-jobs` has an inline bound of 2,000 characters for each output. When
an output does not fit, the system MUST store the captured output as one artifact, with one part
for each output. It MUST do so only when the Run that started the job could read artifacts. The
artifact MUST use the number that the job reserved and the tool name of the executor. It MUST
name the Run and tool call that started the job.

#### Scenario: A job artifact after the Run ended

- **WHEN** `job://bash-7` settles with 50,000 characters of `stdout`, one hour after its Run completed
- **THEN** `artifact://bash-7/stdout` holds the captured `stdout`

#### Scenario: A short output creates no artifact

- **WHEN** a job settles with 300 characters of output
- **THEN** the system creates no artifact, and the job record names no artifact locator

### Requirement: A job output stays readable without an artifact

When a settled job has no artifact, a `read` of an output of the job MUST return the stored
increments. A failed artifact write MUST leave the job settled and its increments stored. The
host-file rules of this capability MUST apply to a job artifact as they apply to a `bash`
artifact.

#### Scenario: A failed write keeps the stored increments

- **WHEN** the database refuses the artifact write of a settled job
- **THEN** the job is settled, its record names no artifact, and a `read` of the output returns the stored increments
