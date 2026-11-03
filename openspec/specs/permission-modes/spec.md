# permission-modes

## Purpose

Let a chat owner choose, per message, one of three Run permission modes — `default`, `bypass`, or `read-only` — within the modes the operator enables. `default` applies the operator's tool-call permission policy. `bypass` admits each call without an evaluation of the policy. `read-only` admits only reads and plain Workspace entry or exit, and then applies the policy as `default` does. Every mode is reported on the Run and its context receipt, and the turn display marks only a `bypass` turn.

## Requirements

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

### Requirement: The accepted mode is fixed on its Run

A Run MUST store the mode that the API accepted with the request that created the Run. That
request is a chat send or a follow-up request from `turn-actions`. The stored mode MUST NOT change
during the life of the Run. A later configuration change, retry, recovery attempt, or change to
the composer selection MUST NOT change it. A follow-up Run MUST NOT change the mode of an earlier
Run. A Run that the system created before this capability MUST read as `default`.

`RunResponse` and the context receipt response MUST always include `permissionMode` with the
accepted mode of the Run. These responses stay owner-scoped under the current Run and Chat
isolation.

#### Scenario: Run reports its accepted mode

- **WHEN** an owner reads a Run that the API accepted with `permissionMode: "bypass"`
- **THEN** its `RunResponse` and its context receipt response report `permissionMode: "bypass"`

#### Scenario: A queued Run keeps its mode across a configuration change

- **WHEN** the API accepts a Run with `bypass`, and the operator restarts the API with only `["default"]` before the Run ends
- **THEN** the reported `permissionMode` of the Run is still `bypass`

#### Scenario: A historical Run reads as default

- **WHEN** an owner reads a Run that the system created before this capability shipped
- **THEN** its `permissionMode` is `default`

#### Scenario: A follow-up Run has its own mode

- **WHEN** a Run with mode `default` failed, and the owner continues it with `permissionMode: "bypass"`
- **THEN** the Continue Run reports `bypass`
- **AND** the failed Run still reports `default`

#### Scenario: Another owner cannot read a Run's mode

- **WHEN** user B requests the Run of user A or its context receipt
- **THEN** the API returns the current not-found response and discloses no `permissionMode`

### Requirement: Enabled modes are listed for authenticated clients

`GET /api/v1/permission-modes` SHALL return `{ "modes": [{ "value": <mode> }, ...] }` listing the API process's enabled modes in configuration order. Items SHALL carry no display label. The endpoint SHALL require authentication and SHALL return the same list to every authenticated user.

#### Scenario: Default configuration lists one mode

- **WHEN** an authenticated client requests the listing with `tools.permissionModes` omitted
- **THEN** the response is `{ "modes": [{ "value": "default" }] }`

#### Scenario: Enabled bypass is listed in configuration order

- **WHEN** the operator configures `["default", "bypass"]`
- **THEN** the listing returns `default` then `bypass`

#### Scenario: Unauthenticated listing is refused

- **WHEN** a request without a valid session requests the listing
- **THEN** the API returns 401

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

### Requirement: Usage records a bypassed turn

An assistant message's persisted `usage` SHALL include `permissionMode: "bypass"` when the attempt that produced it executed under an effective `bypass` mode, and SHALL omit `permissionMode` otherwise. The effective mode is defined by `tool-call-permissions`; an accepted `bypass` Run executed by a process that does not enable `bypass` records no `permissionMode`. Existing usage SHALL NOT be backfilled. Forks copy the value with the rest of `usage`; public shares and public forks receive no `usage` and therefore no mode.

#### Scenario: A bypassed turn records its mode

- **WHEN** a `bypass` Run completes on a worker that enables `bypass`
- **THEN** its assistant message's `usage` includes `permissionMode: "bypass"`

#### Scenario: A downgraded turn records no mode

- **WHEN** a `bypass` Run completes on a worker whose configuration enables only `default`
- **THEN** its assistant message's `usage` has no `permissionMode`

#### Scenario: A default turn records no mode

- **WHEN** a `default` Run completes
- **THEN** its assistant message's `usage` has no `permissionMode`

#### Scenario: A public share omits the mode

- **WHEN** a visitor reads a public share of a chat containing a bypassed turn
- **THEN** the shared transcript carries no usage and no mode

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

### Requirement: The usage badge marks a bypassed turn

The owner-facing usage badge of an assistant turn whose `usage` records `permissionMode: "bypass"` SHALL include a `Bypass` segment after the effort segment and before the latency, and the usage detail SHALL show the mode. A turn whose `usage` records no mode SHALL render exactly as before.

#### Scenario: Badge includes the bypass segment

- **WHEN** a turn's usage records a model displayed as `GPT-5`, effort `high`, `permissionMode: "bypass"`, and 900 ms latency
- **THEN** its badge reads `GPT-5 · high · Bypass · 900ms`

#### Scenario: Default turns are unchanged

- **WHEN** a turn's usage records no `permissionMode`
- **THEN** its badge contains no mode segment
