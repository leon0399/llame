/**
 * The `grep` scope dispatch: a scheme becomes a walkable engine scope, or the
 * closed result that ends the call. Knowledge and skill scopes are resolved by
 * their own modules; a host path and a scope naming this process's own Machine
 * are walked in process, reported by canonical `machine://` locators; and
 * every other Machine scope is walked by its own daemon.
 */

import path from 'node:path';

import {
  compileGlob,
  decodeGrepLiteralSpelling,
  normalizeHostScope,
  parsePathScheme,
  spellGrepMachineScopeLocator,
  splitGrepScope,
  type CompiledGlob,
  type GrepScope,
  type GrepScopeSplit,
} from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';

import {
  formatMachineLocator,
  MACHINE_SCHEME,
} from '../machines/machine-locator';
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
import { verifiedWorkspaceSkillSources } from '../skills/workspace-skill-sources';
import { type GrepReadAdmission, grepScopeStrings } from './grep-admission';
import {
  resolveKnowledgeScope,
  refuseUnsearchableKnowledgeScope,
} from './grep-knowledge-scope';
import {
  machineScopeOf,
  resolveMachineScope,
  type MachineGrepScope,
} from './grep-machine';
import { decodeFileAlias, isFileAlias } from './permissions/file-alias';
import {
  createHostWalkPort,
  createSkillWalkPort,
  joinedPath,
  probeHostPath,
  probeSkillPath,
} from './grep-ports';
import {
  executorUnavailableResult,
  invalidPathResult,
  isGrepToolError,
  selectorColonResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import {
  buildScope,
  hasGlobOperator,
  hostLiteralStart,
  splitScopePath,
  type ResolvedScopes,
  type ScopeOutcome,
} from './grep-scope-shape';
import { verifyLocalMachine } from './local-machine';
import { type ToolContext } from './types';
import {
  literalTargetPath,
  locatorContext,
  resolveMachinePath,
  type MachineTarget,
} from './workspace-path';

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

    if (!alias.ok) return invalidPathResult(alias.message);
    // The decoded path is the text its own scope is split at, and a glob
    // operator it carries is one the engine refuses.
    const split = splitGrepScope(alias.hostPath);

    return 'error' in split ? unsupportedGlobResult(split.operator) : undefined;
  }

  const scheme = parsePathScheme(scope);

  if (scheme === undefined) {
    // A scheme-less scope is a host path: grep parses no selector there, but
    // a glob operator it carries is still the engine's to refuse.
    const split = splitGrepScope(scope);

    return 'error' in split ? unsupportedGlobResult(split.operator) : undefined;
  }

  switch (scheme.scheme) {
    case KNOWLEDGE_SCHEME:
      return refuseUnsearchableKnowledgeScope(scheme.rest);
    case SKILL_SCHEME:
      return refuseUnsearchableSkillScope(scheme.rest);
    case MACHINE_SCHEME: {
      const parsed = machineScopeOf(scope, 0);

      return 'status' in parsed ? parsed : undefined;
    }

    default:
      return unsearchableSchemeResult(scheme.scheme);
  }
}

/** The closed result a scheme without a backend on this process returns. */
function unsearchableSchemeResult(scheme: string): GrepToolError {
  switch (scheme) {
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
): Promise<ResolvedScopes | { readonly result: GrepToolError }> {
  const scopes: Array<GrepScope> = [];
  // A bare `kb://` or `skill://` scope expands to one scope per Space or
  // package. Each expansion is its own scope, so it takes its own ordinal in
  // the walk order.
  let ordinal = 0;
  const machines: Array<MachineGrepScope> = [];

  for (const [index, scope] of submitted.entries()) {
    const outcome = await resolveScope(context, scope, index, admission);

    if ('result' in outcome) return outcome;

    if ('machine' in outcome) {
      machines.push({ ...outcome.machine, index: ordinal });
      ordinal += 1;
      continue;
    }

    for (const resolved of outcome.scopes) {
      scopes.push({ ...resolved, index: ordinal });
      ordinal += 1;
    }
  }

  return { scopes, machines };
}

async function resolveScope(
  context: ToolContext,
  scope: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  const scheme = parsePathScheme(scope);

  // A `file:` alias is a host path (design D6), placed by the locator rule
  // like a bare one; a scheme-less scope is a host path too.
  if (isFileAlias(scope) || scheme === undefined)
    return resolveHostScope(context, scope, index, admission);

  switch (scheme.scheme) {
    case KNOWLEDGE_SCHEME:
      return resolveKnowledgeScope(context, scheme.rest, index, admission);
    case SKILL_SCHEME:
      return resolveSkillScope(context, scheme.rest, index, admission);
    case MACHINE_SCHEME:
      return resolveMachineScheme(context, scope, index, admission);
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

/**
 * One host scope: the locator rule places it on its Machine, lexical
 * normalization settles `.` and `..` before any policy text is read, and the
 * glob split sets where the walk starts. A target on this process's own
 * Machine is walked in process after the identity-checked handshake; a target
 * on another Machine keeps its daemon walk (design D8).
 */
async function resolveHostScope(
  context: ToolContext,
  scope: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  const target = resolveMachinePath(scope, locatorContext(context));

  if (target.kind !== 'machine')
    return {
      result: invalidPathResult(
        target.kind === 'invalid'
          ? target.message
          : 'This path scheme cannot be searched.',
      ),
    };

  return resolveTarget(context, { scope, target, index, admission });
}

/**
 * One host scope after the locator rule placed it on its Machine: the text the
 * model wrote, the resolved target, and the call's own ordinal and admission.
 */
type HostTarget = {
  readonly scope: string;
  readonly target: MachineTarget;
  readonly index: number;
  readonly admission: GrepReadAdmission;
};

/**
 * One resolved Machine address: this process walks a target naming its own
 * Machine, and every other target is the named Machine's daemon walk.
 */
async function resolveTarget(
  context: ToolContext,
  host: HostTarget,
): Promise<ScopeOutcome> {
  const { target } = host;
  // The resolver splits a valid read selector off a bare path; grep parses no
  // selector, so the suffix stays the path text the model wrote.
  const normalized = normalizeHostScope(literalTargetPath(target));
  // A colon is path text here: grep parses no read selector.
  const split = splitGrepScope(normalized);

  if ('error' in split)
    return { result: unsupportedGlobResult(split.operator) };

  if (!target.local) return resolveRemoteTarget(context, host, split);

  const refused = await localScopeRefusal(context, normalized);

  if (refused !== undefined) return { result: refused };

  return buildLocalScope(context, {
    name: target.name,
    index: host.index,
    admission: host.admission,
    path: decodedHostPrefix(
      split.prefix.length > 1 && split.prefix.endsWith('/')
        ? split.prefix.slice(0, -1)
        : split.prefix,
      hostLiteralStart(
        host.scope,
        context.workspaceRoot?.current(),
        target.path,
      ),
    ),
    glob:
      split.globSuffix === undefined
        ? undefined
        : compileGlob(split.globSuffix),
    endsWithSeparator: split.endsWithSeparator,
  });
}

/** One other Machine's scope: its daemon walks the spelled locator text. */
function resolveRemoteTarget(
  context: ToolContext,
  host: HostTarget,
  split: GrepScopeSplit,
): Promise<ScopeOutcome> {
  const { target } = host;

  // The scope text decodes the literal spellings the model's part carries,
  // exactly as the local walk does, then spells each glob character back:
  // a directory named `a[b]` must reach the daemon as scope text its own
  // parser reads as one literal path.
  const decoded = decodedHostPrefix(
    split.prefix,
    hostLiteralStart(host.scope, context.workspaceRoot?.current(), target.path),
  );

  const literal = formatMachineLocator(target.name, decoded) ?? split.prefix;

  return resolveMachineScope(
    context,
    `${spellGrepMachineScopeLocator(literal)}${split.globSuffix ?? ''}`,
    host.index,
    host.admission,
  );
}

/**
 * One `machine://` scope: a target naming this process's own Machine shares
 * the in-process walk its bare form takes (design D8), and every other
 * Machine keeps its daemon walk.
 */
async function resolveMachineScheme(
  context: ToolContext,
  scope: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  const parsed = machineScopeOf(scope, index);

  if ('status' in parsed) return { result: parsed };
  const local = context.localMachine;

  if (local === undefined || parsed.name !== local.toLowerCase())
    return resolveMachineScope(context, scope, index, admission);

  const refused = await localScopeRefusal(context, parsed.path);

  if (refused !== undefined) return { result: refused };

  return buildLocalScope(context, {
    name: parsed.name,
    index,
    admission,
    path: parsed.path,
    glob:
      parsed.globSuffix === undefined
        ? undefined
        : compileGlob(parsed.globSuffix),
    endsWithSeparator: scope.endsWith('/'),
  });
}

/**
 * The refusals every in-process scope passes before it is walked: the worker's
 * own authority and path text first, then the identity-checked handshake.
 */
async function localScopeRefusal(
  context: ToolContext,
  normalized: string,
): Promise<GrepToolError | undefined> {
  const refused = hostScopeRefusal(context, normalized);

  if (refused !== undefined) return refused;
  const verification = await verifyLocalMachine(context);

  return verification === undefined
    ? undefined
    : isGrepToolError(verification)
      ? verification
      : executorUnavailableResult();
}

/** The authority and path checks every in-process scope passes first. */
function hostScopeRefusal(
  context: ToolContext,
  normalized: string,
): GrepToolError | undefined {
  if (context.runId === undefined || context.localMachine === undefined)
    return executorUnavailableResult();

  return !path.isAbsolute(normalized) || normalized.includes('\0')
    ? invalidPathResult('The scope path is invalid.')
    : undefined;
}

/**
 * The seven literal spellings decode in the prefix only, after the glob cut,
 * so a reported `%5B` names the directory and no encoded bracket is refused
 * as a glob operator. Only the model-supplied part decodes: a Workspace root
 * is a real path, so its own `%25` must survive.
 */
function decodedHostPrefix(
  encodedPrefix: string,
  literalStart: number,
): string {
  return (
    encodedPrefix.slice(0, literalStart) +
    decodeGrepLiteralSpelling(encodedPrefix.slice(literalStart))
  );
}

/** One scope this process walks in process, reported by canonical locators. */
type LocalScopeInput = {
  /** Lowercase Machine name every reported locator starts with. */
  readonly name: string;
  readonly index: number;
  readonly admission: GrepReadAdmission;
  /** Normalized absolute path, with no trailing separator but for `/`. */
  readonly path: string;
  readonly glob: CompiledGlob | undefined;
  readonly endsWithSeparator: boolean;
};

/** One in-process scope: the host tree's own walk, reported by locator. */
function buildLocalScope(
  context: ToolContext,
  input: LocalScopeInput,
): Promise<ScopeOutcome> {
  return buildScope({
    index: input.index,
    locatorFor: (rel) => {
      const pathText =
        rel.length === 0
          ? input.path
          : input.path === '/'
            ? `/${rel}`
            : `${input.path}/${rel}`;

      return formatMachineLocator(input.name, pathText) ?? pathText;
    },
    glob: input.glob,
    port: () => createHostWalkPort(input.path, context.abortSignal),
    probe: () => probeHostPath(input.path, context.abortSignal),
    endsWithSeparator: input.endsWithSeparator,
    admission: input.admission,
  });
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

  const entry = await readableSkillPackage(context, name);

  if ('result' in entry) return entry;

  const outcome = await resolveSkillPackage({
    skillDirectory: entry.skillDirectory,
    name: entry.name,
    rawPath,
    index,
    admission,
    signal: context.abortSignal,
  });

  if ('result' in outcome || 'machine' in outcome) return outcome;

  return { scopes: outcome.scopes };
}

/** A package whose directory this process can walk. */
type ReadableSkillPackage = {
  readonly name: string;
  readonly skillDirectory: string;
};

/** The package a `skill://<name>` scope names, once its access is settled. */
async function readableSkillPackage(
  context: ToolContext,
  name: string,
): Promise<ReadableSkillPackage | { readonly result: GrepToolError }> {
  const snapshot = await readSkillCatalog(context);

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
  if (context.skillCatalog === undefined) return { scopes: [] };
  const snapshot = await readSkillCatalog(context);

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

    if ('result' in outcome || 'machine' in outcome) return outcome;
    scopes.push(...outcome.scopes);
  }

  return { scopes };
}

function selectionOf(context: ToolContext): SkillSelection {
  return context.skillSelection ?? NO_SKILL_SELECTION;
}

/**
 * The skill catalog a `skill://` scope searches. A bound Workspace's own roots
 * are host reads on this Machine, so they are offered only after this call's
 * identity-checked handshake; a refused handshake leaves operator skills only.
 */
async function readSkillCatalog(
  context: ToolContext,
): Promise<SkillCatalogSnapshot | { readonly result: GrepToolError }> {
  const catalog = context.skillCatalog;

  if (catalog === undefined) return { result: skillCatalogUnavailableResult() };
  const root = context.workspaceRoot?.current();

  const snapshot = catalog.getSnapshot(
    root === undefined
      ? undefined
      : await verifiedWorkspaceSkillSources(root, {
          localMachine: context.localMachine,
          verifyLocal: async () =>
            (await verifyLocalMachine(context)) === undefined,
        }),
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
  });
}

function isSkillResourcePath(relativePath: string): boolean {
  return (
    relativePath.length === 0 ||
    validateSkillResourcePath(relativePath) !== undefined
  );
}
