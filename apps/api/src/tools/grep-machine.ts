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
  type FsGrepConsumed,
  type FsGrepSuccess,
  type FsGrepWarning,
  type FsGrepWarningKind,
} from '@workspace/machine-protocol';
import {
  formatPassageLocator,
  GREP_LIMITS,
  parsePassageLocator,
  type GrepBudget,
  type GrepIgnored,
  type GrepPassage,
} from '@workspace/native-file-tools';

import type { MachineConnector } from '../machines/machine-connector.service';
import { readFsGrepResult } from '../machines/machine-results';
import { type GrepReadAdmission } from './grep-admission';
import { machineUnsupportedResult, type GrepToolError } from './grep-results';
import {
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineUnusableResult,
} from './machine-call';
import {
  admitMachineFile,
  ignoredAccumulator,
  machineScopeLocator,
  mergePage,
  requestOf,
  type DaemonAsk,
  type IgnoredAccumulator,
} from './grep-machine-wire';
import { budgetAfter } from './grep-page';
import { machineGrepFailure } from './grep-machine-failure';
import { type ToolContext, type ToolResult } from './types';

export {
  isMachineGrepScope,
  machineScopeOf,
  resolveMachineScope,
  resolveParsedMachineScope,
} from './grep-machine-resolve';

/** One Machine scope: the prefix the daemon searches and its glob suffix. */
export type MachineGrepScope = {
  readonly index: number;
  readonly name: string;
  /** The absolute Machine path; normalized, with no trailing separator. */
  readonly path: string;
  /** The glob text from the first glob segment onward, as submitted. */
  readonly globSuffix: string | undefined;
  /** The submitted text ended with a separator, so it names a directory. */
  readonly endsWithSeparator: boolean;
  /**
   * The exact-path probe found one regular file, so the daemon walks it
   * without listing: no entry is counted, and the file bound trips first.
   * Absent (a directory or glob scope) lists entries before any candidate.
   */
  readonly singleFile?: boolean;
  /**
   * The locator and `read` identity of a path relative to `path`. Absent for
   * a `machine://` scope, whose locator is the Machine path itself; a skill
   * package on a Machine reports its `skill://` locator instead, so admission
   * matches the same identity a `read` of that package matches.
   */
  readonly locatorOf?: (rel: string) => string;
  /**
   * The extra texts whose matching `read` reject refuses a file, by its path
   * relative to `path`: a skill package on a Machine is also judged on its
   * canonical `machine://` locator and that bare path.
   */
  readonly rejectTextsOf?: (rel: string) => ReadonlyArray<string>;
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
      /** The segment's counts; its passages went to the call as each page arrived. */
      readonly page: MachineSegmentPageView;
    }
  | { readonly status: 'error'; readonly result: ToolResult };

/** What one Machine scope's walk adds to the call besides its passages. */
export type MachineSegmentPageView = {
  readonly complete: boolean;
  readonly warnings: ReadonlyArray<FsGrepWarning>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Whether this scope's walk got past the point the call started at. */
  readonly progressed: boolean;
  /** The file a bound stopped the daemon walk inside, relative to the prefix. */
  readonly unfinished?: string;
  /** The excluded directory locators of this scope, capped across its pages. */
  readonly ignored?: GrepIgnored;
};

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
  /**
   * Keep one page's passages in the call's artifact text. Returns false when
   * the artifact bound stops the call, so the walk asks for no next page.
   */
  readonly keepPassages: (passages: ReadonlyArray<GrepPassage>) => boolean;
};

/** One Machine scope's resolution: its text, ordinal, admission, and clock. */
export type MachineScopeRequest = {
  readonly context: ToolContext;
  readonly scope: string;
  readonly index: number;
  readonly admission: GrepReadAdmission;
  /** The absolute instant the walk stops, which bounds the probe. */
  readonly deadlineAt: number;
};

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
type MachinePassageBuffer = {
  pending: GrepPassage | undefined;
  readonly passagesByFile: Map<string, number>;
  readonly truncatedFiles: Set<string>;
};

function passageFile(passage: GrepPassage): string {
  return parsePassageLocator(passage.locator)?.file ?? passage.locator;
}

function mergeMachinePassages(
  previous: GrepPassage,
  next: GrepPassage,
): GrepPassage | undefined {
  const first = parsePassageLocator(previous.locator);
  const second = parsePassageLocator(next.locator);

  if (
    first === undefined ||
    second === undefined ||
    first.file !== second.file ||
    first.endLine !== second.startLine
  )
    return undefined;

  const previousLines = previous.content.split('\n');
  const nextLines = next.content.split('\n');

  return {
    locator: formatPassageLocator(first.file, first.startLine, second.endLine),
    content: [...previousLines.slice(0, -1), ...nextLines].join('\n'),
    matches: [...new Set([...previous.matches, ...next.matches])],
    ...(next.cut === true && { cut: true as const }),
    ...((previous.truncated === true || next.truncated === true) && {
      truncated: true as const,
    }),
  };
}

function keepMachinePassages(
  search: MachineGrepSearch,
  buffer: MachinePassageBuffer,
  passages: ReadonlyArray<GrepPassage>,
): boolean {
  const ready: Array<GrepPassage> = [];

  for (const passage of passages) {
    const file = passageFile(passage);

    if (buffer.truncatedFiles.has(file)) continue;

    if (buffer.pending !== undefined) {
      const merged = mergeMachinePassages(buffer.pending, passage);

      if (merged !== undefined) {
        buffer.pending = merged;

        continue;
      }

      ready.push(buffer.pending);
      buffer.pending = undefined;
    }

    const count = buffer.passagesByFile.get(file) ?? 0;

    if (count >= GREP_LIMITS.passagesPerFile) {
      const previous = ready.at(-1);

      if (previous !== undefined && passageFile(previous) === file)
        ready[ready.length - 1] = { ...previous, truncated: true };

      buffer.truncatedFiles.add(file);

      continue;
    }

    buffer.passagesByFile.set(file, count + 1);
    buffer.pending = passage;

    if (passage.truncated === true) buffer.truncatedFiles.add(file);
  }

  if (ready.length > 0 && !search.keepPassages(ready)) {
    buffer.pending = undefined;

    return false;
  }

  return true;
}

async function runDaemonPages(
  search: MachineGrepSearch,
  connector: MachineConnector,
  deadlineAt: number,
): Promise<MachineGrepSegment> {
  const run = initialMachineSegmentPage(search, deadlineAt);

  const passageBuffer: MachinePassageBuffer = {
    pending: undefined,
    passagesByFile: new Map(),
    truncatedFiles: new Set(),
  };

  const keepPagePassages = (passages: ReadonlyArray<GrepPassage>) =>
    keepMachinePassages(search, passageBuffer, passages);

  while (canAskPage(run.budget, search.scope.singleFile === true)) {
    const asked = await requestPage(search, connector, {
      budget: run.budget,
      cursor: run.cursor,
      progressed: run.progressed,
    });

    if ('result' in asked) return { status: 'error', result: asked.result };
    const step = takePage(search, run, asked.page, keepPagePassages);

    if ('result' in step) return { status: 'error', result: step.result };

    if (step.ended) break;
  }

  if (passageBuffer.pending !== undefined)
    search.keepPassages([passageBuffer.pending]);

  return segmentOfPages(search, run);
}

/** One Machine scope's pages, as the loop between them carries them. */
type MachineSegmentPage = {
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

function initialMachineSegmentPage(
  search: MachineGrepSearch,
  deadlineAt: number,
): MachineSegmentPage {
  return {
    budget: budgetAfter(
      search.budget,
      { files: 0, entries: 0, bytes: 0 },
      deadlineAt,
    ),
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    ignored: ignoredAccumulator(search.scope),
    deadlineAt,
    cursor: undefined,
    progressed: search.progressed,
    last: undefined,
    unfinished: undefined,
  };
}

/** One page's effect on the run; `ended` says the scope has no next page. */
type PageStep =
  | { readonly ended: boolean }
  | { readonly result: GrepToolError };

/** Fold one page into the run, and say whether the scope has another. */
function takePage(
  search: MachineGrepSearch,
  run: MachineSegmentPage,
  page: FsGrepSuccess,
  keepPassages: (passages: ReadonlyArray<GrepPassage>) => boolean,
): PageStep {
  run.last = page;
  mergePage(run.warnings, run.consumed, run.ignored, page);
  run.progressed = run.progressed || page.progressed;
  const kept: Array<GrepPassage> = [];
  const refused = renderPage(search, page, kept);

  if (refused !== undefined) return { result: refused };

  // The artifact bound can cut a daemon page, so the walk stops asking here.
  if (!keepPassages(kept)) return { ended: true };

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
    // budget for another page. A page can spend its bound exactly at its own
    // page end, before it reports the stop; when no bound is left, the call
    // deadline is what spent the budget.
    const stopped = canAskPage(pages.budget, singleFile)
      ? undefined
      : (spentBound(pages.budget, singleFile) ?? 'deadline');

    if (stopped !== undefined) pages.warnings.set(stopped, 1);
  }

  return {
    status: 'success',
    page: {
      complete,
      warnings: [...pages.warnings].map(([kind, count]) => ({ kind, count })),
      consumed: pages.consumed,
      progressed: pages.progressed,
      unfinished: pages.unfinished,
      ignored: {
        paths: pages.ignored.paths,
        atLeast: pages.ignored.atLeast,
      },
    },
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
 * page. A page that progressed made the walk advance even when it charged
 * nothing: a resumed page re-opens the file its cursor names without counting
 * that file or its bytes again.
 */
function nextCursor(
  page: FsGrepSuccess,
  cursor: string | undefined,
): string | undefined {
  if (page.complete) return undefined;

  const consumed =
    page.consumed.files + page.consumed.entries + page.consumed.bytes > 0;

  if (!consumed && !page.progressed) return undefined;

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

/** One file's admission input: the call's admission, its scope, and its path. */
type MachineFileAdmission = {
  readonly admission: GrepReadAdmission;
  readonly scope: MachineGrepScope;
  readonly decided: Map<string, boolean>;
  readonly rel: string;
  readonly locator: string;
};

/** The `read` verdict for one file, judged once and shared by its passages. */
function admitsFile(input: MachineFileAdmission): boolean {
  const known = input.decided.get(input.rel);

  if (known !== undefined) return known;

  const allowed = admitMachineFile(
    input.admission,
    input.scope,
    input.rel,
    input.locator,
  );

  input.decided.set(input.rel, allowed);

  return allowed;
}

/** One kept passage, in the spelling the call's result carries. */
function keptPassage(passage: FsGrepPassage, locator: string): GrepPassage {
  return {
    locator: formatPassageLocator(locator, passage.startLine, passage.endLine),
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

    if (
      !admitsFile({
        admission: search.admission,
        scope: search.scope,
        decided,
        rel: passage.path,
        locator,
      })
    )
      continue;
    into.push(keptPassage(passage, locator));
  }
}
