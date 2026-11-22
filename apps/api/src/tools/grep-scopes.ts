/**
 * The `grep` scope dispatch: a scheme becomes a walkable engine scope, or the
 * closed result that ends the call. Knowledge and skill scopes are resolved by
 * their own modules. Every path scope is a Machine scope: a bare path, a
 * `file:` alias, and a Workspace-relative path land on the current Machine,
 * and that Machine's daemon walks it exactly as it walks a spelled
 * `machine://` scope (host-as-machine design D8).
 */

import {
  decodeGrepLiteralSpelling,
  normalizeHostScope,
  parsePathScheme,
  spellGrepMachineScopeLocator,
  splitGrepScope,
  type GrepScope,
} from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';

import {
  formatMachineLocator,
  MACHINE_SCHEME,
} from '../machines/machine-locator';
import { MEDIA_LOCATOR_SCHEME } from '../media/media-locator';
import { isValidSkillName } from '../skills/skill-name';
import {
  type SkillCatalogEntry,
  type SkillCatalogSnapshot,
} from '../skills/skill-catalog';
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
import {
  isMachineGrepScope,
  machineScopeOf,
  resolveMachineScope,
  type MachineGrepScope,
} from './grep-machine';
import { decodeFileAlias, isFileAlias } from './permissions/file-alias';
import {
  invalidPathResult,
  selectorColonResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import {
  hasGlobOperator,
  hostLiteralStart,
  type ResolvedScopes,
  type ScopeOutcome,
} from './grep-scope-shape';
import { resolveSkillPackage } from './grep-skill-package';
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

/** One submitted scope and the call state its resolution may spend. */
type ScopeRequest = {
  readonly context: ToolContext;
  readonly scope: string;
  readonly index: number;
  readonly admission: GrepReadAdmission;
  /** The absolute instant the walk stops, shared with every probe. */
  readonly deadlineAt: number;
};

/** The call state one skill package expansion spends. */
type SkillCall = Pick<ScopeRequest, 'context' | 'admission' | 'deadlineAt'>;

export async function resolveScopes(
  context: ToolContext,
  submitted: ReadonlyArray<string>,
  admission: GrepReadAdmission,
  // A caller without a walk clock probes under the operation's own bound.
  deadlineAt: number = Number.POSITIVE_INFINITY,
): Promise<ResolvedScopes | { readonly result: GrepToolError }> {
  const scopes: Array<GrepScope> = [];
  // A bare `kb://` or `skill://` scope expands to one scope per Space or
  // package. Each expansion is its own scope, so it takes its own ordinal in
  // the walk order.
  let ordinal = 0;
  const machines: Array<MachineGrepScope> = [];

  for (const [index, scope] of submitted.entries()) {
    const outcome = await resolveScope({
      context,
      scope,
      index,
      admission,
      deadlineAt,
    });

    if ('result' in outcome) return outcome;

    if ('machine' in outcome) {
      machines.push({ ...outcome.machine, index: ordinal });
      ordinal += 1;
      continue;
    }

    // One expansion mixes host and Machine packages; its segments keep the
    // order the packages were expanded in, whatever backend walks each.
    for (const resolved of orderedExpansion(outcome)) {
      if (isMachineGrepScope(resolved))
        machines.push({ ...resolved, index: ordinal });
      else scopes.push({ ...resolved, index: ordinal });

      ordinal += 1;
    }
  }

  return { scopes, machines };
}

/**
 * One expansion's segments in package order, whatever their backend. A package
 * expansion numbers its segments; a Knowledge one shares the submitted index,
 * whose stable sort keeps the Space order it listed.
 */
function orderedExpansion(
  outcome: ResolvedScopes,
): ReadonlyArray<GrepScope | MachineGrepScope> {
  return [...outcome.scopes, ...(outcome.machines ?? [])].sort(
    (left, right) => left.index - right.index,
  );
}

async function resolveScope(request: ScopeRequest): Promise<ScopeOutcome> {
  const { context, scope, index, admission } = request;
  const scheme = parsePathScheme(scope);

  // A `file:` alias is a host path (design D6), placed by the locator rule
  // like a bare one; a scheme-less scope is a host path too.
  if (isFileAlias(scope) || scheme === undefined)
    return resolveHostScope(request);

  switch (scheme.scheme) {
    case KNOWLEDGE_SCHEME:
      return resolveKnowledgeScope(context, scheme.rest, index, admission);
    case SKILL_SCHEME:
      return resolveSkillScope(request, scheme.rest);
    case MACHINE_SCHEME:
      return resolveMachineScope(request);
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
 * glob split sets where the walk starts. The placed Machine's daemon walks it,
 * whether that Machine is this process's own or another one (design D8).
 */
async function resolveHostScope(request: ScopeRequest): Promise<ScopeOutcome> {
  const { context, scope } = request;
  const target = resolveMachinePath(scope, locatorContext(context));

  if (target.kind !== 'machine')
    return {
      result: invalidPathResult(
        target.kind === 'invalid'
          ? target.message
          : 'This path scheme cannot be searched.',
      ),
    };

  return resolvePlacedScope({ ...request, target });
}

/**
 * One host scope after the locator rule placed it on its Machine: the text the
 * model wrote, the resolved target, and the call's own ordinal, admission, and
 * walk clock.
 */
type HostTarget = ScopeRequest & {
  readonly target: MachineTarget;
};

/**
 * One placed Machine scope: lexical normalization settles `.` and `..` before
 * any policy text is read, the glob split sets where the walk starts, and the
 * spelled locator text reaches that Machine's daemon, whether that Machine is
 * this process's own or another one (design D8).
 */
async function resolvePlacedScope(host: HostTarget): Promise<ScopeOutcome> {
  const { context, target } = host;
  // The resolver splits a valid read selector off a bare path; grep parses no
  // selector, so the suffix stays the path text the model wrote.
  const normalized = normalizeHostScope(literalTargetPath(target));
  // A colon is path text here: grep parses no read selector.
  const split = splitGrepScope(normalized);

  if ('error' in split)
    return { result: unsupportedGlobResult(split.operator) };

  // The scope text decodes the literal spellings the model's part carries,
  // exactly as the daemon's own parse does, then spells each glob character
  // back: a directory named `a[b]` must reach the daemon as scope text its
  // own parser reads as one literal path.
  const decoded = decodedHostPrefix(
    split.prefix,
    hostLiteralStart(host.scope, context.workspaceRoot?.current(), target.path),
  );

  const literal = formatMachineLocator(target.name, decoded) ?? split.prefix;

  return resolveMachineScope({
    context,
    scope: `${spellGrepMachineScopeLocator(literal)}${split.globSuffix ?? ''}`,
    index: host.index,
    admission: host.admission,
    deadlineAt: host.deadlineAt,
  });
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

async function resolveSkillScope(
  request: ScopeRequest,
  rest: string,
): Promise<ScopeOutcome> {
  const { context, index, admission, deadlineAt } = request;

  if (rest.length === 0) return resolveEverySkill(request);
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

  return resolveSkillPackage({
    context,
    skillDirectory: entry.skillDirectory,
    name: entry.name,
    rawPath,
    index,
    admission,
    signal: context.abortSignal,
    deadlineAt,
  });
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

async function resolveEverySkill(request: ScopeRequest): Promise<ScopeOutcome> {
  const { context, admission, deadlineAt } = request;

  if (context.skillCatalog === undefined) return { scopes: [], machines: [] };
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
  const machines: Array<MachineGrepScope> = [];
  // A package keeps its place in the byte order, whether a host path or a
  // Machine locator: a mixed catalog stays one expansion in package order.
  let ordinal = request.index;

  for (const entry of packages) {
    const outcome = await expandSkill(
      { context, admission, deadlineAt },
      entry,
      ordinal,
    );

    if ('result' in outcome) return outcome;

    if ('machine' in outcome) machines.push(outcome.machine);
    else scopes.push(...outcome.scopes);

    ordinal += 1;
  }

  return { scopes, machines };
}

/** One package of a bare scope, expanded at its place in the byte order. */
function expandSkill(
  call: SkillCall,
  entry: SkillCatalogEntry,
  index: number,
): Promise<ScopeOutcome> {
  const { context } = call;

  if (!entry.available || entry.skillDirectory === null) {
    return Promise.resolve({ result: skillUnavailableResult() });
  }

  return resolveSkillPackage({
    context,
    skillDirectory: entry.skillDirectory,
    name: entry.name,
    rawPath: '',
    index,
    admission: call.admission,
    signal: context.abortSignal,
    deadlineAt: call.deadlineAt,
  });
}

function selectionOf(context: ToolContext): SkillSelection {
  return context.skillSelection ?? NO_SKILL_SELECTION;
}

/**
 * The skill catalog a `skill://` scope searches. A bound Workspace's own roots
 * are Machine locators the attempt's snapshot read from the Workspace's
 * Machine; operator skills stay installation resources.
 */
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
