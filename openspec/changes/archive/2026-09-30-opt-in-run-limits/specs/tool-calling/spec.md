## MODIFIED Requirements

### Requirement: Multi-step tool-calling run loop

The run executor SHALL support multi-step runs: when the model requests tool
invocations, the loop SHALL execute them, append the results to the run's model
context, and continue the same run until the model produces a final answer or,
when the operator configures one, the step cap is reached. Without a configured
cap the loop places no bound on the number of steps. A step is one model turn that requested at least one
tool. Multiple independent read-only calls MAY execute concurrently. Calls that
mutate the same native file path SHALL execute sequentially in provider-emitted
order, each producing its own call/result parts. A configured step cap SHALL be
evaluated per step, atomically: the turn that reaches the cap executes all
accepted calls.
The loop remains queue-processed and durable.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters model context, and the model continues

#### Scenario: Multiple sequential tool steps

- **WHEN** the model chains several tool-requesting turns within one Run
- **THEN** each executes in order and context accumulates every call and result

#### Scenario: Independent read-only calls can run concurrently

- **WHEN** the model requests independent read-only calls in one turn
- **THEN** they may execute concurrently and the step counter increments once

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three independent read-only tool calls in one turn
- **THEN** all three may execute concurrently, each with its own call/result parts, and the step counter increments by one

#### Scenario: Same-path native mutations are serialized

- **WHEN** one model turn requests two native mutations against the same absolute path
- **THEN** they execute sequentially in provider order
- **AND** the later call observes the earlier call's current bytes

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps have run, and the model requests three calls in its eighth tool turn
- **THEN** all three accepted calls execute before further tools are refused

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a Run reaches the configured maximum tool steps
- **THEN** no further calls execute, the model is driven to answer from what it has, and the Run completes with the cap recorded in Run events

#### Scenario: No step cap unless configured

- **WHEN** no step cap is configured and the model keeps requesting tools across many turns
- **THEN** every accepted step executes and the Run continues until the model answers, the owner cancels, or another durable-runs rule ends it
- **AND** no cap marker is recorded
