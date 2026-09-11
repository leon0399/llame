import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import {
  type CompiledPolicy,
  type PermissionGroup,
} from '../tools/permissions/types';

/** The seven current code-owned tools, permissively allowed for fixtures. */
const PERMISSIVE_TOOL_IDS = [
  'bash',
  'read',
  'edit',
  'write',
  'knowledge_search',
  'search_conversations',
  'conversation_read',
] as const;

/**
 * A fully permissive compiled policy for execution fixtures: every code-owned
 * tool is allowed with no rejects, plus any extra exact tool ids a suite needs
 * (typically MCP tools). Suites that exercise policy behavior build their own
 * explicit map instead.
 */
export function compileTestPermissionPolicy(
  extraToolIds: ReadonlyArray<string> = [],
): CompiledPolicy {
  const groups: Record<string, PermissionGroup> = {};
  for (const id of [...PERMISSIVE_TOOL_IDS, ...extraToolIds]) {
    groups[id] = { allow: true };
  }
  return compileToolPermissionMap(groups, 'test-policy');
}
