## MODIFIED Requirements

### Requirement: A Run that waits holds no worker

`awaiting_jobs` MUST be a non-terminal Run status. A Run MUST enter it when a `wait` of
`background-jobs` opens and none of its jobs is settled. The queue job of the Run MUST then end,
and no worker MUST execute the Run while it waits. The Run MUST stay the in-flight Run of its
Chat. A `wait` call of a send that failed after a started tool call MUST NOT open, as
`provider-failures` defines.

#### Scenario: A wait frees the worker

- **WHEN** a Run calls `wait` on a build that takes 30 minutes, and the worker concurrency is 1
- **THEN** the Run is in `awaiting_jobs`, and the worker executes a Run of another Chat in those 30 minutes

#### Scenario: A Run that waits survives a worker crash

- **WHEN** every worker crashes while a Run is in `awaiting_jobs`, and new workers start
- **THEN** the Run stays in `awaiting_jobs` until a waker resumes it

#### Scenario: A wait call of a failed send does not suspend the Run

- **WHEN** a send streams a complete `wait` tool-call part after a started `bash` call, and then breaks
- **THEN** the Run does not enter `awaiting_jobs`
