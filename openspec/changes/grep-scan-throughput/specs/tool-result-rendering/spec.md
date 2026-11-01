## MODIFIED Requirements

### Requirement: A grep page groups consecutive passages under one file line

A `grep` text MUST render each run of consecutive passages of one file under
one `## <locator>` line. That line holds the file locator and no line range.
`<locator>:<start>-<end>` built from a rendered line number MUST be a valid
`read` argument. One blank line MUST separate the passages under one line. A
capped twentieth passage MUST end with `[more passages in this file; read it
to see them]`. A Knowledge notice MUST render first.

After the passages, the text MUST render these lines in this order, each only
when it applies:

- Non-empty warnings MUST render as one `[warnings: …]` line.
- An `ignored` field MUST render as one line. The line is `[ignored <count>
  directories: <locators>; a scope that names one searches it]`.
  `<locators>` lists `ignored.locators`, with a comma and one space between
  two locators. When the count is larger than the list, `(+<rest> more)`
  follows the list after one space. When `ignored.atLeast` is `true`,
  `<count>` is `<count> or more`.
- An `unfinishedFile` field MUST render as
  `[not searched to the end: <locator>]`.
- The continuation line follows last.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` gives passages `:3-7` and `:40-42` in one scope
- **THEN** the text has one `## src/app.ts` line and the two passages, with a blank line between them

#### Scenario: Overlapping scopes repeat the file line

- **WHEN** scopes `src/**` and `src/app.ts` both give passages of `src/app.ts`
- **THEN** each run of passages of a scope has its own `## src/app.ts` line, in scope order

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and stopped at the call deadline
- **THEN** the text carries `[warnings: 3 binary, 1 deadline]`

#### Scenario: A capped file is marked

- **WHEN** one file holds 25 passages and the page carries its first 20
- **THEN** the twentieth passage ends with `[more passages in this file; read it to see them]`

#### Scenario: Excluded directories render after the warnings

- **WHEN** `ignored` has count 7 and the locators `/r/node_modules` and `/r/dist`
- **THEN** the text carries `[ignored 7 directories: /r/node_modules, /r/dist (+5 more); a scope that names one searches it]`
- **AND** that line comes after the `[warnings: …]` line and before the continuation line

#### Scenario: An unfinished file is named

- **WHEN** the result carries `unfinishedFile` `/var/log/big.log`
- **THEN** the text carries `[not searched to the end: /var/log/big.log]`
