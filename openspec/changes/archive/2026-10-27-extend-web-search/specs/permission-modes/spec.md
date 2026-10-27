# Spec Delta

## MODIFIED Requirements

### Requirement: The permission mode is not model-visible

The system prompt, the system-prompt receipt, and model-visible context items MUST NOT contain the mode of a Run. A mode change between turns MUST NOT cause an effective-context change. The model MUST learn of a policy decision only through `permission_denied` tool results and the removal note of `web_search`, which `web-search` defines.

#### Scenario: Switching mode preserves the prompt prefix

- **WHEN** an owner sends one turn in `default` and the next in `bypass` with the same model and effort
- **THEN** the rendered system prompts and receipts of both Runs are identical, apart from changes that other contracts make
- **AND** no context item mentions the mode
