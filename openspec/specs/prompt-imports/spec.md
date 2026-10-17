# prompt-imports Specification

## Purpose

Prompt imports let an owner point at native `read` locators in a prompt while preserving the prompt text and adding bounded, owner-visible context before the Run asks its model. They use native locator behavior and permission authority without turning imported data into instructions.

## Requirements

### Requirement: Prompt text recognizes shared import markers

The system SHALL scan the owner's stored, neutralized prompt text using the shared marker grammar defined by the `import-markers` capability. Markers inside inline code or fenced code SHALL remain ordinary text, while a delimited backtick marker is recognized as that grammar defines, and importing SHALL leave the stored user text exactly as typed, including marker spelling and placement.

#### Scenario: A prompt marker is recognized without rewriting the prompt

- **WHEN** the stored prompt contains a valid shared import marker outside code
- **THEN** the target is handed to prompt-import processing
- **AND** the stored user text remains exactly as typed

#### Scenario: Code text remains ordinary prompt text

- **WHEN** an inline code span or fenced code block contains an import-shaped string, and no marker `@` immediately precedes the inline code span
- **THEN** no prompt import is created from that string
- **AND** the code text remains unchanged

### Requirement: Prompt targets resolve as native read locators

Each target SHALL resolve exactly as native `read`, including selectors: absolute host paths, `file:` aliases, bound-Workspace-relative paths, `kb://`, `skill://`, `http://`, and `https://`. An unbound relative target SHALL remain prose. An absolute or `file:` host target MAY run unbound only with `read` allowlisted and a native executor; a `kb://` target MAY run unbound only with `read` allowlisted and a Knowledge root.

#### Scenario: A Workspace-relative target uses the bound Workspace

- **WHEN** a Chat is bound to `/repo` and its prompt contains `@README.md:30-35`
- **THEN** the target resolves as `/repo/README.md:30-35`
- **AND** its selector remains attached to the target

#### Scenario: Scheme locators retain their native authority

- **WHEN** a prompt contains valid absolute, `file:`, `kb://`, `skill://`, `http://`, or `https://` locators
- **THEN** each target is resolved by the corresponding native `read` authority
- **AND** no Workspace-relative projection changes a scheme locator

#### Scenario: An unbound relative target is prose

- **WHEN** a Chat has no Workspace and its prompt contains `@README.md`
- **THEN** the target remains prose
- **AND** no prompt import is attempted

### Requirement: Local and Knowledge targets are silently pre-evaluated before probing

After resolving, each host-path or `kb://` target SHALL be silently pre-evaluated by the `read` group before probing, without recording an audit event. A denied target SHALL use the normal audited `read` path without probing and be reported as denied/not imported whether or not it exists. Only an admitted target SHALL be probed; an admitted missing target, or a host target with no native executor, SHALL remain prose with no audit event. Bypass admits and probes.

#### Scenario: A missing allowed host target stays prose

- **WHEN** a prompt names `@missing.md:10-12`, the resolved target is admitted by the silent `read` pre-evaluation, and the selector-free host target does not exist
- **THEN** the marker remains prose and no audited read is issued
- **AND** no audit event, model notice, or owner notice is produced

#### Scenario: A missing allowed Knowledge target stays prose

- **WHEN** a prompt names a `kb://` target whose resolved target is admitted by the silent `read` pre-evaluation but whose selector-free resource cannot be found for the Run owner
- **THEN** the marker remains prose
- **AND** no audited read or audit event is produced

#### Scenario: An absolute host target without an executor stays prose

- **WHEN** an unbound Chat imports `@/tmp/notes.md` on a process with no native executor
- **THEN** the target cannot be probed and the marker remains prose
- **AND** no read or audit event is recorded

#### Scenario: A rejected absolute path hides existence

- **WHEN** the silent `read` pre-evaluation rejects an absolute host target, whether or not its path exists
- **THEN** the normal audited `read` path reports it as denied without probing the filesystem
- **AND** the owner chip and model-visible text report the same not-imported outcome in either case

#### Scenario: Literal paths take precedence over selectors

- **WHEN** a prompt imports `@/tmp/x.md:10-12` and a regular file literally named `/tmp/x.md:10-12` exists
- **THEN** the probe and import read `/tmp/x.md:10-12` as that literal file
- **AND** no `10-12` selector is applied

### Requirement: Admitted prompt reads use system origin

Each target surviving a probe or needing none (`skill://`/web) SHALL be read once through `read` with system origin `prompt-import` under effective `read` permission. The audit SHALL record requested/started/completed, except a denied read has requested/completed only. The system owns the origin; no assistant tool part SHALL appear. If `read` is not allowlisted, nothing SHALL be imported. The completion audit SHALL record derived web decisions with origin `prompt-import`.

#### Scenario: An admitted target produces a system-origin read audit

- **WHEN** an existing target is admitted by the `read` group
- **THEN** one native `read` is audited with origin `prompt-import` and requested, started, and completed events
- **AND** no assistant tool part is emitted for the read

#### Scenario: A denied target has no started event

- **WHEN** the silent `read` pre-evaluation rejects a prompt target, whether or not it exists
- **THEN** the normal audited `read` path records requested and completed audit events with origin `prompt-import`
- **AND** it has no started event, no filesystem probe, and no imported content

#### Scenario: The model cannot choose the prompt-import origin

- **WHEN** a model-supplied value attempts to set or replace a prompt-import read origin
- **THEN** the system ignores that value and retains the system-owned origin
- **AND** the model cannot turn the read into an assistant tool part

#### Scenario: Read is unavailable to prompt imports

- **WHEN** `read` is absent from `tools.allowed`
- **THEN** no prompt target is read or imported
- **AND** no prompt-import audit event is recorded

#### Scenario: Bypass admits a prompt read

- **WHEN** `read` is allowlisted, a target exists, and the Run's effective permission mode is `bypass`
- **THEN** the prompt-import read is admitted without evaluating the `read` group
- **AND** its decision is recorded as bypass
- **AND** the target is probed after bypass admission

### Requirement: Imported results equal native read output

The imported body SHALL equal the model-facing output that native `read` returns for the same locator, with the locator's selectors honored, including read-provided context lines, Markdown ancestor headings, and representations such as `outline`.

#### Scenario: A ranged Workspace read imports native context

- **WHEN** a Chat bound to `/repo` has prompt text containing `@README.md:30-35`
- **THEN** the imported body is exactly what `read("/repo/README.md:30-35")` returns
- **AND** it includes context lines 29 and 36 and any Markdown ancestor headings returned by `read`

#### Scenario: A web outline imports the outline representation

- **WHEN** the prompt contains `@https://github.com/leon0399/llame/issues/1029:outline`
- **THEN** the imported body is the outline representation returned by native `read` for that locator
- **AND** the URL selector is not discarded

#### Scenario: Derived web decisions carry prompt-import origin

- **WHEN** an admitted web prompt import causes native `read` to evaluate a redirect, alternate, adapter request, suffix candidate, or network address
- **THEN** each derived decision is recorded in the completion audit with origin `prompt-import`
- **AND** no assistant tool part exposes the derived decision

### Requirement: Prompt imports persist as one preceding rail item

Before the Run's first model request, the triggering message SHALL persist one `prompt-imports` rail item with form `notice` before user text. It SHALL contain one locator-labelled file block per imported target, neutralize reserved delimiters, and carry third-party precedence. Denied or failed targets SHALL be named only as not imported. Payload SHALL record, for each attempted target, whether it was admitted and its resolved absolute host path or canonical `kb://` locator when applicable.

#### Scenario: Successful imports precede unchanged user text

- **WHEN** a prompt imports two targets before its Run's first model request
- **THEN** the triggering user message contains one `prompt-imports` notice before the user text
- **AND** it has one locator-labelled file block for each imported target while the user text remains unchanged
- **AND** its private payload records each attempted target's admission result and resolved absolute host or canonical Knowledge locator when applicable

#### Scenario: Imported content carries precedence framing

- **WHEN** a prompt-imports item contains file content from a host, Knowledge, skill, or web target
- **THEN** the item carries its third-party precedence statement
- **AND** the statement ranks that content below system instructions and user requests and denies it authority to grant tools or relax authorization

#### Scenario: Reserved delimiters do not close the item

- **WHEN** imported content contains a reserved context delimiter
- **THEN** the persisted file block contains the neutralized form
- **AND** the prompt-imports notice remains intact

#### Scenario: Denied or failed content is not included

- **WHEN** a prompt target is denied or an admitted target's read fails
- **THEN** the item names its locator only as not imported
- **AND** it includes no content from that target

### Requirement: Prompt-import work has bounded targets, output, and time

Prompt imports SHALL consider at most 64 markers in first-occurrence order and SHALL read at most 8 targets, counting admitted probe survivors and every `skill://`/web target, within 128 KiB of output and 30 s of work, probes included, or the remaining Run deadline. A target past the read or output bound SHALL be listed as omitted; a host or Knowledge target the `read` group denies is audited without a read, never counted or omitted. When work ends, unprobed targets SHALL be dropped silently.

#### Scenario: Targets beyond the count bound are omitted

- **WHEN** a prompt contains more than 8 distinct targets that survive probing, in first-occurrence order
- **THEN** only the first 8 targets are attempted
- **AND** every later target is listed once as omitted without a read

#### Scenario: Output and work bounds stop further reads

- **WHEN** the serialized item would exceed 128 KiB, 30 seconds of work elapse, or the Run deadline arrives
- **THEN** no further admitted target is read, and once the work or deadline bound fires no further target is probed or evaluated
- **AND** after the output bound, later host or Knowledge targets are still evaluated and probed, so a prose token is never listed as omitted and a denied target is still reported as not imported
- **AND** admitted targets skipped by the output bound, or admitted targets that survived probing or needed no probe when the work bound fires, are listed once as omitted
- **AND** unprobed host or Knowledge targets skipped by the work bound are dropped silently and may remain prose

#### Scenario: Markers beyond the count bound stay prose

- **WHEN** a prompt contains 65 distinct markers in first-occurrence order
- **THEN** only the first 64 markers are considered for probing
- **AND** the 65th marker is neither probed nor listed as omitted and remains prose

#### Scenario: An unprobed work-bound target is not omitted

- **WHEN** the work bound fires before `@leo` is probed
- **THEN** `@leo` is neither probed nor read
- **AND** it is not listed as omitted and may remain prose

#### Scenario: Unresolved prose markers are not omitted

- **WHEN** a prompt contains nine prose tokens like `@leo` and none resolves to a target that survives probing
- **THEN** none is listed as omitted
- **AND** no prompt import is attempted

### Requirement: Recovery reuses completed prompt imports

A retry or worker resumption SHALL reuse persisted completed prompt-import results without rereading them and SHALL process only unfinished targets in original order. A target whose read started but did not complete SHALL receive fresh admission and read on recovery. A completed target changed on disk after the turn SHALL not be reread.

#### Scenario: A retry reads only unfinished targets

- **WHEN** a worker resumes after some prompt targets completed and others are unfinished
- **THEN** completed results are reused without another read
- **AND** only unfinished targets receive fresh admission and read, in their original order

#### Scenario: A started read receives fresh admission on recovery

- **WHEN** a prompt target's read started but did not complete before worker failure
- **THEN** recovery does not reuse a completed result for that target
- **AND** it performs fresh admission and a new read for the target

#### Scenario: A disk edit does not cause a historical reread

- **WHEN** a local target changes on disk after the turn's prompt-import result was persisted
- **THEN** recovery reuses the persisted result
- **AND** it does not read the edited target again

### Requirement: Imported content is not recursively imported

Markers inside an imported result SHALL be treated as data and SHALL not be parsed or followed, so prompt imports SHALL not recurse.

#### Scenario: Nested marker text remains data

- **WHEN** an imported file contains another valid-looking import marker
- **THEN** the nested marker is included only as imported content
- **AND** no second-level target is read or persisted

### Requirement: Admitted local imports trigger instruction loading

An admitted host-path or `kb://` prompt import whose target exists SHALL trigger its target directory's instruction-file load on the same accepted turn, whether its read then succeeds or fails. Persisted resolved paths SHALL rebuild the trigger set on retries without re-projecting relative locators. Denied, missing, `skill://`, and web targets SHALL not trigger it. Importing an instruction file SHALL neither load nor mark that file seen unless another same-turn trigger selects it.

#### Scenario: An admitted local import loads its directory instructions

- **WHEN** a host or Knowledge target survives probing, is admitted, and its read then completes or fails
- **THEN** the target directory's instruction chain is loaded on that accepted turn
- **AND** a retry stages the same load from the persisted resolved path without re-projecting the original marker

#### Scenario: Non-triggering prompt targets load no instructions

- **WHEN** a prompt target is denied, missing and never read, `skill://`, or `http://` or `https://`
- **THEN** it triggers no instruction-file load
- **AND** its outcome does not add an instruction item

#### Scenario: Importing an instruction file obeys the self-read rule

- **WHEN** a prompt imports an instruction file such as `@AGENTS.md` and no other trigger selects it
- **THEN** that prompt import does not load or mark the file as seen
- **AND** if another trigger on the same turn selects it, the file loads under that trigger

### Requirement: Prompt imports respect attempt gates and detachment

Prompt imports SHALL run after the attempt's Workspace binding re-check and any detach, and after explicit skill activation. A detaching attempt SHALL perform no new prompt imports and SHALL stage no prompt-import instruction triggers. A host-path trigger SHALL require `read` to be allowlisted and a native executor; a `kb://` trigger SHALL require `read` to be allowlisted and a Knowledge root. These triggers SHALL not require a Workspace binding.

#### Scenario: An unbound Chat imports an absolute host file

- **WHEN** an unbound Chat imports an existing absolute host file while `read` is allowlisted and a native executor is available
- **THEN** that file's directory instruction chain loads on that accepted turn
- **AND** no Workspace binding is required

#### Scenario: An unbound Chat imports a Knowledge file without a native executor

- **WHEN** an unbound Chat imports an existing `kb://` file on a process with a Knowledge root, with `read` allowlisted and no native executor
- **THEN** that Space's instruction chain loads on that accepted turn
- **AND** no native executor is required for the Knowledge trigger

#### Scenario: A detaching attempt without a persisted item skips prompt imports

- **WHEN** the Workspace binding re-check detaches the binding before prompt-import processing and no `prompt-imports` item from an earlier attempt is persisted
- **THEN** the attempt performs no prompt imports and marker text remains prose for that attempt
- **AND** no prompt-import instruction trigger is staged

#### Scenario: A persisted item replays when retry detaches

- **WHEN** a prior attempt persisted a `prompt-imports` item and a retry detaches the Workspace before prompt-import processing
- **THEN** the persisted item replays unchanged as stored text on the user message
- **AND** the retry performs no new prompt-import reads, removes no persisted item, and stages no prompt-import instruction trigger

### Requirement: Skill prompt targets are data reads

A `skill://` prompt target SHALL be read as data only; it SHALL not activate a skill, and skill activation SHALL continue to require `$skill` syntax.

#### Scenario: A skill locator does not activate the skill

- **WHEN** the prompt contains `@skill://review`
- **THEN** the `SKILL.md` text is imported as data
- **AND** no skill-activation item is produced

### Requirement: Prompt-import disclosure is owner-isolated

The owner-only chip on the triggering user message SHALL list imported, truncated, denied, failed, and omitted locators from private metadata. Datastore access SHALL enforce authenticated owner identity so another owner cannot read the item, its metadata, or its audit events through any API; public shares, exports, and search projections SHALL expose neither text nor metadata.

#### Scenario: The owner sees prompt-import outcomes

- **WHEN** a user message has imported, truncated, denied, failed, and omitted prompt targets
- **THEN** its owner's chip lists each corresponding locator and outcome
- **AND** the chip data comes from private metadata rather than model-visible text

#### Scenario: Another owner cannot inspect prompt-import history

- **WHEN** owner A has a prompt-import item and its prompt-import audit events
- **THEN** owner B cannot read that item, its metadata, or those events through any API
- **AND** datastore authorization uses the authenticated identity to enforce the isolation

#### Scenario: Public projections hide prompt imports

- **WHEN** a Chat with prompt-import items is shared, exported, or included in search projections
- **THEN** neither prompt-import text nor metadata is exposed

#### Scenario: Another owner's Knowledge Space is prose

- **WHEN** owner A's prompt names a `kb://` locator for a Space owned by owner B
- **THEN** the probe under owner A's identity finds no target, so the locator remains prose and is not imported
- **AND** no content, read, audit event, item, or owner disclosure for owner B is produced

### Requirement: Unresolvable prose is never imported

Prompt prose that names no resolvable target SHALL remain unchanged and SHALL cause no import or audit event, and an email address SHALL never be recognized as a marker.

#### Scenario: A casual at-mention is prose

- **WHEN** a bound Workspace has no path named `leo` and the prompt says `ping @leo`
- **THEN** the text remains prose and nothing is imported
- **AND** no read or audit event is recorded

#### Scenario: An email address is not a prompt marker

- **WHEN** the prompt contains `leo@example.com`
- **THEN** it remains ordinary text
- **AND** no prompt import or audit event is produced

### Requirement: Image targets import as image entries

An admitted prompt-import target whose native `read` returns an image SHALL become an image entry of
the same `prompt-imports` item, whose body SHALL be exactly the image result `read` returns for that
locator. Image entries SHALL count toward the 8-target bound; image bytes and an entry's `thumbnail`
SHALL NOT count toward the 128 KiB output bound. Recovery SHALL reuse the persisted entry without
rereading.

#### Scenario: An image target becomes an image entry

- **WHEN** a Chat bound to `/repo` sends a prompt containing `@shot.png`, the target is admitted, and
  native `read` of `/repo/shot.png` returns a 1600×900 PNG image result
- **THEN** the `prompt-imports` item holds an image entry whose body is exactly the image result that
  `read("/repo/shot.png")` returns: `status: "success"`, `kind: "image"`, `mediaType` `image/png`,
  `width` 1600, `height` 900, and `path` `/repo/shot.png`, with no `media` field
- **AND** the item's persisted text contains no image bytes or encoded image data, and the stored
  user text is unchanged

#### Scenario: Image entries count toward the target bound

- **WHEN** a prompt names nine distinct targets that survive probing, the first of which is an image
- **THEN** the first eight targets, the image included, are attempted
- **AND** the ninth target is listed once as omitted without a read

#### Scenario: Image bytes do not consume the output bound

- **WHEN** a prompt imports an image whose model variant exceeds 128 KiB followed by a text target,
  and the item's serialized text stays within 128 KiB
- **THEN** both targets are imported
- **AND** neither is listed as omitted, and the image entry's `thumbnail` is not counted

#### Scenario: A denied image target is not imported

- **WHEN** the silent `read` pre-evaluation rejects `@/tmp/shot.png`
- **THEN** the item names that locator only as not imported, through the normal audited denied
  `read`
- **AND** no probe, decode, or image entry is produced for it

#### Scenario: A refused image is not imported

- **WHEN** an admitted target's bytes are a PNG over the 40-megapixel ceiling
- **THEN** the item names that locator only as not imported
- **AND** no image entry is produced for it

### Requirement: Unstored image entries reach the model only in their attempt

A target other than `media://` SHALL be imported without being stored: its entry carries no `media`
locator, and the importing attempt's memory SHALL keep it as `media-attachments` defines. That
attempt's requests SHALL carry the image's part or placeholder after the item's text, as the epoch
window selects. Every later request, a retry or resume included, SHALL carry the not-retained
placeholder for a model that declares `image` input and the omitted placeholder otherwise.

#### Scenario: A vision model receives the imported image after the item text

- **WHEN** the Run's model declares `image` input and the request's epoch image window attaches the
  imported image
- **THEN** the Run's requests carry the `prompt-imports` item's text followed immediately by an image
  part built from the model variant the attempt's memory holds for that entry

#### Scenario: A text-only model receives the placeholder

- **WHEN** the Run's model declares text-only input and the prompt imported `@shot.png`, a 1600×900
  image
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[image "shot.png" 1600×900, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: A later turn receives the not-retained placeholder

- **WHEN** a later turn on a model that declares `image` input replays the user message whose
  `prompt-imports` item imported `@shot.png`, a 1600×900 image
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[image "shot.png" 1600×900, not retained]`
- **AND** the request carries no image part for that entry

#### Scenario: A later text-only turn receives the omitted placeholder

- **WHEN** a later turn on a model that does not declare `image` input replays the user message
  whose `prompt-imports` item imported `@shot.png`, a 1600×900 image
- **THEN** the request carries, immediately after the item's text,
  `[image "shot.png" 1600×900, omitted: this model has no image input]`
- **AND** no placeholder in the request contains `not retained`

#### Scenario: Recovery reuses the persisted entry

- **WHEN** a worker resumes the Run as a new attempt on a model that declares `image` input after an
  image target's import completed, and the image file then changed on disk
- **THEN** the image entry is reused as persisted, and the target is neither read nor decoded again
  and no new audit event is recorded for it
- **AND** the new attempt's requests carry the not-retained placeholder for that entry

#### Scenario: An imported image is not stored

- **WHEN** owner A's prompt imports `@/repo/shot.png`, whose bytes are a PNG image
- **THEN** no media object is created for owner A or any other owner
- **AND** the image entry carries no `media://` locator

### Requirement: Image entries record a thumbnail or a media locator privately

Each image entry's private payload entry SHALL record outcome `imported` and one of two forms. An
entry imported without being stored SHALL carry the original's `width`, `height`, and `mediaType`,
together with `thumbnail`, the display-only thumbnail that `media-attachments` defines, when one
fits its cap. An entry imported from a `media://` target SHALL carry `media: "media://<id>"` and
none of those four keys. A client SHALL never supply any of these keys.

#### Scenario: The payload records an unstored image's thumbnail and dimensions

- **WHEN** `@/repo/shot.png` is imported as a 1600×900 PNG image
- **THEN** its private payload entry records outcome `imported`, a `thumbnail` that is a
  `data:image/webp;base64,` URL, `width` 1600, `height` 900, and `mediaType` `image/png`
- **AND** it records no `media` key

#### Scenario: An unstored image over the thumbnail cap keeps its dimensions

- **WHEN** `@/repo/shot.png` is imported as an image whose single thumbnail encode yields a data URL
  longer than 65,536 characters
- **THEN** its private payload entry records outcome `imported`, `width`, `height`, and `mediaType`,
  and no `thumbnail`
- **AND** the API's payload validator accepts it

#### Scenario: The payload records a stored image's media locator

- **WHEN** `@media://<id>` is imported as an image
- **THEN** its private payload entry records outcome `imported` and `media` `media://<id>`
- **AND** it records no `thumbnail`, `width`, `height`, or `mediaType`

### Requirement: Image entry payloads are validated exactly

The API's payload validator SHALL validate an entry without `kind` as an image entry and an entry
carrying `kind` `pdf` as a PDF entry, and SHALL reject as malformed any entry that departs from the
closed shape it claims. It SHALL reject as malformed an entry carrying `kind` with any other value.

#### Scenario: A malformed image entry is rejected

- **WHEN** a stored payload entry carries both `thumbnail` and `media`, or a `thumbnail` that is not
  a `data:image/webp;base64,` URL
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: An unstored image entry without its dimensions is rejected

- **WHEN** a stored payload entry carries `thumbnail` but lacks `width`, `height`, or `mediaType`,
  or carries only some of `width`, `height`, and `mediaType`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Out-of-range image entry fields are rejected

- **WHEN** a stored payload entry carries `width` 0, a non-integer `height`, or `mediaType`
  `image/svg+xml`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: A media entry with dimensions is rejected

- **WHEN** a stored payload entry without `kind` carries `media` together with `width`, `height`, or
  `mediaType`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Well-formed PDF entries are accepted

- **WHEN** a stored payload entry carries `locator`, `outcome` `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages` 15, and `byteSize` 2215244, with or without `resolved` and with or
  without `media`
- **THEN** the API's payload validator accepts it

#### Scenario: A malformed PDF entry is rejected

- **WHEN** a stored payload entry carries `kind` `pdf` together with `mediaType` `image/png`,
  `pages` 0 or 101, a missing `byteSize`, a `thumbnail`, `width`, or `truncated`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Image entry keys are accepted only in their closed domains

- **WHEN** any entry without `kind` reaches the payload validator
- **THEN** it accepts `thumbnail` only as a `data:image/webp;base64,` URL within the thumbnail size
  cap, `width` and `height` only as positive integers, and `mediaType` only as `image/png`,
  `image/jpeg`, `image/gif`, or `image/webp`
- **AND** it requires `width`, `height`, and `mediaType` together whenever any of the four keys is
  present, accepts those three with or without `thumbnail`, and rejects an entry carrying `media`
  with any of the four as malformed

#### Scenario: A PDF entry's keys are exactly its closed set

- **WHEN** any entry carrying `kind` `pdf` reaches the payload validator
- **THEN** the validator accepts it only with the keys `locator`, optional `resolved`, `outcome`
  `imported`, `kind` `pdf`, `mediaType` `application/pdf`, `pages` as an integer from 1 through 100,
  `byteSize` as a positive integer, and optional `media`
- **AND** it rejects as malformed a PDF entry lacking one of its required keys or carrying
  `truncated`, `thumbnail`, `width`, `height`, or any other key

### Requirement: Image entry payloads are never sent to a model

Request assembly SHALL take the image or PDF part or placeholder from the entry, never from the
item's text, and SHALL never send a `thumbnail` to a model.

#### Scenario: A thumbnail never reaches the model

- **WHEN** a request carries a `prompt-imports` item with an image entry that records a `thumbnail`
- **THEN** no part of the request carries the `thumbnail` or any part of its data URL

#### Scenario: A PDF entry's part comes from the entry

- **WHEN** a request carries a `prompt-imports` item with a PDF entry
- **THEN** the PDF's file part or placeholder follows the item's text, built from the entry
- **AND** the item's text itself carries only the PDF result and no PDF bytes

### Requirement: Media locators are prompt-import targets

A `media://` target SHALL resolve as native `read` resolves it and SHALL be silently pre-evaluated
and probed like a `kb://` target, the probe being a lookup of the Run owner's media. An unknown id or
another owner's id SHALL remain prose. A `media://` target SHALL trigger no instruction-file load,
and the denial, output-bound, and work-bound rules for host and Knowledge targets SHALL apply to it.

#### Scenario: A typed media locator imports a stored image

- **WHEN** a prompt contains `@media://<id>` naming an image the Run owner stored, and the target is
  admitted
- **THEN** the item holds an image entry for `media://<id>` without storing a new object
- **AND** no instruction-file load is triggered by the target

#### Scenario: A media import replays from the store in a later turn

- **WHEN** a later turn on a model that declares `image` input replays the item whose image entry
  records `media://<id>`, and the epoch image window attaches it
- **THEN** the request carries the item's text followed by an image part built from that object's
  stored model variant

#### Scenario: Another owner's media locator stays prose

- **WHEN** owner A's prompt contains `@media://<id>` naming an image owner B stored
- **THEN** the marker remains prose and nothing is imported
- **AND** no read, audit event, or owner disclosure concerning owner B's object is produced

#### Scenario: A denied media target is audited and never counted

- **WHEN** the silent `read` pre-evaluation rejects `@media://<id>`
- **THEN** the normal audited `read` path records it as denied without a lookup
- **AND** it is neither counted toward the 8-target bound nor listed as omitted

### Requirement: PDF targets import as PDF entries

An admitted prompt-import target whose native `read` returns a PDF SHALL become a PDF entry of the
same `prompt-imports` item, whose body SHALL be exactly the PDF result `read` returns for that
locator. PDF entries SHALL count toward the 8-target bound; PDF bytes SHALL NOT count toward the
128 KiB output bound. A target whose `read` refuses the PDF SHALL be named only as not imported.
Recovery SHALL reuse the persisted entry without rereading.

#### Scenario: A PDF target becomes a PDF entry

- **WHEN** a Chat bound to `/repo` sends a prompt containing `@paper.pdf`, the target is admitted, and
  native `read` of `/repo/paper.pdf` returns a PDF result for a 15-page, 2,215,244-byte PDF
- **THEN** the `prompt-imports` item holds a PDF entry whose body is exactly the PDF result that
  `read("/repo/paper.pdf")` returns: `status: "success"`, `kind: "pdf"`, `mediaType`
  `application/pdf`, `pages` 15, `byteSize` 2215244, and `path` `/repo/paper.pdf`, with no `media`
  field
- **AND** the item's persisted text contains no PDF bytes or encoded PDF data, and the stored user
  text is unchanged

#### Scenario: PDF entries count toward the target bound

- **WHEN** a prompt names nine distinct targets that survive probing, the first of which is a PDF
- **THEN** the first eight targets, the PDF included, are attempted
- **AND** the ninth target is listed once as omitted without a read

#### Scenario: PDF bytes do not consume the output bound

- **WHEN** a prompt imports a 2 MiB PDF followed by a text target, and the item's serialized text
  stays within 128 KiB
- **THEN** both targets are imported
- **AND** neither is listed as omitted

#### Scenario: A refused PDF is not imported

- **WHEN** an admitted target's bytes are a PDF of 101 pages, or an encrypted PDF
- **THEN** the item names that locator only as not imported
- **AND** no PDF entry is produced for it

#### Scenario: A PDF target with a selector is not imported

- **WHEN** an admitted target `@paper.pdf:1-20` names a PDF, so native `read` refuses it with
  `invalid_selector`
- **THEN** the item names that locator only as not imported
- **AND** no PDF entry is produced for it

### Requirement: Unstored PDF entries reach the model only in their attempt

A PDF target other than `media://` SHALL be imported without being stored, its entry carrying no
`media` locator, and the importing attempt's memory SHALL keep it as `media-attachments` defines.
That attempt's requests SHALL carry the PDF's file part or placeholder after the item's text, as the
epoch image window selects. Every later request, a retry or resume included, SHALL carry the PDF
not-retained placeholder for a model declaring `pdf` input and the PDF omitted placeholder otherwise.

#### Scenario: A PDF model receives the imported PDF after the item text

- **WHEN** the Run's model declares `pdf` input and the request's epoch image window attaches the
  imported PDF
- **THEN** the Run's requests carry the `prompt-imports` item's text followed immediately by a file
  part with `mediaType` `application/pdf` built from the original the attempt's memory holds for that
  entry

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** the Run's model does not declare `pdf` input and the prompt imported `@paper.pdf`, a
  15-page PDF
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file part for that entry

#### Scenario: An imported PDF beyond the window receives the limit placeholder

- **WHEN** the Run's model declares `pdf` input and the epoch image window does not attach the
  imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, immediately after the item's text,
  `[pdf "paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file part for that entry

#### Scenario: A later turn receives the PDF not-retained placeholder

- **WHEN** a later turn on a model that declares `pdf` input replays the user message whose
  `prompt-imports` item imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[pdf "paper.pdf" 15 pages, not retained]`
- **AND** the request carries no file part for that entry

#### Scenario: A later turn without PDF input receives the omitted placeholder

- **WHEN** a later turn on a model that does not declare `pdf` input replays the user message whose
  `prompt-imports` item imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, immediately after the item's text,
  `[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** no placeholder in the request contains `not retained`

#### Scenario: Recovery reuses the persisted PDF entry

- **WHEN** a worker resumes the Run as a new attempt on a model that declares `pdf` input after a
  PDF target's import completed, and the PDF file then changed on disk
- **THEN** the PDF entry is reused as persisted, and the target is neither read nor parsed again and
  no new audit event is recorded for it
- **AND** the new attempt's requests carry the PDF not-retained placeholder for that entry

#### Scenario: An imported PDF is not stored

- **WHEN** owner A's prompt imports `@/repo/paper.pdf`, whose bytes are a PDF
- **THEN** no media object is created for owner A or any other owner
- **AND** the PDF entry carries no `media://` locator

### Requirement: PDF entries record a media locator privately

Each PDF entry's private payload entry SHALL record outcome `imported`, `kind` `pdf`, `mediaType`
`application/pdf`, `pages`, and `byteSize`. An entry imported from a `media://` target SHALL also
carry `media: "media://<id>"`; an entry imported without being stored SHALL carry no `media`. No PDF
entry SHALL carry a `thumbnail`, and a client SHALL never supply any of these keys.

#### Scenario: The payload records an unstored PDF's page count and size

- **WHEN** `@/repo/paper.pdf` is imported as a 15-page, 2,215,244-byte PDF
- **THEN** its private payload entry records outcome `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages` 15, and `byteSize` 2215244
- **AND** it records no `media` and no `thumbnail` key

#### Scenario: The payload records a stored PDF's media locator

- **WHEN** `@media://<id>` is imported as a PDF the Run owner stored
- **THEN** its private payload entry records outcome `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages`, `byteSize`, and `media` `media://<id>`
- **AND** it records no `thumbnail` key, and no new media object is stored

#### Scenario: A stored PDF import replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays the item whose PDF entry records
  `media://<id>`, and the epoch image window attaches it
- **THEN** the request carries the item's text followed by a file part built from that object's
  stored original
