/**
 * The parts every scope scheme shares: the glob split of a raw path part, the
 * exact-path probe, and the engine scope it builds. Kept apart from the scheme
 * modules so Knowledge and skill resolution import one shape, never each other.
 */

import {
  compileGlob,
  splitGrepScope,
  type CompiledGlob,
  type GrepScope,
} from '@workspace/native-file-tools';

import { decodeRelativePath } from './locator-spelling';
import { type GrepReadAdmission } from './grep-admission';
import {
  invalidPathResult,
  notFoundResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import { type ScopeProbe } from './grep-ports';

/** One scope set a call resolved, plus the roots its cursor is keyed on. */
export type ResolvedScopes = {
  readonly scopes: ReadonlyArray<GrepScope>;
  readonly roots: ReadonlyArray<string>;
};

/** Either a resolved scope set or the result that ends the whole call. */
export type ScopeOutcome = ResolvedScopes | { readonly result: GrepToolError };

/** The characters splitGrepScope treats as glob operators. */
const GLOB_OPERATORS = ['*', '?', '{', '}', '[', ']'] as const;

export function hasGlobOperator(text: string): boolean {
  return GLOB_OPERATORS.some((operator) => text.includes(operator));
}

/**
 * The canonical locator with a literal glob character encoded, so a hit or a
 * prefix returns as a scope that applies no glob.
 */
export function encodeSearchLocator(locator: string): string {
  return locator.replaceAll('*', '%2A').replaceAll('?', '%3F');
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
  readonly root: string;
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
  if (draft.glob !== undefined) {
    return { scopes: [base], roots: [draft.root] };
  }
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
    roots: [draft.root],
  };
}
