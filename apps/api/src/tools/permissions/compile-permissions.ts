import { isString } from '@workspace/runtime-safety';

import { PermissionCompileError, PERMISSION_LIMITS } from './limits';
import { compileLiteralMatcher, compileRegexMatcher } from './matcher';
import {
  type CompiledPermissionClause,
  type CompiledPermissionGroup,
  type CompiledPolicy,
  type CompiledValueMatcher,
  type PermissionClause,
  type PermissionGroup,
  type PermissionMatcher,
  type ToolPermissionMap,
} from './types';

/**
 * Compile a structurally valid operator map into the immutable matcher policy.
 * Identity and field checks are separate; this enforces the clause grammar and
 * the code-owned size bounds. Any failure aborts startup.
 */
export function compileToolPermissionMap(
  map: ToolPermissionMap,
  policyId: string,
): CompiledPolicy {
  const entries = Object.entries(map);
  if (entries.length > PERMISSION_LIMITS.maxGroups) {
    throw new PermissionCompileError(
      'tools.permissions',
      `at most ${PERMISSION_LIMITS.maxGroups} groups are supported`,
    );
  }

  const groups = new Map<string, CompiledPermissionGroup>();
  let clauseCount = 0;
  for (const [toolId, group] of entries) {
    const path = `tools.permissions.${toolId}`;
    const compiled = compileGroup(path, toolId, group);
    clauseCount +=
      compiled.allowClauses.length +
      compiled.rejectClauses.length +
      (compiled.allowWholeTool ? 1 : 0) +
      (compiled.rejectWholeTool ? 1 : 0);
    if (clauseCount > PERMISSION_LIMITS.maxClauses) {
      throw new PermissionCompileError(
        path,
        `at most ${PERMISSION_LIMITS.maxClauses} clauses are supported`,
      );
    }
    groups.set(toolId, compiled);
  }
  return { id: policyId, groups };
}

function compileGroup(
  path: string,
  groupId: string,
  group: PermissionGroup,
): CompiledPermissionGroup {
  const allow = compileMatcher(path, groupId, 'allow', group.allow);
  const reject = compileMatcher(path, groupId, 'reject', group.reject);
  return {
    allowWholeTool: allow.wholeTool,
    rejectWholeTool: reject.wholeTool,
    allowClauses: allow.clauses,
    rejectClauses: reject.clauses,
  };
}

function compileMatcher(
  path: string,
  groupId: string,
  list: 'allow' | 'reject',
  matcher: PermissionMatcher | undefined,
) {
  if (matcher === undefined) return { wholeTool: false, clauses: [] };
  if (matcher === true) return { wholeTool: true, clauses: [] };
  return {
    wholeTool: false,
    clauses: matcher.map((clause, index) =>
      compileClause({ path, groupId, list, clauseIndex: index, clause }),
    ),
  };
}

interface ClauseInput {
  readonly path: string;
  readonly groupId: string;
  readonly list: 'allow' | 'reject';
  readonly clauseIndex: number;
  readonly clause: PermissionClause;
}

function compileClause(input: ClauseInput): CompiledPermissionClause {
  const { path, groupId, list, clauseIndex, clause } = input;
  const clausePath = `${path}.${list}[${clauseIndex}]`;
  const literal = 'literal' in clause ? clause.literal : undefined;
  const regex = 'regex' in clause ? clause.regex : undefined;
  const field = 'field' in clause ? clause.field : undefined;
  const allFields = 'allFields' in clause ? clause.allFields : undefined;

  const matcher = compileMatcherPattern(clausePath, literal, regex);
  if (allFields === true) {
    if (list === 'allow') {
      throw new PermissionCompileError(
        clausePath,
        'allFields is valid only for reject',
      );
    }
    return { groupId, list, clauseIndex, target: { allFields: true }, matcher };
  }
  if (!isString(field) || field.length === 0) {
    throw new PermissionCompileError(
      clausePath,
      'clause must target exactly one non-empty field or allFields',
    );
  }
  return { groupId, list, clauseIndex, target: { field }, matcher };
}

function compileMatcherPattern(
  path: string,
  literal: string | undefined,
  regex: string | undefined,
): CompiledValueMatcher {
  const hasLiteral = isString(literal) && literal.length > 0;
  const hasRegex = isString(regex) && regex.length > 0;
  if (hasLiteral === hasRegex) {
    throw new PermissionCompileError(
      path,
      'clause must set exactly one non-empty literal or regex',
    );
  }
  if (isString(literal) && literal.length > 0) {
    return compileLiteralMatcher(literal, path);
  }
  if (isString(regex) && regex.length > 0) {
    return compileRegexMatcher(regex, path);
  }
  throw new PermissionCompileError(path, 'clause has no matcher');
}
