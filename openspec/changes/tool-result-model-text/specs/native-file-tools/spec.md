# Spec Delta

## MODIFIED Requirements

### Requirement: Exact edit replaces one current unique match

`edit` SHALL accept an absolute local path or, while a Workspace is entered, a
relative local path resolved from the Workspace root under the local path rules
above, together with a valid `file://` alias, non-empty `oldText`, and
`newText`. A file alias is always absolute and is decoded before native
operation. It SHALL read the current file at execution time and require exactly
one exact occurrence of `oldText`. A missing or ambiguous occurrence SHALL fail
without mutation. Unrelated changes elsewhere in the file SHALL NOT block a
correct unique replacement. Calls targeting the same path SHALL execute
sequentially in the host runtime. The operation SHALL preserve bytes outside
the replacement and return post-edit content with two adjacent live lines on
each side when available, the post-edit line count, and `display` data that
carries the replaced text, the replacement text, and the start line of the
replacement. The result MUST NOT carry a diff. No prior read, snapshot tag,
read hash, or permission rule is required in this iteration.

#### Scenario: Unrelated change does not block edit

- **WHEN** another writer changes a different paragraph after the model read, while `oldText` remains one exact match
- **THEN** edit replaces the match and preserves the unrelated change

#### Scenario: Changed target fails without mutation

- **WHEN** another writer changes the exact old text before edit executes
- **THEN** edit returns a stale/missing-target error
- **AND** it does not write the replacement

#### Scenario: Duplicate target fails closed

- **WHEN** `oldText` occurs more than once
- **THEN** edit returns an ambiguity error with no mutation
- **AND** it does not replace every occurrence implicitly

#### Scenario: Sequential same-path calls are first-writer-wins

- **WHEN** two edit calls both request `-Foo +Bar` and `-Foo +Baz` against the same current bytes
- **THEN** the first call applies
- **AND** the second call observes the changed bytes and fails without overwriting the first result

#### Scenario: File URL edit uses the decoded host target

- **WHEN** `edit` targets `file:///tmp/guide.md` with one matching `oldText`
- **THEN** it applies the exact unique replacement to `/tmp/guide.md`
- **AND** it reports the same post-edit region and decoded result identity as an edit naming `/tmp/guide.md`

#### Scenario: Workspace-relative edit uses the resolved local path

- **WHEN** the model edits `src/app.ts` while a Workspace is entered at `/work/project`
- **THEN** the host applies the edit to `/work/project/src/app.ts`
- **AND** the result identifies `/work/project/src/app.ts` as the path used

#### Scenario: The persisted edit carries display data and no diff

- **WHEN** the model replaces lines 12-13 of `src/app.ts` with three lines
- **THEN** the persisted result carries `display` with `startLine` 12, the two replaced lines as `oldText`, and the three new lines as `newText`
- **AND** it carries `content` for lines 10 to 16 and no `diff` key

### Requirement: Only a media read's image result carries a media locator

Only a `media://` read's image result SHALL carry `media`, the stored object's locator. Every other
image result SHALL carry no `media` field and no `media://` locator, and SHALL be stored in its tool
output with the display-only thumbnail that `media-attachments` defines, under `display.thumbnail`,
when one fits its cap, which never reaches the model.

#### Scenario: An unstored image result carries a thumbnail and no locator

- **WHEN** the model reads `https://example.test/shot.png`, which serves a PNG image
- **THEN** the result carries no `media` field and no `media://` locator
- **AND** its stored tool output carries `display.thumbnail`, which no model request carries

## ADDED Requirements

### Requirement: A write result carries no content

A successful `write` MUST persist the mutated locator, the `created` or `replaced` marker, and the
written file's line count. It MUST NOT persist the written content or a diff. The owner UI MUST
render the written content from the call's `content` argument.

#### Scenario: A persisted write is status only

- **WHEN** the model writes a 216-line file
- **THEN** the persisted result carries `created: true` and `lineCount: 216`
- **AND** it carries no `content` and no `diff` key
