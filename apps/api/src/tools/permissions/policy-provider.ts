import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { GREP_SCOPES_FIELD } from '../grep-admission';
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

const logger = new Logger('ToolPermissions');

/**
 * Evaluator identity recorded once in startup diagnostics so a stored decision's
 * policy id can be correlated with the process that produced it. Bump on any
 * matching-semantics change.
 */
export const PERMISSION_EVALUATOR_VERSION =
  're2js-2.8.6/tool-call-permissions-v1';

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
  const policy = compileToolPermissionMap(permissions, randomUUID());
  logger.log(
    `Tool permission policy ${policy.id} compiled (evaluator ${PERMISSION_EVALUATOR_VERSION}).`,
  );

  return policy;
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

    // `grep` evaluates once per scope with `scopes` replaced by one projected
    // prefix string, so the array-valued input is the one declared exception
    // (tool-call-permissions, "Grep scopes are admitted per scope").
    const allowedFields =
      toolId === 'grep'
        ? new Set([...declaredStringProperties(document), GREP_SCOPES_FIELD])
        : declaredStringProperties(document);

    assertMatcherFields(toolId, 'allow', group.allow, allowedFields);
    assertMatcherFields(toolId, 'reject', group.reject, allowedFields);
  }
}

/**
 * The path parameter each tool decides on with a Machine locator (design D7).
 * A regex on one of these that is anchored at a bare root — `^/` — could only
 * ever miss, because every Machine value is matched as its `machine://`
 * locator; it fails startup instead of silently never matching.
 */
const PATH_FIELDS = {
  read: 'path',
  edit: 'path',
  write: 'path',
  enter_workspace: 'path',
  grep: GREP_SCOPES_FIELD,
  bash: 'cwd',
  zsh: 'cwd',
} satisfies Readonly<Record<string, string>>;

/** Whether a tool id names a tool whose path parameter is decided on. */
function isPathFieldTool(toolId: string): toolId is keyof typeof PATH_FIELDS {
  return toolId in PATH_FIELDS;
}

const BARE_ROOT_ANCHOR = '^/';

const BARE_ROOT_HINT =
  'a regex on a path parameter must not start with "^/": every Machine value ' +
  'is matched as its machine:// locator, so write the rule against it instead ' +
  '(e.g. ^machine://[^/]+/srv/docs(/|$) for that path on every Machine).';

function assertMatcherFields(
  toolId: string,
  list: 'allow' | 'reject',
  matcher: PermissionMatcher | undefined,
  allowedFields: ReadonlySet<string>,
): void {
  if (matcher === undefined || matcher === true) return;
  const pathField = isPathFieldTool(toolId) ? PATH_FIELDS[toolId] : undefined;

  matcher.forEach((clause, index) => {
    if (!('field' in clause)) return;

    const clausePath = `tools.permissions.${toolId}.${list}[${index}]`;

    if (!allowedFields.has(clause.field)) {
      throw new PermissionCompileError(
        clausePath,
        `field "${clause.field}" is not a declared string input of tool "${toolId}"`,
      );
    }

    // A literal clause stays a substring match, so `"/opt/secret"` keeps
    // working on every Machine; only an anchored regex is refused.
    if (
      clause.field === pathField &&
      'regex' in clause &&
      clause.regex.startsWith(BARE_ROOT_ANCHOR)
    ) {
      throw new PermissionCompileError(clausePath, BARE_ROOT_HINT);
    }
  });
}
