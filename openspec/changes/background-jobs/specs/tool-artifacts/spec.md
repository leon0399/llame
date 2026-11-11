## ADDED Requirements

### Requirement: A settled job stores its output as one artifact

When a job of `background-jobs` settles, the system MUST store its captured output as one
artifact with one part for each output. The artifact MUST use the number that the job reserved
and the tool name of the executor. It MUST name the Run and tool call that started the job. The write MUST
follow the complete-or-absent rule. After the write, a `read` of an output of the job MUST
return the artifact part.

#### Scenario: A job artifact after the Run ended

- **WHEN** `job://bash-7` settles one hour after its Run completed
- **THEN** `artifact://bash-7/stdout` holds the captured `stdout`

#### Scenario: A failed write keeps the stored increments

- **WHEN** the database refuses the artifact write of a settled job
- **THEN** the job record names no artifact, and a `read` of the output returns the stored increments
