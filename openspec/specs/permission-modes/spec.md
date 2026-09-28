# permission-modes

## Purpose

Let a chat owner choose, per message, whether the Run it starts is governed by the operator's tool-call permission policy or bypasses it, within the modes the operator enables, and show that choice wherever the owner reviews the turn.

## Requirements

### Requirement: Chat sends accept an optional permission mode

Creating a chat message SHALL accept an optional top-level `permissionMode` whose value is `"default"` or `"bypass"`. An omitted `permissionMode` SHALL mean `default`. Any other value, including a blank string, `null`, or a non-string, SHALL be rejected with 400 as a malformed body, creating no message and no Run.

A well-formed mode SHALL be validated against the API process's enabled modes (`tools.permissionModes`) before any message or Run is created. A mode that is not enabled SHALL be rejected with 422 and `code = "permission_mode_not_available"`, creating no message and no Run. Model validation and effort validation SHALL precede mode validation, so an unavailable model or effort is reported without the mode being evaluated.

The mode SHALL be supplied only by the authenticated sender's request. No model output, tool argument, tool result, skill text, or configuration value other than `tools.permissionModes` SHALL select or change a Run's mode.

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

- **WHEN** an owner posts a chat message naming an unavailable model with `permissionMode: "bypass"` while `bypass` is not enabled
- **THEN** the API returns the model's 422 `model_not_available` rather than `permission_mode_not_available`

#### Scenario: A model argument cannot select a mode

- **WHEN** a `default` Run's model submits tool arguments or text claiming `permissionMode: "bypass"`
- **THEN** the Run's mode remains `default` and every call is evaluated against the operator policy

### Requirement: The accepted mode is fixed on its Run

A Run SHALL persist the mode accepted with its triggering message. The persisted mode SHALL NOT change for the life of the Run: a later configuration change, retry, recovery attempt, or change to the composer's selection SHALL NOT alter it. Runs created before this capability SHALL read as `default`.

`RunResponse` and the context receipt response SHALL always include `permissionMode` with the Run's accepted mode. These responses remain owner-scoped under the existing Run and Chat isolation.

#### Scenario: Run reports its accepted mode

- **WHEN** an owner reads a Run accepted with `permissionMode: "bypass"`
- **THEN** its `RunResponse` and its context receipt response report `permissionMode: "bypass"`

#### Scenario: A queued Run keeps its mode across a configuration change

- **WHEN** a Run is accepted with `bypass` and the operator restarts the API with only `["default"]` before the Run finishes
- **THEN** the Run's reported `permissionMode` is still `bypass`

#### Scenario: A historical Run reads as default

- **WHEN** an owner reads a Run created before this capability shipped
- **THEN** its `permissionMode` is `default`

#### Scenario: Another owner cannot read a Run's mode

- **WHEN** user B requests user A's Run or its context receipt
- **THEN** the API returns the existing not-found response and discloses no `permissionMode`

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

A Run's mode SHALL NOT be rendered into the system prompt, recorded in the system-prompt receipt, or authored as a model-visible context item. A mode change between turns SHALL NOT be a cause of effective-context change. The model SHALL learn of a policy decision only through the existing `permission_denied` tool results.

#### Scenario: Switching mode preserves the prompt prefix

- **WHEN** an owner sends one turn in `default` and the next in `bypass` with the same model and effort
- **THEN** both Runs' rendered system prompts and receipts are identical apart from what other contracts change
- **AND** no context item mentions the mode

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

The web composer SHALL offer a permission-mode selector at the left of its toolbar, listing the modes returned by the enabled-mode listing with a title and a one-line description each. It SHALL render nothing when the listing has fewer than two modes or has not loaded successfully.

The selection SHALL start at `default` for every new chat, for every chat the owner navigates to, and after every page load; it SHALL NOT be written to any persistent storage. A send SHALL include `permissionMode: "bypass"` only while `bypass` is selected for that chat, and SHALL omit the field otherwise. While `bypass` is selected, the selector's trigger SHALL use the destructive button style. When a send is rejected with `permission_mode_not_available`, the client SHALL refetch the listing and reset that chat's selection to `default`.

#### Scenario: Selector hidden on a default-only instance

- **WHEN** the listing returns only `default`
- **THEN** the composer shows no permission-mode control and sends no `permissionMode`

#### Scenario: Bypass is sent only when selected

- **WHEN** the owner selects `bypass` and sends a message
- **THEN** the request body carries `permissionMode: "bypass"`
- **AND** after switching back to `default`, the next request body has no `permissionMode`

#### Scenario: Selection does not follow the owner to another chat

- **WHEN** the owner selects `bypass` in one chat and navigates to another chat
- **THEN** the other chat's selector shows `default`
- **AND** reloading the first chat also shows `default`

#### Scenario: Bypass is visibly marked

- **WHEN** `bypass` is selected
- **THEN** the selector's trigger renders in the destructive style

#### Scenario: A withdrawn mode resets the selection

- **WHEN** the operator disabled `bypass` after the listing loaded and the owner sends with `bypass` selected
- **THEN** the send fails with `permission_mode_not_available`, the listing is refetched, and the chat's selection returns to `default`

### Requirement: The usage badge marks a bypassed turn

The owner-facing usage badge of an assistant turn whose `usage` records `permissionMode: "bypass"` SHALL include a `Bypass` segment after the effort segment and before the latency, and the usage detail SHALL show the mode. A turn whose `usage` records no mode SHALL render exactly as before.

#### Scenario: Badge includes the bypass segment

- **WHEN** a turn's usage records a model displayed as `GPT-5`, effort `high`, `permissionMode: "bypass"`, and 900 ms latency
- **THEN** its badge reads `GPT-5 · high · Bypass · 900ms`

#### Scenario: Default turns are unchanged

- **WHEN** a turn's usage records no `permissionMode`
- **THEN** its badge contains no mode segment
