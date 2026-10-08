import {
  EngineFailure,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type FailureClass,
  type RawResult,
} from './chain';
import { canonicalUrl } from './output';

export type AggregateChild = {
  readonly id: string;
  readonly timeoutSeconds: number;
  readonly engine: Engine;
};

type ChildRun =
  | {
      readonly child: AggregateChild;
      readonly kind: 'results';
      readonly results: ReadonlyArray<RawResult>;
    }
  | {
      readonly child: AggregateChild;
      readonly kind: 'empty';
    }
  | {
      readonly child: AggregateChild;
      readonly kind: 'failure';
      readonly failureClass: FailureClass;
    };

type ResultGroup = {
  readonly key: string;
  url: string;
  score: number;
  bestRank: number;
  bestChild: number;
  title: string;
  snippet: string | undefined;
  published: string | undefined;
};

type MergedResult = {
  title: string;
  url: string;
  snippet?: string;
  published?: string;
};

function throwAbort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The web search was aborted.', 'AbortError');
}

function canonicalizeResults(
  results: ReadonlyArray<RawResult>,
): Array<RawResult> {
  return results.flatMap((result) => {
    const url = canonicalUrl(result.url);
    return url === undefined ? [] : [{ ...result, url }];
  });
}

function classifyOutcome(
  child: AggregateChild,
  outcome: EngineOutcome,
): ChildRun {
  if (outcome.kind === 'empty') return { child, kind: 'empty' };
  if (outcome.kind !== 'results')
    return { child, kind: 'failure', failureClass: 'upstream_error' };
  const results = canonicalizeResults(outcome.results);
  return results.length === 0
    ? { child, kind: 'empty' }
    : { child, kind: 'results', results };
}

async function runChild(
  child: AggregateChild,
  request: EngineRequest,
): Promise<ChildRun> {
  const deadline = AbortSignal.timeout(child.timeoutSeconds * 1000);
  const signal = AbortSignal.any([request.signal, deadline]);
  try {
    const outcome = await child.engine({ ...request, signal });
    if (request.signal.aborted) throwAbort(request.signal);
    if (deadline.aborted)
      return { child, kind: 'failure', failureClass: 'timeout' };
    return classifyOutcome(child, outcome);
  } catch (error) {
    if (request.signal.aborted) throwAbort(request.signal);
    return {
      child,
      kind: 'failure',
      failureClass: deadline.aborted
        ? 'timeout'
        : error instanceof EngineFailure
          ? error.failureClass
          : 'upstream_error',
    };
  }
}

function groupingKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.hostname.startsWith('www.'))
    url.hostname = url.hostname.slice('www.'.length);
  if (url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.href;
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function updateGroup(
  group: ResultGroup,
  result: RawResult,
  rank: number,
  childIndex: number,
): void {
  group.score += 1 / (60 + rank);
  if (
    rank < group.bestRank ||
    (rank === group.bestRank && childIndex < group.bestChild)
  ) {
    group.url = result.url;
    group.bestRank = rank;
    group.bestChild = childIndex;
  }
  if (group.title === '' && isNonEmpty(result.title))
    group.title = result.title;
  if (
    result.snippet !== undefined &&
    (group.snippet === undefined ||
      result.snippet.length > group.snippet.length)
  )
    group.snippet = result.snippet;
  if (group.published === undefined && isNonEmpty(result.published))
    group.published = result.published;
}

function groupResult(group: ResultGroup): RawResult {
  const result: MergedResult = { title: group.title, url: group.url };
  if (group.snippet !== undefined) result.snippet = group.snippet;
  if (group.published !== undefined) result.published = group.published;
  return result;
}

function mergeResultGroups(runs: ReadonlyArray<ChildRun>): Array<RawResult> {
  const groups = new Map<string, ResultGroup>();
  runs.forEach((run, childIndex) => {
    if (run.kind !== 'results') return;
    run.results.forEach((result, resultIndex) => {
      const rank = resultIndex + 1;
      const key = groupingKey(result.url);
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, {
          key,
          url: result.url,
          score: 1 / (60 + rank),
          bestRank: rank,
          bestChild: childIndex,
          title: isNonEmpty(result.title) ? result.title : '',
          snippet: result.snippet,
          published: isNonEmpty(result.published)
            ? result.published
            : undefined,
        });
      } else updateGroup(group, result, rank, childIndex);
    });
  });
  return [...groups.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.bestRank - right.bestRank ||
        left.bestChild - right.bestChild,
    )
    .map(groupResult);
}

function outcomeNotes(runs: ReadonlyArray<ChildRun>): Array<string> {
  return runs.flatMap((run) =>
    run.kind === 'failure'
      ? [`${run.child.id}: ${run.failureClass}`]
      : run.kind === 'empty'
        ? [`${run.child.id}: empty`]
        : [],
  );
}

/** Build an aggregate engine that fans out to every configured child. */
export function createAggregateEngine(
  children: ReadonlyArray<AggregateChild>,
): Engine {
  return async (request) => {
    if (request.signal.aborted) throwAbort(request.signal);
    const runs = await Promise.all(
      children.map((child) => runChild(child, request)),
    );
    if (request.signal.aborted) throwAbort(request.signal);
    const notes = outcomeNotes(runs);
    if (runs.some((run) => run.kind === 'results')) {
      const result = {
        kind: 'results' as const,
        results: mergeResultGroups(runs).slice(0, request.limit),
      };
      return notes.length === 0 ? result : { ...result, notes };
    }
    if (runs.some((run) => run.kind === 'empty')) {
      return notes.length === 0
        ? { kind: 'empty' as const }
        : { kind: 'empty' as const, notes };
    }
    throw new EngineFailure('upstream_error');
  };
}
