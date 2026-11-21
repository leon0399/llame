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
import { JOB_SCHEME } from '../../jobs/job-locator';
import { MACHINE_SCHEME } from '../../machines/machine-locator';
import {
  parseProjectLocator,
  PROJECT_SCHEME,
} from '../../projects/project-locator';
import {
  canonicalMachineLocator,
  type LocatorContext,
  resolveMachinePath,
} from '../workspace-path';
import {
  parseWebLocator,
  splitWebSelector,
  stripFragment,
} from '../web-read/locator';
import { isFileAlias, decodeFileAlias } from './file-alias';

const WEB_LOCATOR_SCHEMES = { http: true, https: true } as const;

/**
 * Tools whose `path` is a logical resource locator for policy. `enter_workspace`
 * decides its submitted path on the canonical locator too (design D7),
 * otherwise a bare-path entry could never find a canonical allow.
 */
const NATIVE_FILE_PERMISSION_TOOL_IDS = new Set([
  'read',
  'edit',
  'write',
  'enter_workspace',
]);

/**
 * Project a submitted locator to the identity its read is admitted under: a
 * valid read selector is removed. A valid Project resource projects to its
 * canonical resource even when the trailing suffix is not a native selector —
 * the suffix is never part of the resource identity, and the reader refuses it
 * after admission.
 */
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

  if (scheme?.scheme === PROJECT_SCHEME) {
    // The resource matches as canonical whatever trails it; the reader
    // refuses a non-native suffix after admission.
    const parsed = parseProjectLocator(value);

    return parsed === undefined ? value : parsed.canonical;
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

/** The identity one native `path` value has for policy. */
export type NativePathProjection = {
  /** The canonical locator policy decides an allow on. */
  readonly canonical: string;
  /** The decoded absolute path on the Machine, for a Machine value only. */
  readonly projectedPath?: string;
};

/**
 * Canonicalize a submitted native `path` value for permission matching only.
 * A `file:` alias is decoded to its absolute path before any other
 * classification, so a valid alias is matched as its path on the current
 * Machine and an invalid alias is returned unchanged. The single locator rule
 * (`resolveMachinePath`) decides the Machine: a bare absolute path and every
 * valid `file:` form are the current Machine's, a relative path resolves from
 * the entered Workspace root, and `machine://<name>/<path>` names its own. A
 * Machine value's canonical text is its `machine://` locator with the path
 * decoded once; its projected path is the decoded absolute path without the
 * scheme and the name, which is what a reject written as a bare path matches.
 * Knowledge, skill, Project, job, and web locators keep their existing
 * canonical forms. Nothing touches the filesystem, and an invalid value is
 * matched as written.
 *
 * A mutation takes its path literally, so a suffix that looks like a selector
 * stays on both texts; the `read` projection removes it afterward.
 */
export function projectNativeFilePath(
  value: string,
  context: LocatorContext = {},
): NativePathProjection {
  return projectValue(value, context, { keepSelector: true });
}

/**
 * One value's projection. `keepSelector` describes a mutation, whose path the
 * tool takes literally; a `read` drops a split-off selector from both texts.
 */
function projectValue(
  value: string,
  context: LocatorContext,
  options: { readonly keepSelector: boolean },
): NativePathProjection {
  const target = resolveMachinePath(value, context);

  if (target.kind === 'machine') {
    // A mutation takes the suffix literally, so it keeps whatever the grammar
    // split off; a `read` drops the selector that windowed the call.
    const literalSuffix =
      target.selector === undefined ? '' : `:${target.selector}`;

    return {
      canonical: options.keepSelector
        ? target.locator
        : withoutReadSelector(target.locator),
      projectedPath: options.keepSelector
        ? `${target.path}${literalSuffix}`
        : target.path,
    };
  }

  if (target.kind === 'scheme') {
    const canonical = projectSchemeValue(value);

    // A `read` matches the resource without the selector that windowed the
    // call, exactly as it does for a Machine path.
    return {
      canonical: options.keepSelector
        ? canonical
        : withoutReadSelector(canonical),
    };
  }

  // The reader refuses this value, so policy matches the text it would refuse:
  // a valid `file:` alias stays its decoded path, everything else as written.
  if (!isFileAlias(value)) return { canonical: value };
  const alias = decodeFileAlias(value);

  return { canonical: alias.ok ? alias.hostPath : value };
}

/** The canonical text of every locator scheme whose reader keeps its routing. */
function projectSchemeValue(projected: string): string {
  const scheme = parsePathScheme(projected);

  if (scheme === undefined) return projected;

  if (scheme.scheme === MACHINE_SCHEME) {
    // The Machine grammar decodes the path once before this text is matched,
    // so a `%2E` spelling cannot miss a reject written against the decoded
    // address. `.`, `..`, and trailing separators stay as written, and a
    // listing or malformed locator is matched as the model wrote it.
    return canonicalMachineLocator(projected);
  }

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

  if (scheme.scheme === PROJECT_SCHEME) {
    // The Project parser owns the resource grammar, so an invalid spelling is
    // matched as written and a valid one is matched by its selector-free
    // canonical identity. The split selector is reattached for a mutation; a
    // read projection drops it, because no suffix is part of the resource.
    const parsed = parseProjectLocator(projected);

    if (parsed === undefined) return projected;

    return withSelector(parsed.canonical, parsed.selector);
  }

  if (scheme.scheme in WEB_LOCATOR_SCHEMES) return projectWebLocator(projected);

  // The scheme matches in lower case, so `JOB://` cannot slip past a clause
  // written against `job://`. The rest is the text the reader parses; a read
  // selector is removed afterward by `withoutReadSelector`.
  if (scheme.scheme === JOB_SCHEME) return `${JOB_SCHEME}://${scheme.rest}`;

  return projected;
}

/**
 * A web locator's canonical text: the URL the read tool's own parser yields,
 * plus the selector exactly as it trails it in the submitted text, so a
 * fragment the request drops cannot smuggle clause-matching text past an
 * allow. A locator with no path keeps the slash its request carries, and a
 * malformed one is matched as the model wrote it.
 */
function projectWebLocator(projected: string): string {
  const parsed = parseWebLocator(projected);

  if ('type' in parsed) return projected;
  const fragmentFree = stripFragment(projected);
  const split = splitWebSelector(fragmentFree);

  return split.selector === undefined
    ? parsed.url
    : `${parsed.url}${fragmentFree.slice(split.url.length)}`;
}

function withSelector(canonical: string, selector: string | undefined): string {
  return selector === undefined ? canonical : `${canonical}:${selector}`;
}

/**
 * The evaluator projection for a tool: native file tools match their `path` as
 * a logical locator, and a `read` matches it without the selector that
 * windowed the call; `stop` matches each `jobs` entry with a lower-case
 * scheme; every other tool and field is passed through. The same projection
 * applies when all-fields rejection visits the native `path`.
 *
 * The returned function takes a whole `path` value on its own — the form a
 * caller that only has values uses — or a field and a value, which is the
 * shape `projectFieldValue` calls.
 */
export type NativeFileProjection = {
  (value: string): NativePathProjection;
  (field: string, value: string): NativePathProjection;
};

export function nativeFileProjection(
  toolId: string,
  context: LocatorContext = {},
): NativeFileProjection {
  const project = (field: string, value: string): NativePathProjection => {
    if (toolId === 'stop') {
      // Each `jobs` entry matches with its scheme in lower case.
      const scheme = field === 'jobs' ? parsePathScheme(value) : undefined;

      return {
        canonical:
          scheme?.scheme === JOB_SCHEME
            ? `${JOB_SCHEME}://${scheme.rest}`
            : value,
      };
    }

    if (!NATIVE_FILE_PERMISSION_TOOL_IDS.has(toolId) || field !== 'path')
      return { canonical: value };

    return projectValue(value, context, { keepSelector: toolId !== 'read' });
  };

  return (first: string, second?: string) =>
    second === undefined ? project('path', first) : project(first, second);
}
