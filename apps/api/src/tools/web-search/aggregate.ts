import {
  EngineFailure,
  canonicalizeResults,
  isFailureClass,
  runOne,
  throwAbort,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type FailureClass,
  type RawResult,
} from './chain';

export type AggregateChild = {
  readonly id: string;
  readonly timeoutSeconds: number;
  readonly engine: Engine;
};

type ChildRun = { readonly child: AggregateChild } & (
  | {
      readonly kind: 'results';
      readonly results: ReadonlyArray<RawResult>;
      readonly notes?: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'empty';
      readonly notes?: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'failure';
      readonly failureClass: FailureClass;
    }
);

type ResultGroup = {
  url: string;
  score: number;
  bestRank: number;
  bestChild: number;
  title: string;
  snippet: string | undefined;
  published: string | undefined;
  children: Set<number>;
};

function classifyOutcome(
  child: AggregateChild,
  outcome: EngineOutcome,
): ChildRun {
  if (outcome.kind === 'empty')
    return { child, kind: 'empty', notes: outcome.notes };
  if (outcome.kind !== 'results')
    return { child, kind: 'failure', failureClass: 'upstream_error' };
  const results = canonicalizeResults(outcome.results);
  return results.length === 0
    ? { child, kind: 'empty', notes: outcome.notes }
    : { child, kind: 'results', results, notes: outcome.notes };
}

async function runChild(
  child: AggregateChild,
  request: EngineRequest,
): Promise<ChildRun> {
  const outcome = await runOne(child.engine, child.timeoutSeconds, request);
  return isFailureClass(outcome)
    ? { child, kind: 'failure', failureClass: outcome }
    : classifyOutcome(child, outcome);
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
  if (!group.children.has(childIndex)) {
    group.children.add(childIndex);
    group.score += 1 / (60 + rank);
  }
  if (rank < group.bestRank) {
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
  return {
    title: group.title,
    url: group.url,
    ...(group.snippet !== undefined && { snippet: group.snippet }),
    ...(group.published !== undefined && { published: group.published }),
  };
}

function mergeResultGroups(runs: ReadonlyArray<ChildRun>): Array<RawResult> {
  const groups = new Map<string, ResultGroup>();
  runs.forEach((run, childIndex) => {
    if (run.kind !== 'results') return;
    run.results.forEach((result, resultIndex) => {
      const rank = resultIndex + 1;
      const key = groupingKey(result.url);
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          url: '',
          score: 0,
          bestRank: Infinity,
          bestChild: 0,
          title: '',
          snippet: undefined,
          published: undefined,
          children: new Set<number>(),
        };
        groups.set(key, group);
      }
      updateGroup(group, result, rank, childIndex);
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

function childNotes(runs: ReadonlyArray<ChildRun>): Array<string> {
  return runs.flatMap((run) =>
    run.kind === 'failure' ? [] : [...(run.notes ?? [])],
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
    const notes = [...outcomeNotes(runs), ...childNotes(runs)];
    if (runs.some((run) => run.kind === 'results')) {
      const result = {
        kind: 'results' as const,
        results: mergeResultGroups(runs).slice(0, request.limit),
      };
      return notes.length === 0 ? result : { ...result, notes };
    }
    if (runs.some((run) => run.kind === 'empty')) {
      return { kind: 'empty' as const, notes };
    }
    throw new EngineFailure('upstream_error');
  };
}
