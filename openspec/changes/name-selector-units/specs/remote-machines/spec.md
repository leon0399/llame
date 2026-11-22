## MODIFIED Requirements

### Requirement: Each Machine daemon reports a persistent instance id

Each Machine daemon MUST create an instance id once and keep it in its configuration directory. Two daemons that start at the same time with one directory MUST report the same id. The handshake MUST report the id, the release version, the build id, and the protocol version. The protocol version MUST be 3, and the hub MUST accept only an exact match.

#### Scenario: Two first starts agree on one id

- **WHEN** two daemon processes start at the same time with an empty configuration directory
- **THEN** both report the same instance id

#### Scenario: A version 1 daemon is not used

- **WHEN** a Machine daemon speaks protocol version 1
- **THEN** every operation on that Machine returns `machine_unavailable` with reason `incompatible_version`

#### Scenario: A daemon without unit-letter selectors is not used

- **WHEN** a Machine daemon speaks protocol version 2, which has no `L` selector forms or line-and-column suffix
- **THEN** every operation on that Machine returns `machine_unavailable` with reason `incompatible_version`
