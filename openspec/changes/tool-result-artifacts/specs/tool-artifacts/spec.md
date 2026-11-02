## Purpose

Tool-result artifacts keep the whole result of a tool call that does not fit
the model-facing bounds. The model reads the rest through `artifact://`
locators, or through host files when `bash` can run.

## ADDED Requirements

### Requirement: A result that does not fit is stored as an artifact

When a tool result does not fit the inline bound of its tool, the system
MUST store the whole result as an artifact. The inline bound
is the result cap, or the bound that the tool declares. A result that fits
MUST NOT create an artifact. The tool part MUST store the artifact locator and
MUST NOT store the artifact content.

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
number. An artifact with more than one part MUST address each part as one
more path segment, for example `artifact://bash-12/stdout`.

#### Scenario: Numbers increase across tools

- **WHEN** the first artifact of a Chat comes from `grep` and the second comes from `bash`
- **THEN** their locators are `artifact://grep-1` and `artifact://bash-2`

#### Scenario: Concurrent calls get different numbers

- **WHEN** two read-only calls in one model step each create an artifact at the same time
- **THEN** the two artifacts have different numbers

#### Scenario: A bash artifact has one part for each stream

- **WHEN** both streams of a `bash` call do not fit inline
- **THEN** the artifact has the parts `artifact://bash-<n>/stdout` and `artifact://bash-<n>/stderr`

### Requirement: An artifact holds the whole result in the text the model reads

An artifact MUST hold the whole result, the inline part included. Its text
MUST be the rendering that the model reads. A line number thus means the same
line inline and in the artifact. Each part MUST have one content type.
A part is Markdown when its tool renders Markdown, JSON when it is JSON, and
plain text in every other case.

#### Scenario: Inline lines keep their numbers in the artifact

- **WHEN** a `grep` result shows lines 1 to 200 of its rendering inline
- **THEN** `read("artifact://grep-<n>:1-200")` returns the same 200 lines

#### Scenario: A grep artifact is Markdown

- **WHEN** the model reads `artifact://grep-<n>:outline`
- **THEN** the result lists one `## <locator>` heading for each file of the artifact

#### Scenario: JSON stdout is a JSON part

- **WHEN** the stdout of a `bash` call that does not fit inline is one valid JSON document
- **THEN** the `stdout` part has the JSON content type

### Requirement: One byte bound limits every artifact

The system MUST stop a result at `tools.artifacts.maxBytes` UTF-8 bytes. The
default is 8 MiB. A producer that reaches the bound MUST stop and MUST mark its
result incomplete. The bound MUST apply to each artifact as a whole.

#### Scenario: A broad search stops at the bound

- **WHEN** a `grep` walk gives more than 8 MiB of passages under the default bound
- **THEN** the walk stops when the artifact reaches 8 MiB
- **AND** the result carries `complete: false` and an `artifact_bound` warning

### Requirement: The read tool accepts artifact locators

`read` MUST accept `artifact://` locators with its line selectors, `:raw`, and
the selectors of the content type of the part. `read` MUST route the scheme
before local path resolution. It MUST NOT need a native executor. `edit` and
`write` MUST refuse an `artifact://` locator as `invalid_path`.

#### Scenario: A range of an artifact is read

- **WHEN** the model reads `artifact://bash-12/stdout:4900-5000`
- **THEN** the result holds lines 4,900 to 5,000 of that stream

#### Scenario: An artifact is read without a native executor

- **WHEN** a process with no `tools.nativeExecutorId` allowlists `read` and the model reads `artifact://grep-3`
- **THEN** the read returns the artifact and no `executor_unavailable`

#### Scenario: An artifact cannot be edited

- **WHEN** the model calls `edit` with the path `artifact://grep-3`
- **THEN** the tool returns `invalid_path`

### Requirement: A bare artifact locator lists artifacts

`read("artifact://")` MUST list the artifacts of the Chat, oldest first. Each
line MUST give the locator, the tool name, the size in lines and bytes, and
the turn that made it. `read` of an artifact that has parts MUST list its
parts in the same form.

#### Scenario: The Chat list names each artifact

- **WHEN** a Chat has the artifacts `grep-1` and `bash-2` and the model reads `artifact://`
- **THEN** the result has one line for `artifact://grep-1` and one line for `artifact://bash-2`

#### Scenario: A bash artifact lists its streams

- **WHEN** the model reads `artifact://bash-2` and both streams did not fit
- **THEN** the result lists `artifact://bash-2/stdout` and `artifact://bash-2/stderr`

### Requirement: An artifact read checks each finding again

When an artifact part records the source locator of each finding, each read
MUST evaluate the current `read` group on those locators. Each line of a
refused finding MUST render as `[withheld]`. The read MUST keep the line count
and every line number of the part.

#### Scenario: A new reject withholds a finding

- **WHEN** an operator adds a `read` reject for `/home/u/secrets/` after a `grep` artifact stored passages from that directory
- **THEN** each line of those passages reads as `[withheld]`
- **AND** every other line keeps its number

#### Scenario: A bash part has no finding to check

- **WHEN** the model reads `artifact://bash-12/stdout`
- **THEN** the read evaluates no `read` group for findings inside the stream

### Requirement: Artifacts belong to their Chat and its owner

An artifact MUST be readable only in its own Chat and only by its owner. The
store MUST enforce this with row-level security, and it MUST fail closed
without identity. Another Chat MUST receive `not_found`. Deleting the Chat or
its owner MUST delete its artifacts.

#### Scenario: Another Chat of the same owner cannot read it

- **WHEN** Chat A made `artifact://grep-1` and Chat B of the same owner reads `artifact://grep-1`
- **THEN** Chat B receives `not_found`, or its own `grep-1` when one exists

#### Scenario: Another owner cannot read it

- **WHEN** user B runs a query on the artifact rows of user A without the identity of user A
- **THEN** the store returns no row

#### Scenario: A deleted Chat leaves no artifact

- **WHEN** the owner deletes a Chat that has three artifacts
- **THEN** no artifact row or part of that Chat remains

### Requirement: An artifact is complete or absent

The system MUST write an artifact and all its parts in one transaction. A
failed write MUST leave no artifact. The tool MUST then return its bounded
inline text with a notice that the full result is not stored.

#### Scenario: A failed write keeps the inline result

- **WHEN** the database refuses the artifact write of a `bash` call
- **THEN** the call returns its inline text and the notice `[full result not stored]`
- **AND** no locator names a partial artifact

### Requirement: Artifacts live as long as their Chat

The system MUST keep an artifact until its Chat or its owner is deleted. It
MUST NOT expire an artifact, and compaction MUST NOT delete an artifact.

#### Scenario: An old artifact still reads

- **WHEN** a checkpoint absorbed the turn that made `artifact://grep-1`
- **THEN** `read("artifact://grep-1")` still returns the artifact

### Requirement: Each tool declares how its result spills

Each tool MUST declare one spill shape: `head`, `head_tail`, or a split by
result count. A tool without a declaration MUST use `head`. The system MUST
choose the inline part from the declaration of the tool and from no other
list. `bash` MUST declare `head_tail`.

#### Scenario: A bash log keeps its tail inline

- **WHEN** a `bash` stdout has 5,000 lines and does not fit inline
- **THEN** the inline text shows its first lines, its last lines, and the omitted line range

#### Scenario: An MCP result keeps its head

- **WHEN** an MCP tool that declares no spill shape returns a result above the cap
- **THEN** the inline text is the head of its rendering

### Requirement: The inline notice names the artifact and the next selector

A result with an artifact MUST end with one notice line. The notice MUST name
the artifact locator, its size in lines, and a selector that continues after
the inline part. For a `head_tail` part, the notice MUST name the omitted line
range.

#### Scenario: A head notice gives the next line

- **WHEN** a `grep` result shows lines 1 to 200 inline and its artifact has 4,812 lines
- **THEN** the notice names `artifact://grep-<n>`, 4,812 lines, and `artifact://grep-<n>:201-`

#### Scenario: A head and tail notice gives the omitted range

- **WHEN** a `bash` stdout of 5,000 lines shows lines 1 to 80 and 4,921 to 5,000
- **THEN** the notice names `artifact://bash-<n>/stdout:81-4920`

### Requirement: Artifacts are host files when bash can run

When `bash` is in `tools.allowed` and the Run has a native executor, each
artifact part MUST also be a file on the llame host. The file is
`$TMPDIR/llame/chats/<chatId>/artifacts/<toolName>-<n>`, with the part name as
a file in that directory when the artifact has parts. Each file MUST have the
extension of its content type.

#### Scenario: A bash artifact becomes files

- **WHEN** `bash` is allowlisted and both streams of call `bash-12` did not fit
- **THEN** the host has `bash-12/stdout.txt` and `bash-12/stderr.txt` in the artifact directory of the Chat

#### Scenario: Without bash no file is written

- **WHEN** `bash` is not in `tools.allowed` and a `grep` call creates `artifact://grep-1`
- **THEN** the system writes no file for it

### Requirement: Missing artifact files are restored

When files are written, the system MUST compare the files of the Chat with its
stored artifacts. It MUST do so at the start of each attempt and before each
`bash` call. It
MUST write each absent file and each file whose content hash differs. It MUST
NOT read the content of a file that is already correct.

#### Scenario: A reboot loses the files

- **WHEN** the host restarts and `$TMPDIR` is empty, and a new attempt of the Chat starts
- **THEN** the system writes every artifact file of the Chat again before the first model request

#### Scenario: A changed file is repaired before bash

- **WHEN** a command changed the content of `grep-1.md` and the model then calls `bash`
- **THEN** the system writes `grep-1.md` again from the store before the command starts

### Requirement: The notice names the host file

When the system wrote the artifact as a file, the notice MUST also name its
absolute host path. In a Machine Workspace, the notice MUST say that the file
is on the llame host and not on the Machine. Without files, the notice MUST
name no host path.

#### Scenario: The host path is shown with bash

- **WHEN** `bash` is allowlisted on the host and a `grep` call creates `artifact://grep-1`
- **THEN** the notice names the absolute path of `grep-1.md` on the host

#### Scenario: A Machine Workspace is told where the file is

- **WHEN** the Chat is in a Machine Workspace and a call creates an artifact
- **THEN** the notice says that the file is on the llame host only
- **AND** `read("artifact://…")` returns the artifact in that Workspace

### Requirement: Artifact files hold the content as admitted

A host file MUST hold the artifact content as it was admitted when the
artifact was made. Only `read` and `grep` on `artifact://` check findings
again. `bash` reads the file with its host authority.

#### Scenario: A file keeps a later withheld finding

- **WHEN** a new `read` reject makes a `grep` finding read as `[withheld]` through `artifact://`
- **THEN** the host file of that artifact still holds the finding
