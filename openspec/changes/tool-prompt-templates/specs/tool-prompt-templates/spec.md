## Purpose

Provide operator-customizable file-based descriptions for llame-owned tools,
rendered from the same safe context as the system prompt and frozen per Run.

## ADDED Requirements

### Requirement: llame-owned tool descriptions are complete file templates

Every registered llame-owned tool SHALL have one packaged complete Markdown
description template. The selected description SHALL use the same template
language, context projection, escaping, omission, bounded-iteration, and
single-pass rendering rules as system prompts. Template selection SHALL follow
the `instance-config` tool prompt file precedence. Templates SHALL change only
the model-facing tool description, never its id, input schema, parameter
descriptions, classification, execution policy, or output contract. MCP-provided
descriptions SHALL remain opaque text and SHALL NOT be evaluated as templates.

#### Scenario: Packaged descriptions cover the current registry

- **WHEN** an instance starts without tool prompt overrides
- **THEN** each registered llame-owned tool resolves its packaged description
- **AND** disabling a tool does not require deleting its template

#### Scenario: System and description share owner context

- **WHEN** both templates reference the same allowed model, owner, chat, or temporal path
- **THEN** they receive the same resolved value and neutralization rules for that Run
- **AND** owner text containing template syntax is emitted literally without another evaluation

#### Scenario: Raw settings are not exposed

- **WHEN** an operator template attempts to access a configuration record, credential, private host path, or undeclared setting
- **THEN** startup fails with a safe configuration error
- **AND** neither prompt kind gains access through arbitrary property traversal

#### Scenario: MCP description contains template syntax

- **WHEN** an admitted MCP description contains `{{user.email}}`
- **THEN** the model-facing description preserves those characters literally
- **AND** no owner value is substituted into the server-provided text

### Requirement: Tool predicates describe the accepted catalog

Both system and tool templates SHALL support `tools.<exact-tool-id>` as a
boolean subject of `if` and `unless`. A predicate SHALL be true exactly when
that canonical id has an admitted declaration in the accepted Run catalog,
after existing availability/admission filtering. Registered-but-disabled,
unavailable, collision-refused, and schema-refused tools SHALL be false.
Call-permission policy SHALL NOT affect the predicate. Execution SHALL continue
to enforce current invocation permissions and source availability independently.

Code-owned predicate names SHALL identify registered tools. MCP predicate names
SHALL satisfy the canonical exact-id grammar and name a configured server,
without requiring live discovery at boot. A valid but undiscovered MCP id SHALL
be false. Wildcards, unknown code-owned names, direct value emission, iteration
over tool predicates, the bare `tools` namespace, deeper traversal, and parent or
prototype traversal SHALL fail template validation. Tool predicates SHALL be
resolved from explicit own boolean properties, never source or configuration
objects.

#### Scenario: Another admitted tool changes guidance

- **WHEN** a Bash description guards its edit recommendation with `tools.edit`
- **THEN** the recommendation appears exactly when `edit` is admitted to the Run
- **AND** the system template observes the same predicate value

#### Scenario: Visible tool has no matching permission

- **WHEN** a tool is admitted but its call-permission policy rejects every call
- **THEN** its template predicate remains true
- **AND** an invocation receives the existing `permission_denied` result without an effect

#### Scenario: Remote state changes after acceptance

- **WHEN** an MCP tool disconnects after a Run is accepted with its predicate true
- **THEN** that Run retains its prompt, descriptions, and predicate-derived wording
- **AND** a failed invocation follows existing unavailable-tool handling
- **AND** the next accepted Run resolves the changed catalog

#### Scenario: Configured MCP tool is offline at startup

- **WHEN** a predicate names a canonical exact id for a configured offline MCP server
- **THEN** template validation does not require a network lookup
- **AND** the predicate is false until that id is admitted in a subsequent Run

#### Scenario: Predicate cannot become an inventory or object lookup

- **WHEN** a template emits `{{tools.read}}`, iterates `tools`, or traverses `tools.read.description`
- **THEN** startup fails naming the offending construct without prompt contents

### Requirement: Rendered descriptions bind atomically with the system prompt

The system SHALL determine admitted membership before rendering either prompt
surface and SHALL render both from one owner-scoped context. It SHALL compute
declaration hashes, available-entry hashes, and effective-context hashes from
the final rendered descriptions. It SHALL persist those descriptions with the
system prompt in the accepted Run's immutable snapshot, before provider I/O.
Retries and delayed execution SHALL reuse those strings without rereading files,
owner settings, digest state, or catalogs. Rendering SHALL NOT mutate a shared
registry or reuse another owner's rendered text.

Startup SHALL validate syntax, paths, file contents, and the existing
owner/digest render probes with both absent and present referenced tools. A
description's own predicate SHALL be true in its boot probes. Actual Run
acceptance SHALL independently reject an empty system prompt or admitted tool
description. A render failure SHALL reject the entire acceptance atomically,
with no partial user message, Run, snapshot binding, or provider request. It
SHALL NOT remove a tool and rerender remaining descriptions. Errors SHALL reveal
only the model/tool id, configuration field, and a safe static reason; they
SHALL NOT reveal source or rendered prompt contents, owner values, or host paths.

#### Scenario: Two owners share template files

- **WHEN** two owners concurrently accept Runs using one model and the same files
- **THEN** each snapshot contains only its owner's projected values
- **AND** neither owner can retrieve the other's snapshot or rendered descriptions

#### Scenario: Override changes after acceptance

- **WHEN** an operator edits a description file and restarts processes after a Run is accepted
- **THEN** that Run and any permitted retry use its stored description
- **AND** newly accepted Runs use the reloaded template

#### Scenario: A mixed tool combination renders empty

- **WHEN** a template passes the none/all boot probes but renders empty for the actual admitted tool combination
- **THEN** acceptance fails before any user message or Run is committed
- **AND** the system neither falls back to another file nor advertises a partial catalog

#### Scenario: Rendered description hashes are consistent

- **WHEN** owner values or tool predicates change the description for a new Run
- **THEN** the declaration, tool hash, content hash, and available-entry declaration hash describe the rendered text
- **AND** declaration-only drift does not create an availability transition reminder

### Requirement: Packaged cross-tool advice follows tool predicates

Packaged description guidance that recommends invoking another tool SHALL be
conditional on that tool's predicate. Omitting a recommendation SHALL preserve
the description's independent safety and result-limit statements. This rule
SHALL cover Bash's preference for native edit and conversation search's
recommendation to inspect a result with `conversation_read`.

#### Scenario: Reader is absent

- **WHEN** conversation search is admitted and `conversation_read` is not
- **THEN** the search description does not recommend invoking the absent reader
- **AND** it still identifies search excerpts as bounded, untrusted context

#### Scenario: Edit is available again

- **WHEN** a later accepted Run admits both Bash and edit
- **THEN** the Bash description includes its native-edit recommendation
- **AND** the earlier Run's description stays unchanged
