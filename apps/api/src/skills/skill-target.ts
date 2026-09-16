import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { type ToolResult } from '@workspace/runtime-safety';

import {
  formatSkillLocator,
  parseSkillLocator,
  validateSkillResourcePath,
  type ParsedSkillLocator,
} from './skill-locator';
import { type SkillCatalogEntry, type SkillCatalogPort } from './skill-catalog';
import { loadPackagedTemplate } from '../prompts/template-engine';

/**
 * The instruction every skill read carries. It tells the agent how to turn the
 * package's own relative references into tool arguments without the tool
 * rewriting anything: package-relative paths resolve against `skillDirectory`,
 * task-relative inputs stay as the user gave them, and a script needing its own
 * directory gets an explicit `cwd`.
 *
 * The sentence is the packaged `prompts/path-instruction.md`, rendered once at
 * module scope. It stays an exported string, not a render function:
 * `skill-results.ts` places it in three result shapes' `skillPathInstruction`
 * field, so what those call sites need is the bytes. It is NOT the rail's path
 * guidance in `chats/prompts/skill-activation.md` — that sentence is a
 * different surface (rail prose, with its own wording) and is never shared
 * with this one.
 */
const renderPathInstructionTemplate = loadPackagedTemplate<
  Record<string, never>
>(__dirname, 'path-instruction');

export const SKILL_PATH_INSTRUCTION = renderPathInstructionTemplate({});

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
 * selected real package, so no link can redirect a read elsewhere. A resource
 * symlink that stays inside the package resolves; one that leaves it does not.
 *
 * A missing target still has to be contained: its *existing* ancestor is what
 * the reader would list for sibling suggestions, and an escaping intermediate
 * symlink would put that ancestor outside the package. The unresolved path is
 * handed back there so the reader's own `not_found` (with sibling suggestions)
 * stays authoritative; it opens with symlinks refused either way.
 */
async function containIntoPackage(
  packageDirectory: string,
  targetPath: string,
): Promise<{ readonly hostPath: string } | ToolResult> {
  const existing = await nearestExistingAncestor(targetPath);
  if (existing === undefined) return notFoundResult();
  let real: string;
  try {
    real = await realpath(existing);
  } catch {
    return notFoundResult();
  }
  if (!isInside(packageDirectory, real)) return notFoundResult();
  // An existing target resolves to its real path, so a contained link is
  // followed; a missing one keeps its literal spelling for the reader's own
  // miss handling.
  return { hostPath: existing === targetPath ? real : targetPath };
}

/** The deepest ancestor of `targetPath`, inclusive, that exists; `undefined`
 *  when even the filesystem root cannot be resolved. */
async function nearestExistingAncestor(
  targetPath: string,
): Promise<string | undefined> {
  let candidate = targetPath;
  for (;;) {
    try {
      await lstat(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return undefined;
      candidate = parent;
    }
  }
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
