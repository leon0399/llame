## Purpose

Defines how stored Chat turns become the model messages of a later request, so
that each request starts with what the previous request of the Chat sent.

## ADDED Requirements

### Requirement: One projection builds the messages of stored turns

The system MUST build the model messages of stored Chat rows through one
projection. A later turn, a Continue Run, and a compaction request MUST use it.
A new feature that sends stored Chat turns to a model MUST use it too. A feature
MUST NOT keep a second builder for stored turns.

#### Scenario: Continue and a later turn replay a reply the same way

- **WHEN** a Continue Run keeps the parts of a stored reply, and a later turn replays the same parts on the same model
- **THEN** both requests carry the same messages for those parts

### Requirement: A later request starts with the previous request

This rule applies when the previous reply completed on the model of the new turn,
with one llame version. The first request of the turn MUST then start with the
messages of the last request of the previous turn. The messages of the response
to that request MUST follow them. A new checkpoint, an edit, or a replaced reply
changes the history, and the rule then applies to the new history.

#### Scenario: The next turn extends the previous request

- **WHEN** turn 1 completes on `sonnet` after three model requests, and turn 2 runs on `sonnet`
- **THEN** the first request of turn 2 starts with the messages of the third request of turn 1
- **AND** the messages of the response to that request follow them

#### Scenario: Request-time media keeps the prefix

- **WHEN** an earlier tool result holds an image that the epoch image window attaches
- **THEN** a later request carries the same image content at the same position as the earlier request

### Requirement: A model switch keeps the previous request less the omitted parts

This rule applies when the previous reply did not complete, or completed on
another model, with one llame version. The first request of the turn MUST then
start with the messages of the last request of the previous turn and of the
stored part of its response, with two differences. The parts and the provider metadata that the
model rule of `reasoning-output` omits MUST be absent. Each image and PDF MUST
take the form that the input of the new model selects.

#### Scenario: A model switch changes only the omitted parts

- **WHEN** turn 1 completes on `sonnet`, and turn 2 runs on `glm-5`
- **THEN** the first request of turn 2 starts with the messages of the last request of turn 1 and of its response
- **AND** those messages do not have the reasoning parts and the provider metadata that the model rule of `reasoning-output` omits
- **AND** each image and PDF takes the form that the input of `glm-5` selects

#### Scenario: A failed reply changes only the omitted parts

- **WHEN** the Run of turn 1 fails on `sonnet` after a reasoning part, and turn 2 runs on `sonnet`
- **THEN** the first request of turn 2 starts with the messages of the last request of turn 1 and of the stored part of its response
- **AND** those messages do not have the reasoning parts and the provider metadata of turn 1

### Requirement: Replay removes nothing that a checkpoint has not absorbed

Each part after the latest checkpoint MUST replay whole. The system MUST NOT
clear a payload or an input, drop a call or a result, or add an omission marker.
No size budget applies to replay. When a request does not fit the context window
of its model, the compaction rules of `model-system-prompts` apply.

#### Scenario: A long tool turn replays whole

- **WHEN** an earlier turn made 19 calls with 176,510 characters of tool parts
- **AND** one `read` result has 8,629 characters, and one `edit` input has 22,240 characters
- **THEN** the next request carries each of the 19 calls with its full input and its full result
- **AND** the request carries no omission marker

#### Scenario: A request that does not fit compacts or fails

- **WHEN** the replayed history and the new owner message do not fit the context window of the model
- **THEN** the system compacts the history or fails with `context_incompatible`, as `model-system-prompts` defines
- **AND** the system does not clear or drop a part of a tool call

### Requirement: A refused call replays as the live step sent it

When the AI SDK refused a call before llame ran it, the tool part MUST store the
error text and the input of the live step. These fields are for the
model only, and the owner-facing error stays as before. Replay MUST send that
error text as an error-text output, with that input. A refused part stored before
this change has neither field and replays through the failure rendering.

#### Scenario: A call to an unknown tool replays the SDK error

- **WHEN** the model called `fetch_page`, which no declaration names, and a later turn replays that call
- **THEN** the replayed result is the error text that the SDK sent in the live step
- **AND** the replayed result names the same available tools as the live step
- **AND** the owner still sees the refusal message of llame

#### Scenario: Unparsable input replays as an empty object

- **WHEN** the model called `read` with the input `not valid json{{{`, and a later turn replays that call
- **THEN** the replayed call carries the input that the live step sent, which is `{}`

### Requirement: Tool results replay in their live rendering

A replayed tool result MUST carry the output that the live loop sent for that
call: the same output type and the same text. The rendering of
`tool-result-rendering` makes both, except for a call that the AI SDK refused. The system MUST NOT add a frame, an outcome
line, an artifact line, or other text to a replayed result. A JSON result MUST
replay as a JSON output. A call with no live result MUST replay the failure
rendering of its stored outcome.

#### Scenario: A text result replays as it was sent

- **WHEN** a later turn replays the result of `read("/work/draft.md")`
- **THEN** the output text is equal to the text that the live loop sent for that call
- **AND** no untrusted-output frame and no outcome line surrounds it

#### Scenario: A JSON result replays as a JSON output

- **WHEN** an MCP tool returned a JSON result, and a later turn replays it
- **THEN** the replayed result is a JSON output with the value that the live loop sent

#### Scenario: A spilled result names its artifact once

- **WHEN** a later turn replays a `grep` result whose cap notice names `artifact://grep-7`
- **THEN** the replayed text carries that cap notice as the live loop sent it
- **AND** the result carries no separate `Artifact:` line

#### Scenario: A call that ended with its Run replays its outcome

- **WHEN** a Run was cancelled while a `read` call was open, and a later turn replays that call
- **THEN** the replayed result is the failure rendering of `tool-result-rendering` for the outcome `cancelled`

#### Scenario: A failure replays as it was sent

- **WHEN** an earlier `read` call failed with `permission_denied` for a refused redirect hop
- **THEN** the replayed result is the failure output that the live loop sent, with its type, its message, and the refused locator

### Requirement: The calls of one step replay as one step

The parts of one model step MUST replay as one assistant message, then one tool
message with the results of its calls. The assistant message MUST hold the
reasoning, the text, and the calls of that step in stored order. Parts with the
same step number form one step. For parts with no step number, a run of
consecutive tool parts and the text and reasoning before it form one step.

#### Scenario: Parallel calls replay as one step

- **WHEN** step 2 of a turn called `read("a.md")` and `read("b.md")` in one model response
- **THEN** the replay carries one assistant message with both calls, then one tool message with both results

#### Scenario: Sequential calls replay as two steps

- **WHEN** step 2 called `read("a.md")` and step 3 called `read("b.md")`, with no text or reasoning between them
- **THEN** the replay carries an assistant message with the first call and a tool message with its result
- **AND** a second assistant message with the second call and a tool message with its result follow them

#### Scenario: Text before a call stays in its step

- **WHEN** a step wrote visible text and then called a tool
- **THEN** one assistant message carries the text and then the call

#### Scenario: Text between two parallel calls stays in their step

- **WHEN** one model response wrote text, called `read("a.md")`, wrote more text, and called `read("b.md")`
- **THEN** one assistant message carries the first text, the first call, the second text, and the second call
- **AND** one tool message carries both results

#### Scenario: Text after the calls stays in their step

- **WHEN** one model response called `read("a.md")` and then wrote text, and the next step called `read("b.md")`
- **THEN** the first assistant message carries the first call and that text
- **AND** the second assistant message carries only the second call

#### Scenario: Parts with no step number use the consecutive rule

- **WHEN** a stored turn has parts with no step number
- **THEN** each run of consecutive tool parts replays as one step, with the text and the reasoning before it

### Requirement: Stored parts keep the member order of their objects

The storage of message parts in the `messages` row MUST keep the members of each
object in the order in which the system wrote them. A tool input and a JSON
result that replay from that row MUST keep the member order of the live call and
of the live result. The Run event log stores its payloads as `jsonb`, which does
not keep member order. Parts that the system rebuilds from the event log,
including the kept parts of a Continue Run, replay in the key order of `jsonb`.

#### Scenario: A tool input keeps its member order

- **WHEN** the model calls `edit` with the members `path`, `oldText`, and `newText` in that order
- **THEN** a later turn replays the input with its members in that order

#### Scenario: A reordered part replays as stored

- **WHEN** a part stored before this change holds members in a sorted order
- **THEN** replay uses the stored order
- **AND** the system does not try to restore the original order

#### Scenario: A kept part of a Continue Run replays in the key order of the event log

- **WHEN** a Continue Run keeps a tool part of its source Run
- **THEN** the first request of the Continue Run replays the input of that part in the key order of `jsonb`
- **AND** a later turn replays that part in the order of the `messages` row of the Continue Run

### Requirement: A compaction request replays its rows like a later turn

A compaction request MUST carry the rows that it absorbs through the projection
of a later turn. Their reasoning parts MUST follow the model rule of
`reasoning-output`. The summarization instruction MUST be the last message of the
request.

#### Scenario: A compaction request extends the previous request

- **WHEN** the previous turn completed on a model, and a compaction runs on that model before the first step of a new turn
- **THEN** its request starts with the messages of the last request of the previous turn and of its response
- **AND** the summarization instruction is the last message

#### Scenario: A compaction request carries reasoning

- **WHEN** a compaction absorbs a completed reply with reasoning parts from the model of the request
- **THEN** the compaction request carries those reasoning parts in their stored positions

### Requirement: Stored parts keep the provider metadata of the live step

A stored text part MUST keep the provider metadata of the live text, and a stored
tool part MUST keep that of the live call. A later request MUST send it back
unchanged when its reply meets the model rule of `reasoning-output`. The kept
parts of a Continue Run meet it on their model. The result of a call that ran MUST carry the metadata of its call.
Otherwise the part MUST replay with no provider metadata. The metadata MUST stay
opaque, as `reasoning-output` requires.

#### Scenario: The same model gets the metadata back

- **WHEN** a completed reply on an `openai-responses` model stored a text part and a tool call with item ids
- **AND** the next turn runs on that model
- **THEN** the request carries the text part and the tool call with the item ids that the live step sent

#### Scenario: A model switch drops the metadata and keeps the parts

- **WHEN** the next turn runs on another model
- **THEN** the request carries the text part and the tool call with no provider metadata of the earlier model

#### Scenario: The metadata is never shown

- **WHEN** a chat is displayed, exported, indexed, or viewed through a public share
- **THEN** no provider metadata of a text part or a tool part appears in that output
