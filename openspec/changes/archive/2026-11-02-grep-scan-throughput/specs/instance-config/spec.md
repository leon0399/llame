## ADDED Requirements

### Requirement: Operator configuration can bound grep walks

The configuration MUST accept an optional `tools.grep` object with the fields
`maxFilesExamined`, `maxEntriesListed`, `maxBytesRead`, and `maxFileBytes`. An
absent or `null` object sets no bound. Each field MUST be `null` or a positive
integer. An absent field is `null`, and `null` sets no bound. Each field
accepts the numeric interpolation tokens that `tools.maxStepsPerRun` accepts.
Zero, a negative number, a fraction, or an unknown field MUST fail startup and
name the configuration path.

#### Scenario: Absent grep bounds set no bound

- **WHEN** the file omits `tools.grep`, sets it to `null`, or sets each of its fields to `null`
- **THEN** startup succeeds and a grep walk has no file, entry, byte, or file-size bound

#### Scenario: A configured grep bound applies

- **WHEN** the file sets `tools.grep.maxBytesRead` to `33554432` and a scope holds 40 MiB of text with no match
- **THEN** the grep walk stops with a `byte_bound` warning after it took 32 MiB

#### Scenario: Zero is not read as unlimited

- **WHEN** `tools.grep.maxFilesExamined` resolves to `0`
- **THEN** startup fails and names `tools.grep.maxFilesExamined`

#### Scenario: An unknown grep field fails startup

- **WHEN** the file sets `tools.grep.deadlineSeconds`
- **THEN** startup fails and names the unknown configuration path
