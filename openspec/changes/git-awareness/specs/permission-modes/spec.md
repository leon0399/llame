# Spec Delta

## MODIFIED Requirements

### Requirement: The permission mode is not model-visible

The system prompt, the system-prompt receipt, and model-visible context items
MUST NOT contain the mode of a Run. A change of mode between turns MUST NOT be a
cause of an `effective-context-change` item. But a `read-only` attempt has no
Workspace MCP declaration, and the tool availability reminder reports that
change. The model MUST learn of a policy decision only from these sources:
`permission_denied` results, the `web_search` removal note, that reminder, the
Workspace MCP reason of `mcp-tools`, and the "not permitted" git line of
`workspace-git-state`.

#### Scenario: Switching mode preserves the prompt prefix

- **WHEN** an owner sends one turn in `default` and the next turn in `bypass` with the same model and effort
- **THEN** the rendered system prompts and receipts of the two Runs are identical, apart from changes that other contracts make
- **AND** no context item mentions the mode

#### Scenario: A read-only turn keeps the prompt prefix

- **WHEN** an owner sends one turn in `default` and the next turn in `read-only` with the same model and effort
- **AND** the Chat has no Workspace MCP server
- **THEN** the rendered system prompts, receipts, and tool declarations of the two Runs are identical, apart from changes that other contracts make
- **AND** no context item mentions the mode

#### Scenario: A read-only turn reports the Workspace MCP tools as removed

- **WHEN** a `default` Run of a bound Chat had the Workspace MCP tool `mcp__docs__search`, and the next turn is `read-only`
- **AND** no checkpoint publishes between the two turns, and no operator MCP server has the server id `docs`
- **THEN** the `read-only` attempt does not declare `mcp__docs__search`
- **AND** its tool availability reminder lists `mcp__docs__search` under `Removed tools:`

#### Scenario: A bypass turn changes the git line without the mode

- **WHEN** the `read` group rejects the git entry, a `default` turn told "git state unavailable: not permitted", and the next turn is `bypass`
- **THEN** the `bypass` turn carries a `git` item with the repository state
- **AND** no context item mentions the mode
