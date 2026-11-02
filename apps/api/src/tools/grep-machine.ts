/**
 * The `machine://` backend of the `grep` tool: one Machine scope, walked by
 * the daemon through `MachineConnector` over as many `fs.grep` pages as the
 * scope needs. The daemon walks and matches locally; this module renders each
 * returned path as a Machine locator, judges the `read` group per file on that
 * locator, and reports what the call will append. A host path never leaves the
 * daemon, and a passage from a file `read` refuses never reaches the result.
 */

import {
  FS_GREP_METHOD,
  FS_STAT_METHOD,
  MachineProtocolError,
  type FsGrepConsumed,
  type FsGrepPassage,
  type FsGrepSuccess,
  type FsGrepWarning,
  type FsGrepWarningKind,
} from '@workspace/machine-protocol';
import {
  normalizeHostScope,
  splitGrepScope,
  type GrepBudget,
  type GrepIgnored,
  type GrepPassage,
  type GrepScope,
} from '@workspace/native-file-tools';

import {
  MachineUnavailableError,
  type MachineConnector,
} from '../machines/machine-connector.service';
import {
  formatMachineLocator,
  MACHINE_NAME_PATTERN,
} from '../machines/machine-locator';
import {
  readFsGrepResult,
  readFsStatResult,
} from '../machines/machine-results';
import { type GrepReadAdmission } from './grep-admission';
import {
  invalidPathResult,
  machineUnsupportedResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import { decodeRelativePath } from './locator-spelling';
import {
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineProtocolFailureResult,
  machineUnavailableResult,
  machineUnusableResult,
  type MachineFailureResult,
} from './machine-call';
import {
  ignoredAccumulator,
  machineScopeLocator,
  mergePage,
  requestOf,
  type DaemonAsk,
  type IgnoredAccumulator,
} from './grep-machine-wire';
import { budgetAfter } from './grep-page';
import { type ToolContext, type ToolResult } from './types';

/** One Machine scope: the prefix the daemon searches and its glob suffix. */
export type MachineGrepScope = {
  readonly index: number;
  readonly name: string;
  /** The absolute Machine path; normalized, with no trailing separator. */
  readonly path: string;
  /** The glob text from the first glob segment onward, as submitted. */
  readonly globSuffix: string | undefined;
  /**
   * The exact-path probe found one regular file, so the daemon walks it
   * without listing: no entry is counted, and the file bound trips first.
   * Absent (a directory or glob scope) lists entries before any candidate.
   */
  readonly singleFile?: boolean;
};

/** The compiled search the call resolved before either backend ran. */
export type GrepSearchArguments = {
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
};

/** One Machine scope's walk, or the result that ends the call. */
export type MachineGrepSegment =
  | {
      readonly status: 'success';
      readonly passages: ReadonlyArray<GrepPassage>;
      readonly complete: boolean;
      readonly warnings: ReadonlyArray<FsGrepWarning>;
      readonly consumed: { files: number; entries: number; bytes: number };
      /** Whether this scope's walk got past the point the call started at. */
      readonly progressed: boolean;
      /** The file a bound stopped the daemon walk inside, relative to the prefix. */
      readonly unfinished?: string;
      /** The excluded directory locators of this scope, capped across its pages. */
      readonly ignored?: GrepIgnored;
    }
  | { readonly status: 'error'; readonly result: ToolResult };

/** Everything one Machine scope needs to run its request. */
export type MachineGrepSearch = {
  readonly context: ToolContext;
  readonly scope: MachineGrepScope;
  readonly args: GrepSearchArguments;
  /** What is left of the call's bounds, shared with every other scope. */
  readonly budget: GrepBudget;
  /** Whether the call already progressed in an earlier scope or page. */
  readonly progressed: boolean;
  readonly admission: GrepReadAdmission;
};

/** Whether a resolved scope is a Machine one, for the call's ordering. */
export function isMachineGrepScope(
  scope: GrepScope | MachineGrepScope,
): scope is MachineGrepScope {
  return !('port' in scope);
}

/** The resolution of one `machine://` scope: its search target, or a refusal. */
export type MachineScopeResolution =
  | { readonly machine: MachineGrepScope }
  | { readonly result: GrepToolError };

/**
 * One `machine://` scope, or the result that ends the call. The path is split
 * at its first glob segment before any decoding — so `%2A` stays a literal
 * filename character — and normalized lexically, exactly as a host scope. A
 * glob-free scope is probed first: a regular file the `read` group refuses
 * answers the `not_found` a missing path gets, while a directory scope is
 * walked with a per-file check.
 */
export async function resolveMachineScope(
  context: ToolContext,
  scope: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<MachineScopeResolution> {
  const parsed = machineScopeOf(scope, index);
  if ('status' in parsed) return { result: parsed };
  const connector = machineConnector(context);
  if (connector === undefined) return { result: machineUnsupportedResult() };
  if (!connector.isConfigured(parsed.name))
    return { result: machineNotFoundResult(parsed.name) };
  const verdict = await exactPathVerdict(context, connector, parsed, admission);
  if ('result' in verdict) return { result: verdict.result };
  if (verdict.kind === 'refused')
    return { result: machinePathNotFoundResult() };
  return {
    machine: verdict.singleFile ? { ...parsed, singleFile: true } : parsed,
  };
}

/** What the exact-path rule settled for one glob-free Machine scope. */
type ExactPathVerdict =
  | { readonly kind: 'walk'; readonly singleFile: boolean }
  | { readonly kind: 'refused' }
  | { readonly result: GrepToolError };

/** The result a missing Machine path and a `read`-refused one both answer. */
function machinePathNotFoundResult(): GrepToolError {
  return { status: 'error', type: 'not_found', message: NOT_FOUND_MESSAGE };
}

/**
 * The `read` verdict for a glob-free scope that names one regular file. The
 * daemon's own stat is the probe, so a directory scope keeps its per-file
 * checks and the directory itself never counts as a refused file. Anything
 * the probe cannot settle — a refusal, an unusable answer — is left to the
 * search, which reports the same failure with its own message.
 */
async function exactPathVerdict(
  context: ToolContext,
  connector: MachineConnector,
  scope: MachineGrepScope,
  admission: GrepReadAdmission,
): Promise<ExactPathVerdict> {
  if (scope.globSuffix !== undefined)
    return { kind: 'walk', singleFile: false };
  const locator = formatMachineLocator(scope.name, scope.path);
  if (locator === undefined) return { kind: 'walk', singleFile: false };
  try {
    const answer = readFsStatResult(
      await connector.request(
        scope.name,
        FS_STAT_METHOD,
        {
          envelope: machineCallEnvelope(
            context,
            machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
          ),
          path: scope.path,
        },
        { signal: context.abortSignal },
      ),
    );
    if (answer === undefined || answer.kind !== 'file' || answer.isLink)
      return { kind: 'walk', singleFile: false };
    return admission.admit(locator)
      ? { kind: 'walk', singleFile: true }
      : { kind: 'refused' };
  } catch (error) {
    return { result: machineGrepFailure(scope.name, error) };
  }
}

/** The one refusal message for a Machine scope with no path to search. */
const NO_PATH_MESSAGE =
  'A machine:// scope must name a Machine and an absolute path.';
const BAD_NAME_MESSAGE =
  'A machine:// scope must name a Machine as [a-z0-9-], up to 63 characters.';
const BAD_PATH_MESSAGE = 'The Machine scope path is invalid.';
/** What the daemon answers for a path that does not exist. */
const NOT_FOUND_MESSAGE = 'The target does not exist.';

/** The text parse of a `machine://` scope; also the pre-admission shape check. */
export function machineScopeOf(
  scope: string,
  index: number,
): MachineGrepScope | GrepToolError {
  // `machine://` is fixed width whatever the case of the scheme.
  const rest = scope.slice('machine://'.length);
  const separator = rest.indexOf('/');
  if (separator < 0) return invalidPathResult(NO_PATH_MESSAGE);
  const name = rest.slice(0, separator).toLowerCase();
  if (!MACHINE_NAME_PATTERN.test(name))
    return invalidPathResult(BAD_NAME_MESSAGE);
  const split = splitGrepScope(rest.slice(separator));
  if ('error' in split) return unsupportedGlobResult(split.operator);
  const prefix =
    split.prefix !== '/' && split.prefix.endsWith('/')
      ? split.prefix.slice(0, -1)
      : split.prefix;
  const decoded = decodeRelativePath(prefix);
  if (
    decoded === undefined ||
    !decoded.startsWith('/') ||
    decoded.includes('\u0000')
  )
    return invalidPathResult(BAD_PATH_MESSAGE);
  return {
    index,
    name,
    path: normalizeHostScope(decoded),
    globSuffix: split.globSuffix,
  };
}

/**
 * Run one Machine scope. The connector's refusals become the Machine results
 * `read` uses; a daemon that does not know the method is Machine unusable.
 */
export async function executeMachineScope(
  search: MachineGrepSearch,
): Promise<MachineGrepSegment> {
  const { context, scope } = search;
  const connector = machineConnector(context);
  if (connector === undefined)
    return { status: 'error', result: machineUnsupportedResult() };
  if (!connector.isConfigured(scope.name))
    return { status: 'error', result: machineNotFoundResult(scope.name) };
  try {
    return await runDaemonPages(
      search,
      connector,
      Date.now() + Math.max(1, search.budget.deadlineMs),
    );
  } catch (error) {
    return { status: 'error', result: machineGrepFailure(scope.name, error) };
  }
}

/** One `fs.grep` answer, or the result that ends the call. */
type DaemonPage =
  | { readonly page: FsGrepSuccess }
  | { readonly result: GrepToolError };

/**
 * One Machine scope, paged on the daemon position inside the call: each
 * response is asked on after the previous one's position, so a page of refused
 * passages still advances the walk and a page that kept passages asks for the
 * next one. The walk ends at the scope's end or the bound or deadline that
 * stopped it.
 *
 * A page that stopped inside a file the daemon could not finish is skipped:
 * the next request starts after that file and never opens it again in this
 * call, while the segment still names it, because its walk is incomplete.
 *
 * Progress belongs to the call: a page that got past the start point lets the
 * next request know, so its own stop hides no file behind it.
 */
async function runDaemonPages(
  search: MachineGrepSearch,
  connector: MachineConnector,
  deadlineAt: number,
): Promise<MachineGrepSegment> {
  const run: MachineSegmentPage = {
    budget: budgetAfter(
      search.budget,
      { files: 0, entries: 0, bytes: 0 },
      deadlineAt,
    ),
    passages: [],
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    ignored: ignoredAccumulator(search.scope),
    deadlineAt,
    cursor: undefined,
    progressed: search.progressed,
    last: undefined,
    unfinished: undefined,
  };
  while (canAskPage(run.budget, search.scope.singleFile === true)) {
    const asked = await requestPage(search, connector, {
      budget: run.budget,
      cursor: run.cursor,
      progressed: run.progressed,
    });
    if ('result' in asked) return { status: 'error', result: asked.result };
    const step = takePage(search, run, asked.page);
    if ('result' in step) return { status: 'error', result: step.result };
    if (step.ended) break;
  }
  return segmentOfPages(search, run);
}

/** One Machine scope's pages, as the loop between them carries them. */
type MachineSegmentPage = {
  readonly passages: Array<GrepPassage>;
  readonly warnings: Map<FsGrepWarningKind, number>;
  readonly consumed: FsGrepConsumed;
  readonly ignored: IgnoredAccumulator;
  readonly deadlineAt: number;
  budget: GrepBudget;
  cursor: string | undefined;
  progressed: boolean;
  last: FsGrepSuccess | undefined;
  /** The file the daemon stopped inside that the call skipped, if any. */
  unfinished: string | undefined;
};

/** One page's effect on the run; `ended` says the scope has no next page. */
type PageStep =
  | { readonly ended: boolean }
  | { readonly result: GrepToolError };

/** Fold one page into the run, and say whether the scope has another. */
function takePage(
  search: MachineGrepSearch,
  run: MachineSegmentPage,
  page: FsGrepSuccess,
): PageStep {
  run.last = page;
  mergePage(run.warnings, run.consumed, run.ignored, page);
  run.progressed = run.progressed || page.progressed;
  const refused = renderPage(search, page, run.passages);
  if (refused !== undefined) return { result: refused };
  if (page.unfinished !== undefined) {
    // A second stop inside a file ends the scope at the first one: one call
    // names one file, and the next call opens the second with a full budget.
    if (run.unfinished !== undefined) return { ended: true };
    run.unfinished = page.unfinished;
    // A one-file walk ignores a cursor, so a stop in it can only end the scope.
    if (search.scope.singleFile === true) return { ended: true };
  }
  const next = nextCursor(page, run.cursor);
  if (next === undefined) return { ended: true };
  run.cursor = next;
  run.budget = budgetAfter(run.budget, page.consumed, run.deadlineAt);
  return { ended: false };
}

/** One Machine scope's pages, as the segment the call appends. */
function segmentOfPages(
  search: MachineGrepSearch,
  pages: MachineSegmentPage,
): MachineGrepSegment {
  const singleFile = search.scope.singleFile === true;
  // A skipped file leaves the walk incomplete even when a later page ended
  // the scope: the call knows a file it could not finish.
  const complete =
    pages.last?.complete === true && pages.unfinished === undefined;
  if (complete) {
    // The daemon's own nine-tenths time budget belongs to one response: a walk
    // that finished after it did not stop at the call deadline.
    pages.warnings.delete('deadline');
  } else if (!namesStop(pages.warnings)) {
    // The walk stopped without a reported reason: name the bound that left no
    // budget for another page, or the call deadline it reached. A page can
    // spend its bound exactly at its own page end, before it reports the stop.
    const budget = pages.last === undefined ? search.budget : pages.budget;
    const stopped = canAskPage(budget, singleFile)
      ? undefined
      : (spentBound(budget, singleFile) ??
        (budget.deadlineMs <= 0 ? 'deadline' : undefined));
    if (stopped !== undefined) pages.warnings.set(stopped, 1);
  }
  return {
    status: 'success',
    passages: pages.passages,
    complete,
    warnings: [...pages.warnings].map(([kind, count]) => ({ kind, count })),
    consumed: pages.consumed,
    progressed: pages.progressed,
    ...(pages.unfinished !== undefined && { unfinished: pages.unfinished }),
    ...(pages.ignored.paths.length > 0 && {
      ignored: {
        paths: pages.ignored.paths,
        atLeast: pages.ignored.atLeast,
      },
    }),
  };
}

/** The warnings that name a bound or deadline a walk stopped at. */
const STOP_WARNING_KINDS: ReadonlyArray<FsGrepWarningKind> = [
  'file_bound',
  'entry_bound',
  'byte_bound',
  'deadline',
];

function namesStop(warnings: ReadonlyMap<FsGrepWarningKind, number>): boolean {
  return STOP_WARNING_KINDS.some((kind) => warnings.has(kind));
}

/**
 * The count bound a segment starts already spent under, if any, in the order
 * the walk would trip it: a directory lists entries first, while a direct-file
 * scope counts none and checks the file bound at its one candidate.
 */
function spentBound(
  budget: GrepBudget,
  singleFile: boolean,
): FsGrepWarningKind | undefined {
  if (!singleFile && budget.entries === 0) return 'entry_bound';
  if (budget.files === 0) return 'file_bound';
  if (budget.bytes === 0) return 'byte_bound';
  return undefined;
}

/**
 * The cursor the next page is asked with, or undefined when this page ended
 * the scope's walk: the page is complete, or asking again would fetch the same
 * page (the daemon consumed nothing, or named the cursor it was asked with).
 */
function nextCursor(
  page: FsGrepSuccess,
  cursor: string | undefined,
): string | undefined {
  if (page.complete) return undefined;
  if (page.consumed.files + page.consumed.entries + page.consumed.bytes === 0)
    return undefined;
  return page.cursor === undefined || page.cursor === cursor
    ? undefined
    : page.cursor;
}

/**
 * Whether the remaining budget can buy one more daemon page. A direct-file
 * scope counts no entry, so a spent entry bound does not stop it, exactly as
 * the engine's single-file walk never calls the entry counter.
 */
function canAskPage(budget: GrepBudget, singleFile: boolean): boolean {
  return (
    budget.deadlineMs > 0 &&
    (budget.files === null || budget.files > 0) &&
    (singleFile || budget.entries === null || budget.entries > 0) &&
    (budget.bytes === null || budget.bytes > 0)
  );
}

/** One `fs.grep` request under the given budget and resume key. */
async function requestPage(
  search: MachineGrepSearch,
  connector: MachineConnector,
  ask: DaemonAsk,
): Promise<DaemonPage> {
  const { context, scope } = search;
  const raw = await connector.request(
    scope.name,
    FS_GREP_METHOD,
    requestOf(
      search,
      machineCallEnvelope(
        context,
        machineBudgetMs(context, Math.max(1, ask.budget.deadlineMs)),
      ),
      ask,
    ),
    { signal: context.abortSignal },
  );
  const result = readFsGrepResult(raw);
  if (result === undefined || !('ok' in result))
    return { result: result ?? machineUnusableResult(scope.name) };
  return { page: result };
}

/** The Machine failure vocabulary, as `read` maps it, plus the missing method. */
function machineGrepFailure(
  name: string,
  error: unknown,
): MachineFailureResult {
  if (error instanceof MachineUnavailableError)
    return machineUnavailableResult(name, error.reason);
  if (error instanceof MachineProtocolError) {
    // A daemon older than this hub refuses an unknown method as `internal`.
    // `invalid_params` on `fs.grep` means a build that reads another request
    // shape: the hub validates the patterns and owns the cursor and the
    // bounds, so the only cause is a daemon of another build (design D8).
    return error.code === 'internal' || error.code === 'invalid_params'
      ? machineUnusableResult(name)
      : machineProtocolFailureResult(name, error);
  }
  throw error;
}

/** Every passage's Machine locator, or undefined when one cannot be spelled. */
function locatorsOf(
  search: MachineGrepSearch,
  result: FsGrepSuccess,
): ReadonlyArray<string> | undefined {
  const locators: Array<string> = [];
  for (const passage of result.results) {
    const locator = machineScopeLocator(search.scope, passage.path);
    if (locator === undefined) return undefined;
    locators.push(locator);
  }
  return locators;
}

/** The `read` verdict for one file, judged once and shared by its passages. */
function admitsFile(
  admission: GrepReadAdmission,
  decided: Map<string, boolean>,
  rel: string,
  locator: string,
): boolean {
  const known = decided.get(rel);
  if (known !== undefined) return known;
  const allowed = admission.admit(locator);
  decided.set(rel, allowed);
  return allowed;
}

/** One kept passage, in the spelling the call's result carries. */
function keptPassage(passage: FsGrepPassage, locator: string): GrepPassage {
  return {
    locator: `${locator}:${String(passage.startLine)}-${String(passage.endLine)}`,
    content: passage.content,
    matches: [...passage.matches],
    ...(passage.cut === true && { cut: true as const }),
    ...(passage.truncated === true && { truncated: true as const }),
  };
}

/**
 * The passages the page keeps: each file judged once against the `read` group
 * on its Machine locator, a refused file dropped whole. A refused passage
 * never reaches the result; the daemon position still moves past it.
 */
function renderPage(
  search: MachineGrepSearch,
  result: FsGrepSuccess,
  into: Array<GrepPassage>,
): GrepToolError | undefined {
  const locators = locatorsOf(search, result);
  if (locators === undefined) return machineUnusableResult(search.scope.name);
  const decided = new Map<string, boolean>();
  for (const [index, passage] of result.results.entries()) {
    const locator = locators[index];
    if (!admitsFile(search.admission, decided, passage.path, locator)) continue;
    into.push(keptPassage(passage, locator));
  }
  return undefined;
}
