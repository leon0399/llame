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
