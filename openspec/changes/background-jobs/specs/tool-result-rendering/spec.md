## MODIFIED Requirements

### Requirement: A bash result renders a status header and its streams

A `bash` success of a command that exited MUST begin with `exit <code>`. When the result carries
`wallTimeMs`, `, <seconds> s` with one decimal MUST follow. The stdout MUST
follow verbatim, and a non-empty stderr MUST follow under a `[stderr]` line.
When both streams are empty, the text MUST be the header and `(no output)`.
A stream that does not fit inline MUST render its head lines, one
omitted-range line, and its tail lines. A line longer than its share MUST be
cut by code units. The artifact notice line, when present, MUST end the text. A
`command_failed` or `timed_out` message MUST have the same shape.

A result whose executor bound cut a stream MUST carry `[output cut at the
bound]`. A result that only the cap shortened MUST NOT carry that line.

A `backgrounded` result has no exit code and no streams. Its text MUST be the fixed text of
`bash-execution` for that result, and it MUST NOT begin with `exit`.

#### Scenario: A silent command reports no output

- **WHEN** `true` exits 0 after 12 ms
- **THEN** the result is `exit 0, 0.0 s` then `(no output)`

#### Scenario: Stderr is labelled

- **WHEN** a command writes to both streams
- **THEN** stdout follows the header and stderr follows a `[stderr]` line

#### Scenario: A failing command keeps the shape in its error

- **WHEN** `false` exits 1
- **THEN** the `command_failed` message is `exit 1, <seconds> s` then `(no output)`

#### Scenario: A stored bash part without wall time omits it

- **WHEN** a bash part stored without `wallTimeMs` renders
- **THEN** the header is `exit 0` with no time

#### Scenario: Cut output is marked

- **WHEN** a command's stdout is cut at the executor bound
- **THEN** the text ends with `[output cut at the bound]`

#### Scenario: A result only the cap shortened carries no bound marker

- **WHEN** a command writes 20,000 characters to stdout, within the executor stream bound
- **THEN** the stdout renders as head lines, an omitted-range line, and tail lines
- **AND** the text carries no `[output cut at the bound]`

#### Scenario: A bound cut and a cap cut carry both lines

- **WHEN** the executor bound cuts stdout and the stdout does not fit inline
- **THEN** the text carries `[output cut at the bound]`
- **AND** it ends with the artifact notice line

#### Scenario: A long log keeps its tail

- **WHEN** stdout has 5,000 lines and does not fit inline
- **THEN** the text shows its first 40 lines, `[lines 41-4880 omitted; read artifact://bash-<n>/stdout:41-4880]`, and its last 120 lines

#### Scenario: A backgrounded result has no exit line

- **WHEN** a host command moves to the background as `job://bash-4`
- **THEN** the text names `job://bash-4` and the job tools, and it holds no `exit` header

## ADDED Requirements

### Requirement: A job read renders as text

A `read` of a job output MUST render as a text read of that locator. It MUST use the read header
and the line prefixes of this capability. A `read` of a job record MUST begin with the locator line
and then hold one `<name>: <value>` line for each field of the record. A `read` of `job://` MUST
render one line for each job, with no header.

#### Scenario: A job record is plain text

- **WHEN** the model reads `job://bash-4` while the command runs
- **THEN** the text begins with `job://bash-4` and holds the line `state: running`

#### Scenario: A job output read has the read header

- **WHEN** the model reads `job://bash-4/stdout:1-3`
- **THEN** the text begins with `job://bash-4/stdout:1-3`

### Requirement: Wait and stop results keep the JSON rendering

The rendering function MUST render a `wait` result and a `stop` result as JSON. The preview of
an output in a `wait` result MUST pass the delimiter neutralization of this capability, as every
tool result does.

#### Scenario: A wait result is one JSON object

- **WHEN** a `wait` returns with one settled job
- **THEN** the model receives one JSON object with `ended` and `jobs`
