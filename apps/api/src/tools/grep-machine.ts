/**
 * The `machine://` backend of the `grep` tool: one `fs.grep` request per
 * Machine scope, executed on the Machine through `MachineConnector`. The
 * daemon walks and matches locally; this module renders each returned path as
 * a Machine locator, judges the `read` group per file on that locator, and
 * reports the page the call will append. A host path never leaves the daemon,
 * and a passage from a file `read` refuses never reaches the result.
 */

import {
  FS_GREP_METHOD,
  FS_STAT_METHOD,
  fsGrepCursorKey,
  MachineProtocolError,
  type FsGrepParams,
  type FsGrepConsumed,
  type FsGrepPassage,
  type FsGrepSuccess,
  type FsGrepWarning,
  type FsGrepWarningKind,
} from '@workspace/machine-protocol';
import {
  decodeGrepCursor,
  encodeGrepCursor,
  normalizeHostScope,
  splitGrepScope,
  type DecodedGrepCursor,
  type GrepBudget,
  type GrepPageEnd,
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
import { type ToolContext, type ToolResult } from './types';

/** One Machine scope: the prefix the daemon searches and its glob suffix. */
export type MachineGrepScope = {
  readonly index: number;
  readonly name: string;
  /** The absolute Machine path; normalized, with no trailing separator. */
  readonly path: string;
  /** The glob text from the first glob segment onward, as submitted. */
  readonly globSuffix: string | undefined;
};

/** The compiled search the call resolved before either backend ran. */
export type GrepSearchArguments = {
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
};

/** One kept Machine passage with the cursor point it ends at. */
export type MachineGrepEntry = {
  readonly passage: GrepPassage;
  readonly end: GrepPageEnd;
};

/** One Machine scope's page, or the result that ends the call. */
export type MachineGrepSegment =
  | {
      readonly status: 'success';
      readonly entries: ReadonlyArray<MachineGrepEntry>;
      readonly complete: boolean;
      readonly warnings: ReadonlyArray<FsGrepWarning>;
      readonly consumed: { files: number; entries: number; bytes: number };
      /**
       * Where a daemon page below the call's page stopped when it admitted no
       * passage at all: the call resumes after that entry.
       */
      readonly position?: { readonly scopeIndex: number; readonly rel: string };
    }
  | { readonly status: 'error'; readonly result: ToolResult };

/** Everything one Machine scope needs to run its request. */
export type MachineGrepSearch = {
  readonly context: ToolContext;
  readonly scope: MachineGrepScope;
  readonly args: GrepSearchArguments;
  /** What is left of the call's bounds, shared with every other scope. */
  readonly budget: GrepBudget;
  /** The call's cursor, when it names a passage of this scope. */
  readonly resume: DecodedGrepCursor | undefined;
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
  | { readonly machine: MachineGrepScope; readonly root: string }
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
  return { machine: parsed, root: parsed.name };
}

/** What the exact-path rule settled for one glob-free Machine scope. */
type ExactPathVerdict =
  | { readonly kind: 'walk' }
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
  if (scope.globSuffix !== undefined) return { kind: 'walk' };
  const locator = formatMachineLocator(scope.name, scope.path);
  if (locator === undefined) return { kind: 'walk' };
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
      return { kind: 'walk' };
    return admission.admit(locator) ? { kind: 'walk' } : { kind: 'refused' };
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

/** The path two parts join to: no separator for an empty relative part. */
function machinePath(prefix: string, rel: string): string {
  if (rel.length === 0) return prefix;
  return prefix === '/' ? `/${rel}` : `${prefix}/${rel}`;
}

/** The key the daemon binds its own page to, built from the same inputs. */
function requestCursorKey(search: MachineGrepSearch): string {
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
function daemonCursor(
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
function requestOf(
  search: MachineGrepSearch,
  envelope: FsGrepParams['envelope'],
  budget: GrepBudget,
  cursor: string | undefined,
): FsGrepParams {
  const { scope, args } = search;
  return {
    envelope,
    path: scope.path,
    ...(scope.globSuffix !== undefined && { globSuffix: scope.globSuffix }),
    patterns: args.patterns,
    literal: args.literal,
    ignoreCase: args.ignoreCase,
    ...(cursor !== undefined && { cursor }),
    budget: {
      files: budget.files,
      entries: budget.entries,
      bytes: budget.bytes,
      deadlineMs: budget.deadlineMs,
      limit: budget.limit,
      pageUnits: budget.pageUnits,
    },
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
 * The caller's page from one Machine scope. A page whose every passage the
 * `read` group refuses is not a page: the next daemon page is asked for under
 * what the call has left, so a scope of hidden files can never answer an
 * incomplete page without a cursor. Every page reports what it consumed, so
 * the budget bounds the loop; a page that consumed nothing and named no new
 * cursor is the last one the call asks for.
 */
async function runDaemonPages(
  search: MachineGrepSearch,
  connector: MachineConnector,
  deadlineAt: number,
): Promise<MachineGrepSegment> {
  const entries: Array<MachineGrepEntry> = [];
  const warnings = new Map<FsGrepWarningKind, number>();
  const consumed = { files: 0, entries: 0, bytes: 0 };
  let budget: GrepBudget = {
    ...search.budget,
    deadlineMs: Math.max(0, deadlineAt - Date.now()),
  };
  let cursor =
    search.resume === undefined
      ? undefined
      : daemonCursor(search, search.resume);
  let last: FsGrepSuccess | undefined;
  while (canAskPage(budget)) {
    const asked = await requestPage(search, connector, budget, cursor);
    if ('result' in asked) return { status: 'error', result: asked.result };
    const page = asked.page;
    last = page;
    mergePage(warnings, consumed, page);
    const rendered = renderPage(search, page, entries);
    if ('result' in rendered)
      return { status: 'error', result: rendered.result };
    if (rendered.kept > 0 || page.complete) break;
    const next = nextCursor(page, cursor);
    if (next === undefined) break;
    cursor = next;
    budget = spent(budget, page.consumed, deadlineAt);
  }
  const position =
    entries.length > 0 || last === undefined
      ? undefined
      : stoppedPosition(search, last);
  return segmentOf({ entries, warnings, consumed, last, position });
}

/** What one Machine scope's pages add up to. */
type MachineSegmentPage = {
  readonly entries: ReadonlyArray<MachineGrepEntry>;
  readonly warnings: ReadonlyMap<FsGrepWarningKind, number>;
  readonly consumed: FsGrepConsumed;
  readonly last: FsGrepSuccess | undefined;
  readonly position:
    | { readonly scopeIndex: number; readonly rel: string }
    | undefined;
};

/** The segment one Machine scope's pages add up to. */
function segmentOf(page: MachineSegmentPage): MachineGrepSegment {
  return {
    status: 'success',
    entries: page.entries,
    complete: page.last?.complete === true,
    warnings: [...page.warnings].map(([kind, count]) => ({ kind, count })),
    consumed: page.consumed,
    ...(page.position !== undefined && { position: page.position }),
  };
}

/** Fold one daemon page's warnings and consumed budget into the segment's. */
function mergePage(
  warnings: Map<FsGrepWarningKind, number>,
  consumed: { files: number; entries: number; bytes: number },
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
}

/**
 * The cursor the next page is asked with, or undefined when asking again
 * would fetch the same page: the daemon consumed nothing, or named the cursor
 * it was asked with.
 */
function nextCursor(
  page: FsGrepSuccess,
  cursor: string | undefined,
): string | undefined {
  if (page.consumed.files + page.consumed.entries + page.consumed.bytes === 0)
    return undefined;
  return page.cursor === undefined || page.cursor === cursor
    ? undefined
    : page.cursor;
}

/** What the call has left after one daemon page. */
function spent(
  budget: GrepBudget,
  consumed: FsGrepConsumed,
  deadlineAt: number,
): GrepBudget {
  return {
    files: Math.max(0, budget.files - consumed.files),
    entries: Math.max(0, budget.entries - consumed.entries),
    bytes: Math.max(0, budget.bytes - consumed.bytes),
    limit: budget.limit,
    pageUnits: budget.pageUnits,
    fixedReserve: budget.fixedReserve,
    deadlineMs: Math.max(0, deadlineAt - Date.now()),
  };
}

/** Whether the remaining budget can buy one more daemon page. */
function canAskPage(budget: GrepBudget): boolean {
  return (
    budget.files > 0 &&
    budget.entries > 0 &&
    budget.bytes > 0 &&
    budget.limit > 0 &&
    budget.pageUnits > 0 &&
    budget.deadlineMs > 0
  );
}

/** One `fs.grep` request under the given budget and resume key. */
async function requestPage(
  search: MachineGrepSearch,
  connector: MachineConnector,
  budget: GrepBudget,
  cursor: string | undefined,
): Promise<DaemonPage> {
  const { context, scope } = search;
  const raw = await connector.request(
    scope.name,
    FS_GREP_METHOD,
    requestOf(
      search,
      machineCallEnvelope(
        context,
        machineBudgetMs(context, Math.max(1, budget.deadlineMs)),
      ),
      budget,
      cursor,
    ),
    { signal: context.abortSignal },
  );
  const result = readFsGrepResult(raw);
  if (result === undefined || !('ok' in result))
    return { result: result ?? machineUnusableResult(scope.name) };
  return { page: result };
}

/**
 * Where a daemon page that admitted no passage stopped. Its cursor names a
 * passage of a file the `read` group refused, or the entry a bound stopped the
 * walk at; either way no passage of that file may reach the model, so the call
 * resumes after the file.
 */
function stoppedPosition(
  search: MachineGrepSearch,
  page: FsGrepSuccess,
): { readonly scopeIndex: number; readonly rel: string } | undefined {
  if (page.cursor === undefined) return undefined;
  const decoded = decodeGrepCursor(page.cursor, requestCursorKey(search));
  if ('error' in decoded) return undefined;
  return { scopeIndex: search.scope.index, rel: decoded.rel };
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
    return error.code === 'internal'
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
    const locator = formatMachineLocator(
      search.scope.name,
      machinePath(search.scope.path, passage.path),
    );
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

/** One kept passage, with the cursor point it ends at. */
function keptEntry(
  scope: MachineGrepScope,
  passage: FsGrepPassage,
  locator: string,
): MachineGrepEntry {
  return {
    passage: {
      locator: `${locator}:${String(passage.startLine)}-${String(passage.endLine)}`,
      content: passage.content,
      matches: [...passage.matches],
      ...(passage.truncated === true && { truncated: true as const }),
    },
    end: {
      scopeIndex: scope.index,
      rel: passage.path,
      startLine: passage.startLine,
      // Only a passage the page cut continues from its last emitted line.
      ...(passage.cut === true && { endLine: passage.endLine }),
      // The daemon marks the file's twentieth passage by its own position in
      // the file; its passages after it are reachable only through a read.
      capped: passage.capped === true,
    },
  };
}

/** A rendered page: the passages it contributed, or the refusal that ends the call. */
type RenderedPage =
  | { readonly kept: number }
  | { readonly result: GrepToolError };

/**
 * The passages the page keeps: each file judged once against the `read` group
 * on its Machine locator, a refused file dropped whole, and each kept passage
 * remembered so the cursor can never name a dropped one.
 */
function renderPage(
  search: MachineGrepSearch,
  result: FsGrepSuccess,
  into: Array<MachineGrepEntry>,
): RenderedPage {
  const locators = locatorsOf(search, result);
  if (locators === undefined)
    return { result: machineUnusableResult(search.scope.name) };
  const decided = new Map<string, boolean>();
  let kept = 0;
  for (const [index, passage] of result.results.entries()) {
    const locator = locators[index];
    if (!admitsFile(search.admission, decided, passage.path, locator)) continue;
    into.push(keptEntry(search.scope, passage, locator));
    kept += 1;
  }
  return { kept };
}
