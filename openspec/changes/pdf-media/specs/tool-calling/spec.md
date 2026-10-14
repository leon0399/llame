## ADDED Requirements

### Requirement: PDF results are carried without bytes and their media locator survives the cap

A PDF in a tool result SHALL be carried without PDF bytes and without a thumbnail, so the cap
measures only the result's text. Truncation SHALL NOT cut, shorten, or omit the `media` locator of a
`media://` PDF result: other values SHALL be shrunk and, at the floor, other fields omitted in its
place, so a recorded `media://` PDF result always names the complete `media://` locator of the PDF
it carries.

#### Scenario: PDF bytes do not count toward the cap

- **WHEN** a `read` of `/work/paper.pdf` returns a PDF result for a 15-page, 2,215,244-byte PDF
- **THEN** the cap measures only the serialized PDF result, which is not truncated
- **AND** the recorded result carries no PDF bytes, no base64 data, and no `thumbnail`

#### Scenario: Truncation keeps a PDF result's media reference

- **WHEN** a `media://` PDF result serializes above the cap because another field is oversized
- **THEN** the recorded result carries the complete `media://` locator unchanged
- **AND** the oversized field is shrunk in place and the marker states the omitted characters

#### Scenario: The floor omits other fields before a PDF's media reference

- **WHEN** a `media://` PDF result's top-level field names alone serialize above the cap
- **THEN** other fields are omitted and the marker states how many of how many
- **AND** the recorded result still carries the complete `media://` locator

### Requirement: PDF tool observations are stored and replayed like image results

A PDF in a tool result SHALL be stored in the tool part as the native PDF result, never as a media
descriptor, PDF bytes, or base64 content. On replay its text SHALL follow the ordinary projection,
and the PDF SHALL become provider file content built from its original at request time only when the
request's model declares `pdf` input, the original is available, and the epoch image window attaches
it; otherwise its text SHALL carry the matching PDF placeholder.

#### Scenario: A PDF result is stored without PDF data

- **WHEN** a `read` of `/work/paper.pdf` returns a PDF result
- **THEN** the stored tool part carries that native PDF result, with `status: "success"`,
  `kind: "pdf"`, `mediaType` `application/pdf`, `pages`, `byteSize`, and `path`, and no `media` field
- **AND** its stored output carries no `thumbnail`, no PDF bytes, and no base64 data

#### Scenario: A media read PDF result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns a PDF result
- **THEN** the stored tool part carries that native PDF result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no PDF bytes, and no base64 data

#### Scenario: An attached PDF result replays as file content

- **WHEN** a later step of the Run that read `/work/paper.pdf`, on a model that declares `pdf` input,
  replays its PDF result and the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  original held in that attempt's memory, keyed by the tool call id
- **AND** the call remains immediately paired with its result

#### Scenario: A media read PDF result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `media://<id>` PDF result
  whose reference the epoch image window attaches
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  stored original

#### Scenario: An earlier turn's PDF read replays as not retained

- **WHEN** a later turn, a retry or resume, a compaction request, or a fork on a model that declares
  `pdf` input replays the stored PDF result of `read("/work/paper.pdf")` for a 15-page PDF
- **THEN** the replayed result's text carries `[pdf "/work/paper.pdf" 15 pages, not retained]`
- **AND** the request carries no file content for that result and does not fail

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** a request whose model declares `image` but not `pdf` input replays the PDF result of
  `read("/work/paper.pdf")` for a 15-page PDF
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file content for that result

#### Scenario: A PDF result beyond the window replays as the limit placeholder

- **WHEN** a request on a model that declares `pdf` input replays the PDF result of
  `read("/work/paper.pdf")` for a 15-page PDF whose reference is beyond the epoch image window's
  bounds
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file content for that result

#### Scenario: PDF content does not consume the observation budget

- **WHEN** a replayed PDF result's original would serialize as base64 longer than 8,000 UTF-16 code
  units, and the pair's text fits within the budget
- **THEN** the pair's payload is neither cleared nor dropped on account of the PDF
- **AND** the budgets measure only the pair's text

#### Scenario: A dropped pair carries no PDF

- **WHEN** the hard budget drops an older complete pair whose result carries a PDF
- **THEN** neither the pair nor its file content appears in the request
- **AND** the omission is counted by the single omission marker

#### Scenario: A replayed PDF reference never resolves another owner's media

- **WHEN** a stored `media://<id>` PDF result replayed in user A's Run references a media id owned by
  user B
- **THEN** the replayed result carries `[pdf media://<id> unavailable]` and the request proceeds
- **AND** no PDF bytes or descriptor fields of user B's object reach the request
