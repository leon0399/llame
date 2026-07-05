import { getCurrentTimeTool } from './get-current-time';
import { type BuiltinTool } from './types';

/** Every built-in tool the harness knows about. */
export const BUILTIN_TOOLS: readonly BuiltinTool[] = [getCurrentTimeTool];

/**
 * The **central, code-owned allowlist** of tool names admitted WITHOUT a
 * policy grant (agents-best-practices "compute-only: allow in bounded
 * environment"; claude-code's "centralize the check" over opencode's
 * per-tool inline assert). This is deliberately keyed on the tool NAME, not
 * the tool's self-reported `riskClass` — tagging a tool `read_only` must never
 * be enough to bypass policy (adversarial review, fail-closed invariant). A
 * tool enters this set only by an explicit, reviewed edit here.
 */
export const SAFE_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_current_time',
]);

/**
 * Pre-filter the candidate tools into the set available for a turn
 * (open-webui `get_tools` / opencode-coarse pattern): computed ONCE before the
 * stream, never per-call inside the model loop — so no mid-stream DB work
 * contends for the process's single Postgres connection.
 *
 * `decide(tool)` is the effective-policy verdict (#45, roadmap principle #3):
 * - `'deny'`  → excluded. **Deny overrides everything**, including the safe
 *   allowlist — an admin can revoke even a read-only built-in.
 * - `'allow'` → included, even a non-safe tool (an explicit policy grant).
 * - `'unset'` → no policy matched; fall back to `SAFE_BUILTIN_TOOL_NAMES`.
 *
 * Fail-closed: a tool neither safe-listed nor policy-allowed (and not denied)
 * is excluded — the model never sees it, so there's no denied call to pair a
 * result with. `decide` defaults to `'unset'`, so omitting it yields exactly
 * the safe allowlist (today's behavior).
 */
export type ToolPolicyVerdict = 'allow' | 'deny' | 'unset';

export function resolveAvailableTools(
  candidates: readonly BuiltinTool[],
  decide: (tool: BuiltinTool) => ToolPolicyVerdict = () => 'unset',
): BuiltinTool[] {
  return candidates.filter((tool) => {
    const verdict = decide(tool);
    if (verdict === 'deny') return false;
    if (verdict === 'allow') return true;
    return SAFE_BUILTIN_TOOL_NAMES.has(tool.name);
  });
}
