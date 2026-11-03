## MODIFIED Requirements

### Requirement: One rendering function produces every model-facing tool result

The system MUST render each tool result a model receives through one rendering function. The input
of that function MUST be the tool result object: a success object, or a failure object with its
type, message, and locators. Replay MUST rebuild the failure object from the stored outcome, error
text, and rejected locator. The function MUST produce the live result, the replayed result of a
later turn, and the kept result of a Continue Run. A call that the AI SDK refused before llame ran
it is the one exception. The SDK makes its live result, and `turn-replay` defines its replay. A tool MUST NOT bypass the function.

#### Scenario: Live and replayed renderings agree

- **WHEN** a tool result is rendered live and the same stored part is replayed in a later turn
- **THEN** the payload text of the replayed result equals the live rendering
- **AND** the replayed result has the output type of the live result, with no frame around it

#### Scenario: A tool without a text shape renders as JSON

- **WHEN** `search_conversations` returns a result
- **THEN** the live result, the Continue result, and the replayed result carry the JSON rendering as a JSON output

#### Scenario: A failure renders as JSON with its type

- **WHEN** a `bash` call fails with `command_failed` and its message contains `</tool-result>`
- **THEN** the live rendering is the JSON failure object with `type: "command_failed"` and the tag escaped
- **AND** the replayed rendering is the same JSON rebuilt from the stored outcome and error text

#### Scenario: A media reference survives the rendering

- **WHEN** the model reads a PNG file live, and the part replays in a later turn
- **THEN** both renderings carry the JSON image text and the image reference the step composer attaches
- **AND** the native JSON rendering keeps the SDK output type `text`
