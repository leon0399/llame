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

## MODIFIED Requirements

### Requirement: Model-authored tool intent is presentation metadata

The declarations for `bash`, `read`, `edit`, `write`, `grep`, `wait`, `stop`, `enter_workspace`, `search_conversations`, `knowledge_search`, and `web_search` MUST require `i`. It MUST be a nonblank string of at most 120 characters in the canonical declaration. Executor schemas MUST remain unchanged. Before validation, admission, or execution, the host MUST remove `i` from executor arguments and retain it as display-only intent. It MUST alter no eligibility, permission, native-attempt identity, or MCP argument.

Owner history, events, kept-part replay, and live streams MUST preserve the separate intent field. Public shares, exports, and search MUST omit it. Stored inputs and model-history arguments MUST retain `i` as the model sent it, including refused calls. SDK refusal diagnostics MUST retain their original text. Trusted host calls MUST require no synthetic intent. MCP schemas and server-owned `i` arguments MUST remain unchanged.

#### Scenario: A described command still receives ordinary admission

- **WHEN** a model requests `bash` with an intent and a rejected command
- **THEN** policy rejects the command regardless of that intent
- **AND** admission receives the command without `i`
- **AND** owner history preserves the separate intent and original input

#### Scenario: An internal read does not need model presentation data

- **WHEN** a trusted instruction or skill read supplies only a path
- **THEN** its unchanged executor schema validates and executes it
- **AND** the host invents no intent

#### Scenario: Reconnection preserves the intent beside the real arguments

- **WHEN** events or Continue reconstruct a tool part with intent
- **THEN** that intent and its input agree with owner history

#### Scenario: A later request shows the model its own intent

- **WHEN** an earlier call has `i: "Checking files"`
- **THEN** later model history retains those exact arguments

#### Scenario: An MCP argument named i keeps its server-defined meaning

- **WHEN** an MCP schema defines and receives `i`
- **THEN** the host neither replaces nor strips that server argument
