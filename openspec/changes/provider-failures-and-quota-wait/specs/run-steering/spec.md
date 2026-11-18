## MODIFIED Requirements

### Requirement: A delivery does not restart the time limits of the Run

The wall-clock budget `runs.timeoutSeconds` and the execution ceiling MUST count from the claim of
the Run by its worker. The budget MUST exclude the time in `awaiting_quota`, as `quota-wait`
defines. A delivery MUST NOT restart either of them.

#### Scenario: A long steered Run reaches its budget

- **WHEN** the budget is one hour, and a Run takes a steer after 50 minutes
- **THEN** the Run expires one hour after the claim, during its second segment

### Requirement: Stop interrupts when steers are pending

The Stop control and the Esc key MUST interrupt the Run when one or more `steer` message items are
pending. A pending command item MUST NOT make them interrupt. For a Run in `awaiting_quota`, they
MUST always request cancellation of the Run. Otherwise they MUST request cancellation of the Run. A
draft in the composer MUST NOT change.

#### Scenario: Esc twice stops everything

- **WHEN** one steer and one queue item are pending, and the owner presses Esc
- **THEN** the steer is delivered as an interrupt in the same Run
- **AND** a second press after that delivery cancels the Run, and the queue item stays pending and paused

#### Scenario: Stop with only a pending compact

- **WHEN** only a `/compact` steer item is pending, and the owner presses Stop
- **THEN** the Run is cancelled, and the `/compact` item stays pending and paused

#### Scenario: Stop during a quota wait with a pending steer

- **WHEN** a steer is pending, the Run is in `awaiting_quota`, and the owner presses Stop
- **THEN** the Run is cancelled, and the steer stays pending and paused
