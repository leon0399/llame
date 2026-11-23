## Purpose

The failover policy decides when a Run on a model role moves to the next candidate with no owner
action. Every cell of the policy is off unless the operator sets it, and each Run records its origin.

## ADDED Requirements

### Requirement: Every Run records its origin

Each Run MUST record its origin: `owner` or `agent`. A send, a Continue, a Regenerate, a queue item,
and a `/compact` MUST start an `owner` Run. A job-notice Run MUST take the origin of the Run that
started its job. The Chat of the Run MUST NOT change its origin.

#### Scenario: A send starts an owner Run

- **WHEN** the owner sends a message
- **THEN** the Run records origin `owner`

#### Scenario: A job notice inherits the origin

- **WHEN** an `agent` Run starts a background job, and the job settles on an idle Chat
- **THEN** the job-notice Run records origin `agent`

### Requirement: The operator declares a failover matrix

A top-level `failover` object MUST be the instance default matrix. A role can hold its own `failover`.
A matrix holds Run origins `owner` and `agent`, and each holds the groups `availability`, `access`,
and `quota`. A cell MUST be `on` or `off`. A `quota` cell can also be `{ switchAfterSeconds: N }`.

#### Scenario: An unknown origin fails startup

- **WHEN** `failover` holds the key `schedule`
- **THEN** startup fails, and the error names `failover.schedule`

#### Scenario: A non-positive threshold fails startup

- **WHEN** a `quota` cell is `{ switchAfterSeconds: 0 }`
- **THEN** startup fails, and the error names that cell

### Requirement: A role matrix overrides the default cell by cell

The policy of a role MUST take each cell from the role's `failover` when the role sets that cell. In
other cases it MUST take the cell from the top-level `failover`. A cell that neither sets MUST be
`off`.

#### Scenario: A role adds one cell

- **WHEN** the top-level `failover` sets `agent.availability: "on"`, and `@coding` sets only `agent.quota: "on"`
- **THEN** the policy of `@coding` has both cells on for `agent`, and every `owner` cell off

### Requirement: Each failure class belongs to one failure group

The `availability` group MUST hold `overloaded`, `server_error`, `unreachable`,
`first_token_timeout`, and `stream_broken`. The `access` group MUST hold `auth`, `billing`, and
`model_not_found`. The `quota` group MUST hold `quota_exhausted`, and `rate_limited` with a reset time.
A class outside these groups MUST NOT cause a switch.

#### Scenario: A context overflow does not switch

- **WHEN** a request of a role Run fails with `context_overflow`, and every cell is on
- **THEN** the Run fails, and no other model receives a request

### Requirement: A failure switches only where its cell is on

A failure MUST switch the Run only when four conditions are true. The request has no request retry
left. The selector of the Run is a role. A next candidate exists. The cell of the Run origin and the
failure group is on. The switch MUST use the model switch of `model-roles`, with cause `policy`.

#### Scenario: An agent Run fails over

- **WHEN** the policy of `@coding` has `agent.availability` on, and an `agent` Run gets `overloaded` after its last retry
- **THEN** the Run continues on the next candidate in a new segment

#### Scenario: An owner Run with the cell off fails

- **WHEN** the policy of `@coding` has `owner.availability` off, and an `owner` Run gets `overloaded` after its last retry
- **THEN** the Run fails with `error.code` `overloaded`, and the reply offers Continue on next candidate

#### Scenario: The default policy never switches

- **WHEN** the config declares no `failover`, and a role Run gets `server_error` after its last retry
- **THEN** the Run fails, and no other model receives a request

### Requirement: A quota cell decides between a wait and a switch

A `quota` cell `on` MUST switch at once and MUST NOT wait. A cell `off` MUST keep the quota wait of
`quota-wait`. A cell with `switchAfterSeconds` MUST wait when the reset is at most that far away. It
MUST switch when the reset is later, or when the failure has no reset time.

#### Scenario: A near reset waits

- **WHEN** the cell is `{ switchAfterSeconds: 7200 }`, and a usage limit resets in one hour
- **THEN** the Run enters `awaiting_quota`

#### Scenario: A far reset switches

- **WHEN** the cell is `{ switchAfterSeconds: 7200 }`, and a usage limit resets in five days
- **THEN** the Run continues on the next candidate, and it does not enter `awaiting_quota`

### Requirement: The policy is read when the failure happens

The system MUST read the policy of the current config when a request fails. A Run that already
waits MUST keep its wait when a restart changes the policy. A failure after its wake MUST follow the
policy of that time.

#### Scenario: A restart enables quota failover

- **WHEN** a Run waits in `awaiting_quota`, and the operator restarts with `quota: "on"` for its origin
- **THEN** the Run keeps its wait until the reset, an owner action, or a cancellation

### Requirement: A paid candidate needs the operator's consent

An automatic switch from a `subscription` or `free` model MUST skip each candidate whose resolved
billing is `usage`. The role can set `allowPaidFallback: true` to stop this skip. The owner's
next-candidate action MUST NOT skip a paid candidate.

#### Scenario: A gated paid candidate is skipped

- **WHEN** `@coding` lists `codex`, a `usage` model, then a `free` model, with no `allowPaidFallback`
- **AND** an `agent` Run on `codex` fails over
- **THEN** the Run continues on the `free` model

#### Scenario: The owner reaches a paid candidate

- **WHEN** the same Run fails with the cell off, and the owner sends Continue with `candidate: "next"`
- **THEN** the Continue Run starts on the `usage` model

### Requirement: The end of the chain keeps the failure

When no candidate remains after the skip rule, the failure MUST follow `provider-failures` and
`quota-wait` as for a Run with no policy. The Run MUST NOT switch to the first candidate.

#### Scenario: Every candidate failed

- **WHEN** an `agent` Run on the last candidate of `@coding` fails with `overloaded`, with the cell on
- **THEN** the Run fails with `error.code` `overloaded`

### Requirement: A failed send with a started tool call switches after its calls settle

A send that fails after a started tool call MUST wait for its started calls, as `provider-failures`
requires. A switch MUST then keep the parts through the last settled tool part. The first request on
the new model MUST be a new step, not the failed request again.

#### Scenario: A broken stream after a tool call

- **WHEN** an `agent` Run streams a `bash` call that settles, then breaks after its last retry, with the cell on
- **THEN** the closed reply holds the `bash` part with its result
- **AND** the new model receives that result, and the command does not run again

### Requirement: A compaction request follows the rules of its Run

A compaction request on the model of the current segment MUST follow the policy of its Run. A
compaction request on another model is a side call and MUST NOT switch.

#### Scenario: A step-boundary compaction fails over

- **WHEN** an `agent` Run compacts at a step boundary, and the summary request gets `overloaded` after its last retry, with the cell on
- **THEN** the Run switches to the next candidate, and the compaction runs on it

### Requirement: A title call walks the chain of its role

When `defaults.titleGenerationSelector` names a role, a title request MUST try the next candidate
after a failure in any failure group. It MUST NOT store a hold and MUST NOT wait for a quota reset. It
MUST skip a gated paid candidate, as an automatic switch does.

#### Scenario: A title during an outage

- **WHEN** the title role lists `codex` then `deepseek`, and `codex` answers `overloaded` after its last retry
- **THEN** the title request goes to `deepseek`, and the Chat gets its title

#### Scenario: Every title candidate fails

- **WHEN** each candidate of the title role fails
- **THEN** the Chat keeps its current title, and no Run waits
