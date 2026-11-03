## MODIFIED Requirements

### Requirement: The Workspace step uses the request permission mode

The Workspace step MUST use `message.permissionMode`, and `default` when it is absent.
A request with a mode that the process does not enable in `tools.permissionModes`
MUST get 422 before any store. A `read-only` request MUST evaluate each path
decision as `default` does, because the owner, not the model, starts the step. The
step MUST record each decision in the creation record of the chat.

#### Scenario: bypass on a process without bypass stores nothing

- **WHEN** the request sets `permissionMode` to `bypass` and the process does not
  enable `bypass`
- **THEN** the response is 422, and the system stores no chat, bound root, or message

#### Scenario: An enabled bypass applies to every path decision

- **WHEN** the request sets `permissionMode` to `bypass` and the process enables
  `bypass`
- **THEN** the system evaluates each path decision in `bypass` mode
- **AND** the system records each decision in the creation record of the chat

#### Scenario: A read-only request creates its worktree

- **WHEN** the request sets `permissionMode` to `read-only` and asks for a
  worktree, the process enables `read-only`, and the `enter_workspace` group allows
  each path
- **THEN** the system creates the worktree and binds the chat to it
- **AND** the first Run of the chat has mode `read-only`

#### Scenario: read-only on a process without read-only stores nothing

- **WHEN** the request sets `permissionMode` to `read-only` and the process does
  not enable `read-only`
- **THEN** the response is 422, and the system stores no chat, bound root, or message
