import { parsePathScheme } from '@workspace/native-file-tools';

import {
  formatKnowledgeLocator,
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../../knowledge/knowledge-locator';
import {
  formatSkillLocator,
  parseSkillLocator,
  SKILL_LOCATOR_SCHEME,
} from '../../skills/skill-locator';
import { isWorkspaceRelative, resolveWorkspacePath } from '../workspace-path';
import { parseWebLocator } from '../web-read/locator';
import { isFileAlias, decodeFileAlias } from './file-alias';

const WEB_LOCATOR_SCHEMES = { http: true, https: true } as const;

/** Native tools whose `path` is a logical resource locator for policy. */
const NATIVE_FILE_PERMISSION_TOOL_IDS = new Set(['read', 'edit', 'write']);

/**
 * Canonicalize a submitted native `path` value for permission matching only.
 * A `file:` alias is decoded to its absolute host path before any other
 * classification, so a valid alias is matched as its host path and an invalid
 * alias is returned unchanged. Knowledge and skill locators are re-encoded to
 * their canonical logical identity with read selectors excluded; a web locator
 * is re-encoded through the read tool's own parser, so the text a clause
 * matches is the text that will be requested plus the selector that trails
 * it — a fragment the request drops cannot smuggle clause-matching text past
 * an allow, and a locator with no path is matched with the slash its request
 * carries. Relative direct host paths are projected lexically from the
 * Workspace root when one is supplied; absolute host locators and invalid
 * locators are otherwise returned unchanged. Nothing touches the filesystem,
 * and the resolved host path is never substituted for Knowledge, skill, or
 * direct host locators.
 */
export function projectNativeFilePath(
  value: string,
  workspaceRoot?: string,
): string {
  if (isFileAlias(value)) {
    const alias = decodeFileAlias(value);
    if (!alias.ok) return value;
    return alias.hostPath;
  }
  const projected =
    workspaceRoot !== undefined && isWorkspaceRelative(value)
      ? resolveWorkspacePath(workspaceRoot, value)
      : value;
  const scheme = parsePathScheme(projected);
  if (scheme === undefined) return projected;
  if (scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME) {
    const parsed = parseKnowledgeLocator(scheme.rest);
    return parsed === undefined ? projected : formatKnowledgeLocator(parsed);
  }
  if (scheme.scheme === SKILL_LOCATOR_SCHEME) {
    const parsed = parseSkillLocator(scheme.rest);
    return parsed === undefined ? projected : formatSkillLocator(parsed);
  }
  if (scheme.scheme in WEB_LOCATOR_SCHEMES) {
    const parsed = parseWebLocator(projected);
    if ('type' in parsed) return projected;
    return parsed.selector === undefined
      ? parsed.url
      : `${parsed.url}:${parsed.selector}`;
  }
  return projected;
}

/**
 * The evaluator projection for a tool: native file tools match their `path`
 * as a logical locator; every other tool and field is passed through. The same
 * projection applies when all-fields rejection visits the native `path`.
 */
export function nativeFileProjection(
  toolId: string,
  workspaceRoot?: string,
): (field: string, value: string) => string {
  if (!NATIVE_FILE_PERMISSION_TOOL_IDS.has(toolId)) {
    return (_field, value) => value;
  }
  return (field, value) =>
    field === 'path' ? projectNativeFilePath(value, workspaceRoot) : value;
}
