import {
  EngineFailure,
  canonicalizeCitations,
  canonicalizeResults,
  distinctResults,
  groupingKey,
  isFailureClass,
  isGrounded,
  runOne,
  throwAbort,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type FailureClass,
  type RawAnswer,
  type RawCitation,
  type RawResult,
} from './chain';
import { acceptsQuery, type EngineLimits } from './limits';

export type AggregateChild = {
  readonly id: string;
  readonly timeoutSeconds: number;
  readonly limits: EngineLimits;
  readonly engine: Engine;
};

type ChildRun = { readonly child: AggregateChild } & (
  | {
      readonly kind: 'results';
      readonly results: ReadonlyArray<RawResult>;
      readonly notes?: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'answer';
      readonly answer: string;
      readonly citations: ReadonlyArray<RawCitation>;
      /** How many citations become merge candidates: the child's fetch bound. */
      readonly candidateBound: number;
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
  limit: number,
): ChildRun {
  if (outcome.kind === 'empty')
    return { child, kind: 'empty', notes: outcome.notes };
  if (outcome.kind === 'answer') {
    const citations = canonicalizeCitations(outcome.citations);
    // The rest is a failed child, so the aggregate can still answer from its
    // result children.
    if (!isGrounded(outcome.answer, citations))
      return { child, kind: 'failure', failureClass: 'ungrounded' };
    return {
      child,
      kind: 'answer',
      answer: outcome.answer,
      citations,
      candidateBound: limit,
      notes: outcome.notes,
    };
  }
  // Each child holds its own fetch bound, whatever it returned.
  const results = distinctResults(canonicalizeResults(outcome.results), limit);
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
    : classifyOutcome(child, outcome, request.limit);
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

/** The results one child contributes to the merge; an answer contributes its citations. */
function runResults(run: ChildRun): ReadonlyArray<RawResult> {
  if (run.kind === 'results') return run.results;
  if (run.kind !== 'answer') return [];
  return run.citations.slice(0, run.candidateBound).map((citation) => ({
    title: citation.title ?? '',
    url: citation.url,
  }));
}

/** The merged groups in rank-fusion order, cut to `limit` unless it is undefined. */
function mergeResultGroups(
  runs: ReadonlyArray<ChildRun>,
  limit?: number,
): Array<RawResult> {
  const groups = new Map<string, ResultGroup>();
  runs.forEach((run, childIndex) => {
    runResults(run).forEach((result, resultIndex) => {
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
    .map(groupResult)
    .slice(0, limit);
}

/** The grounded answers one aggregate attaches, in child order. */
function attachedAnswers(runs: ReadonlyArray<ChildRun>): Array<RawAnswer> {
  return runs.flatMap((run): Array<RawAnswer> =>
    run.kind === 'answer'
      ? [
          {
            engine: run.child.id,
            answer: run.answer,
            citations: run.citations,
          },
        ]
      : [],
  );
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

/** The merged results of the runs that answered, with the answers and notes. */
function mergedOutcome(
  runs: ReadonlyArray<ChildRun>,
  limit: number | undefined,
  notes: ReadonlyArray<string>,
): EngineOutcome {
  const answers = attachedAnswers(runs);
  const result = {
    kind: 'results' as const,
    results: mergeResultGroups(runs, limit),
    ...(answers.length > 0 && { answers }),
  };
  return notes.length === 0 ? result : { ...result, notes };
}

/**
 * Build an aggregate engine that fans out to every configured child. It cuts
 * the merged list to the request's fetch size, unless `retainMerged` keeps
 * every merged candidate for a rank call: each child still holds its own fetch
 * bound, so the list stays at most the sum of the children's results.
 */
export function createAggregateEngine(
  children: ReadonlyArray<AggregateChild>,
  { retainMerged = false }: { readonly retainMerged?: boolean } = {},
): Engine {
  return async (request) => {
    if (request.signal.aborted) throwAbort(request.signal);
    // A skipped child's run is a plain value, wrapped so every element the
    // aggregator receives is a promise.
    const runs = await Promise.all(
      children.map((child) =>
        acceptsQuery(child.limits, request.query)
          ? runChild(child, request)
          : Promise.resolve({
              child,
              kind: 'failure' as const,
              failureClass: 'unsupported' as const,
            }),
      ),
    );
    if (request.signal.aborted) throwAbort(request.signal);
    const notes = [...outcomeNotes(runs), ...childNotes(runs)];
    if (runs.some((run) => run.kind === 'results' || run.kind === 'answer')) {
      return mergedOutcome(
        runs,
        retainMerged ? undefined : request.limit,
        notes,
      );
    }
    if (runs.some((run) => run.kind === 'empty')) {
      return { kind: 'empty' as const, notes };
    }
    // An aggregate that skipped every child makes a local decision, not a
    // vendor failure; the chain records `unsupported` and advances like any
    // other class.
    throw new EngineFailure(
      runs.every(
        (run) => run.kind === 'failure' && run.failureClass === 'unsupported',
      )
        ? 'unsupported'
        : 'upstream_error',
    );
  };
}
