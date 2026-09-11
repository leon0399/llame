import { parsePathScheme } from '@workspace/native-file-tools';

import {
  formatKnowledgeLocator,
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../../knowledge/knowledge-locator';

/** Native tools whose `path` is a logical resource locator for policy. */
const NATIVE_FILE_PERMISSION_TOOL_IDS = new Set(['read', 'edit', 'write']);

/**
 * Canonicalize a submitted native `path` value for permission matching only.
 * Knowledge locators are re-encoded to their canonical logical identity with
 * read selectors excluded; direct host locators and invalid locators are
 * returned unchanged. Nothing touches the filesystem.
 */
export function projectNativeFilePath(value: string): string {
  const scheme = parsePathScheme(value);
  if (scheme === undefined || scheme.scheme !== KNOWLEDGE_LOCATOR_SCHEME) {
    return value;
  }
  const parsed = parseKnowledgeLocator(scheme.rest);
  if (parsed === undefined) return value;
  return formatKnowledgeLocator(parsed);
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
