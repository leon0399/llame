import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { type ToolResult } from '@workspace/runtime-safety';

import {
  formatSkillLocator,
  parseSkillLocator,
  validateSkillResourcePath,
  type ParsedSkillLocator,
} from './skill-locator';
import { type SkillCatalogEntry, type SkillCatalogPort } from './skill-catalog';

/**
 * The instruction every skill read carries. It tells the agent how to turn the
 * package's own relative references into tool arguments without the tool
 * rewriting anything: package-relative paths resolve against `skillDirectory`,
 * task-relative inputs stay as the user gave them, and a script needing its own
 * directory gets an explicit `cwd`.
 */
export const SKILL_PATH_INSTRUCTION =
  'Resolve package-relative references and script paths against skillDirectory and use the resulting absolute paths in tool calls. Preserve task-relative input arguments as given, and choose `cwd` explicitly when a script requires its own directory.';

/**
 * The current user turn's explicit skill selections. The read layer always
 * passes an empty set; the activation layer supplies the Run's selections so a
 * manual-only package the user named stays readable for that Run.
 */
export type SkillSelection = ReadonlySet<string>;

export const NO_SKILL_SELECTION: SkillSelection = new Set<string>();

export type ResolvedSkillTarget = {
  readonly catalog?: false;
  /** The real absolute path the reader opens. */
  readonly hostPath: string;
  /** The canonical logical locator, selector excluded. */
  readonly locator: string;
  readonly name: string;
  /** The package's real absolute directory. */
  readonly skillDirectory: string;
  /** The configured source the winning package came from. */
  readonly sourceDirectory: string;
  readonly selector?: string;
};

/** A `skill://` catalog listing request, which reads no package file. */
export type ResolvedSkillCatalog = {
  readonly catalog: true;
  readonly entries: ReadonlyArray<SkillCatalogEntry>;
  readonly selector?: string;
};

/** Narrow a resolution result to the catalog listing. */
export function isSkillCatalogResult(
  value: ResolvedSkillTarget | ResolvedSkillCatalog | ToolResult,
): value is ResolvedSkillCatalog {
  return 'catalog' in value && value.catalog === true;
}

/**
 * Resolve one `skill://` locator against the current catalog. Discovery runs on
 * every call, so a removed or newly invalid package fails immediately. Nothing
 * is opened here; the caller opens the returned real path with symlinks
 * refused.
 */
export async function resolveSkillLocator(
  catalog: SkillCatalogPort,
  rest: string,
  selection: SkillSelection,
): Promise<ResolvedSkillTarget | ResolvedSkillCatalog | ToolResult> {
  const parsed = parseSkillLocator(rest);
  if (parsed === undefined) return invalidPathResult();

  const snapshot = catalog.getSnapshot();
  if (!snapshot.available) return catalogUnavailableResult();

  if (parsed.catalog === true) {
    const entries = snapshot.entries.filter((entry) =>
      isListable(entry, selection),
    );
    return parsed.selector === undefined
      ? { catalog: true, entries }
      : { catalog: true, entries, selector: parsed.selector };
  }

  const entry = snapshot.entries.find(
    (candidate) => candidate.name === parsed.name,
  );
  if (entry === undefined) return notFoundResult();
  if (!entry.available || entry.skillDirectory === null) {
    return unavailablePackageResult();
  }
  if (!isReadable(entry, selection)) return manualOnlyResult(entry.name);

  return resolveWithinPackage(parsed, entry, entry.skillDirectory);
}

/** A manual-only package is absent from listings unless this turn selected it. */
function isListable(
  entry: SkillCatalogEntry,
  selection: SkillSelection,
): boolean {
  return entry.proactive || selection.has(entry.name);
}

/** Body and resource reads of a manual-only package need that exact selection. */
function isReadable(
  entry: SkillCatalogEntry,
  selection: SkillSelection,
): boolean {
  return entry.proactive || selection.has(entry.name);
}

async function resolveWithinPackage(
  parsed: Exclude<ParsedSkillLocator, { catalog: true }>,
  entry: SkillCatalogEntry,
  skillDirectory: string,
): Promise<ResolvedSkillTarget | ToolResult> {
  const relativePath = parsed.relativePath;
  const targetPath =
    relativePath === undefined
      ? parsed.trailingSeparator === true
        ? skillDirectory
        : path.join(skillDirectory, SKILL_DOCUMENT_FILENAME)
      : path.join(skillDirectory, relativePath);

  if (relativePath !== undefined) {
    if (validateSkillResourcePath(relativePath) === undefined) {
      return invalidPathResult();
    }
  }

  const containment = await containIntoPackage(skillDirectory, targetPath);
  if ('status' in containment) return containment;

  const target: ResolvedSkillTarget = {
    // The separator rides along so the reader's own open applies the native
    // rule: a directory resolves, a file is `ENOTDIR` and reports `not_found`.
    hostPath:
      parsed.trailingSeparator === true
        ? `${containment.hostPath}${path.sep}`
        : containment.hostPath,
    locator: formatSkillLocator(parsed),
    name: entry.name,
    skillDirectory,
    sourceDirectory: entry.sourceDirectory ?? skillDirectory,
  };
  return parsed.selector === undefined
    ? target
    : { ...target, selector: parsed.selector };
}

const SKILL_DOCUMENT_FILENAME = 'SKILL.md';

/**
 * Resolve a target to its real path and refuse anything landing outside the
 * selected real package, so no link can redirect a read elsewhere. A target
 * that cannot be resolved is handed back unresolved: the reader's own
 * `not_found` path (including sibling suggestions) owns that answer, and the
 * native reader opens it with symlinks refused.
 */
async function containIntoPackage(
  packageDirectory: string,
  targetPath: string,
): Promise<{ readonly hostPath: string } | ToolResult> {
  let real: string;
  try {
    real = await realpath(targetPath);
  } catch {
    return { hostPath: targetPath };
  }
  return isInside(packageDirectory, real)
    ? { hostPath: real }
    : notFoundResult();
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function invalidPathResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'The skill locator is invalid.',
  };
}

function notFoundResult(): ToolResult {
  return { status: 'error', type: 'not_found', message: 'File not found.' };
}

function catalogUnavailableResult(): ToolResult {
  return {
    status: 'error',
    type: 'skill_catalog_unavailable',
    message: 'The skill catalog is unavailable.',
  };
}

function unavailablePackageResult(): ToolResult {
  return {
    status: 'error',
    type: 'skill_unavailable',
    message: 'The skill package is unavailable.',
  };
}

/** Bounded and explicit: the model is told the package exists but needs the
 *  user to name it, so it asks rather than inventing the instructions. */
function manualOnlyResult(name: string): ToolResult {
  return {
    status: 'error',
    type: 'skill_requires_explicit_selection',
    message: `The skill \`${name}\` is manual-only. It loads only when the user names it explicitly in the current turn, for example by writing \`$${name}\`.`,
  };
}
