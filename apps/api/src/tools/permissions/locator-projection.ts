import {
  isSelectorSuffix,
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

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
import {
  parseWebLocator,
  splitWebSelector,
  stripFragment,
} from '../web-read/locator';
import { isFileAlias, decodeFileAlias } from './file-alias';

const WEB_LOCATOR_SCHEMES = { http: true, https: true } as const;

/** Native tools whose `path` is a logical resource locator for policy. */
const NATIVE_FILE_PERMISSION_TOOL_IDS = new Set(['read', 'edit', 'write']);

/** Removes only a valid read selector from a submitted locator. */
export function withoutReadSelector(value: string): string {
  if (isFileAlias(value)) return withoutFileAliasSelector(value);
  const scheme = parsePathScheme(value);
  const parse =
    scheme?.scheme === KNOWLEDGE_LOCATOR_SCHEME
      ? parseKnowledgeLocator
      : scheme?.scheme === SKILL_LOCATOR_SCHEME
        ? parseSkillLocator
        : undefined;
  if (scheme !== undefined && parse !== undefined) {
    // Both parsers split the selector off at the first colon of the rest.
    const parsed = parse(scheme.rest);
    if ('type' in parsed || parsed.selector === undefined) return value;
    return value.slice(
      0,
      value.length - scheme.rest.length + scheme.rest.indexOf(':'),
    );
  }
  if (scheme?.scheme !== undefined && scheme.scheme in WEB_LOCATOR_SCHEMES) {
    const fragmentFree = stripFragment(value);
    const { url, selector } = splitWebSelector(fragmentFree);
    return selector !== undefined && isSelectorSuffix(selector)
      ? `${url}${value.slice(fragmentFree.length)}`
      : value;
  }
  const { path, selector } = splitSelectorSuffix(value);
  return selector !== undefined && isSelectorSuffix(selector) ? path : value;
}

function withoutFileAliasSelector(value: string): string {
  const alias = decodeFileAlias(value);
  if (!alias.ok) return value;
  const { path, selector } = splitSelectorSuffix(alias.hostPath);
  if (selector === undefined || !isSelectorSuffix(selector)) return value;
  // The selector starts at a colon written literally or as `%3A`; cut at the
  // last such colon whose prefix decodes to the selector-free path, so any
  // other spelling in the submitted text is left as written.
  for (const match of [...value.matchAll(/:|%3A/giu)].reverse()) {
    const prefix = value.slice(0, match.index);
    const decoded = decodeFileAlias(prefix);
    if (decoded.ok && decoded.hostPath === path) return prefix;
  }
  return value;
}

/**
 * Canonicalize a submitted native `path` value for permission matching only.
 * A `file:` alias is decoded to its absolute host path before any other
 * classification, so a valid alias is matched as its host path and an invalid
 * alias is returned unchanged. Knowledge and skill locators are re-encoded to
 * their canonical logical identity, retaining a valid selector for mutations;
 * read projections remove it afterward. A web locator is re-encoded through
 * the read tool's own parser, so the text a clause matches is the URL that
 * will be requested plus the selector exactly as it trails it — a fragment
 * the request drops cannot smuggle clause-matching text past an allow, a
 * locator with no path is matched with the slash its request carries, and
 * `:5-9:raw` is never reordered to `:raw:5-9`, which the model and a server
 * never wrote. Relative direct host paths are projected lexically from the
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
    // A refused selector and a malformed part are the same unmatched text to
    // policy, which is what the reported failure type separates for the reader
    // that reports it.
    if ('type' in parsed) return projected;
    return withSelector(formatKnowledgeLocator(parsed), parsed.selector);
  }
  if (scheme.scheme === SKILL_LOCATOR_SCHEME) {
    const parsed = parseSkillLocator(scheme.rest);
    if ('type' in parsed) return projected;
    return withSelector(formatSkillLocator(parsed), parsed.selector);
  }
  if (scheme.scheme in WEB_LOCATOR_SCHEMES) {
    const parsed = parseWebLocator(projected);
    if ('type' in parsed) return projected;
    const fragmentFree = stripFragment(projected);
    const split = splitWebSelector(fragmentFree);
    return split.selector === undefined
      ? parsed.url
      : `${parsed.url}${fragmentFree.slice(split.url.length)}`;
  }
  return projected;
}

function withSelector(canonical: string, selector: string | undefined): string {
  return selector === undefined ? canonical : `${canonical}:${selector}`;
}

/**
 * The evaluator projection for a tool: native file tools match their `path` as
 * a logical locator, and a `read` matches it without the selector that
 * windowed the call; every other tool and field is passed through. The same
 * projection applies when all-fields rejection visits the native `path`.
 */
export function nativeFileProjection(
  toolId: string,
  workspaceRoot?: string,
): (field: string, value: string) => string {
  if (!NATIVE_FILE_PERMISSION_TOOL_IDS.has(toolId)) {
    return (_field, value) => value;
  }
  return (field, value) => {
    if (field !== 'path') return value;
    const projected = projectNativeFilePath(value, workspaceRoot);
    return toolId === 'read' ? withoutReadSelector(projected) : projected;
  };
}
