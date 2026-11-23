## REMOVED Requirements

### Requirement: Conversation read uses the attempt-local read-only tool loop

**Reason**: The standalone conversation_read declaration and executor retire. Chat reads use the existing read lifecycle.

**Migration**: Drain prior Runs before deployment. Remove old executable/configuration paths, but preserve stored observations and immutable sequences.

## ADDED Requirements

### Requirement: Chat reads use the existing read lifecycle

Chat reads MUST declare `read_only` through `read`. They MUST use its attempt-local admission, trusted execution context, cancellation, persistence, replay, and generic owner interface. They MUST enforce conversation-reads bounds before generic truncation. They MUST require no separate Chat-reader declaration, catalog entry, or executor id.

#### Scenario: Read is not admitted

- **WHEN** the attempt does not admit `read`
- **THEN** no Chat locator can invoke the removed tool or another executor

#### Scenario: Bounded Chat read survives reload

- **WHEN** read stores a bounded Chat observation
- **THEN** live output, reload, and replay preserve its authored content and continuation

### Requirement: Historical conversation observations survive reader retirement

The system MUST preserve stored conversation_read inputs, results, and events without a live executor. It MUST NOT rehydrate, rename, or rewrite them. Source deletion MUST make a fresh Chat read fail without redacting another Chat's stored observation. Destination deletion MUST retain the existing cascade. Deployment MUST drain prior declarations and queued Runs before cutover. Rollback MUST restore matching binaries and data.

#### Scenario: An old observation remains readable

- **WHEN** a stored conversation_read result predates the tool retirement
- **THEN** the owner interface and model replay use its stored observation without invoking an executor

#### Scenario: A deleted source does not rewrite history

- **WHEN** a destination Chat stores text from a source that the owner later deletes
- **THEN** its stored observation remains while a fresh read returns `not_found`

#### Scenario: The cutover never changes sequence interpretation

- **WHEN** deployment retires the tool declaration
- **THEN** message sequences stay unchanged and no old tool id becomes an alias
