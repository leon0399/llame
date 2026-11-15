## MODIFIED Requirements

### Requirement: A held notice goes with the next Run

A notice MUST stay pending when it starts no Run and no Run is live. A Run can then start from a
chat send, a promoted queue item, or a mode change of a pending item. A turn Run MUST take all
pending notices of the Chat into its user message. A compaction Run MUST take no notice. When a follow-up Run of `turn-actions`
starts, the notices MUST be delivered at its
first step boundary.

#### Scenario: A result after a Stop waits for the owner

- **WHEN** the owner cancels a Run, its job succeeds two minutes later, and the owner then sends a message
- **THEN** no Run starts at the settlement, and the first model request of the new Run carries the notice before the owner text

#### Scenario: A result after a failed Run waits for Continue

- **WHEN** a Run fails, its job succeeds, and the owner then starts a Continue
- **THEN** the Continue Run gets the notice at its first step boundary

#### Scenario: A compaction Run leaves a notice pending

- **WHEN** a notice is pending, and the owner sends `/compact` to the idle Chat
- **THEN** the compaction Run publishes its checkpoint, and the notice stays pending until the Run ends

### Requirement: A host message carries notices when no owner message exists

A host message is a stored message with the wire role `user`, no sender, and no text part. Its
only parts are context items of the producers `interrupted`, `job`, and `compaction`. The system
MUST store a host message when notices are delivered and no owner message carries them. It MUST
also store one when a compaction continues a Run with no message item. The history read MUST mark a host message. A host
message MUST NOT give a Chat its title, and it MUST NOT be the list preview of a Chat.

#### Scenario: A host message in the history

- **WHEN** the owner loads a Chat in which a notice started a Run
- **THEN** the history holds a message that is marked as a host message, before the reply to it

#### Scenario: A host message is not search evidence

- **WHEN** a job output holds the word `kestrel`, and the owner searches the conversations for it
- **THEN** no result cites the host message, because it has no text part

### Requirement: A notice starts a Run on an idle Chat

A notice MUST start a Run when the Chat is idle and the job is `succeeded`, `failed`, or
`timed_out`. A Chat is idle when it has no non-terminal Run, its latest Run is `completed`, and
it is not archived. The system MUST then store one host message for all pending notices of the
Chat and start one Run on it. A notice for a `cancelled` or `lost` job MUST NOT start a Run. When a compaction Run completes,
the system MUST apply this rule to the notices that are pending.

#### Scenario: A monitor wakes the Chat at night

- **WHEN** the latest Run of a Chat is `completed`, and its monitor job exits with code 0 at 03:00
- **THEN** one Run starts on a host message that holds the notice

#### Scenario: Two jobs settle together

- **WHEN** two jobs of an idle Chat settle in the same second
- **THEN** one Run starts, and its host message holds both notices

#### Scenario: A lost job starts no Run

- **WHEN** a job of an idle Chat settles as `lost`
- **THEN** no Run starts, and the notice stays pending

#### Scenario: A result during a compaction Run

- **WHEN** a job succeeds while a compaction Run is live, and the compaction Run then completes
- **THEN** one Run starts on a host message that holds the notice, after the checkpoint

### Requirement: The web shows notices and host messages as notices

The web MUST show a pending `notice` item above the composer with the job locator and the state.
The item MUST offer delete and no other action. The transcript MUST show a host message as a
muted notice for each job that it names, and never as a message of the owner. It MUST show a
`compaction` item as a muted notice that the Run continues after a compaction.

#### Scenario: The owner drops a result

- **WHEN** a notice is pending, and the owner deletes it
- **THEN** the item is `withdrawn`, and no later Run carries it

#### Scenario: A host message in the transcript

- **WHEN** a host message names one job that succeeded
- **THEN** the transcript shows one muted notice with the job locator and `succeeded`

#### Scenario: A continue message in the transcript

- **WHEN** a Run compacts mid-turn and continues
- **THEN** the transcript shows the compaction boundary and then one muted continue notice
