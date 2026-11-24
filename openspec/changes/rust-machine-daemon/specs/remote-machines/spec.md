## ADDED Requirements

### Requirement: The handshake calls the bootstrap service

A Machine connection MUST call `BootstrapService.GetInfo` and `Roots.List`
before any other call, then bind the reported instance id to the Machine name.
The connection MUST run `llame-machine attach --stdio`, over SSH for a remote
Machine and as a local child for the host.

#### Scenario: The host is reached through attach

- **WHEN** the API connects to the host Machine
- **THEN** it starts `llame-machine attach --stdio` as a child and calls `GetInfo` first

## REMOVED Requirements

### Requirement: The Machine session is versioned and multiplexed

**Reason**: The JSON-RPC framing is replaced by gRPC over HTTP/2.
**Migration**: See `machine-daemon` "The main service matches the protocol version exactly".

### Requirement: The handshake lists the git methods that a daemon answers

**Reason**: gRPC methods are typed; a missing method answers UNIMPLEMENTED.
**Migration**: The installation reports UNIMPLEMENTED as update required.

### Requirement: The handshake reports the static facts of a Machine

**Reason**: Static facts come from the bootstrap service.
**Migration**: See `machine-daemon` "The bootstrap service never breaks".
