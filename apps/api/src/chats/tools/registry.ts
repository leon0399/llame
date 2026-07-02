import { getCurrentTimeTool } from './get-current-time';
import { listTodosTool } from './list-todos';
import { recallTool } from './recall';
import { rememberTool } from './remember';
import { searchConversationsTool } from './search-conversations';
import { writeTodosTool } from './write-todos';
import { type BuiltinTool } from './types';

/** Every built-in tool the harness knows about. */
export const BUILTIN_TOOLS: readonly BuiltinTool[] = [
  getCurrentTimeTool,
  searchConversationsTool,
  rememberTool,
  recallTool,
  listTodosTool,
  writeTodosTool,
];

/**
 * The **central, code-owned allowlist** of tool names admitted WITHOUT a
 * policy grant (agents-best-practices "compute-only: allow in bounded
 * environment"; claude-code's "centralize the check" over opencode's
 * per-tool inline assert). This is deliberately keyed on the tool NAME, not
 * the tool's self-reported `riskClass` — tagging a tool `read_only` must never
 * be enough to bypass policy (adversarial review, fail-closed invariant). A
 * tool enters this set only by an explicit, reviewed edit here.
 *
 * Members are READ-ONLY and own-scope. A WRITE tool never belongs here
 * (agents-best-practices "write internal record: policy allowlist") — a write
 * stays default-deny and is admitted only by an explicit policy `allow` (Tier-B)
 * or the operator's `TOOLS_ENABLED` opt-in, so an operator decides whether
 * agents may persist data. This holds even for a "low-risk" write like the
 * todo plan: `write_todos` is replace-all (delete-then-reinsert), STRICTLY more
 * destructive than the append-only `remember`, so if `remember` is gated,
 * `write_todos` must be too (consistent risk ordering).
 */
export const SAFE_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_current_time',
  // Read-only, scoped to the user's OWN data by injected context + RLS.
  'search_conversations',
  // Read-only recall of the user's own durable memories.
  'recall',
  // Read-only view of the chat's todo plan.
  'list_todos',
  // NOTE: the WRITE tools `remember` and `write_todos` are deliberately NOT
  // here — default-deny, enabled via a policy allow or `TOOLS_ENABLED`.
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
