## Purpose

Provide operator-customizable file descriptions for llame-owned tools, rendered
with the system prompt from each worker execution attempt's safe current context.

## ADDED Requirements

### Requirement: llame-owned descriptions are complete file templates

Every registered llame-owned tool SHALL have a packaged complete Markdown
description. System and description templates SHALL share the existing template
language, allowed variables, neutralization, omission, bounded-iteration, and
single-pass rendering rules. Selection SHALL follow `instance-config`
precedence. Templates SHALL change only description text, never tool identity,
input schemas, parameter descriptions, classification, permissions, or results.
MCP descriptions SHALL remain opaque source-authored text.

#### Scenario: Packaged descriptions cover the registry

- **WHEN** a worker starts without overrides
- **THEN** it loads a complete packaged description for every llame-owned tool
- **AND** its compiled runtime can load those files independently of the source tree

#### Scenario: Both prompt surfaces share variables

- **WHEN** the system prompt and an admitted description reference the same allowed path
- **THEN** they receive the same resolved value and neutralization for that attempt
- **AND** substituted template-looking owner text is never evaluated again

#### Scenario: MCP text is not a template

- **WHEN** an MCP description contains `{{user.email}}`
- **THEN** it remains literal text
- **AND** the worker does not substitute owner data into it

### Requirement: Tool predicates are absent-safe membership checks

Both template kinds SHALL permit `tools.<exact-id>` as an `if`/`unless`
subject. It SHALL be true exactly for an admitted declaration in the current
attempt's worker catalog, after existing allowlist, classification, capability,
collision, timeout, and schema admission. Every absent id SHALL be false,
including an unknown native tool or unconfigured/undiscovered MCP tool.
Absence SHALL NOT fail boot or initiate discovery.

Validate exact-id syntax and parsed path structure, not registry membership.
Direct value emission, wildcard identity, iteration, bare `tools`, deeper
properties, parent traversal, and prototype traversal SHALL remain invalid.
Predicates SHALL use explicit own boolean values. No additional feature-check
namespace SHALL be introduced. Per-call permission policy SHALL remain separate.

#### Scenario: A shared template mentions an uninstalled tool

- **WHEN** a valid template checks `tools.grep` and no grep tool is registered
- **THEN** worker startup succeeds and the predicate evaluates false
- **AND** no tool is created or enabled by the reference

#### Scenario: An MCP server is not configured

- **WHEN** a predicate names a syntactically valid exact MCP id with no configured server
- **THEN** validation succeeds and the predicate evaluates false
- **AND** no network lookup is performed

#### Scenario: Tool visibility does not grant invocation permission

- **WHEN** a tool is admitted but every call is rejected by its permission policy
- **THEN** its predicate is true
- **AND** invoking it still produces the existing non-fatal permission rejection

#### Scenario: Predicate cannot expose source objects

- **WHEN** a template emits `{{tools.read}}` or traverses `tools.read.description`
- **THEN** startup fails naming the unsupported construct without prompt contents

### Requirement: Workers load templates at boot and render each attempt

Run-capable processes SHALL load, validate, and compile templates at boot.
API-only acceptance SHALL require no resolved prompt or catalog. File edits
SHALL require restarting the executing process. Each allowed execution attempt
SHALL freshly resolve owner variables and its worker's current admitted catalog,
then render both prompt surfaces from one safe context. It SHALL hold the
result in memory for that attempt's steps; another attempt SHALL resolve again.

No tool catalog, schema, template, or rendered description SHALL be persisted
as execution context in the database, queue, receipts, events, or context
metadata. System-only receipts and the minimal committed-turn availability
record defined by the related capabilities SHALL be the permitted persistence.
Ordinary tool calls/results and authored system/reminder text SHALL retain their
existing history/operational roles.

Syntax and structural validation SHALL occur at boot. Templates without tool
predicates SHALL retain existing empty-render probes. For tool-aware templates,
probe emptiness caused by absent tools SHALL NOT reject startup; actual attempt
rendering SHALL require a non-empty system prompt and every admitted
description. A failed render SHALL fail preparation before provider I/O without
silently falling back, removing a tool, or rerendering a smaller catalog.
Diagnostics SHALL contain only safe field/model/tool identifiers and static
reasons, never prompt contents, owner values, or private host paths.

#### Scenario: Queue delay changes owner inputs

- **WHEN** an owner changes personalization after scheduling but before execution
- **THEN** the worker renders that attempt using the current owner projection
- **AND** both prompt surfaces agree on it

#### Scenario: Retry uses a different worker

- **WHEN** an infrastructure retry starts on a worker with newer boot-loaded templates or a different current catalog
- **THEN** it freshly resolves and renders its own attempt context
- **AND** it neither reads a persisted tool catalog nor reuses failed-attempt model context

#### Scenario: File edit without restart

- **WHEN** an operator edits a template while its worker remains running
- **THEN** that worker retains its boot-loaded source
- **AND** a restarted worker uses the new valid source on its next attempt

#### Scenario: Empty real render fails the attempt

- **WHEN** a syntactically valid tool-aware template renders empty for the actual membership
- **THEN** preparation fails before provider I/O
- **AND** the scheduled user message and Run remain recorded
- **AND** no availability baseline or canonical attempt context is published

#### Scenario: Two owners share one template

- **WHEN** two owners execute concurrently with the same model and files
- **THEN** each attempt uses only its own projected values
- **AND** neither rendered descriptions nor runtime catalogs are shared through a mutable registry/cache

### Requirement: Packaged cross-tool guidance follows membership

Packaged descriptions recommending another tool SHALL gate that recommendation
on its predicate while preserving independent safety and result-limit text.
This SHALL include Bash-to-edit and search-to-conversation-read advice.

#### Scenario: Reader is absent

- **WHEN** search is admitted and `conversation_read` is absent
- **THEN** its description omits the reader invocation recommendation
- **AND** it still identifies search excerpts as bounded and untrusted

#### Scenario: Edit is available in a retry

- **WHEN** a fresh retry admits edit alongside Bash
- **THEN** that retry's Bash description includes the edit recommendation
- **AND** the failed attempt supplies no earlier description or reminder to its model context
