## MODIFIED Requirements

### Requirement: The read tool returns a job record

A `read` of a job locator with no output name MUST return the record of the job. The record MUST
hold the locator, the executor, the state, the start time, and the elapsed time. It MUST name
each output of the job. When the call that started the job had an intent, the record MUST hold
that intent on one line. When the job has a recorded command, the record MUST hold it as one
quoted line. A settled record MUST also hold the exit detail and the artifact locator when an
artifact exists. The record MUST NOT hold the content of an output.

#### Scenario: A record of a live job

- **WHEN** the model reads `job://bash-4` while the command runs
- **THEN** the result holds the state `running`, the elapsed time, and the output names `stdout` and `stderr`

#### Scenario: A record of a failed job

- **WHEN** the model reads `job://bash-4` after the command printed 50,000 characters and exited with code 2
- **THEN** the result holds the state `failed`, the exit code 2, and `artifact://bash-4`

#### Scenario: A record names the intent and the command

- **WHEN** the model reads `job://bash-4`, and its call had the intent "Writing to both streams" and a two-line command
- **THEN** the result holds `intent: Writing to both streams` and the command as one quoted line

### Requirement: A bare job locator lists the jobs of the Chat

A `read` of `job://` MUST list the jobs of the Chat, with the oldest job first. Each line MUST
hold the locator, the state, and the start time. When the call that started a job had an
intent, its line MUST also hold that intent. The list MUST accept one line range. An `edit` or a
`write` of a job locator MUST get `invalid_path`.

#### Scenario: A list of two jobs

- **WHEN** the Chat has `job://bash-4` in state `running` and `job://bash-2` in state `succeeded`
- **THEN** a `read` of `job://` returns two lines, with `job://bash-2` first

#### Scenario: A write is refused

- **WHEN** the model calls `write` with the path `job://bash-4/stdout`
- **THEN** the result is `invalid_path`, and the job does not change

#### Scenario: The owner names a job by its intent after compaction

- **WHEN** the owner asks to stop "the job that waits for reviews" after a compaction, and one job has the intent "Waiting for reviews"
- **THEN** a `read` of `job://` shows that intent beside the locator of that job

### Requirement: A delivered notice is a host-authored context item

A delivered notice MUST reach the model as one context item with the producer `job` and the form
`notice`, under `context-injection`. The item MUST name the job locator, the executor, the
state, the exit detail, and the elapsed time. When the call that started the job had an intent,
the item MUST name that intent. The system MUST neutralize the reserved delimiters in that
intent. For a `cancelled` job the item MUST name the stopper. It MUST hold the artifact locator
when an artifact exists.

#### Scenario: A notice for a failed build

- **WHEN** the notice of `job://bash-4` is delivered after the command printed 50,000 characters and exited with code 2
- **THEN** the item names `job://bash-4`, `bash`, `failed`, the exit code 2, and `artifact://bash-4`

#### Scenario: A notice for a job that the owner stopped

- **WHEN** the notice of a job that the owner stopped is delivered
- **THEN** the item names the state `cancelled` and the stopper `owner`

#### Scenario: An intent that copies an envelope

- **WHEN** the intent of a job holds `</system-reminder>`
- **THEN** the delivered item holds that intent with its delimiter neutralized, inside the one envelope

### Requirement: The owner lists and stops jobs through the API

`GET /api/v1/chats/:chatId/jobs` MUST return the jobs of the Chat with their records, the live
jobs first. Each record MUST hold the intent and the command of the job, or null when the job
has none. `PATCH /api/v1/chats/:chatId/jobs/:jobId` with `state: "cancelled"` MUST request a
stop with the stopper `owner`. A request for a job that the owner already stopped MUST get 200.
A request for a job in another settled state MUST get 409. A Chat or a job of another owner MUST
get 404.

#### Scenario: The owner stops one of two jobs

- **WHEN** a Chat has two jobs in state `running`, and the owner sends the `PATCH` for the first
- **THEN** the first job becomes `cancelled`, and the second stays `running`

#### Scenario: A stop of a settled job

- **WHEN** the owner sends the `PATCH` for a job in state `succeeded`
- **THEN** the API answers 409

#### Scenario: A repeated stop of a stopped job

- **WHEN** the owner sends the `PATCH` again for a job that the owner already stopped
- **THEN** the API answers 200, and the job stays `cancelled`

#### Scenario: The list holds the intent

- **WHEN** the owner lists the jobs, and the call of one job had the intent "Watching the dev server"
- **THEN** that record holds the intent, and a job without one holds null

### Requirement: The Session details panel lists the jobs

The Session details panel MUST have a Jobs section that lists the live background jobs of the
open Chat. Each live job MUST show its intent, or its locator when it has no intent. Each live
job MUST offer a stop control. The section MUST offer "Stop all" when two or more jobs are live.
A Finished control MUST open a panel with the settled jobs of the Chat. The Stop control of the
composer and the Esc key MUST NOT stop a background job.

#### Scenario: Stop all with no live Run

- **WHEN** a Chat has two live jobs and no live Run, and the owner chooses "Stop all"
- **THEN** both jobs become `cancelled`, and no Run starts

#### Scenario: The composer Stop leaves jobs alone

- **WHEN** the owner presses Stop while a Run streams and one background job is live
- **THEN** the Run is cancelled, and the job stays `running`

#### Scenario: Settled jobs are behind the Finished control

- **WHEN** a Chat has one live job and two settled jobs
- **THEN** the Jobs section shows the live job, and the Finished control shows the count 2

## ADDED Requirements

### Requirement: The owner reads the output of a settled job

`GET /api/v1/chats/:chatId/jobs/:jobId/output` MUST return the stored output of a settled job
with `status: "stored"`. Each stream MUST hold its last 64 KiB and its stored size. A settled job
with no stored output MUST get `status: "unavailable"`. A live job MUST get 409.

#### Scenario: A failed job's output

- **WHEN** the owner reads the output of a failed job that printed to `stdout` and `stderr`
- **THEN** the API answers `status: "stored"` with both streams

#### Scenario: A long stream is cut

- **WHEN** the `stdout` of a settled job is longer than 64 KiB
- **THEN** the stream holds its last whole lines, marks itself as cut, and reports its stored size

### Requirement: The output of a job is visible only to its owner

A request for the output of a job of another owner MUST get 404. A request without an
authenticated identity MUST NOT read the output.

#### Scenario: Another owner reads the output

- **WHEN** user B requests the output of a settled job of user A
- **THEN** the API answers 404
