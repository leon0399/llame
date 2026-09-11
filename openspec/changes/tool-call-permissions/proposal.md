## Why

Issue [#763](https://github.com/leon0399/llame/issues/763) needs operator-controlled decisions for individual tool calls. The existing `tools.allowed` list controls availability, but cannot reject a particular command or locator while leaving the tool usable.

## What Changes

- Add startup-loaded `tools.permissions`, grouped by tool, with allow and reject rules. Matching rejects win; otherwise any matching allow permits the call; no match rejects.
- Support whole-tool decisions, one named string field, and rejection across all submitted string values recursively. All-fields rules cannot allow a call.
- Match literal substrings or explicit bounded regex. Bash command literals treat whitespace runs as `\s+`; no shell parsing occurs. Resource matching uses logical locators rather than private backing paths.
- Check permissions at the shared tool execution boundary. Return `permission_denied` as a tool observation and continue the Run without invoking the rejected tool.
- Keep `tools.allowed`, capability admission, immutable model catalogs, authentication, RLS, and native effect/retry fencing independent and mandatory. Permission rules do not change tool visibility.
- Freeze policy per executor process. Restart applies new permissions to subsequent attempts, including unfinished older Runs; retain safe policy-decision provenance outside model context.
- Ship an explicit portable default map for the seven current code-owned tools, with common destructive-command and credential-locator rejects. Keep personal toolchains, MCP grants, skill rules, and repository workflow restrictions local.
- **BREAKING:** every call must pass the execution policy. Omitted permissions select the built-in map; an explicit map replaces it completely, and `{}` rejects every call. MCP tools require explicit permission groups. Update examples and fixtures atomically.

## Capabilities

### New Capabilities

- `tool-call-permissions`: matching, decision precedence, execution admission, restart semantics, and safe decision provenance.

### Modified Capabilities

- `instance-config`: add the closed, restart-applied permission configuration and validate patterns before serving or claiming work.
- `tool-calling`: distinguish availability from execution permission; persist non-fatal rejections and decision metadata without altering replayed observations or effect recovery.

## Non-goals

The `ask` tool and approval suspension belong to [#778](https://github.com/leon0399/llame/issues/778), blocked by this foundation. This change does not add personal settings, non-overridable operator policy tiers, a sandbox, shell parsing, command-effect analysis, HTTP fetching or domain selectors, boolean condition expressions, permission-driven tool hiding, or an operator UI. Operator settings are intended to become overridable personal defaults in a later proposal.

## Impact

Affected areas are API configuration/schema, the shared tool runner, Run tool-result persistence, API tool tests/fixtures, and operator documentation. A bounded regex engine is added to the API. No new endpoint or database table is required: decision metadata uses existing owner-scoped tool events and stored tool parts. A proposal-only branch precedes implementation and final spec sync/archive.
