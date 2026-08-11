## Why

`tools.allowed` requires one exact entry per MCP tool, which makes enabling a server-owned namespace repetitive and forces configuration churn whenever that server adds another read-only tool. #318 adds one deliberately narrow namespace permission while making its security cost explicit: the server operator can add executable tools without another llame configuration change.

## What Changes

- Accept `mcp__<configured-server>__*` in `tools.allowed` as the only wildcard form; reject bare, partial, mid-string, multiple, server-name, malformed, noncanonical, and unconfigured-server patterns at startup without requiring live discovery.
- Treat a namespace wildcard as the operator's read-only attestation for every current and future declaration safely admitted from exactly that MCP server. MCP annotations still grant no authority.
- Treat both exact MCP entries and namespace entries as boolean permission predicates over tool IDs in the safely admitted process-local inventory; neither permission form creates, expands, or deduplicates effective-context candidates. Use one shared matcher over the raw boot-validated `tools.allowed` strings: exact equality or a terminal-wildcard ID prefix.
- Reserve the `mcp__` tool-ID prefix for MCP-generated tools so a namespace permission cannot authorize a bundled tool with an MCP-shaped ID.
- Keep every provider-facing, availability, receipt, snapshot, persistence, and execution-binding surface exact-ID-only. Wildcard patterns are configuration policy, never model context or durable tool identities.
- Preserve immediate callable-catalog withdrawal on disconnect while retaining the last completely admitted exact source inventory for unavailable/reconnected disclosure; stale executors and declarations remain unusable. Successful complete discovery authoritatively replaces that inventory, so omitted or newly refused tools become removed. A fresh process invents no identities during an offline start, even when an exact permission names one.
- Keep unmatching and admission-refused discoveries invisible. General globs, deny rules, wildcard precedence, code-owned wildcards, all-server wildcards, and allow/ask/deny permissions remain out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `instance-config`: Validate exact tool ids or the single canonical configured-MCP namespace wildcard form without requiring server discovery.
- `tool-calling`: Make exact and namespace permissions consistent filters over source-owned inventory while binding only filtered exact eligible tool identities and declarations into each Run.
- `mcp-tools`: Define namespace-wide operator read-only attestation, exact-boundary matching, and disconnect/reconnect behavior without exposing patterns or stale declarations.

## Impact

- `apps/api/src/instance-config`: configuration parsing, raw allowlist validation, JSON Schema descriptions, and boot-validation tests.
- `apps/api/src/tools`, `apps/api/src/mcp`, `apps/api/src/chats`, and `apps/api/src/runs`: shared ID matching across catalog admission, availability, immutable Run binding, execution rebinding, and process-local reconnect state.
- Operator documentation and `llame.config.json` example: wildcard syntax, future-tool authority risk, and exact-ID alternative.
- No public API, provider tool-id grammar, database schema, persisted snapshot shape, MCP transport, or dependency change.
