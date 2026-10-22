/**
 * The `grep` scope dispatch: a scheme becomes a walkable engine scope, or the
 * closed result that ends the call. A host or `machine://` scope has no backend
 * on this layer and fails with the result its own layer owns; Knowledge and
 * skill scopes are resolved by their own modules.
 */

import path from 'node:path';

import {
  parsePathScheme,
  splitGrepScope,
  type GrepScope,
} from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { MACHINE_SCHEME } from '../machines/machine-locator';
import { MEDIA_LOCATOR_SCHEME } from '../media/media-locator';
import { isValidSkillName } from '../skills/skill-name';
import {
  formatSkillLocator,
  validateSkillResourcePath,
} from '../skills/skill-locator';
import { type SkillCatalogSnapshot } from '../skills/skill-catalog';
import {
  NO_SKILL_SELECTION,
  skillCatalogUnavailableResult,
  skillNotFoundResult,
  skillRequiresSelectionResult,
  skillUnavailableResult,
  type SkillSelection,
} from '../skills/skill-target';
import { workspaceSkillSources } from '../skills/workspace-skill-sources';
import { type GrepReadAdmission, grepScopeStrings } from './grep-admission';
import {
  resolveKnowledgeScope,
  refuseUnsearchableKnowledgeScope,
} from './grep-knowledge-scope';
import { decodeFileAlias, isFileAlias } from './permissions/file-alias';
import { createSkillWalkPort, joinedPath, probeSkillPath } from './grep-ports';
import {
  executorUnavailableResult,
  invalidPathResult,
  machineUnsupportedResult,
  selectorColonResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import {
  buildScope,
  hasGlobOperator,
  splitScopePath,
  type ScopeOutcome,
} from './grep-scope-shape';
import { type ToolContext } from './types';

const KNOWLEDGE_SCHEME = 'kb';
const SKILL_SCHEME = 'skill';

/**
 * The shape checks every scope passes before the runner asks policy: a scheme
 * this process cannot search, a `file:` alias that does not decode, the glob
 * operator the engine refuses, and a selector-shaped colon in a `kb://` or
 * `skill://` scope. Pure and synchronous, so a scope that can never be
 * searched yields its `invalid_path` without a recorded permission decision.
 */
export function refuseUnsearchableGrepScopes(
  args: UnknownRecord,
  context: ToolContext,
): GrepToolError | undefined {
  const scopes = grepScopeStrings(args, context.workspaceRoot?.current());
  if (scopes === undefined) return undefined;
  for (const scope of scopes) {
    const refused = refuseUnsearchableScope(scope);
    if (refused !== undefined) return refused;
  }
  return undefined;
}

/** One scope's text refusal, shared with its resolution. */
function refuseUnsearchableScope(scope: string): GrepToolError | undefined {
  if (isFileAlias(scope)) {
    const alias = decodeFileAlias(scope);
    return alias.ok ? undefined : invalidPathResult(alias.message);
  }
  const scheme = parsePathScheme(scope);
  if (scheme === undefined) return undefined;
  switch (scheme.scheme) {
    case KNOWLEDGE_SCHEME:
      return refuseUnsearchableKnowledgeScope(scheme.rest);
    case SKILL_SCHEME:
      return refuseUnsearchableSkillScope(scheme.rest);
    default:
      return unsearchableSchemeResult(scheme.scheme);
  }
}

/** The closed result a scheme without a backend on this process returns. */
function unsearchableSchemeResult(scheme: string): GrepToolError {
  switch (scheme) {
    case MACHINE_SCHEME:
      return machineUnsupportedResult();
    case MEDIA_LOCATOR_SCHEME:
      return invalidPathResult('A media:// locator holds no text to search.');
    case 'http':
    case 'https':
      return invalidPathResult(
        'A web locator is fetched, not searched; read one page instead.',
      );
    default:
      return invalidPathResult('This path scheme cannot be searched.');
  }
}

export async function resolveScopes(
  context: ToolContext,
  submitted: ReadonlyArray<string>,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  const scopes: Array<GrepScope> = [];
  const roots: Array<string> = [];
  // A bare `kb://` or `skill://` scope expands to one scope per Space or
  // package. Each expansion is its own scope, so it takes its own ordinal:
  // a cursor names exactly one of them, and a page resumes after that one.
  let ordinal = 0;
  for (const [index, scope] of submitted.entries()) {
    const outcome = await resolveScope(context, scope, index, admission);
    if ('result' in outcome) return outcome;
    for (const resolved of outcome.scopes) {
      scopes.push({ ...resolved, index: ordinal });
      ordinal += 1;
    }
    roots.push(...outcome.roots);
  }
  return { scopes, roots };
}

async function resolveScope(
  context: ToolContext,
  scope: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  if (isFileAlias(scope)) {
    const alias = decodeFileAlias(scope);
    if (!alias.ok) return { result: invalidPathResult(alias.message) };
    return { result: executorUnavailableResult() };
  }
  const scheme = parsePathScheme(scope);
  if (scheme === undefined) return { result: executorUnavailableResult() };
  switch (scheme.scheme) {
    case KNOWLEDGE_SCHEME:
      return resolveKnowledgeScope(context, scheme.rest, index, admission);
    case SKILL_SCHEME:
      return resolveSkillScope(context, scheme.rest, index, admission);
    default:
      return { result: unsearchableSchemeResult(scheme.scheme) };
  }
}

/** The text checks a `skill://` scope passes before any catalog lookup. */
function refuseUnsearchableSkillScope(rest: string): GrepToolError | undefined {
  const separator = rest.indexOf('/');
  const name = separator < 0 ? rest : rest.slice(0, separator);
  const rawPath = separator < 0 ? '' : rest.slice(separator + 1);
  if (name.includes(':') || rawPath.includes(':'))
    return selectorColonResult('skill');
  if (hasGlobOperator(name))
    return invalidPathResult('A skill name cannot hold a glob.');
  const split = splitGrepScope(rawPath);
  return 'error' in split ? unsupportedGlobResult(split.operator) : undefined;
}

async function resolveSkillScope(
  context: ToolContext,
  rest: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  if (rest.length === 0) return resolveEverySkill(context, index, admission);
  const refused = refuseUnsearchableSkillScope(rest);
  if (refused !== undefined) return { result: refused };
  const separator = rest.indexOf('/');
  const name = separator < 0 ? rest : rest.slice(0, separator);
  const rawPath = separator < 0 ? '' : rest.slice(separator + 1);
  if (!isValidSkillName(name)) {
    return { result: invalidPathResult('The skill locator is invalid.') };
  }

  const entry = readableSkillPackage(context, name);
  if ('result' in entry) return entry;
  const outcome = await resolveSkillPackage({
    skillDirectory: entry.skillDirectory,
    name: entry.name,
    rawPath,
    index,
    admission,
    signal: context.abortSignal,
  });
  if ('result' in outcome) return outcome;
  return { scopes: outcome.scopes, roots: [name] };
}

/** A package whose directory this process can walk. */
type ReadableSkillPackage = {
  readonly name: string;
  readonly skillDirectory: string;
};

/** The package a `skill://<name>` scope names, once its access is settled. */
function readableSkillPackage(
  context: ToolContext,
  name: string,
): ReadableSkillPackage | { readonly result: GrepToolError } {
  const snapshot = readSkillCatalog(context);
  if ('result' in snapshot) return snapshot;
  const entry = snapshot.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) return { result: skillNotFoundResult() };
  if (!entry.available || entry.skillDirectory === null) {
    return { result: skillUnavailableResult() };
  }
  if (!entry.proactive && !selectionOf(context).has(entry.name)) {
    return { result: skillRequiresSelectionResult(entry.name) };
  }
  return { name: entry.name, skillDirectory: entry.skillDirectory };
}

async function resolveEverySkill(
  context: ToolContext,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  if (context.skillCatalog === undefined) return { scopes: [], roots: [] };
  const snapshot = readSkillCatalog(context);
  if ('result' in snapshot) return snapshot;
  const selection = selectionOf(context);
  const packages = snapshot.entries
    .filter((entry) => entry.proactive || selection.has(entry.name))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name, 'utf8'),
        Buffer.from(right.name, 'utf8'),
      ),
    );

  const scopes: Array<GrepScope> = [];
  for (const entry of packages) {
    if (!entry.available || entry.skillDirectory === null) {
      return { result: skillUnavailableResult() };
    }
    const outcome = await resolveSkillPackage({
      skillDirectory: entry.skillDirectory,
      name: entry.name,
      rawPath: '',
      index,
      admission,
      signal: context.abortSignal,
    });
    if ('result' in outcome) return outcome;
    scopes.push(...outcome.scopes);
  }
  return { scopes, roots: packages.map((entry) => entry.name) };
}

function selectionOf(context: ToolContext): SkillSelection {
  return context.skillSelection ?? NO_SKILL_SELECTION;
}

function readSkillCatalog(
  context: ToolContext,
): SkillCatalogSnapshot | { readonly result: GrepToolError } {
  const catalog = context.skillCatalog;
  if (catalog === undefined) return { result: skillCatalogUnavailableResult() };
  const root = context.workspaceRoot?.current();
  const snapshot = catalog.getSnapshot(
    root === undefined ? undefined : workspaceSkillSources(root),
  );
  return snapshot.available
    ? snapshot
    : { result: skillCatalogUnavailableResult() };
}

type SkillPackageScope = {
  readonly skillDirectory: string;
  readonly name: string;
  readonly rawPath: string;
  readonly index: number;
  readonly admission: GrepReadAdmission;
  readonly signal: AbortSignal | undefined;
};

/**
 * One package's scope: the raw path part split at its first glob segment, then
 * probed only when it names one path. Package directories are host paths; a
 * package that lives on a Machine is refused rather than walked locally.
 */
async function resolveSkillPackage(
  input: SkillPackageScope,
): Promise<ScopeOutcome> {
  const parsed = splitScopePath(input.rawPath, isSkillResourcePath);
  if ('status' in parsed) return { result: parsed };
  if (!path.isAbsolute(input.skillDirectory)) {
    return { result: skillUnavailableResult() };
  }
  const root =
    parsed.prefixPath.length === 0
      ? input.skillDirectory
      : path.join(input.skillDirectory, ...parsed.prefixPath.split('/'));
  return buildScope({
    index: input.index,
    locatorFor: (rel) => {
      const relativePath = joinedPath(parsed.prefixPath, rel);
      return formatSkillLocator(
        relativePath.length === 0
          ? { name: input.name }
          : { name: input.name, relativePath },
      );
    },
    glob: parsed.glob,
    port: () => createSkillWalkPort(root, input.signal),
    probe: () => probeSkillPath(root, input.signal),
    endsWithSeparator: parsed.endsWithSeparator,
    admission: input.admission,
    root: input.name,
  });
}

function isSkillResourcePath(relativePath: string): boolean {
  return (
    relativePath.length === 0 ||
    validateSkillResourcePath(relativePath) !== undefined
  );
}
