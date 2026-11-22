## MODIFIED Requirements

### Requirement: The read tool accepts artifact locators

`read` MUST accept `artifact://` locators with its line selectors, `:raw`, and
`:outline` for a Markdown part. `read` MUST route the scheme before path
resolution. It MUST NOT need a Machine. A part name that does not
exist MUST return `not_found`. `edit` and `write` MUST refuse an `artifact://`
locator as `invalid_path`.

#### Scenario: A range of an artifact is read

- **WHEN** the model reads `artifact://bash-12/stdout:4900-5000`
- **THEN** the result holds lines 4,900 to 5,000 of that stream

#### Scenario: An artifact is read without a native executor

- **WHEN** `read` is allowlisted, the current Machine is unreachable, and the model reads `artifact://grep-3`
- **THEN** the read returns the artifact and no `machine_unavailable`

#### Scenario: An unknown part is not found

- **WHEN** the model reads `artifact://bash-2/stdin`
- **THEN** the tool returns `not_found`

#### Scenario: An artifact cannot be edited

- **WHEN** the model calls `edit` with the path `artifact://grep-3`
- **THEN** the tool returns `invalid_path`

### Requirement: Artifacts are host files when bash can run

When `bash` is in `tools.allowed` and the process has a `machines.local`
Machine, each artifact part MUST also be a file on that Machine. The directory
is `$TMPDIR/llame/chats/<chatId>/artifacts/` of the worker process. A part
file is `<toolName>-<n>` with the extension of its content type. A `bash` part
is the stream name with that extension, in a `bash-<n>` directory.

#### Scenario: A bash artifact becomes files

- **WHEN** `bash` is allowlisted, the process has `machines.local` set to `devl`, and both streams of call `bash-12` did not fit
- **THEN** `devl` has `bash-12/stdout.txt` and `bash-12/stderr.txt` in the artifact directory of the Chat

#### Scenario: Without bash no file is written

- **WHEN** `bash` is not in `tools.allowed` and an MCP result spills to `artifact://mcp__docs__fetch-1`
- **THEN** the system writes no file for it

### Requirement: The notice names the host files

The current Machine of the process can be its `machines.local` Machine, or
another Machine. When the two are the same, the notice MUST name the artifact
directory as a canonical `machine://` locator on it. When they differ, or
`bash` runs on an `ssh://` host, the notice MUST instead say that the files
are only on the `machines.local` Machine. Without files, the notice MUST name
no path.

#### Scenario: The host path is shown with bash

- **WHEN** `bash` is allowlisted, the current Machine is the `machines.local` Machine `devl`, and a `bash` call spills its stdout
- **THEN** the notice names the directory of `bash-<n>` as a `machine://devl/...` locator

#### Scenario: A Machine Workspace is told where the files are

- **WHEN** `bash` is allowlisted, the process has `machines.local` set to `devl`, the Chat is in a Workspace on `gpu`, and a call spills
- **THEN** the notice says that the files are only on `devl`
- **AND** `read("artifact://…")` returns the artifact in that Workspace
