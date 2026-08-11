## 1. Permission Grammar and Configuration

- [x] 1.1 Add failing unit cases for the exact `mcp__<configured-server>__*` form, offline validation, undeclared/noncanonical servers, bare/partial/mid-string/multiple/server wildcards, and similarly prefixed server boundaries.
- [x] 1.2 Implement one shared raw-array ID matcher using exact equality or the validated terminal-wildcard prefix; add no policy object or glob dependency, and manufacture or deduplicate no candidates.
- [x] 1.3 Add failing registry coverage and reserve the `mcp__` prefix against code-owned tool registration.
- [x] 1.4 Update resolved config types, JSON Schema descriptions, and config-loader tests so wildcard validation remains connection-independent and fail-closed.

## 2. Runtime Expansion and Lifecycle

- [x] 2.1 Add failing MCP runtime tests proving candidate inventory is permission-independent, refused identities are absent, and a fresh offline process returns no synthetic candidates for exact or namespace permissions.
- [x] 2.2 Make the process-local MCP snapshot expose the complete safely admitted current inventory or last admitted unavailable identities without consulting `tools.allowed`.
- [x] 2.3 Retain only the last completely published admitted exact-id set across disconnects; prove executors/declarations withdraw immediately and successful complete discovery atomically replaces the remembered set, removing omitted/refused identities.
- [x] 2.4 Add disconnect/reconnect/refresh tests proving retained identities transition unavailable/available while authoritative omission becomes Removed without stale advertisement or execution.

## 3. Immutable Run Boundary

- [x] 3.1 Add failing turn-catalog and effective-context tests proving source-inventory-first exact/wildcard parity, one-pass boolean filtering, collision preservation, filtered exact-only canonical manifests/declarations, refused/unmatched absence, and no permission-pattern leakage.
- [x] 3.2 Apply the shared ID-only matcher during API chat acceptance and bind only the filtered exact Run snapshot without re-evaluating configuration during retries.
- [x] 3.3 Extend API/worker integration coverage for provider advertisement, receipt exactness, declaration-hash rebinding, unavailable execution settlement, and process-local reconnect behavior.

## 4. Operator Contract and Release Records

- [x] 4.1 Update `docs/mcp-tools.md`, `apps/api/AGENTS.md`, and `apps/api/llame.config.json.example` with the wildcard syntax, filter-only exact/wildcard semantics, exact-id safer default, future-tool authority risk, process-local offline limitation, and mixed-version rollout/rollback order.
- [x] 4.2 Update affected code comments and config descriptions that currently define `tools.allowed` as exact-id-only.
- [x] 4.3 Add the dated `CHANGELOG.md` entry and update `ROADMAP.md` only if #318 is represented there.

## 5. Verification

- [x] 5.1 Run focused config, MCP id/runtime, turn-catalog, effective-context, chat-loop, snapshot execution, and MCP operator integration suites.
- [x] 5.2 Run API lint, type-check, test, and build scripts identified from `package.json`, then root formatting checks.
- [x] 5.3 Run `openspec validate allow-mcp-tool-namespace-wildcards --strict` and reconcile implementation behavior with every delta scenario before requesting review.
