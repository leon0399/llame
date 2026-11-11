## ADDED Requirements

### Requirement: An owner compaction absorbs every committed row

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

### Requirement: An owner compaction request reuses a stored system prompt

This requirement applies when the absorbed rows fit the model of a compaction Run. Its summary
request MUST hold the stored receipt prompt of its source Run, the absorbed rows, and the
instruction last. The source Run is the Run of the
newest completed reply. With no source Run, it MUST send no system prompt. It MUST send no tool
declarations, and it MUST bind no receipt.

#### Scenario: The summary request of a compaction Run

- **WHEN** a compaction Run with model `B` sends its summary request, and its source Run used model `A`
- **THEN** the request holds the receipt prompt of the source Run and no tool declarations
- **AND** the compaction Run has no system-prompt receipt

#### Scenario: A compaction Run with no source Run

- **WHEN** every earlier turn Run of the Chat failed, and the owner compacts
- **THEN** the summary request holds no system prompt

### Requirement: An owner focus is a bounded paragraph after the summary instruction

A compaction Run can have a focus. Its summary instruction MUST then end with a paragraph that
starts with `Additional focus:` and holds the neutralized focus text. That paragraph MUST say that
the focus cannot change the section headings or the redaction rules. With no focus, the instruction
MUST hold no such paragraph.

#### Scenario: A focus reaches the summary request

- **WHEN** a compaction Run with the focus `keep the migration plan` sends its summary request
- **THEN** the last part of the instruction is `Additional focus:` with `keep the migration plan`

#### Scenario: A focus cannot remove redaction

- **WHEN** the focus asks the model to keep a credential verbatim
- **THEN** the instruction still tells the model to write `[REDACTED]` for a credential

### Requirement: The focus shows on the checkpoint and is not replayed

A checkpoint that a compaction Run with a focus publishes MUST store the focus. The history read
MUST return the focus with the checkpoint. The focus MUST NOT be part of the checkpoint text that
later requests replay.

#### Scenario: The boundary shows the focus

- **WHEN** a compaction Run with a focus publishes a checkpoint and the owner reads the history
- **THEN** the checkpoint in the history holds that focus

#### Scenario: A later request does not replay the focus

- **WHEN** a turn Run replays a checkpoint that has a focus
- **THEN** the checkpoint text in the request does not hold the focus text

### Requirement: A failed owner compaction fails its Run

When the summary request of a compaction Run fails or returns no usable summary, the Run MUST end
`failed` with the error. It MUST NOT publish a checkpoint. The rule that a failed overflow
compaction never fails its Run MUST NOT apply to a compaction Run.

#### Scenario: A provider error during a compaction Run

- **WHEN** the provider answers the summary request of a compaction Run with an error
- **THEN** the Run is `failed`, and the Chat has no new checkpoint
