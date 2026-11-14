# tool-artifacts Specification

## Purpose

Tool-result artifacts keep the whole result of a tool call that does not fit
the model-facing bounds. The model reads the rest through `artifact://`
locators, or through host files when `bash` can run.

## Requirements

### Requirement: A result that does not fit is stored as an artifact

When a tool result does not fit the inline bound of its tool, the system
MUST store the whole result as an artifact. The inline bound is the result
cap, or the bound that the tool declares. A result that fits MUST NOT create
an artifact. The tool part MUST store the inline result and the artifact
locator. It MUST NOT store the content after the inline part.

#### Scenario: A large bash output is stored

- **WHEN** a `bash` command prints 3 MB to stdout
- **THEN** the system stores an artifact that holds all 3 MB
- **AND** the tool part holds the inline text and the artifact locator

#### Scenario: A small result creates no artifact

- **WHEN** a `grep` call finds 4 passages that fit inline
- **THEN** the system creates no artifact
- **AND** the result names no artifact locator

### Requirement: An artifact needs a way to read it

The system MUST store an artifact only when the Run can read it. The Run can
read it through `read` when `read` is in `tools.allowed` and the `read` group
admits its `artifact://` locator. The Run can also read it when its `bash`
runs on the llame host and gets host files. Otherwise the
tool MUST return its bounded inline result. The result MUST then state how
many lines, files, or results it left out.

#### Scenario: A grep-only Run gets no artifact

- **WHEN** `grep` is allowlisted, `read` and `bash` are not, and a `grep` result does not fit inline
- **THEN** the system stores no artifact
- **AND** the result states how many files it left out

### Requirement: An artifact has a locator scoped to its Chat

Each artifact MUST have the locator `artifact://<toolName>-<n>`. `<toolName>`
is the name of the tool that made it. `<n>` MUST come from one counter for
each Chat. The counter MUST start at 1 and MUST give each artifact a different
number. A part MUST add one path segment, as in `artifact://bash-12/stdout`.
A `bash` artifact MUST always name its parts by stream. Other artifacts with
one part MUST have no part segment.

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

- **WHEN** only the stdout of a `bash` call does not fit inline
- **THEN** the artifact has the one part `artifact://bash-<n>/stdout`

### Requirement: An artifact part holds the full text of its source

A `grep` or `web_search` artifact MUST begin with the lines that start its
inline text, such as a notice or the `[engine: …]` line. Each passage or
result MUST follow in the text shape of the model, inline ones included. Each
inline passage or result line has the same number in the artifact. A `bash`
part MUST hold the stream as the executor returned it, after redaction. The system MUST store a
JSON result with one member or item on each line.

#### Scenario: Inline lines keep their numbers in the artifact

- **WHEN** a `grep` result shows lines 1 to 200 of its text inline
- **THEN** `read("artifact://grep-<n>:1-200")` returns the same 200 lines

#### Scenario: A grep artifact is Markdown

- **WHEN** the model reads `artifact://grep-<n>:outline`
- **THEN** the result lists one `## <locator>` heading for each file of the artifact

#### Scenario: A long JSON result is read by lines

- **WHEN** an MCP result holds one `text` item of 400 KB and the model reads `artifact://mcp__docs__fetch-<n>:1-200`
- **THEN** the read returns the first numbered lines up to the read bound, the start of the long text value included
- **AND** its continuation line names the next line

### Requirement: Artifact lines are at most 8,000 units long

Artifact line numbers MUST count a source line longer than 8,000 UTF-16 code
units as one line for each 8,000 units. A piece that would split a surrogate
pair MUST end one unit early, and the next piece starts at that pair. Every read, notice, and range MUST use that count. A host file MUST keep the source lines as the source wrote
them.

#### Scenario: A one-line JSON stdout is read in pieces

- **WHEN** a `bash` stdout is one JSON line of 3 MB and spills
- **THEN** `read("artifact://bash-<n>/stdout:1-10")` returns its first pieces up to the read bound
- **AND** its continuation line names the next piece

### Requirement: One byte bound limits every artifact part

Each artifact part MUST be at most `tools.artifacts.maxBytes` UTF-8 bytes. A
producer that streams MUST stop at that bound and MUST mark its result
incomplete. When a whole result arrives larger than the bound, the system
MUST NOT store it. The tool MUST then return its bounded inline result with
`[full result not stored]`.

#### Scenario: A broad search stops at the bound

- **WHEN** a `grep` walk gives more than 8 MiB of passages under the default bound
- **THEN** the walk stops when the artifact reaches 8 MiB
- **AND** the result carries `complete: false` and an `artifact_bound` warning

#### Scenario: An MCP result above the bound is not stored

- **WHEN** an MCP tool returns 12 MiB of JSON under the default bound
- **THEN** the system stores no artifact
- **AND** the result is the cut inline JSON with `[full result not stored]`

### Requirement: The read tool accepts artifact locators

`read` MUST accept `artifact://` locators with its line selectors, `:raw`, and
`:outline` for a Markdown part. `read` MUST route the scheme before local path
resolution. It MUST NOT need a native executor. A part name that does not
exist MUST return `not_found`. `edit` and `write` MUST refuse an `artifact://`
locator as `invalid_path`.

#### Scenario: A range of an artifact is read

- **WHEN** the model reads `artifact://bash-12/stdout:4900-5000`
- **THEN** the result holds lines 4,900 to 5,000 of that stream

#### Scenario: An artifact is read without a native executor

- **WHEN** a process with no `tools.nativeExecutorId` allowlists `read` and the model reads `artifact://grep-3`
- **THEN** the read returns the artifact and no `executor_unavailable`

#### Scenario: An unknown part is not found

- **WHEN** the model reads `artifact://bash-2/stdin`
- **THEN** the tool returns `not_found`

#### Scenario: An artifact cannot be edited

- **WHEN** the model calls `edit` with the path `artifact://grep-3`
- **THEN** the tool returns `invalid_path`

### Requirement: A bare artifact locator lists artifacts

`read("artifact://")` MUST list every artifact of the Chat, oldest first. Each
line MUST give the locator, the tool name, the size in lines and bytes, and
the creation time. `read` of a `bash` artifact MUST list its parts in the
same form. The list MUST include an artifact that a failed or replaced attempt
made.

#### Scenario: The Chat list names each artifact

- **WHEN** a Chat has the artifacts `grep-1` and `bash-2` and the model reads `artifact://`
- **THEN** the result has one line for `artifact://grep-1` and one line for `artifact://bash-2`

#### Scenario: An artifact of a replaced reply stays listed

- **WHEN** a Regenerate replaces a reply whose `grep` call made `artifact://grep-4`
- **THEN** `read("artifact://")` still lists `artifact://grep-4`

#### Scenario: A bash artifact lists its streams

- **WHEN** the model reads `artifact://bash-2` and both streams did not fit
- **THEN** the result lists `artifact://bash-2/stdout` and `artifact://bash-2/stderr`

### Requirement: An artifact read checks each finding again

A `grep` or `web_search` part MUST record the source locators and the line
range of each file, result, or answer that it holds. The range MUST include
its heading line. An answer records each of its citation URLs. Each read MUST evaluate the current `read` group on each finding that
the read serves. A refused finding MUST render each of its lines as
`[withheld]`, and every line number MUST stay the same.

#### Scenario: A new reject withholds a grep finding

- **WHEN** an operator adds a `read` reject for `/home/u/secrets/` after a `grep` artifact stored passages from that directory
- **THEN** the heading and each line of those passages read as `[withheld]`
- **AND** every other line keeps its number

#### Scenario: A withheld file leaves the outline

- **WHEN** a finding of a `grep` artifact is withheld and the model reads `artifact://grep-<n>:outline`
- **THEN** the outline does not name the withheld file

#### Scenario: A bash part has no finding to check

- **WHEN** the model reads `artifact://bash-12/stdout`
- **THEN** the read evaluates no `read` group for lines inside the stream

### Requirement: Each producer keeps its own admission rule

A re-check MUST use the rule that admitted the finding. A `grep` finding is
refused unless the decision is an allow. A `web_search` finding is refused
only when a reject clause matches its URL. A `bypass` attempt MUST evaluate no
finding.

#### Scenario: A web result is withheld after a reject

- **WHEN** an operator adds a `read` reject for `example.com` after a `web_search` artifact stored a result from it
- **THEN** that result reads as `[withheld]` in the artifact

#### Scenario: A web result without an allow stays visible

- **WHEN** the `read` group has allows for host paths only and no reject that matches a stored URL
- **THEN** each result of the `web_search` artifact stays visible

#### Scenario: A bypassed Run sees every finding

- **WHEN** a `bypass` attempt reads a `grep` artifact after a new `read` reject
- **THEN** no finding reads as `[withheld]`

### Requirement: Artifacts belong to their Chat and its owner

An artifact MUST be readable only in its own Chat and only by its owner. The
store MUST enforce this with row-level security, and it MUST fail closed
without identity. Another Chat MUST receive `not_found`. When the owner deletes the Chat, or
the owner is deleted, the system MUST delete its artifact rows.

#### Scenario: Another Chat of the same owner cannot read it

- **WHEN** Chat A made `artifact://grep-1` and Chat B of the same owner has no artifact
- **THEN** a read of `artifact://grep-1` in Chat B returns `not_found`

#### Scenario: Another owner cannot read it

- **WHEN** a query runs on the artifact rows of user A with the identity of user B
- **THEN** the store returns no row

#### Scenario: A query without identity reads nothing

- **WHEN** a query runs on the artifact rows with no identity
- **THEN** the store returns no row

#### Scenario: A deleted Chat leaves no artifact row

- **WHEN** the owner deletes a Chat that has three artifacts
- **THEN** no artifact row or part row of that Chat remains

### Requirement: An artifact is complete or absent

The system MUST write an artifact and all its parts in one transaction. A
failed write MUST leave no artifact. The tool MUST then return its bounded
inline result with `[full result not stored]` and no locator.

#### Scenario: A failed write keeps the inline result

- **WHEN** the database refuses the artifact write of a `bash` call
- **THEN** the call returns its inline text and `[full result not stored]`
- **AND** no locator names a partial artifact

### Requirement: An artifact is a Chat resource, not a replayed record

The system MUST keep an artifact until its Chat or its owner is deleted. It
MUST NOT expire an artifact. Replay and compaction MUST NOT include artifact
content. The model MUST reach that content only through `read` or a host file.

#### Scenario: An old artifact still reads

- **WHEN** a checkpoint absorbed the turn that made `artifact://grep-1`
- **THEN** `read("artifact://grep-1")` still returns the artifact

#### Scenario: A checkpoint does not carry the artifact

- **WHEN** compaction absorbs a turn with `artifact://grep-1`
- **THEN** the checkpoint request holds no line of that artifact

### Requirement: Each tool declares how its result spills

Each tool MUST declare one spill shape, `head` or `tool`. A tool without a
declaration MUST use `head`. A `head` result keeps the head of its rendering
inline. A `tool` result builds its inline part and its artifact itself.
`bash`, `grep`, and `web_search` MUST declare `tool`. The result cap MUST NOT
shorten a `tool` result. The system MUST NOT choose a shape by tool name.

#### Scenario: An MCP result keeps its head

- **WHEN** an MCP tool that declares no spill shape returns a result above the cap
- **THEN** the inline text is the head of its rendering
- **AND** its cap notice names the artifact

### Requirement: A head result names the artifact in its cap notice

When a `head` result spills, its cap notice MUST name the artifact, its line
count, `<locator>:1-`, and its host files when they exist. The notice MUST
still state that narrower arguments recover the omitted content.

#### Scenario: A spilled MCP result names its artifact

- **WHEN** an MCP result of 900 lines of JSON spills to `artifact://mcp__docs__fetch-4`
- **THEN** the cap notice names `artifact://mcp__docs__fetch-4`, 900 lines, and `artifact://mcp__docs__fetch-4:1-`

### Requirement: A bash call spills each stream before it is recorded

`bash` MUST keep the head and the tail of each stream that does not fit
inline. When the Run can read artifacts, it MUST store that stream as a part.
A Machine part holds the capture that the protocol bound allows. A `command_failed` or `timed_out`
result MUST spill like a success. The run event of the call MUST hold the
inline result and the locator, not the full streams. The result of a settled
open call MUST keep its locator.

#### Scenario: A build that fails keeps its log tail inline

- **WHEN** a build exits 1 and writes 3 MB to stderr
- **THEN** the error message holds the head and the tail of stderr and an omitted-range line
- **AND** `artifact://bash-<n>/stderr` holds all 3 MB

#### Scenario: A timeout with large output is stored

- **WHEN** a command times out after it printed 3 MB to stdout
- **THEN** the `timed_out` message holds the head and the tail of stdout
- **AND** `artifact://bash-<n>/stdout` holds all 3 MB

#### Scenario: A settled open bash call keeps its artifact

- **WHEN** a worker dies after a `bash` call recorded a `command_failed` result with `artifact://bash-4`, and the next attempt settles the open call
- **THEN** the settled result names `artifact://bash-4`
- **AND** the Chat has no new artifact

#### Scenario: A Machine command that fails keeps its tail

- **WHEN** a Machine `bash` call exits 1 with 32,000 units of stderr, and `read` is allowlisted
- **THEN** the error message holds the head and the tail of stderr
- **AND** `artifact://bash-<n>/stderr` holds the whole stderr

### Requirement: Artifacts are host files when bash can run

When `bash` is in `tools.allowed` and the Run has a native executor, each
artifact part MUST also be a file on the llame host. The directory is
`$TMPDIR/llame/chats/<chatId>/artifacts/`. A part file is `<toolName>-<n>`
with the extension of its content type. A `bash` part is the stream name with
that extension, in a `bash-<n>` directory.

#### Scenario: A bash artifact becomes files

- **WHEN** `bash` is allowlisted and both streams of call `bash-12` did not fit
- **THEN** the host has `bash-12/stdout.txt` and `bash-12/stderr.txt` in the artifact directory of the Chat

#### Scenario: Without bash no file is written

- **WHEN** `bash` is not in `tools.allowed` and an MCP result spills to `artifact://mcp__docs__fetch-1`
- **THEN** the system writes no file for it

### Requirement: Missing artifact files are restored

When files are written, the system MUST compare the files of the Chat with its
stored artifacts. It MUST do so at the start of each attempt and before each
`bash` call. It MUST write each absent file and each file whose size or
modification time differs from the stored values. It MUST NOT fetch the
content of a file that matches.

#### Scenario: A reboot loses the files

- **WHEN** the host restarts with an empty `$TMPDIR`, and a new attempt of the Chat starts
- **THEN** the system writes every artifact file of the Chat again before the first model request

#### Scenario: A changed file is repaired before bash

- **WHEN** a command changed `bash-3/stdout.txt` and the model then calls `bash`
- **THEN** the system writes that file again from the store before the command starts

#### Scenario: Reconcile touches only its own Chat

- **WHEN** the Runs of Chat A and Chat B share one worker and Chat A reconciles its files
- **THEN** no file of Chat B changes

### Requirement: Host files of a deleted Chat go away

At worker start and at each attempt start, the system MUST remove each Chat
directory on that host that no attempt reconciled for 7 days. The directory
of a deleted Chat thus goes at the first such check after 7 days. A live Chat
gets its files back at its next reconcile.

#### Scenario: An idle Chat directory is removed

- **WHEN** no attempt reconciled the directory of a deleted Chat for 7 days
- **THEN** the next worker start or attempt start on that host removes the directory

### Requirement: The notice names the host files

When the system wrote host files, the notice MUST also name their absolute
directory. In a Machine Workspace, or when `bash` runs on an `ssh://` host,
the notice MUST say that the files are on the llame host only. Without files,
the notice MUST name no host path.

#### Scenario: The host path is shown with bash

- **WHEN** `bash` is allowlisted on the host and a `bash` call spills its stdout
- **THEN** the notice names the absolute directory of `bash-<n>` on the host

#### Scenario: A Machine Workspace is told where the files are

- **WHEN** `bash` is allowlisted, the process has a native executor, the Chat is in a Machine Workspace, and a call spills
- **THEN** the notice says that the files are on the llame host only
- **AND** `read("artifact://…")` returns the artifact in that Workspace

### Requirement: Artifact files hold the content as admitted

A host file MUST hold the artifact content as it was admitted when the
artifact was made. Only `read` on `artifact://` checks findings again. `bash`
reads the file with its host authority.

#### Scenario: A file keeps a later withheld finding

- **WHEN** a new `read` reject makes a `grep` finding read as `[withheld]` through `artifact://`
- **THEN** the host file of that artifact still holds the finding

### Requirement: A settled job stores output that does not fit as one artifact

A settled job of `background-jobs` has an inline bound of 2,000 characters for each output. When
an output does not fit, the system MUST store one artifact with one part for every output of
the job. It MUST do so only when the Run that started the job could read artifacts. The
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
artifact. The system MUST decide them from the Run that started the job, when the job starts.
The notice and the `wait` entry of the job MUST name the host directory when host files exist.

#### Scenario: A failed write keeps the stored increments

- **WHEN** the database refuses the artifact write of a settled job
- **THEN** the job is settled, its record names no artifact, and a `read` of the output returns the stored increments
