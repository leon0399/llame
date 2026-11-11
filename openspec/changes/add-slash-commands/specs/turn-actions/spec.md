## MODIFIED Requirements

### Requirement: The chat history read reports the latest Run

`GET /api/v1/chats/:id/messages` MUST return `latestRun` from the same read as the messages. It is
the Chat's newest Run, with its id, kind, message id, status, follow-up action, model id, effort,
accepted permission mode, and error. The kind MUST be `turn` or `compaction`. The error MUST be the terminal message that the Run's stream
sends, or `null`. It MUST be `null` for a Chat with no Run. It MUST follow the owner scope of the
history read.

#### Scenario: The latest Run of a failed turn is reported

- **WHEN** the latest Run of a Chat failed before it dispatched, with model `A` and mode `bypass`
- **THEN** the history read reports that Run with status `failed`, model `A`, and mode `bypass`
- **AND** it reports the failure message of that Run as its error

#### Scenario: Another owner's latest Run is not reported

- **WHEN** user B reads the history of a Chat of user A
- **THEN** the API returns the current not-found response and no `latestRun`

#### Scenario: A compaction Run is the latest Run

- **WHEN** the newest Run of a Chat is a completed compaction Run
- **THEN** the history read reports that Run with kind `compaction` and message id `null`

### Requirement: The latest turn shows Continue and Regenerate actions

The web MUST show Regenerate on the latest turn when `latestRun` is a terminal turn Run. It MUST show Continue
only when `latestRun` produced the reply and is `failed`, `cancelled`, or `expired`. The reply
usage status MUST NOT be `completed`, and the reply MUST hold a settled tool part. A latest turn
with no visible reply MUST show a failed-turn row with the error of `latestRun` and Regenerate.
Older turns MUST NOT show either action. Continue MUST send the composer's permission mode.

#### Scenario: A failed agentic turn shows both actions

- **WHEN** the latest Run failed after two settled tool calls
- **THEN** the latest turn shows Continue and Regenerate

#### Scenario: A failed turn with no completed step shows only Regenerate

- **WHEN** the latest Run failed before any tool call settled
- **THEN** the latest turn shows Regenerate and does not show Continue

#### Scenario: A turn with no reply shows Regenerate

- **WHEN** the latest Run failed at pickup, so the latest turn has no reply
- **THEN** the latest turn shows Regenerate

#### Scenario: A failed turn with an empty reply shows its cause

- **WHEN** the latest Run failed at its provider call and stored a reply with no visible content
- **THEN** the latest turn shows a failed-turn row with the error of the Run and Regenerate
- **AND** the row stays visible without hover

#### Scenario: Older turns show no action

- **WHEN** a Chat has two turns
- **THEN** only the second turn shows the actions

#### Scenario: Continue sends the composer mode

- **WHEN** the composer shows mode `bypass` and the owner clicks Continue
- **THEN** the request names `permissionMode: "bypass"` and no model or effort

#### Scenario: A compacted turn shows no action

- **WHEN** a compaction Run absorbed the latest turn and completed
- **THEN** the latest turn shows neither Continue nor Regenerate

## ADDED Requirements

### Requirement: A follow-up on an absorbed turn is refused

When the absorbed-through sequence of the active checkpoint is at or above the sequence of the
latest user message, a follow-up request MUST get 409. The API MUST NOT create a Run or change a
message.

#### Scenario: Regenerate after a compact

- **WHEN** a compaction Run absorbed the latest turn, and the owner sends a Regenerate request for that turn
- **THEN** the API answers 409 and creates no Run

### Requirement: A compaction Run offers no follow-up action

When `latestRun` is a compaction Run, the web MUST NOT show Continue or Regenerate. When that Run
is `failed` or `expired`, the transcript MUST show its error after the last turn.

#### Scenario: A failed compaction shows its error

- **WHEN** the latest Run is a compaction Run that failed
- **THEN** the transcript shows the error of that Run and no Continue or Regenerate
