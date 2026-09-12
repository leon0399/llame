## Why

llame's tool descriptions are TypeScript strings, so operators cannot customize
them like system prompts and their cross-tool guidance cannot follow the Run's
available tools. Move llame-owned descriptions into Markdown templates using the
existing system-prompt renderer and one shared, owner-scoped render context.

## What Changes

- D1: Package one complete description template for each llame-owned tool.
  Input schemas, parameter descriptions, execution policy, and tool results stay
  owned by code or their existing producers.
- D2: Resolve each tool independently through
  `models[].toolPromptFiles[toolId]` -> `tools.promptFiles[toolId]` -> packaged
  default. Overrides are whole files, operator-managed, and restart-applied.
- D3: Give system and tool templates the same allowlisted model, owner, chat,
  and temporal variables, plus conditional-only `tools.<id>` predicates.
  A predicate is true exactly when that id is admitted to the accepted Run's
  catalog. Call permissions remain evaluated at execution.
- D4: Admit candidates first, render both prompt surfaces from the same context,
  then hash and bind the complete result. Retries use the stored descriptions.
- D5: Separate the packaged code-owned declaration's compatibility hash from its
  rendered model-facing description. Operator edits can change future wording
  without invalidating queued Runs; executor or packaged-contract drift still
  fails closed. MCP descriptions and their existing binding checks are retained.
- D6: Gate existing recommendations to use another tool on that tool's predicate.
  This covers the current `bash` -> `edit` and `search_conversations` ->
  `conversation_read` guidance. It does not add a `grep` tool.
- **BREAKING**: New accepted Runs require the source-contract binding metadata.
  Cut over API and worker processes together after draining active Runs; retain
  historical receipts without fabricating missing metadata.

## Capabilities

### New Capabilities

- `tool-prompt-templates`: Packaged descriptions, shared rendering, tool
  predicates, validation, and owner-isolated per-Run wording.

### Modified Capabilities

- `instance-config`: Instance-wide and per-model tool prompt file maps, and the
  shared template allowlist including tool predicates.
- `model-system-prompts`: Shared tool predicates and immutable binding of both
  rendered descriptions and code-owned source-contract hashes.
- `tool-calling`: Compare code-owned source contracts independently of rendered
  wording while preserving dynamic-source declaration checks.

## Impact

The API owns configuration loading, the existing Handlebars validator/context,
catalog construction, description rendering, and snapshot persistence. Workers
verify source-contract bindings and send the stored descriptions. The database
adds private snapshot binding metadata; existing receipt consumers already
display the exact descriptions. No new template dependency or UI editor is
needed.

Implementation updates `apps/api/src/instance-config`, `src/prompts`,
`src/tools`, `src/knowledge/knowledge-tools.ts`, `src/chats/turn-context.ts`,
`src/runs`, the snapshot schema/migration, and packaged prompt assets. Focused
integration tests cover cross-owner isolation, queue delay/retry, template
changes, and code-owned/MCP drift.

This is a local proposal draft. A tracking issue must be linked before
publication and implementation; no issue is created by drafting these files.
The active `tool-search` proposal is a coordination point, not a dependency:
this change uses the catalog admitted by current code and adds no deferred-tool
or per-step activation semantics.
