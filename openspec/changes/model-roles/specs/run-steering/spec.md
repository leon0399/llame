## MODIFIED Requirements

### Requirement: A pending item records a producer and a sender

Each pending item MUST record its producer kind, its sender reference, its mode, its parts, and its
attachments. It MUST also record the model selector and the effort that the send named, or none, as
`model-roles` defines. It MUST record the permission mode of the send, its state, and its order. The
state is `pending`, `delivered`, or `withdrawn`. This capability MUST accept the producer kinds `owner`
and `job`. An `owner` item MUST have an empty sender reference. A `job` item MUST have the mode
`notice`, no parts, and the job of `background-jobs` as its sender reference. A `job` item MUST record
the model selector, effort, permission mode, and origin of the Run that started the job.

#### Scenario: An owner item names its producer

- **WHEN** the owner sends a queue item during a Run
- **THEN** the stored item has producer kind `owner` and no sender reference

#### Scenario: A job item names its job

- **WHEN** a job that a Run on selector `A` started settles
- **THEN** the stored item has producer kind `job`, the mode `notice`, and the job as sender reference
- **AND** the item records selector `A`

### Requirement: A delivered message is a Run event

Each delivery MUST append one `run.delivered` event. The event MUST name the delivered message, its
items, and a `cause`. A compaction at the final answer with only command items stores no message and
is not a delivery: it appends no `run.delivered` event, and the Run completes. The cause is
`failover` when a model switch of `model-roles` delivers the message. Otherwise the cause is
`interrupt` when an interrupt stopped the step or an interrupt item is delivered. Otherwise it is
`steer` when a message item is delivered, `notice` when a `notice` item is delivered, and
`compaction` in the last case. A boundary that compacted MUST also name its checkpoint. The Run
stream MUST end its current segment at that event and name the delivered message.

#### Scenario: A live client sees the delivery

- **WHEN** a client watches the stream of a Run that delivers a steer
- **THEN** the stream ends the current segment and names the delivered message
- **AND** a resume then streams the next segment

#### Scenario: A delivery of one notice names its cause

- **WHEN** a Run delivers one `notice` item and no owner item at a step boundary
- **THEN** the `run.delivered` event names the host message and the cause `notice`

#### Scenario: A compaction names its cause

- **WHEN** a Run compacts at a step boundary and continues with a host message
- **THEN** the `run.delivered` event has the cause `compaction`, and names that host message and the checkpoint

#### Scenario: An interrupt compaction keeps its cause

- **WHEN** the owner sends `/compact` as an interrupt during a tool call
- **THEN** the `run.delivered` event has the cause `interrupt` and names the checkpoint
- **AND** the closed reply records usage status `aborted` with `interrupted: true`

#### Scenario: A model switch names its cause

- **WHEN** a Run switches from `codex` to `sonnet`, and a steer is pending at that boundary
- **THEN** the `run.delivered` event has the cause `failover` and names the host message of the switch

### Requirement: A segment attempt prepares its own accepted turn

The attempt of a segment MUST prepare its accepted turn as the first attempt of a Run prepares it
for its user message. This includes the accepted-turn context items. Prompt imports and `$skill`
mentions in a delivered message MUST take effect. The pre-step compaction check MUST run before the first model step of
the Run. It MUST also run before the first step of a segment that a model switch opens. It MUST NOT
run at another segment start. A compaction at a step boundary follows
`model-system-prompts`.

#### Scenario: A steer with a skill mention

- **WHEN** a delivered steer names `$pdf` and the skill is available
- **THEN** the delivered message carries a `skill-activation` item before the steer text

#### Scenario: A segment start does not compact

- **WHEN** the model gives a final answer whose measured request is above the compaction threshold, and a steer then starts a second segment
- **THEN** no compaction runs before the first model request of the second segment

#### Scenario: A switch to a smaller window compacts first

- **WHEN** a Run switches from `codex` to `sonnet`, and the history does not fit the window of `sonnet`
- **THEN** the compaction check runs before the first request to `sonnet`, as for the first step of a Run
