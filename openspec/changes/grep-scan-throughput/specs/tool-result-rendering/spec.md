## MODIFIED Requirements

### Requirement: Framing values render on one line

These stored values MUST render on one line, and one line break in such a
value MUST become one space:

- the `read` header and continuation paths,
- the mutation locator that opens an `edit` or `write` rendering,
- a `grep` `## <locator>` header,
- each locator of a `grep` `[ignored …]` line, and the locator of a `grep`
  `[not searched to the end: …]` line,
- each attribution value and each `notes` entry,
- the truncation notice of a `read` or `edit` result.

The Knowledge `notice` of a `grep` result MUST NOT fold its line breaks.

#### Scenario: A path with a line break renders on one line

- **WHEN** a stored `read` part carries a path of `a\nb.ts` and is truncated
- **THEN** the header and the continuation line carry `a b.ts` on one line
- **AND** the path adds no unprefixed line

#### Scenario: A grep file line stays one line

- **WHEN** a stored `grep` passage locator carries the path `a\nb.ts`
- **THEN** its `## a b.ts` line carries one space in place of the break
- **AND** the path adds no unprefixed line

#### Scenario: A mutation path stays on its status line

- **WHEN** a stored `write` part carries the path `a\nb.ts`
- **THEN** its `created a b.ts` line carries one space in place of the break

#### Scenario: A cap notice with a line break stays one line

- **WHEN** a stored `read` or `edit` part carries a `truncationNotice` with a line break
- **THEN** the notice renders on one line with one space in place of the break

#### Scenario: A grep report locator stays on its line

- **WHEN** a stored `grep` result carries `unfinishedFile` with the path `a\nb.log`
- **THEN** the text carries `[not searched to the end: a b.log]` on one line

### Requirement: A grep page groups consecutive passages under one file line

A `grep` text MUST render each run of consecutive passages of one file under
one `## <locator>` line. That line holds the file locator and no line range.
`<locator>:<start>-<end>` built from a rendered line number MUST be a valid
`read` argument. One blank line MUST separate the passages under one line. A
capped twentieth passage MUST end with `[more passages in this file; read it
to see them]`. A Knowledge notice MUST render first.

After the passages, the text MUST render the lines below in this order. Each
line renders only when it applies:

- Non-empty warnings MUST render as one `[warnings: …]` line.
- An `ignored` field MUST render as one line of at most 2,000 code units:
  `[ignored <count> <noun>: <locators>; a scope that names one searches it]`.
  `<noun>` is `directory` for a count of one and `directories` otherwise.
  `<locators>` holds the first `ignored.locators` that fit in the line, with a
  comma and one space between two locators.
- When the count is larger than the rendered locators, `(+<rest> more)`
  follows them after one space. When no locator fits, `(+<rest> more)`
  follows the colon after one space. When `ignored.atLeast` is `true`,
  `<count>` is `<count> or more` and the rest is `(+<rest> or more)`.
- An `unfinishedFile` field MUST render as
  `[not searched to the end: <locator>]`.
- The continuation line follows them.

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

- **WHEN** `ignored` has count 7 and five locators `/r/a`, `/r/b`, `/r/c`, `/r/d`, and `/r/e`
- **THEN** the text carries `[ignored 7 directories: /r/a, /r/b, /r/c, /r/d, /r/e (+2 more); a scope that names one searches it]`
- **AND** that line comes after the `[warnings: …]` line and before the continuation line

#### Scenario: One excluded directory takes the singular

- **WHEN** `ignored` has count 1 and the locator `/r/node_modules`
- **THEN** the text carries `[ignored 1 directory: /r/node_modules; a scope that names one searches it]`

#### Scenario: A lower-bound count is marked

- **WHEN** `ignored` has count 1,000, five locators, and `atLeast: true`
- **THEN** the line starts with `[ignored 1000 or more directories:`
- **AND** the locators end with `(+995 or more)`

#### Scenario: An unfinished file is named

- **WHEN** the result carries `unfinishedFile` `/var/log/big.log`
- **THEN** the text carries `[not searched to the end: /var/log/big.log]`
