## ADDED Requirements

### Requirement: A tool can yield to a steer

A tool can declare that it yields. `wait` and `bash` on the llame host MUST yield, and no other
tool does. A steer, an interrupt, or a job notice can signal the Run. Each open call of a tool
that yields MUST then return a known result at once. The work of that call MUST continue as a job of
`background-jobs`. A call that yields MUST NOT settle as `outcome_unknown` or `cancelled`.

#### Scenario: A read does not yield

- **WHEN** the owner sends a steer while a `read` of a web locator runs
- **THEN** the `read` finishes with its own result before the steer is delivered

#### Scenario: Two commands yield at one signal

- **WHEN** two host `bash` calls of one step run in the foreground, and the owner sends a steer
- **THEN** both calls return `backgrounded`, and both commands continue

### Requirement: Only a wait call stays open while its Run waits

A `wait` call MUST be the only tool call that stays open while a Run is in `awaiting_jobs`. The
Run MUST settle every other call of the step before it enters that status. A `wait` call MUST
NOT record a native attempt, because it has no effect on the host.

#### Scenario: A wait beside a read in one step

- **WHEN** the model calls `read` and `wait` in one step
- **THEN** the `read` result is stored before the Run enters `awaiting_jobs`

### Requirement: A woken Run settles the wait and continues from its stored steps

When a Run leaves `awaiting_jobs`, its attempt MUST record the result of the open `wait` call
exactly once. It MUST then send the next model request with the history and the stored steps of
the current reply, through that result. It MUST NOT execute a settled call again. A retry of
that attempt MUST start from the same stored steps. The recovery rule for a recorded
`native.attempt` in the current segment MUST still apply to that retry.

#### Scenario: A build fails while the Run waits

- **WHEN** a Run waits on a build, the build fails, and another worker claims the Run
- **THEN** the reply keeps its earlier steps, and the `wait` call gets the result that names the failed build
- **AND** the next model request carries those steps and that result

#### Scenario: A worker stops after the wake

- **WHEN** the current segment holds no native attempt, and the worker stops after it recorded the `wait` result
- **THEN** the retry sends the same stored steps and the same `wait` result, and it runs no earlier call again

#### Scenario: A worker stops after the wake of a segment with a command

- **WHEN** the current segment holds a `bash` attempt, and the worker stops after the wake
- **THEN** the redelivered Run fails as `outcome_unknown`, and the owner can start a Continue
