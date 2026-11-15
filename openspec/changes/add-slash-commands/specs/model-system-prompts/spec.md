## ADDED Requirements

### Requirement: A compaction Run absorbs every committed row

A compaction Run MUST absorb every user and assistant row whose sequence is above the
absorbed-through sequence of the active checkpoint. It MUST hold no row back. Its summary
instruction MUST omit the sentence about a newer user message that follows the absorbed rows. All
other text of the summary instruction MUST stay the same.

#### Scenario: The next turn sees only the checkpoint

- **WHEN** a compaction Run publishes a checkpoint and the owner then sends a message
- **THEN** the request of the next turn holds that checkpoint and the new message
- **AND** it holds no row that the checkpoint absorbed

#### Scenario: The instruction has no trigger sentence

- **WHEN** a compaction Run sends its summary request
- **THEN** the instruction does not tell the model that a newer user message follows the absorbed rows
- **AND** it still tells the model to fold an earlier checkpoint

### Requirement: A compaction Run request reuses a stored system prompt

This requirement applies when the absorbed rows fit the model of a compaction Run. Its summary
request MUST hold the stored receipt prompt of its source Run, the absorbed rows, and the
instruction last. The source Run is the Run of the newest completed reply. With no source Run, it
MUST send no system prompt. It MUST send no tool declarations, and it MUST bind no receipt.

#### Scenario: The summary request of a compaction Run

- **WHEN** a compaction Run with model `B` sends its summary request, and its source Run used model `A`
- **THEN** the request holds the receipt prompt of the source Run and no tool declarations
- **AND** the compaction Run has no system-prompt receipt

#### Scenario: A compaction Run with no source Run

- **WHEN** every earlier turn Run of the Chat failed, and the owner compacts
- **THEN** the summary request holds no system prompt

### Requirement: A failed compaction Run fails

When the summary request of a compaction Run fails or returns no usable summary, the Run MUST end
`failed` with the error. It MUST NOT publish a checkpoint. The rule that a failed overflow
compaction never fails its Run MUST NOT apply to a compaction Run.

#### Scenario: A provider error during a compaction Run

- **WHEN** the provider answers the summary request of a compaction Run with an error
- **THEN** the Run is `failed`, and the Chat has no new checkpoint

### Requirement: A step-boundary compaction absorbs the turn so far

A turn Run can compact at a step boundary. The checkpoint MUST then absorb every user and assistant
row above the active checkpoint, the user message of the current segment, and its closed reply.
The summary instruction MUST omit the sentence about a newer user message. All other text of the
instruction MUST stay the same.

#### Scenario: A compaction in a tool loop absorbs the open turn

- **WHEN** a turn Run compacts after its third tool step
- **THEN** the checkpoint absorbs the user message of the Run and the reply with its three tool calls
- **AND** no tool call or tool result of that reply follows the checkpoint

### Requirement: A step-boundary compaction continues the live request

The summary request of a step-boundary compaction MUST use the model, the effort, the system prompt,
and the tool declarations of the live request. Its rows MUST be the stored replay of the absorbed
rows, with the closed reply last. The summary instruction MUST be its last user message.

#### Scenario: The summary request reuses the live prefix

- **WHEN** a turn Run on model `A` with effort `high` compacts at a step boundary
- **THEN** the summary request uses model `A`, effort `high`, the same system prompt, and the same tool declarations

### Requirement: The continue notice carries the current request

The `compaction` notice item of a continue message MUST tell the model that the conversation was
compacted. It MUST tell the model to continue its task from the checkpoint. It MUST then quote the text of the
newest owner message of the Run, at most 4,000 characters. It MUST NOT be a text part.

#### Scenario: The model sees the request after a compaction

- **WHEN** the owner asked `migrate the auth module to sessions`, and the Run compacts mid-turn
- **THEN** the next request holds the checkpoint, then a `compaction` item that quotes `migrate the auth module to sessions`

### Requirement: A failed step-boundary compaction continues the Run

When the summary request of a step-boundary compaction fails or returns no usable summary, the Run
MUST NOT publish a checkpoint. It MUST continue as if no compaction was due. It MUST record the
failure as a Run event, and the web MUST show it in the transcript.

#### Scenario: A provider error during a compaction mid-turn

- **WHEN** the provider answers the summary request of a step-boundary compaction with an error
- **THEN** the Run continues with its next model request and no new checkpoint
- **AND** the transcript shows that the compaction failed

### Requirement: An automatic compaction runs at a step boundary

At each step boundary where the Run takes another model step, the worker MUST measure the next
request. The measure is the context size of the latest request plus the estimate of the rows of
that step. When it reaches the compaction threshold of the Run model, the Run MUST compact at that
boundary.

#### Scenario: A long tool loop compacts itself

- **WHEN** the threshold of the Run model is 160,000 tokens, and a tool result brings the next request to 165,000 tokens
- **THEN** the Run compacts at that boundary and sends its next request after the checkpoint

#### Scenario: A final answer does not compact automatically

- **WHEN** the model gives its final answer, and the measured request is above the threshold
- **THEN** the Run completes with no automatic compaction

### Requirement: Automatic compaction stops when it makes no progress

An automatic compaction MUST NOT run before one model step after the previous compaction of the
Run. It MUST NOT run when there is no row to absorb. When the first request after a compaction is
still at the threshold, automatic compaction MUST stop for the rest of the Run. An owner command
MUST still compact.

#### Scenario: Ten compactions in a long Run

- **WHEN** a Run reaches the threshold ten times, and each checkpoint brings the request below it
- **THEN** the Run compacts ten times and continues

#### Scenario: A compaction that does not help

- **WHEN** the first request after an automatic compaction is still above the threshold
- **THEN** the Run makes no further automatic compaction, and the transcript shows that
- **AND** the owner can still compact with `/compact`

### Requirement: A compaction focus is a bounded paragraph after the summary instruction

A compaction can have a focus. Its summary instruction MUST then end with a paragraph that starts
with `Additional focus:` and holds the neutralized focus text. That paragraph MUST say that the
focus cannot change the section headings or the redaction rules. With no focus, the instruction
MUST hold no such paragraph.

#### Scenario: A focus reaches the summary request

- **WHEN** a compaction with the focus `keep the migration plan` sends its summary request
- **THEN** the last part of the instruction is `Additional focus:` with `keep the migration plan`

#### Scenario: A focus cannot remove redaction

- **WHEN** the focus asks the model to keep a credential verbatim
- **THEN** the instruction still tells the model to write `[REDACTED]` for a credential

### Requirement: The focus shows on the checkpoint and is not replayed

A checkpoint that a compaction with a focus publishes MUST store the focus. The history read MUST
return the focus with the checkpoint. The focus MUST NOT be part of the checkpoint text that later
requests replay.

#### Scenario: The boundary shows the focus

- **WHEN** a compaction with a focus publishes a checkpoint and the owner reads the history
- **THEN** the checkpoint in the history holds that focus

#### Scenario: A later request does not replay the focus

- **WHEN** a turn Run replays a checkpoint that has a focus
- **THEN** the checkpoint text in the request does not hold the focus text
