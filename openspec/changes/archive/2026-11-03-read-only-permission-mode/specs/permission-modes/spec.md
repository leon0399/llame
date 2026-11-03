## MODIFIED Requirements

### Requirement: Chat sends accept an optional permission mode

The API MUST accept an optional top-level `permissionMode` on a chat message request. Its value MUST be `"default"`, `"bypass"`, or `"read-only"`. An omitted `permissionMode` MUST mean `default`. The API MUST reject any other value with 400 as a malformed body. That includes a blank string, `null`, and a non-string. A 400 MUST create no message and no Run.

The API MUST validate a well-formed mode against the enabled modes of the API process (`tools.permissionModes`). It MUST do this before it creates a message or a Run. The API MUST reject a mode that is not enabled with 422 and `code = "permission_mode_not_available"`. That rejection MUST create no message and no Run. Model validation and effort validation MUST occur before mode validation. Thus the API MUST report an unavailable model or effort without an evaluation of the mode.

The mode MUST come only from the request of the authenticated sender. Model output, tool arguments, tool results, and skill text MUST NOT select or change the mode of a Run. A configuration value other than `tools.permissionModes` MUST NOT affect it.

#### Scenario: Omitted mode resolves to default

- **WHEN** an authenticated owner posts a chat message without `permissionMode`
- **THEN** the API creates the message and a Run whose mode is `default`

#### Scenario: Enabled bypass is accepted

- **WHEN** the operator enables `["default", "bypass"]` and an owner posts a chat message with `permissionMode: "bypass"`
- **THEN** the API creates the message and a Run whose mode is `bypass`

#### Scenario: Disabled bypass creates nothing

- **WHEN** the operator enables only `["default"]` and an owner posts a chat message with `permissionMode: "bypass"`
- **THEN** the API returns 422 with `code = "permission_mode_not_available"`
- **AND** it creates no chat, message, or Run and enqueues no execution

#### Scenario: Unknown mode is a malformed body

- **WHEN** an owner posts a chat message with `permissionMode: "yolo"`
- **THEN** the API returns 400 and creates no message or Run

#### Scenario: Unavailable model short-circuits mode validation

- **WHEN** an owner posts a chat message that names an unavailable model with `permissionMode: "bypass"`, and `bypass` is not enabled
- **THEN** the API returns the 422 `model_not_available` of the model, not `permission_mode_not_available`

#### Scenario: A model argument cannot select a mode

- **WHEN** the model of a `default` Run submits tool arguments or text that claim `permissionMode: "bypass"`
- **THEN** the mode of the Run stays `default`, and the operator policy decides each call

#### Scenario: Enabled read-only is accepted

- **WHEN** the operator enables `["default", "read-only"]` and an owner posts a chat message with `permissionMode: "read-only"`
- **THEN** the API creates the message and a Run whose mode is `read-only`

#### Scenario: Disabled read-only creates nothing

- **WHEN** the operator enables only `["default", "bypass"]` and an owner posts a chat message with `permissionMode: "read-only"`
- **THEN** the API returns 422 with `code = "permission_mode_not_available"`
- **AND** it creates no chat, message, or Run and enqueues no execution

### Requirement: The permission mode is not model-visible

The system prompt, the system-prompt receipt, and model-visible context items MUST NOT contain the mode of a Run. A change of mode between turns MUST NOT be a cause of an `effective-context-change` item. But a `read-only` attempt has no Workspace MCP declaration, and the tool availability reminder reports that change. The model MUST learn of a policy decision only from `permission_denied` results, the `web_search` removal note, that reminder, and the Workspace MCP reason of `mcp-tools`.

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

### Requirement: The composer offers the enabled modes per chat

The web composer MUST show a permission-mode selector at the left of its toolbar. The selector MUST list the modes from the enabled-mode listing, each with a title and a one-line description. The composer MUST show no selector when the listing has fewer than two modes or did not load.

The selection MUST start at `default` for each new chat, for each chat that the owner opens, and after each page load. The client MUST NOT write the selection to persistent storage. A send MUST include `permissionMode` with the selected mode when that mode is not `default`. A send MUST NOT include `permissionMode` while `default` is selected. While `bypass` is selected, the trigger of the selector MUST use the destructive button style. For each other mode, the trigger MUST NOT use that style. When the API rejects a send with `permission_mode_not_available`, the client MUST fetch the listing again and set the selection of that chat to `default`.

#### Scenario: Selector hidden on a default-only instance

- **WHEN** the listing returns only `default`
- **THEN** the composer shows no permission-mode control and sends no `permissionMode`

#### Scenario: Bypass is sent only when selected

- **WHEN** the owner selects `bypass` and sends a message
- **THEN** the request body carries `permissionMode: "bypass"`
- **AND** after the owner selects `default` again, the next request body has no `permissionMode`

#### Scenario: Selection does not follow the owner to another chat

- **WHEN** the owner selects `bypass` in one chat and then opens another chat
- **THEN** the selector of the other chat shows `default`
- **AND** after a reload, the first chat also shows `default`

#### Scenario: Bypass is visibly marked

- **WHEN** `bypass` is selected
- **THEN** the trigger of the selector uses the destructive style

#### Scenario: A withdrawn mode resets the selection

- **WHEN** the operator disabled `bypass` after the listing loaded, and the owner sends with `bypass` selected
- **THEN** the send fails with `permission_mode_not_available`, the client fetches the listing again, and the selection of the chat returns to `default`

#### Scenario: Read-only is sent when selected

- **WHEN** the listing returns `default` and `read-only`, and the owner selects `read-only` and sends a message
- **THEN** the request body carries `permissionMode: "read-only"`
- **AND** the trigger of the selector does not use the destructive style
