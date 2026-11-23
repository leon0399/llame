## MODIFIED Requirements

### Requirement: The read header names the source and the shown lines

A read MUST begin with its shown-range header or the bare-locator header that its source defines. A message-index header MUST use `<locator>:M<start>-<end>`. Other source ranges MUST use `L`. All units MUST use canonical spelling.

The line headers are these:

- `<locator>:L<start>-<end>` for a single range,
- `<locator>:L<a>-<b>,L<c>-<d>` for a multi-range read,
- `<locator>:raw:L<start>-<end>` for a raw read,
- `<locator>:outline:L<start>-<end>` for an outline.
  A null shown range MUST render `<locator>: empty` when the result is not truncated.

#### Scenario: A multi-range read lists its ranges

- **WHEN** the model reads `src/app.ts:10-12,40-42` of a 216-line file
- **THEN** the header is `src/app.ts:L9-13,L39-43 of 216 lines`

#### Scenario: A raw read names its form

- **WHEN** the model reads `notes.md:raw:3-4`
- **THEN** the header is `notes.md:raw:L3-4 of 40 lines`

#### Scenario: An empty file has an empty header

- **WHEN** the model reads an empty file
- **THEN** the result is `<locator>: empty` and no content lines

#### Scenario: An oversized first line is reported, not emptied

- **WHEN** the first line of `x.min.js` exceeds the result bound and the result has a null shown range
- **THEN** the header is `x.min.js: line 1 exceeds the result bound and was skipped`
- **AND** the continuation line follows

### Requirement: Attribution fields keep the listed order

The attribution fields MUST render in this order: `realPath`, `finalUrl`, `method`, `adapter`,
`notes`, `knowledgeSpaceName`, `knowledgeSpaceId`, `notice`, `locator`, `sourceDirectory`,
`resolvedPath`, `skillDirectory`, `realSkillDirectory`, `skillPathInstruction`, `chatId`, `messageSeq`, `role`, `timestamp`, `runStatus`, `previousMessageSeq`, `nextMessageSeq`. `adapter` MUST
render `id route` and `origin` when present. `notes` MUST render one line per entry. A notice MUST
keep its stored text.

#### Scenario: A Knowledge read keeps its notice verbatim

- **WHEN** the model reads `kb://notes/plan.md`
- **THEN** a `notice:` line carries the closed Knowledge notice unchanged

#### Scenario: Structured attribution fields render as one line each

- **WHEN** a web read result carries `adapter: { id: "github", route: "rewrite", origin: "…" }` and two `notes`
- **THEN** the text carries `adapter: github rewrite …` and one `notes:` line per entry

### Requirement: Continuation is one bracketed notice line

A truncated line read with `nextOffset` MUST end with one bracketed continuation notice. The next read MUST start at line `nextOffset + 1`. It MUST retain the requested end until that end is reached.

Use an open `L<n>-` continuation after the requested end, at the stored line count, or without a stored line count. Directory entries MUST retain their line-index rule. A locator without selector support MUST state only its remainder.

A Chat index with unserved selected sequences MUST supply a canonical continuation locator. The renderer MUST use its sequence and `M` unit without line-number conversion. It MUST retain a finite requested end. A complete selected window MUST NOT invent another continuation. Chat collections MUST retain line-index continuations. Message text MUST retain line continuations.

#### Scenario: A truncated read tells how to continue

- **WHEN** an unselected read of a 3,000-line file stops with `nextOffset` 2000 and `lineCount` 3000
- **THEN** the text ends with `[1000 more lines. Use <locator>:L2001- to continue]`

#### Scenario: A cut inside the requested window resumes to the stored end

- **WHEN** the bound cuts an explicit `:1-2000` read of a 3,000-line file with `nextOffset` 1500
- **THEN** the text ends with `[1500 more lines. Use <locator>:L1501-2000 to continue]`

#### Scenario: A cut unselected read resumes to the end of the file

- **WHEN** the bound cuts an unselected read of a 3,000-line file with `nextOffset` 1500
- **THEN** the text ends with `[1500 more lines. Use <locator>:L1501- to continue]`

#### Scenario: A ranged read that is not truncated has no notice

- **WHEN** the model reads `src/app.ts:150-189` of a 562-line file and the result is not truncated
- **THEN** no bracketed line follows the content

#### Scenario: A result without a line count omits the count

- **WHEN** a read part stored without `lineCount` is truncated with `nextOffset` 2000
- **THEN** the text ends with `[Use <locator>:L2001- to continue]`

#### Scenario: An outline resumes in its own form

- **WHEN** a read of `README.md:outline:1-900` stops at source line 400
- **THEN** the text ends with `[Use README.md:outline:L401-900 to continue]`

#### Scenario: A listing resumes at the next entry

- **WHEN** a directory listing of 120 entries stops with `nextOffset` 50 and `entryCount` 120
- **THEN** the text ends with `[70 more entries. Use <locator>:L51- to continue]`
- **AND** the next read is open

#### Scenario: A Chat index continues in message units

- **WHEN** a `chat://<id>:M20-100` page stops before sequence 70
- **THEN** the continuation names `chat://<id>:M70-100`
- **AND** it never emits `L70` or treats sequence 70 as an entry index

## ADDED Requirements

### Requirement: Chat read attribution stays separate from shared rows

A Chat message read MUST render its role, timestamp, current `runStatus`, and eligible neighbor sequences as attribution after its header. A Chat index MUST render its current `runStatus` after its header. Collection status MUST accompany each read row outside the shared Chat row. These values MUST count toward the rendered bound. Generic replay MUST use stored values rather than query newer Run state.

#### Scenario: A Chat body read identifies activity

- **WHEN** read returns a message from a Chat with an `awaiting_jobs` Run
- **THEN** its plain-text attribution includes role, timestamp, and `runStatus: awaiting_jobs`

#### Scenario: Historical activity annotation remains historical

- **WHEN** the Chat becomes idle after read stores its result
- **THEN** replay retains the stored status without a newer status query
