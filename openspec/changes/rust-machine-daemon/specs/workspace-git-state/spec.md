## MODIFIED Requirements

### Requirement: Absence lines are fixed messages

When the system cannot observe git state, it MUST tell one fixed line:
"git state unavailable:" and one reason from the closed list of the next
requirement.

#### Scenario: An offline Machine is reported

- **WHEN** the Workspace Machine is offline at Run start
- **THEN** the observation gives "git state unavailable: Machine unavailable"

#### Scenario: An outdated daemon is reported

- **WHEN** the Machine daemon reports another protocol version
- **THEN** the observation gives "git state unavailable: Machine daemon update required"

#### Scenario: A git failure is reported without its error text

- **WHEN** git fails with a dubious ownership error
- **THEN** the observation gives "git state unavailable: git failed"
