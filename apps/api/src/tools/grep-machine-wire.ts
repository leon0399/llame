/**
 * The `fs.grep` wire: what one Machine request carries and what its answer's
 * paths mean. The hub validates the patterns and owns the bounds, so the
 * request only shapes them for the daemon, and the daemon answers paths
 * relative to its display prefix, which this module spells.
 */

import {
  type FsGrepParams,
  type FsGrepSuccess,
  type FsGrepWarningKind,
} from '@workspace/machine-protocol';
import { GREP_LIMITS, type GrepBudget } from '@workspace/native-file-tools';

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
      // One protocol message holds one daemon page: the page budget the wire
      // ships today, less the lines the result's envelope adds beside it.
      pageUnits: Math.max(0, budget.pageUnits - budget.fixedReserve),
      progressed: ask.progressed,
    },
  };
}

/** The excluded directories one Machine scope's pages report, capped. */
export type IgnoredAccumulator = {
  readonly scope: MachineGrepScope;
  readonly paths: Array<string>;
  /** The paths already counted, so a repeated page counts its exclusions once. */
  readonly seen: Set<string>;
  atLeast: boolean;
};

export function ignoredAccumulator(
  scope: MachineGrepScope,
): IgnoredAccumulator {
  return {
    scope,
    paths: [],
    seen: new Set(),
    atLeast: false,
  };
}

/**
 * Fold one daemon page's warnings, budget, and excluded directories into the
 * scope's totals. The daemon's own cap and this one both count recorded
 * directories, before the hub's `read` filter. A directory an earlier page of
 * the same scope already reported is counted once: a page asked again after a
 * position it shares lists the exclusion again, and the result names each
 * directory once per call.
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

  // The daemon's own time budget is the call's one stop however many pages it
  // ends, so the result never reports it twice.
  if (warnings.has('deadline')) warnings.set('deadline', 1);

  if (page.ignored === undefined) return;

  if (page.ignored.atLeast) ignored.atLeast = true;

  for (const rel of page.ignored.paths) {
    if (ignored.seen.has(rel)) continue;

    if (ignored.seen.size >= GREP_LIMITS.ignoredReported) {
      ignored.atLeast = true;
      break;
    }

    ignored.seen.add(rel);
    const locator = machineScopeLocator(ignored.scope, rel);

    if (locator === undefined) continue;
    ignored.paths.push(locator);
  }
}
