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
  fsGrepCursorKey,
  MachineProtocolError,
  type FsGrepParams,
  type FsGrepPassage,
  type FsGrepSuccess,
  type FsGrepWarning,
} from '@workspace/machine-protocol';
import {
  encodeGrepCursor,
  GREP_LIMITS,
  normalizeHostScope,
  splitGrepScope,
  type DecodedGrepCursor,
  type GrepBudget,
  type GrepPageEnd,
  type GrepPassage,
  type GrepScope,
} from '@workspace/native-file-tools';

import { MachineUnavailableError } from '../machines/machine-connector.service';
import {
  formatMachineLocator,
  MACHINE_NAME_PATTERN,
} from '../machines/machine-locator';
import { readFsGrepResult } from '../machines/machine-results';
import { type GrepReadAdmission } from './grep-admission';
import {
  invalidPathResult,
  machineUnsupportedResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import { decodeRelativePath } from './locator-spelling';
import {
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineProtocolFailureResult,
  machineUnavailableResult,
  machineUnusableResult,
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

/**
 * One `machine://` scope, or the result that ends the call. The path is split
 * at its first glob segment before any decoding — so `%2A` stays a literal
 * filename character — and normalized lexically, exactly as a host scope.
 */
export function resolveMachineScope(
  context: ToolContext,
  scope: string,
  index: number,
):
  | { readonly machine: MachineGrepScope; readonly root: string }
  | { readonly result: GrepToolError } {
  const parsed = machineScopeOf(scope, index);
  if ('status' in parsed) return { result: parsed };
  const connector = machineConnector(context);
  if (connector === undefined) return { result: machineUnsupportedResult() };
  if (!connector.isConfigured(parsed.name))
    return { result: machineNotFoundResult(parsed.name) };
  return { machine: parsed, root: parsed.name };
}

/** The one refusal message for a Machine scope with no path to search. */
const NO_PATH_MESSAGE =
  'A machine:// scope must name a Machine and an absolute path.';
const BAD_NAME_MESSAGE =
  'A machine:// scope must name a Machine as [a-z0-9-], up to 63 characters.';
const BAD_PATH_MESSAGE = 'The Machine scope path is invalid.';

function machineScopeOf(
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

/** One `fs.grep` request: the remaining budget and, on resume, the page key. */
function requestOf(
  search: MachineGrepSearch,
  envelope: FsGrepParams['envelope'],
): FsGrepParams {
  const { scope, args, budget, resume } = search;
  return {
    envelope,
    path: scope.path,
    ...(scope.globSuffix !== undefined && { globSuffix: scope.globSuffix }),
    patterns: args.patterns,
    literal: args.literal,
    ignoreCase: args.ignoreCase,
    ...(resume !== undefined && {
      cursor: encodeGrepCursor({
        scopeIndex: 0,
        rel: resume.rel,
        startLine: resume.startLine,
        ...(resume.truncated === true && { truncated: true as const }),
        inputHash: requestCursorKey(search),
      }),
    }),
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
    const envelope = machineCallEnvelope(
      context,
      machineBudgetMs(context, Math.max(1, search.budget.deadlineMs)),
    );
    const raw = await connector.request(
      scope.name,
      FS_GREP_METHOD,
      requestOf(search, envelope),
      { signal: context.abortSignal },
    );
    const result = readFsGrepResult(raw);
    if (result === undefined || !('ok' in result))
      return {
        status: 'error',
        result: result ?? machineUnusableResult(scope.name),
      };
    return renderedPage(search, result);
  } catch (error) {
    return { status: 'error', result: machineGrepFailure(scope.name, error) };
  }
}

/** The Machine failure vocabulary, as `read` maps it, plus the missing method. */
function machineGrepFailure(name: string, error: unknown): ToolResult {
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
  count: number,
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
      // The twentieth passage of a file ends that file; its passages after it
      // are reachable only through a read.
      capped:
        passage.truncated === true && count === GREP_LIMITS.passagesPerFile,
    },
  };
}

/**
 * The passages the page keeps: each file judged once against the `read` group
 * on its Machine locator, a refused file dropped whole, and each kept passage
 * remembered so the cursor can never name a dropped one.
 */
function renderedPage(
  search: MachineGrepSearch,
  result: FsGrepSuccess,
): MachineGrepSegment {
  const locators = locatorsOf(search, result);
  if (locators === undefined)
    return {
      status: 'error',
      result: machineUnusableResult(search.scope.name),
    };
  const decided = new Map<string, boolean>();
  const counts = new Map<string, number>();
  const entries: Array<MachineGrepEntry> = [];
  for (const [index, passage] of result.results.entries()) {
    const locator = locators[index];
    if (!admitsFile(search.admission, decided, passage.path, locator)) continue;
    const count = (counts.get(passage.path) ?? 0) + 1;
    counts.set(passage.path, count);
    entries.push(keptEntry(search.scope, passage, locator, count));
  }
  return {
    status: 'success',
    entries,
    complete: result.complete,
    warnings: result.warnings,
    consumed: result.consumed,
  };
}
