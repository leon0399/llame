import { randomUUID } from 'node:crypto';

import { TOOL_REGISTRY } from '../registry';
import { resolveJsonSchema } from '../schema-utils';
import { compileToolPermissionMap } from './compile-permissions';
import { declaredStringProperties } from './declared-fields';
import { PermissionCompileError } from './limits';
import {
  type CompiledPolicy,
  type PermissionMatcher,
  type ToolPermissionMap,
} from './types';

/**
 * Build the immutable per-process policy (openspec/changes/tool-call-permissions
 * D2/D5). Resolves every configured code-owned tool's input schema, fails
 * startup on an incompatible field, compiles all patterns, freezes the policy,
 * and stamps an opaque policy-instance id independent of policy contents.
 *
 * Await this before serving requests or claiming jobs: a rejected promise must
 * abort bootstrap rather than run with a partially compiled policy.
 */
export async function buildToolPermissionPolicy(
  permissions: ToolPermissionMap,
): Promise<CompiledPolicy> {
  await validateCodeOwnedFields(permissions);
  return compileToolPermissionMap(permissions, randomUUID());
}

/** Code-owned fields must exist and be string-capable; a configured MCP field
 *  is validated against its admitted declaration at execution instead. */
async function validateCodeOwnedFields(
  permissions: ToolPermissionMap,
): Promise<void> {
  for (const [toolId, group] of Object.entries(permissions)) {
    if (toolId.startsWith('mcp__')) continue;
    const tool = TOOL_REGISTRY.get(toolId);
    if (tool === undefined) continue;
    const document = await resolveJsonSchema(tool.inputSchema);
    const allowedFields = declaredStringProperties(document);
    assertMatcherFields(toolId, 'allow', group.allow, allowedFields);
    assertMatcherFields(toolId, 'reject', group.reject, allowedFields);
  }
}

function assertMatcherFields(
  toolId: string,
  list: 'allow' | 'reject',
  matcher: PermissionMatcher | undefined,
  allowedFields: ReadonlySet<string>,
): void {
  if (matcher === undefined || matcher === true) return;
  matcher.forEach((clause, index) => {
    if (!('field' in clause)) return;
    if (!allowedFields.has(clause.field)) {
      throw new PermissionCompileError(
        `tools.permissions.${toolId}.${list}[${index}]`,
        `field "${clause.field}" is not a declared string input of tool "${toolId}"`,
      );
    }
  });
}
