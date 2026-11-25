---
summary: "The job:// locator: a read-only handle on one background job of the Chat, its record, and its stored output"
read_when:
  - a tool result names a job://<executor>-<n> locator
  - you need the state or the output of a job that runs or ended
  - a read of a job failed or you need to know why
spec: native-file-tools
configured_by:
  - ../../operator/scaling.md
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
needs no Machine. The `read` permission group gates it and matches the
locator with its scheme in lower case and without its selector, so a reject
written against `^job://` also refuses `JOB://bash-4/stdout:L1-5`.

## Behavior

### Record

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

A daemon reports a job `lost` when the process did not survive daemon restart.
A read finds this state and settles the job before it answers. Output retained
by the daemon stays readable while the job runs. If the daemon cannot return
output, the read says `output unavailable right now`. The hub stores settled
output in an artifact capped by the configured artifact byte limit. Output above
that cap is truncated. If settled output is unavailable, the read says
`output unavailable right now`. The record never holds output content.

### Output

A `read` of `job://<executor>-<n>/<output>` returns stored text with ordinary
read selectors, so `:-L50` returns its last 50 lines. For a running job, the
text comes from the daemon's output files. Settled output comes from the
artifact. If settled output could not be stored, the read says
`output unavailable right now`. An output name that the job does not have is
`not_found`. A quiet output reads as empty.

### Pending notices

Each winning job settlement creates one pending `notice` item for that job. The
settlement transaction inserts it, including when a touch finds the daemon lost
the job. A repeated settlement creates no second item. A live Run receives
notices
at its next ordered boundary delivery with pending `steer` and `interrupt`
items. Only the Run executing at that boundary is signalled. A notice by itself
is a host trigger, not an owner message: its delivered message has user role,
no sender, and no stored content. The first dispatch authors the job context
items from the triggering delivery rows. The notice has delete only and
withdrawing it does not stop the job.

The context item reports the locator, executor, state, exit detail, elapsed
time, stopper when cancelled, artifact locator when present, and the last
2,000 characters of each output. Output is safely neutralized as data before
it enters the context. A host artifact directory is named only when a verified
cache exists. Reading a job record or output does not consume its notice.
See the [operator runtime boundary](../../operator/background-jobs.md#runtime-boundary).

### Host history

A host-authored user turn has no owner sender and contains job context items,
not owner text. Owner history retains that turn and identifies it as host
authored. It supplies no title, list preview, recency excerpt or search
evidence. A public share and a shared fork omit the whole host turn; a visible
reply to an omitted turn has no copied reply target. An owner's fork retains
the literal context items and remaps the reply target to the copied host turn.

## Listing

`read("job://")` lists the jobs of the Chat, the oldest first, one line each:
the locator, the state, and the start time. An empty Chat answers
`job://: empty`. The list takes one line member, with or without the unit
letter, such as `:L5-10`; `:raw`, `:outline`, and comma lists are
`invalid_selector`. A fork of a Chat holds no job of its source.

## Errors

| Error              | When                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `invalid_path`     | a malformed locator, a number over the integer bound, or a mutation |
| `not_found`        | an absent job or output, another Chat, or another owner             |
| `invalid_selector` | a selector the read cannot serve, or one the list refuses           |

## Configured by

The daemon and the owner's job API are operator topics; see
[background jobs](../../operator/background-jobs.md).
