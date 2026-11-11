---
summary: "The job:// locator: a read-only handle on one background job of the Chat, its record, and its stored output"
read_when:
  - a tool result names a job://<executor>-<n> locator
  - you need the state or the output of a job that runs or ended
  - a read of a job failed or you need to know why
spec: native-file-tools
---

# job://

## Form

`job://<executor>-<n>` names the record of one job of the current Chat, where
`<executor>` is the kind of work the job does and `<n>` is an artifact number
of the Chat, reserved when the job starts. `job://<executor>-<n>/<output>`
names one output of the job, such as `stdout` or `stderr`. A bare `job://`
lists the jobs of the Chat.

The scheme is read case-insensitively, as every locator scheme is. `<n>` is a
Postgres `integer`, so a larger number is `invalid_path` rather than a store
error. The job and its artifact share the number, so `job://bash-7` and
`artifact://bash-7` name one command at two times.

## Accepted by

| Tool    | Accepted | Effect                                                 |
| ------- | -------- | ------------------------------------------------------ |
| `read`  | yes      | the record, one output's text, or the list of the Chat |
| `edit`  | no       | `invalid_path`                                         |
| `write` | no       | `invalid_path`                                         |

A `bash` `cwd` does not accept it, and an `@job://` marker in a prompt stays
prose, as an `@artifact://` marker does.

## Authority

The locator resolves only inside the Chat of the job, under its owner's
row-level security. Another Chat of the same owner, another owner, and a
process with no identity read nothing, and each answer is `not_found`. The read
needs no native executor. The `read` permission group gates it and matches the
locator with its scheme in lower case and without its selector, so a reject
written against `^job://` also refuses `JOB://bash-4/stdout:1-5`.

## Record

A `read` of `job://<executor>-<n>` returns plain text. The first line is the
locator, and one `<name>: <value>` line follows for each field:

| Field               | Holds                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| `executor`          | the kind of work                                                      |
| `state`             | `running`, `succeeded`, `failed`, `cancelled`, `timed_out`, or `lost` |
| `started_at`        | the start time                                                        |
| `elapsed`           | seconds from the start to the end, or to now for a live job           |
| `outputs`           | the output names                                                      |
| `settled_at`        | the end time, for a settled job                                       |
| `stopped_by`        | `owner`, `assistant`, or `worker`, for a `cancelled` job              |
| `stop_requested_by` | the stopper of a recorded stop request on a job that runs             |
| `exit_code`         | the exit code, when the job has one                                   |
| `signal`            | the signal that ended the work, when there is one                     |
| `truncated`         | the outputs that the byte bound cut                                   |
| `outcome`           | `unknown` for a `lost` job                                            |
| `artifact`          | the `artifact://` locator, when the output is stored as one           |

A job is `lost` when its worker stopped sending heartbeats for four intervals
of `runs.heartbeatSeconds`. A read finds that and settles the job as `lost`
before it answers, and the output that the worker stored stays readable. The
record never holds the content of an output.

## Output

A `read` of `job://<executor>-<n>/<output>` returns the stored text of that
output with the ordinary read selectors, so `:-50` returns its last 50 lines.
For a running job the text is what the worker stored up to that moment. A job
whose output did not fit inline keeps it in the artifact, and the read returns
it from there. An output name that the job does not have is `not_found`. A quiet
output reads as empty.

## Listing

`read("job://")` lists the jobs of the Chat, the oldest first, one line each:
the locator, the state, and the start time. An empty Chat answers
`job://: empty`. The list takes a single `:N`, `:N-M`, `:N+K`, `:N-`, or `:-K`
member; `:raw`, `:outline`, and comma lists are `invalid_selector`. A fork of a
Chat holds no job of its source.

## Errors

| Error              | When                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `invalid_path`     | a malformed locator, a number over the integer bound, or a mutation |
| `not_found`        | an absent job or output, another Chat, or another owner             |
| `invalid_selector` | a selector the read cannot serve, or one the list refuses           |

## Owner view

The owner lists the jobs of a Chat with `GET /api/v1/chats/:chatId/jobs`, the
running jobs first. `PATCH /api/v1/chats/:chatId/jobs/:jobId` with
`{ "state": "cancelled" }` records a stop request from the owner. A repeat for
a job that the owner stopped answers 200, a job in any other settled state
answers 409, and a Chat or job of another owner answers 404. The chat list and
the live record of a Chat carry `runningJobs`, the number of jobs that run on a
worker that is not dead.
