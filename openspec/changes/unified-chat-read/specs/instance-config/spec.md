## ADDED Requirements

### Requirement: The retired conversation reader is not a configuration target

Startup MUST reject `conversation_read` in `tools.allowed`, `tools.promptFiles`, and `models[].toolPromptFiles`. Its error MUST identify the field and direct the operator to `read` with `chat://`. A stale permission-group key MUST remain inert under exact-id matching. It MUST NOT restore a declaration, executor, or authority.

#### Scenario: Old reader allowlist fails closed

- **WHEN** configuration allowlists `conversation_read`
- **THEN** startup fails with a migration diagnostic rather than a compatibility executor

#### Scenario: An old prompt override cannot survive retirement

- **WHEN** a model or instance overrides the `conversation_read` description
- **THEN** startup rejects that target even when no model admits it

### Requirement: Replaceable templates reject the retired chats namespace

Worker boot MUST reject `chats` and `chats.*` references in system prompts and tool descriptions. The diagnostic MUST identify the model or tool and the retired namespace. It MUST direct the operator to remove those references because the digest uses context items. It MUST expose no prompt contents, source Chat text, or host path.

#### Scenario: A custom digest template fails before model I/O

- **WHEN** a configured prompt references `chats.recent`
- **THEN** worker boot rejects it with an actionable diagnostic
- **AND** no model call or source Chat resolution occurs
