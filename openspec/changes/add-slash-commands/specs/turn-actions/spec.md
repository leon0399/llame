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

### Requirement: An owner starts a follow-up Run on the latest turn

A follow-up Run is a Run that an owner starts on a user message that already has a Run. The owner
MUST start it through `POST /api/v1/chats/:chatId/messages/:userMessageId/runs`. The message MUST
be the user message with the highest `seq` of the Chat's user messages. The newest Run of the Chat
MUST be a turn Run of that message. A checkpoint MUST NOT absorb that message. The Chat MUST NOT be
archived. The answer MUST be the same UI message stream that a chat send returns.

#### Scenario: A follow-up request on the latest turn starts a Run

- **WHEN** the owner sends a valid follow-up request for the latest user message of a Chat with no live Run
- **THEN** the API creates a new Run for that message
- **AND** the first frame of the stream is a `start` frame whose `messageId` is the id of the new Run

#### Scenario: A follow-up request on an older turn is refused

- **WHEN** the owner sends a follow-up request for a user message that has a newer user message after it
- **THEN** the API answers 409
- **AND** it creates no Run and changes no message

#### Scenario: A follow-up request on an archived Chat is refused

- **WHEN** the owner sends a follow-up request for the latest user message of an archived Chat
- **THEN** the API answers with the error that a chat send to that Chat gets
- **AND** it creates no Run

#### Scenario: A follow-up request for another owner's Chat reveals nothing

- **WHEN** user B sends a follow-up request that names a Chat or a user message of user A
- **THEN** the API answers 404 before it reads any job state
- **AND** it creates no Run, expires no Run, and changes no message of user A

#### Scenario: A follow-up after a compaction Run is refused

- **WHEN** the newest Run of a Chat is a compaction Run, and the owner sends a Regenerate request for the latest user message
- **THEN** the API answers 409 and creates no Run

#### Scenario: A follow-up after a compact at the final answer is refused

- **WHEN** a turn Run compacted at its final answer and completed, and the owner sends a Regenerate request for its user message
- **THEN** the API answers 409 and creates no Run

### Requirement: The latest turn shows Continue and Regenerate actions

For a terminal turn `latestRun` of a turn that no checkpoint absorbed, the web MUST show
Regenerate on the latest turn. It MUST show Continue only when `latestRun` produced the reply and
is `failed`, `cancelled`, or `expired`. That reply is not `completed` and holds a settled tool part. A latest
turn with no visible reply MUST then show a failed-turn row with the error of `latestRun` and
Regenerate. Older turns MUST NOT show either action. Continue MUST send the composer's permission
mode.

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

- **WHEN** a compaction Run, or a compaction at the final answer, absorbed the latest turn
- **THEN** the latest turn shows neither Continue nor Regenerate

## ADDED Requirements

### Requirement: A compaction Run offers no follow-up action

When `latestRun` is a compaction Run, the web MUST NOT show Continue or Regenerate. When that Run
is `failed` or `expired`, the transcript MUST show its error after the last turn. The web MUST NOT
show an assistant message or a reply notice for a compaction Run.

#### Scenario: A failed compaction shows its error

- **WHEN** the latest Run is a compaction Run that failed
- **THEN** the transcript shows the error of that Run and no Continue or Regenerate

#### Scenario: A compaction Run in a hidden tab raises no reply notice

- **WHEN** a compaction Run completes while the owner views another Chat
- **THEN** the web shows no reply notice and no unseen mark for it

#### Scenario: A reload during a compaction Run

- **WHEN** the owner reloads the page while a compaction Run is live
- **THEN** the transcript shows the compaction Run as live and shows no empty assistant message
