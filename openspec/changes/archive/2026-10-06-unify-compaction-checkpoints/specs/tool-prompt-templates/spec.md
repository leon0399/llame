# Spec Delta

## MODIFIED Requirements

### Requirement: Workers load templates at boot and render each attempt

Run-capable processes SHALL load, validate, and compile templates at boot.
API-only acceptance SHALL require no resolved prompt or catalog. File edits
SHALL require restarting the executing process. Each allowed execution attempt
SHALL freshly resolve owner variables and its worker's current admitted catalog,
then render both prompt surfaces from one safe context. It SHALL hold the
finalized result in memory for that attempt's target-model steps; another attempt SHALL resolve again. Any pre-step checkpoint and the epoch state re-baked with it SHALL be published before this final rendering, under `model-system-prompts`.

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
description. A failed final render SHALL fail preparation before target-model I/O without
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
- **AND** it neither reads a persisted tool catalog nor reuses the failed attempt's prepared attempt context

#### Scenario: File edit without restart

- **WHEN** an operator edits a template while its worker remains running
- **THEN** that worker retains its boot-loaded source
- **AND** a restarted worker uses the new valid source on its next attempt

#### Scenario: Empty real render fails the attempt

- **WHEN** a syntactically valid tool-aware template renders empty for the actual membership
- **THEN** final preparation fails before target-model I/O
- **AND** the scheduled user message and Run remain recorded
- **AND** no availability baseline or canonical attempt context is published

#### Scenario: Two owners share one template

- **WHEN** two owners execute concurrently with the same model and files
- **THEN** each attempt uses only its own projected values
- **AND** neither rendered descriptions nor runtime catalogs are shared through a mutable registry/cache
