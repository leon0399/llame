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
import { parseWebLocator } from '../web-read/locator';

const WEB_LOCATOR_SCHEMES = { http: true, https: true } as const;

/** Native tools whose `path` is a logical resource locator for policy. */
const NATIVE_FILE_PERMISSION_TOOL_IDS = new Set(['read', 'edit', 'write']);

/**
 * Canonicalize a submitted native `path` value for permission matching only.
 * Knowledge and skill locators are re-encoded to their canonical logical
 * identity with read selectors excluded; a web locator is re-encoded through
 * the read tool's own parser, so the text a clause matches is the text that
 * will be requested plus the selector that trails it — a fragment the request
 * drops cannot smuggle clause-matching text past an allow, and a locator with
 * no path is matched with the slash its request carries. Direct host locators
 * and invalid locators are returned unchanged. Nothing touches the
 * filesystem, and the resolved host path is never substituted — a skill
 * locator is matched as the locator the caller wrote, so the shared read
 * rules (including the credential path rejects) apply to it unchanged.
 */
export function projectNativeFilePath(value: string): string {
  const scheme = parsePathScheme(value);
  if (scheme === undefined) return value;
  if (scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME) {
    const parsed = parseKnowledgeLocator(scheme.rest);
    return parsed === undefined ? value : formatKnowledgeLocator(parsed);
  }
  if (scheme.scheme === SKILL_LOCATOR_SCHEME) {
    const parsed = parseSkillLocator(scheme.rest);
    return parsed === undefined ? value : formatSkillLocator(parsed);
  }
  if (scheme.scheme in WEB_LOCATOR_SCHEMES) {
    const parsed = parseWebLocator(value);
    if ('type' in parsed) return value;
    return parsed.selector === undefined
      ? parsed.url
      : `${parsed.url}:${parsed.selector}`;
  }
  return value;
}

/**
 * The evaluator projection for a tool: native file tools match their `path`
 * as a logical locator; every other tool and field is passed through. The same
 * projection applies when all-fields rejection visits the native `path`.
 */
export function nativeFileProjection(
  toolId: string,
): (field: string, value: string) => string {
  if (!NATIVE_FILE_PERMISSION_TOOL_IDS.has(toolId)) {
    return (_field, value) => value;
  }
  return (field, value) =>
    field === 'path' ? projectNativeFilePath(value) : value;
}
