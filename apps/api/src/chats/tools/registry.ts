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
 * A tool is available iff it is in the central safe allowlist, OR
 * `isAllowedByPolicy` explicitly admits it (the #45 seam for non-safe tools).
 * Fail-closed: anything neither safe-listed nor policy-allowed is excluded, so
 * the model never even sees it — there is no denied call to pair a result
 * with. `isAllowedByPolicy` defaults to deny, so omitting it yields exactly
 * the safe allowlist.
 */
export function resolveAvailableTools(
  candidates: readonly BuiltinTool[],
  isAllowedByPolicy: (tool: BuiltinTool) => boolean = () => false,
): BuiltinTool[] {
  return candidates.filter(
    (tool) => SAFE_BUILTIN_TOOL_NAMES.has(tool.name) || isAllowedByPolicy(tool),
  );
}
