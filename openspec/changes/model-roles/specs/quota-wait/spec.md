## RENAMED Requirements

- FROM: `### Requirement: Only the deadline job and a cancellation wake a quota wait`
- TO: `### Requirement: Only the deadline job, a cancellation, and the next-candidate action wake a quota wait`

## MODIFIED Requirements

### Requirement: Only the deadline job, a cancellation, and the next-candidate action wake a quota wait

The deadline job, a cancellation, and the next-candidate action of `model-roles` MUST be the only
wakers of a Run in `awaiting_quota`. A `steer`, an `interrupt`, a `queue` item, and a job notice MUST
stay pending and MUST NOT wake it. A send without a delivery mode MUST get 409, as for any live Run.

#### Scenario: A steer during a quota wait

- **WHEN** the owner sends a steer to a Chat whose Run is in `awaiting_quota`
- **THEN** the steer is a pending item, and the Run stays in `awaiting_quota`

#### Scenario: A job settles during a quota wait

- **WHEN** a background job of the Chat settles while its Run is in `awaiting_quota`
- **THEN** the job notice is pending, and the Run stays in `awaiting_quota`

#### Scenario: The next-candidate action wakes the Run

- **WHEN** a `@coding` Run is in `awaiting_quota`, and the owner calls the next-candidate action
- **THEN** the Run wakes and continues on the next candidate, and the deadline job does not wake it again

### Requirement: The web shows a quota wait above the composer

While the latest Run of a Chat is in `awaiting_quota`, the web MUST show a box above the prompt
composer, over the transcript. The box MUST show the model name, the local reset time, a live
countdown to the wake time, and a Stop control. When `model-roles` offers a next candidate, the box
MUST also show "Continue on next candidate". After the wake time, the box MUST show that the Run sends
its request again.

#### Scenario: A Codex weekly limit

- **WHEN** the Run of a Chat waits for a reset in 2 days and 3 hours
- **THEN** the box names the model, shows the local reset time, and counts down from about 2 days and 3 hours

#### Scenario: A waiting role Run offers the next candidate

- **WHEN** a `@coding` Run on `codex` waits for a reset, and `sonnet` is the next candidate
- **THEN** the box shows "Continue on next candidate" with the name of `sonnet`
