/**
 * `web_search` objective rerank (experimental decision lane): the call's
 * results become cards, the judge answers one yes/no per card, and the order it
 * implies either reaches the output (`on`), stays beside it (`shadow`), or is
 * skipped (`off`, no lane, fewer than three results, a grounded answer). A
 * failure never reorders. Counts never change.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type MockInstance, vi } from 'vitest';

import * as schema from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';
import {
  type CandidateJudgement,
  type JudgeCandidatesInput,
} from '../../decisions/decisions.service';
import { type ToolRerankMode } from '../../instance-config/tool-rerank-config';
import { type WebSearchConfig } from '../../instance-config/web-search-config';
import { ArtifactsRepository } from '../artifacts/artifacts-repository';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type ToolContext, type ToolResult } from '../types';
import { spillWebSearchResult } from './artifact';
import { type RawResult, type SearchChainSuccess } from './chain';
import { normalizeOutput } from './output';
import {
  WEB_SEARCH_RERANK_RUBRIC,
  WEB_SEARCH_RERANK_CARD_MAX_CODE_UNITS,
} from './rerank';
import { renderWebSearchText, webSearchOutputSchema } from './text';

const SEQ = 5;
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');

type JudgeFn = (input: JudgeCandidatesInput) => Promise<CandidateJudgement>;

type Writes = {
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
};

let writes: Writes;

function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId: 'call-1',
    permissionPolicy: compileToolPermissionMap(
      { read: { allow: true } },
      'web-search-rerank-test',
    ),
    artifactReadable: true,
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    ...overrides,
  };
}

function answered(
  probabilities: Readonly<Record<string, number>>,
): CandidateJudgement {
  return {
    status: 'answered',
    probabilities: new Map(Object.entries(probabilities)),
    usage: { inputTokens: 120, outputTokens: 0, costUsd: 0.0000042 },
    model: 'jev-1.13',
    latencyMs: 180,
  };
}

function unavailable(): CandidateJudgement {
  return {
    status: 'unavailable',
    probabilities: new Map(),
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
    model: null,
    latencyMs: 30,
  };
}

/**
 * One lane double: the tool's own `webSearch.rerank` block, and a judge whose
 * answers a test sets. The judge is a spy, so "no call" is an assertion. No
 * `mode` means the tool has no rerank block at all — off.
 */
function lane(options: {
  readonly mode?: ToolRerankMode;
  readonly judge?: JudgeFn;
}) {
  const judge = vi.fn<JudgeFn>(
    options.judge ?? (() => Promise.resolve(unavailable())),
  );
  const webSearch: WebSearchConfig = {
    engines: [],
    chain: [],
    ...(options.mode !== undefined && {
      rerank: { mode: options.mode, model: 'jev' },
    }),
  };
  return { judge, decisions: { judgeCandidates: judge }, webSearch };
}

function resultAt(
  index: number,
  overrides: Partial<RawResult> = {},
): RawResult {
  return {
    title: `Title ${String(index).padStart(2, '0')}`,
    url: `https://example.test/r/${index}`,
    snippet: `Snippet ${index}`,
    published: '2026-10-08',
    ...overrides,
  };
}

function resultsSource(
  results: ReadonlyArray<RawResult>,
): Extract<SearchChainSuccess, { kind: 'results' }> {
  return { kind: 'results', engine: 'brave', query: 'query text', results };
}

function fiveResults(): ReadonlyArray<RawResult> {
  return Array.from({ length: 5 }, (_unused, index) => resultAt(index + 1));
}

function outputOf(
  result: ToolResult,
): Extract<
  Extract<SearchChainSuccess, { kind: 'results' }>['results'],
  ReadonlyArray<RawResult>
> {
  if (result.status !== 'success') throw new Error('expected a success');
  const output = webSearchOutputSchema.parse(result);
  if (output.kind !== 'results') throw new Error('expected results');
  return output.results;
}

function urls(result: ToolResult): ReadonlyArray<string> {
  return outputOf(result).map((item) => item.url);
}

function writtenText(): string {
  const part = writes.insertParts.mock.calls[0]?.[1]?.[0];
  if (part === undefined)
    throw new Error('Expected one written artifact part.');
  return part.content.toString('utf8');
}

function headings(text: string): ReadonlyArray<string> {
  const titles: Array<string> = [];
  for (const line of text.split('\n')) {
    const heading = /^## \d+\. (.*)$/u.exec(line);
    if (heading?.[1] !== undefined) titles.push(heading[1]);
  }
  return titles;
}

beforeEach(() => {
  vi.restoreAllMocks();
  writes = {
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
  vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(SEQ);
  vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue({
    id: 'artifact-5',
    createdAt: CREATED_AT,
  });
});

it('sends one card per result with the fixed rubric and the call objective', async () => {
  const { decisions, webSearch, judge } = lane({
    mode: 'shadow',
    judge: () => Promise.resolve(answered({ p01: 0.5, p02: 0.5, p03: 0.5 })),
  });
  const source = resultsSource(fiveResults());

  await spillWebSearchResult(testContext({ decisions, webSearch }), source, {
    limit: 5,
    fetchSize: 5,
    objective: 'compare HNSW and IVFFlat recall',
  });

  expect(judge).toHaveBeenCalledTimes(1);
  const input = judge.mock.calls[0][0];
  expect(input).toMatchObject({
    model: 'jev',
    chatId: 'chat',
    runId: 'run',
    tool: 'web_search',
    objective: 'compare HNSW and IVFFlat recall',
    query: 'query text',
    rubric: WEB_SEARCH_RERANK_RUBRIC,
  });
  expect(input.cards.map((card) => card.key)).toEqual([
    'p01',
    'p02',
    'p03',
    'p04',
    'p05',
  ]);
  expect(input.cards[0]?.text).toBe('[1] Title 01 — example.test — Snippet 1');
});

it('keeps a card at the bound and omits the objective when the call has none', async () => {
  const { decisions, webSearch, judge } = lane({
    mode: 'shadow',
    judge: () => Promise.resolve(answered({})),
  });
  const long = resultAt(1, {
    title: 't'.repeat(400),
    snippet: 's'.repeat(500),
  });

  await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    resultsSource([long, resultAt(2), resultAt(3)]),
    { limit: 3, fetchSize: 3 },
  );

  const input = judge.mock.calls[0][0];
  expect(input).not.toHaveProperty('objective');
  expect(input.cards[0]?.text.length).toBeLessThanOrEqual(
    WEB_SEARCH_RERANK_CARD_MAX_CODE_UNITS,
  );
  expect(input.cards[0]?.text.startsWith('[1] tttt')).toBe(true);
});

it('does not judge without a rerank block, without a lane, or with fewer than three results', async () => {
  const call = vi.fn<JudgeFn>(() => Promise.resolve(answered({})));
  const noBlock = lane({ judge: call });
  const two = lane({ mode: 'shadow', judge: call });

  await spillWebSearchResult(
    testContext({ decisions: noBlock.decisions, webSearch: noBlock.webSearch }),
    resultsSource(fiveResults()),
    {
      limit: 5,
      fetchSize: 5,
    },
  );
  await spillWebSearchResult(testContext(), resultsSource(fiveResults()), {
    limit: 5,
    fetchSize: 5,
  });
  await spillWebSearchResult(
    testContext({ decisions: two.decisions, webSearch: two.webSearch }),
    resultsSource(fiveResults().slice(0, 2)),
    { limit: 5, fetchSize: 5 },
  );

  expect(call).not.toHaveBeenCalled();
});

it('leaves a grounded answer alone', async () => {
  const { decisions, webSearch, judge } = lane({
    judge: () => Promise.resolve(answered({ p01: 0.9 })),
  });

  await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    {
      kind: 'answer',
      engine: 'hosted',
      query: 'question',
      answer: 'An answer.',
      citations: [{ url: 'https://example.test/a' }],
    },
    { limit: 5, fetchSize: 5 },
  );

  expect(judge).not.toHaveBeenCalled();
});

it('records the shadow order beside an unchanged output', async () => {
  const { decisions, webSearch, judge } = lane({
    mode: 'shadow',
    judge: () =>
      Promise.resolve(
        answered({ p01: 0.1, p02: 0.9, p03: 0.5, p04: 0.05, p05: 0.7 }),
      ),
  });
  const source = resultsSource(fiveResults());
  const baseline = await spillWebSearchResult(testContext(), source, {
    limit: 3,
    fetchSize: 5,
  });

  const shadow = await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    source,
    { limit: 3, fetchSize: 5, objective: 'objective' },
  );

  expect(judge).toHaveBeenCalledTimes(1);
  expect(urls(shadow)).toEqual(urls(baseline));
  expect(renderWebSearchText(shadow)).toBe(renderWebSearchText(baseline));
  expect(shadow).toMatchObject({
    display: {
      rerank: {
        mode: 'shadow',
        model: 'jev-1.13',
        order: ['p02', 'p05', 'p03', 'p01', 'p04'],
        probabilities: { p01: 0.1, p02: 0.9, p03: 0.5, p04: 0.05, p05: 0.7 },
        latencyMs: 180,
        costUsd: 0.0000042,
      },
    },
  });
  // The record is display-only: the model-facing text has no trace of it.
  expect(renderWebSearchText(shadow)).not.toContain('rerank');
  expect(renderWebSearchText(shadow)).not.toContain('jev-1.13');
});

it('applies the order before every cap, so inline and artifact agree', async () => {
  const { decisions, webSearch } = lane({
    mode: 'on',
    judge: () =>
      Promise.resolve(
        answered({ p01: 0.1, p02: 0.9, p03: 0.5, p04: 0.05, p05: 0.7 }),
      ),
  });
  const source = resultsSource(fiveResults());

  const result = await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    source,
    { limit: 3, fetchSize: 5, objective: 'objective' },
  );

  const ranked = ['Title 02', 'Title 05', 'Title 03', 'Title 01', 'Title 04'];
  expect(headings(renderWebSearchText(result) ?? '')).toEqual(
    ranked.slice(0, 3),
  );
  expect(headings(writtenText())).toEqual(ranked);
  expect(result).toMatchObject({
    display: {
      rerank: { mode: 'on', order: ['p02', 'p05', 'p03', 'p01', 'p04'] },
    },
  });
  // A permutation only: the counts the notice measures do not move.
  const canonical = normalizeOutput(source, 3);
  if (canonical.kind !== 'results') throw new Error('expected results');
  expect(outputOf(result)).toHaveLength(canonical.results.length);
  expect(result.status === 'success' && result.truncationNotice).toMatch(
    /^full result: artifact:\/\/web_search-5/u,
  );
});

it('keeps the canonical order when the judge is unavailable', async () => {
  const { decisions, webSearch } = lane({
    judge: () => Promise.resolve(unavailable()),
  });
  const source = resultsSource(fiveResults());

  const result = await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    source,
    { limit: 5, fetchSize: 5, objective: 'objective' },
  );

  expect(urls(result)).toEqual(source.results.map((item) => item.url));
  expect(result).not.toHaveProperty('display');
});

it('survives a judge that throws and keeps the canonical order', async () => {
  const { decisions, webSearch } = lane({
    judge: () => Promise.reject(new Error('boom')),
  });
  const source = resultsSource(fiveResults());

  const result = await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    source,
    { limit: 5, fetchSize: 5 },
  );

  expect(urls(result)).toEqual(source.results.map((item) => item.url));
  expect(result).not.toHaveProperty('display');
});

it('appends a partially judged tail in its canonical order', async () => {
  const { decisions, webSearch } = lane({
    mode: 'on',
    judge: () => Promise.resolve(answered({ p02: 0.9, p04: 0.4 })),
  });
  const source = resultsSource(fiveResults());

  const result = await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    source,
    { limit: 5, fetchSize: 5, objective: 'objective' },
  );

  expect(headings(renderWebSearchText(result) ?? '')).toEqual([
    'Title 02',
    'Title 04',
    'Title 01',
    'Title 03',
    'Title 05',
  ]);
  expect(result).toMatchObject({
    display: { rerank: { order: ['p02', 'p04', 'p01', 'p03', 'p05'] } },
  });
});

it('ranks only results whose URL the output can keep', async () => {
  const { decisions, webSearch, judge } = lane({
    mode: 'on',
    judge: () => Promise.resolve(answered({ p01: 0.9, p02: 0.1, p04: 0.5 })),
  });
  const results = [
    resultAt(1),
    resultAt(2),
    { title: 'Bare', url: 'not-a-url' },
    resultAt(4),
  ];

  const result = await spillWebSearchResult(
    testContext({ decisions, webSearch }),
    resultsSource(results),
    { limit: 10, fetchSize: 10, objective: 'objective' },
  );

  const input = judge.mock.calls[0][0];
  expect(input.cards.map((card) => card.key)).toEqual(['p01', 'p02', 'p04']);
  expect(headings(renderWebSearchText(result) ?? '')).toEqual([
    'Title 01',
    'Title 04',
    'Title 02',
  ]);
});
