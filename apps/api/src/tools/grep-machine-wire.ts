/**
 * The `fs.grep` wire: what one Machine request carries and what its answer's
 * paths mean. The hub validates the patterns and owns the cursor and the
 * bounds, so the request only shapes them for the daemon, and the daemon
 * answers paths relative to its display prefix, which this module spells or
 * resumes from.
 */

import {
  fsGrepCursorKey,
  type FsGrepParams,
  type FsGrepSuccess,
  type FsGrepWarningKind,
} from '@workspace/machine-protocol';
import {
  encodeGrepCursor,
  GREP_LIMITS,
  type DecodedGrepCursor,
  type GrepBudget,
} from '@workspace/native-file-tools';

import { formatMachineLocator } from '../machines/machine-locator';
import { type GrepReadAdmission } from './grep-admission';
import { type MachineGrepScope, type MachineGrepSearch } from './grep-machine';

/** One daemon page a request asks for. */
export type DaemonAsk = {
  readonly budget: GrepBudget;
  readonly cursor: string | undefined;
  /** Whether the call already progressed before this page. */
  readonly progressed: boolean;
};

/** The path two parts join to: no separator for an empty relative part. */
function machinePath(prefix: string, rel: string): string {
  if (rel.length === 0) return prefix;
  return prefix === '/' ? `/${rel}` : `${prefix}/${rel}`;
}

/** The Machine locator of one path relative to a scope's prefix. */
export function machineScopeLocator(
  scope: MachineGrepScope,
  rel: string,
): string | undefined {
  return formatMachineLocator(scope.name, machinePath(scope.path, rel));
}

/**
 * A daemon's unfinished file as a locator, or undefined when it is not one the
 * `read` group admits: a refused file is never named, and the cursor still
 * moves past it.
 */
export function namedUnfinished(
  scope: MachineGrepScope,
  rel: string,
  admission: GrepReadAdmission,
): string | undefined {
  const locator = machineScopeLocator(scope, rel);
  return locator !== undefined && admission.admit(locator)
    ? locator
    : undefined;
}

/** The key the daemon binds its own page to, built from the same inputs. */
export function requestCursorKey(search: MachineGrepSearch): string {
  return fsGrepCursorKey({
    path: search.scope.path,
    globSuffix: search.scope.globSuffix,
    patterns: search.args.patterns,
    literal: search.args.literal,
    ignoreCase: search.args.ignoreCase,
  });
}

/**
 * The daemon's own cursor for the call's resume point: a passage continues
 * that passage (from its last emitted line when it was cut), a position
 * resumes after the entry a bound stopped at.
 */
export function daemonCursor(
  search: MachineGrepSearch,
  resume: DecodedGrepCursor,
): string {
  const inputHash = requestCursorKey(search);
  return resume.kind === 'position'
    ? encodeGrepCursor({
        kind: 'position',
        scopeIndex: 0,
        rel: resume.rel,
        inputHash,
      })
    : encodeGrepCursor({
        scopeIndex: 0,
        rel: resume.rel,
        startLine: resume.startLine,
        ...(resume.endLine !== undefined && { endLine: resume.endLine }),
        ...(resume.truncated === true && { truncated: true as const }),
        inputHash,
      });
}

/** One `fs.grep` request: the remaining budget and, on resume, the page key. */
export function requestOf(
  search: MachineGrepSearch,
  envelope: FsGrepParams['envelope'],
  ask: DaemonAsk,
): FsGrepParams {
  const { scope, args } = search;
  const { budget, cursor } = ask;
  return {
    envelope,
    path: scope.path,
    ...(scope.globSuffix !== undefined && { globSuffix: scope.globSuffix }),
    patterns: args.patterns,
    literal: args.literal,
    ignoreCase: args.ignoreCase,
    ...(cursor !== undefined && { cursor }),
    bounds: {
      files: budget.files,
      entries: budget.entries,
      bytes: budget.bytes,
      fileBytes: budget.maxFileBytes,
      // Nine tenths of the time left: a daemon that spends its whole budget
      // still answers before the hub abandons the request, so its page,
      // cursor, and unfinished file are never lost.
      deadlineMs: Math.max(1, Math.floor((budget.deadlineMs * 9) / 10)),
      limit: budget.limit,
      // The daemon reserves its own continuation line only; the hub's
      // warnings, notice, and envelope lines must also fit, or a daemon page
      // the hub then drops whole would come back unchanged on every resume.
      pageUnits: Math.max(0, budget.pageUnits - budget.fixedReserve),
      progressed: ask.progressed,
    },
  };
}

/**
 * Where a daemon that stopped inside a file it named left the call. A Machine
 * single-file scope ignores a cursor, so the hub moves its ordinal past the
 * scope itself; a directory scope resumes after the file.
 */
export function unfinishedPosition(
  search: MachineGrepSearch,
  page: { readonly unfinished?: string },
): { readonly scopeIndex: number; readonly rel: string } | undefined {
  const rel = page.unfinished;
  if (rel === undefined) return undefined;
  // A single-file walk yields only `""` and ignores a cursor, so the hub moves
  // past the scope ordinal; a directory scope resumes after the file.
  return rel === ''
    ? { scopeIndex: search.scope.index + 1, rel: '' }
    : { scopeIndex: search.scope.index, rel };
}

/** The excluded directories one Machine scope's pages report, capped. */
export type IgnoredAccumulator = {
  readonly scope: MachineGrepScope;
  readonly paths: Array<string>;
  /** Each locator's scope-relative path, so a page cut can filter them. */
  readonly rels: Array<string>;
  recorded: number;
  atLeast: boolean;
};

export function ignoredAccumulator(
  scope: MachineGrepScope,
): IgnoredAccumulator {
  return { scope, paths: [], rels: [], recorded: 0, atLeast: false };
}

/**
 * Fold one daemon page's warnings, budget, and excluded directories into the
 * scope's totals. The daemon's own cap and this one both count recorded
 * directories, before the hub's `read` filter.
 */
export function mergePage(
  warnings: Map<FsGrepWarningKind, number>,
  consumed: { files: number; entries: number; bytes: number },
  ignored: IgnoredAccumulator,
  page: FsGrepSuccess,
): void {
  for (const warning of page.warnings)
    warnings.set(
      warning.kind,
      (warnings.get(warning.kind) ?? 0) + warning.count,
    );
  consumed.files += page.consumed.files;
  consumed.entries += page.consumed.entries;
  consumed.bytes += page.consumed.bytes;
  if (page.ignored === undefined) return;
  if (page.ignored.atLeast) ignored.atLeast = true;
  for (const rel of page.ignored.paths) {
    if (ignored.recorded >= GREP_LIMITS.ignoredReported) {
      ignored.atLeast = true;
      break;
    }
    ignored.recorded += 1;
    const locator = machineScopeLocator(ignored.scope, rel);
    if (locator === undefined) continue;
    ignored.paths.push(locator);
    ignored.rels.push(rel);
  }
}
