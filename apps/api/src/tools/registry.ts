import { searchConversationsTool } from './search-conversations';
import { type Tool } from './types';

/** Every tool the harness knows about (design D2: in-code registry). */
export const TOOLS: readonly Tool[] = [searchConversationsTool];

/**
 * Build the id-keyed registry, validating at import time (fail loud, not at
 * call time — spec scenarios "Unclassified tool cannot register" / "Duplicate
 * tool id cannot register"). An unclassified tool is already unrepresentable
 * in the `Tool` type, but this guard also catches a value that bypassed the
 * type (a future dynamic source, e.g. an MCP-backed adapter per D2) and is
 * exercised directly by tests via an `as Tool` cast. Exported (not just used
 * to build `TOOL_REGISTRY` below) so `registry.spec.ts` tests this exact
 * function rather than a hand-copy that could silently drift from it.
 */
export function buildRegistry(
  tools: readonly Tool[],
): ReadonlyMap<string, Tool> {
  const registry = new Map<string, Tool>();
  for (const tool of tools) {
    if (!tool.classification) {
      throw new Error(
        `Tool registration failed: "${tool.id}" has no classification (SPEC §13.5 requires one).`,
      );
    }
    if (registry.has(tool.id)) {
      throw new Error(`Tool registration failed: duplicate id "${tool.id}".`);
    }
    registry.set(tool.id, tool);
  }
  return registry;
}

export const TOOL_REGISTRY: ReadonlyMap<string, Tool> = buildRegistry(TOOLS);

/** Every registered tool id — instance-config boot validation reads this. */
export function getRegisteredToolIds(): readonly string[] {
  return [...TOOL_REGISTRY.keys()];
}

/**
 * Fail-closed operator availability gate (design D3): the set of tools
 * offered to the model for a turn is ALWAYS `allowlisted ∩ read_only` — no
 * policy-verdict composition exists yet (that seam is #133, parked). Applied
 * in ONE direction here (what to advertise); the other direction (refusing a
 * request for anything not in this set) falls out for free because the model
 * is never given a declaration for an unadvertised tool — see
 * run-execution.service.ts's `experimental_repairToolCall` handling.
 */
export function resolveAdvertisedTools(
  allowed: ReadonlySet<string>,
  candidates: Iterable<Tool> = TOOL_REGISTRY.values(),
): Tool[] {
  return [...candidates].filter(
    (tool) => tool.classification === 'read_only' && allowed.has(tool.id),
  );
}
