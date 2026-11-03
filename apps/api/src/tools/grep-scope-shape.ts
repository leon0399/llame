/**
 * The parts every scope scheme shares: the glob split of a raw path part, the
 * exact-path probe, and the engine scope it builds. Kept apart from the scheme
 * modules so Knowledge and skill resolution import one shape, never each other.
 */

import {
  compileGlob,
  normalizeHostScope,
  splitGrepScope,
  type CompiledGlob,
  type GrepScope,
} from '@workspace/native-file-tools';

import { decodeRelativePath } from './locator-spelling';
import { isFileAlias } from './permissions/file-alias';
import { isWorkspaceRelative } from './workspace-path';
import { type GrepReadAdmission } from './grep-admission';
import { type MachineGrepScope } from './grep-machine';
import {
  invalidPathResult,
  notFoundResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import { type ScopeProbe } from './grep-ports';

/** One normalized host path without a trailing separator but for `/`. */
function trimHostSeparator(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

/** The length of the segment prefix two normalized paths share, separators included. */
function sharedSegmentPrefix(left: string, right: string): number {
  const leftParts = left.split('/');
  const rightParts = right.split('/');
  let shared = 0;
  while (
    shared < leftParts.length &&
    shared < rightParts.length &&
    leftParts[shared] === rightParts[shared]
  )
    shared += 1;
  const joined = leftParts.slice(0, shared).join('/');
  return joined.length === 0 ? 0 : joined.length + 1;
}

/** Two normalized host paths are equal, a trailing separator aside. */
export function sameHostPath(left: string, right: string): boolean {
  return trimHostSeparator(left) === trimHostSeparator(right);
}

/**
 * Where a placed host path stops being the Workspace root's own text. A
 * relative scope shares only the root segments its `..` segments leave in
 * place, so its decoded part starts after that shared prefix. An absolute
 * scope is model text whole, except one that names the root itself; a file
 * alias is already a decoded host path.
 */
export function hostLiteralStart(
  scope: string,
  root: string | undefined,
  placed: string,
): number {
  if (isFileAlias(scope)) return normalizeHostScope(placed).length;
  if (root === undefined) return 0;
  const rootText = normalizeHostScope(root);
  const placedText = normalizeHostScope(placed);
  if (isWorkspaceRelative(scope))
    return sharedSegmentPrefix(rootText, placedText);
  return sameHostPath(normalizeHostScope(scope), rootText)
    ? placedText.length
    : 0;
}

/** One scope set a call resolved. */
export type ResolvedScopes = {
  readonly scopes: ReadonlyArray<GrepScope>;
  /** Machine scopes, each executed as one request on its Machine. */
  readonly machines?: ReadonlyArray<MachineGrepScope>;
};

/** Either one Machine scope, a resolved scope set, or the result that ends the call. */
export type ScopeOutcome =
  | ResolvedScopes
  | { readonly machine: MachineGrepScope }
  | { readonly result: GrepToolError };

/** The characters splitGrepScope treats as glob operators. */
const GLOB_OPERATORS = ['*', '?', '{', '}', '[', ']'] as const;

export function hasGlobOperator(text: string): boolean {
  return GLOB_OPERATORS.some((operator) => text.includes(operator));
}

/** One raw scope path, split at its first glob segment and decoded. */
type ParsedScopePath = {
  readonly prefixPath: string;
  readonly glob: CompiledGlob | undefined;
  readonly endsWithSeparator: boolean;
};

/**
 * Split a raw path part at the first glob segment and decode the literal
 * prefix before any probe. `isValidPath` is the scheme's own path rule, so a
 * path its resolver would refuse never reaches the filesystem.
 */
export function splitScopePath(
  rawPath: string,
  isValidPath: (decoded: string) => boolean,
): ParsedScopePath | GrepToolError {
  const split = splitGrepScope(rawPath);
  if ('error' in split) return unsupportedGlobResult(split.operator);
  const encodedPrefix = split.prefix.endsWith('/')
    ? split.prefix.slice(0, -1)
    : split.prefix;
  const prefixPath = decodeRelativePath(encodedPrefix);
  if (prefixPath === undefined || !isValidPath(prefixPath)) {
    return invalidPathResult('The scope path is invalid.');
  }
  return {
    prefixPath,
    glob:
      split.globSuffix === undefined
        ? undefined
        : compileGlob(split.globSuffix),
    endsWithSeparator: split.endsWithSeparator,
  };
}

/**
 * Whether a glob-free scope names one file. The probe comes first, so only a
 * path that really is a regular file is checked against the `read` group: a
 * directory scope is walked with a per-file check, and the directory itself is
 * never counted as a refused file. A refused file looks missing, exactly as an
 * absent one does.
 */
async function decideScopeKind(
  locator: string,
  endsWithSeparator: boolean,
  admission: GrepReadAdmission,
  probe: () => Promise<ScopeProbe>,
): Promise<ScopeProbe> {
  const probed = await probe();
  if ('result' in probed) return probed;
  if (probed.kind !== 'file') return probed;
  if (endsWithSeparator) return { kind: 'missing' };
  return admission.admit(locator) ? probed : { kind: 'missing' };
}

/** Everything one scheme settles before the shared probe runs. */
export type ScopeDraft = {
  readonly index: number;
  readonly locatorFor: (rel: string) => string;
  readonly glob: CompiledGlob | undefined;
  readonly port: () => GrepScope['port'];
  readonly probe: () => Promise<ScopeProbe>;
  readonly endsWithSeparator: boolean;
  readonly admission: GrepReadAdmission;
};

/** Finish one scope: probe a glob-free prefix, then mark it single-file. */
export async function buildScope(draft: ScopeDraft): Promise<ScopeOutcome> {
  const prefix = draft.locatorFor('');
  const base: GrepScope = {
    index: draft.index,
    locatorPrefix: `${prefix}/`,
    port: draft.port(),
    glob: draft.glob,
    singleFile: false,
    locatorFor: draft.locatorFor,
  };
  if (draft.glob !== undefined) return { scopes: [base] };
  const decided = await decideScopeKind(
    prefix,
    draft.endsWithSeparator,
    draft.admission,
    draft.probe,
  );
  if ('result' in decided) return decided;
  if (decided.kind === 'missing') return { result: notFoundResult() };
  return {
    scopes: [
      {
        ...base,
        locatorPrefix: decided.kind === 'file' ? prefix : `${prefix}/`,
        singleFile: decided.kind === 'file',
      },
    ],
  };
}
