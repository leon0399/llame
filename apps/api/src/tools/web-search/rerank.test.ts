/**
 * `web_search` objective ranking through the decision lane: deduplication, the
 * fits-inline guard, the score sort, the failure note, the stored rank record,
 * and exact decision-key replacement of the received presentation.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type MockInstance, vi } from 'vitest';
import { z } from 'zod';

import { isRecord } from '@workspace/runtime-safety';

import * as schema from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';
import { type DecisionClient } from '../../decisions/decision-client';
import {
  type DecisionOutcome,
  type DecisionRequest,
} from '../../decisions/decision-protocol';
import {
  type CandidateJudgement,
  type DecisionJudge,
  type JudgeCandidatesInput,
  judgeCandidatesWith,
  DecisionsService,
} from '../../decisions/decisions.service';
import { BUILT_IN_DEFAULTS } from '../../instance-config/llame-config';
import { type WebSearchConfig } from '../../instance-config/web-search-config';
import { ArtifactsRepository } from '../artifacts/artifacts-repository';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type ToolContext, type ToolResult } from '../types';
import { spillWebSearchResult } from './artifact';
import { type RawResult, type SearchChainSuccess } from './chain';
import { normalizeOutput } from './output';
import { WEB_SEARCH_RERANK_RUBRIC } from '../../ranking/rubrics';
import { WEB_SEARCH_RERANK_CARD_BOUND } from './rerank';
import { renderWebSearchText, webSearchOutputSchema } from './text';
import { webSearchTool } from './tool';

const SEQ = 5;
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');
const KEY = 'sk-decision-secret';

type JudgeFn = (input: JudgeCandidatesInput) => Promise<CandidateJudgement>;

type ResultsSource = Extract<SearchChainSuccess, { kind: 'results' }>;

let insertParts: MockInstance<ArtifactsRepository['insertParts']>;

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
    configuredCredentials: [],
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    ...overrides,
  };
}

function judgement(
  scores: Readonly<Record<string, number>> | undefined,
): CandidateJudgement {
  return {
    status: scores === undefined ? 'unavailable' : 'answered',
    probabilities:
      scores === undefined ? undefined : new Map(Object.entries(scores)),
    unanswered: [],
    usage: { inputTokens: 120, outputTokens: 0, costUsd: 0.0000042 },
    model: scores === undefined ? null : 'jev-1.14',
    latencyMs: 180,
  };
}

/** A judge that scores each card by the number its key ends in. */
function byKeyNumber(score: (n: number) => number): JudgeFn {
  return (input) =>
    Promise.resolve(
      judgement(
        Object.fromEntries(
          input.cards.map((card) => [
            card.key,
            score(Number(card.key.slice(1))),
          ]),
        ),
      ),
    );
}

const AGGREGATE_ENGINES: WebSearchConfig['engines'] = [
  { id: 'agg', type: 'aggregate', engines: ['a', 'b'] },
];

/** The tool's `webSearch.rerank` block, the lane double, and its spy. */
function lane(
  judge: JudgeFn,
  {
    engines = [],
    rerank = true,
  }: {
    readonly engines?: WebSearchConfig['engines'];
    readonly rerank?: boolean;
  } = {},
) {
  const spy = vi.fn<JudgeFn>(judge);

  const decisions: DecisionJudge = {
    judgeCandidates: spy,
    protectText: (_model, text) => text.replaceAll(KEY, '[REDACTED]'),
  };

  const webSearch: WebSearchConfig = {
    engines,
    chain: [],
    ...(rerank && { rerank: { model: 'jev' } }),
  };

  return { spy, context: testContext({ decisions, webSearch }) };
}

function resultAt(
  index: number,
  overrides: Partial<RawResult> = {},
): RawResult {
  return {
    title: `Title ${String(index).padStart(2, '0')}`,
    url: `https://example.test/r/${index}`,
    snippet: `Snippet ${index}`,
    ...overrides,
  };
}

function results(count: number): Array<RawResult> {
  return Array.from({ length: count }, (_unused, index) => resultAt(index));
}

/** A result whose URL is long enough that few of them fit the inline bound. */
function wideResult(index: number, label = 'Title'): RawResult {
  return resultAt(index, {
    title: `${label} ${String(index).padStart(2, '0')}`,
    url: `https://example.test/${index}/${'p'.repeat(2000)}`,
  });
}

function source(
  list: ReadonlyArray<RawResult>,
  overrides: Partial<ResultsSource> = {},
): ResultsSource {
  return {
    kind: 'results',
    engine: 'brave',
    query: 'query text',
    results: list,
    ...overrides,
  };
}

function outputOf(result: ToolResult) {
  if (result.status !== 'success') throw new Error('expected a success');
  const output = webSearchOutputSchema.parse(result);

  if (output.kind !== 'results') throw new Error('expected results');

  return output;
}

function titles(result: ToolResult): ReadonlyArray<string> {
  return outputOf(result).results.map((item) => item.title);
}

const recordSchema = z.object({
  model: z.string(),
  order: z.array(z.string()),
  scores: z.record(z.string(), z.number()),
  latencyMs: z.number(),
  costUsd: z.number().nullable(),
});

/** The stored rank record of a result, parsed; absent when none was stored. */
function record(result: ToolResult): z.infer<typeof recordSchema> | undefined {
  if (!('display' in result) || !isRecord(result.display)) return undefined;

  return recordSchema.parse(result.display.rerank);
}

function writtenText(): string {
  const part = insertParts.mock.calls[0]?.[1]?.[0];

  if (part === undefined) throw new Error('Expected one written artifact.');

  return part.content.toString('utf8');
}

/** The result titles of the stored artifact text, in order. */
function writtenTitles(): ReadonlyArray<string> {
  return [...writtenText().matchAll(/^## \d+\. (.*)$/gmu)].map(
    (match) => match[1],
  );
}

const inlineCall = { limit: 10, fetchSize: 20 };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(SEQ);
  vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue({
    id: 'artifact-5',
    createdAt: CREATED_AT,
  });
  insertParts = vi
    .spyOn(ArtifactsRepository.prototype, 'insertParts')
    .mockResolvedValue(undefined);
});

describe('deduplication', () => {
  it('outputs a repeated URL once and lets the first spelling win', async () => {
    const result = await spillWebSearchResult(
      testContext(),
      source([
        resultAt(1, { url: 'https://www.example.test/docs/', title: 'First' }),
        resultAt(2, { url: 'https://example.test/docs', title: 'Second' }),
        resultAt(3),
      ]),
      inlineCall,
    );

    expect(outputOf(result).results.map((item) => item.url)).toEqual([
      'https://www.example.test/docs/',
      'https://example.test/r/3',
    ]);
    expect(titles(result)).toEqual(['First', 'Title 03']);
  });

  it('counts left out results after deduplication', async () => {
    const list = [...results(12), resultAt(99, { url: resultAt(0).url })];

    const result = await spillWebSearchResult(
      testContext({ artifactReadable: false }),
      source(list),
      inlineCall,
    );

    expect(titles(result)).toHaveLength(10);
    expect(result).toMatchObject({
      truncationNotice: 'left out: 2 results; full result not stored',
    });
  });

  it('skips the rank call when the repeat leaves the set within the limit', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      source([...results(10), resultAt(99, { url: resultAt(0).url })]),
      inlineCall,
    );

    expect(spy).not.toHaveBeenCalled();
    expect(titles(result)).toEqual(results(10).map((item) => item.title));
    expect(record(result)).toBeUndefined();
  });
});

describe('the fits-inline guard', () => {
  it('ranks twenty fetched results and shows the first ten by score', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n / 100));

    const result = await spillWebSearchResult(context, source(results(20)), {
      ...inlineCall,
      objective: 'find the thing',
    });

    const input = spy.mock.calls[0][0];
    expect(input).toMatchObject({
      model: 'jev',
      tool: 'web_search',
      objective: 'find the thing',
      query: 'query text',
      cardBound: WEB_SEARCH_RERANK_CARD_BOUND,
      rubric: WEB_SEARCH_RERANK_RUBRIC,
    });
    expect(input.cards.map((card) => card.key)).toEqual(
      Array.from(
        { length: 20 },
        (_unused, i) => `p${String(i).padStart(2, '0')}`,
      ),
    );
    expect(input.cards[3].text).toBe(
      '[p03] Title 03 — example.test — Snippet 3',
    );
    expect(titles(result)).toEqual(
      Array.from({ length: 10 }, (_unused, i) => `Title ${19 - i}`),
    );
    expect(writtenTitles()).toHaveLength(20);
    expect(writtenTitles().slice(0, 3)).toEqual([
      'Title 19',
      'Title 18',
      'Title 17',
    ]);
  });

  it('pads card keys to the width of the last index', async () => {
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    await spillWebSearchResult(context, source(results(12)), inlineCall);
    const keys = spy.mock.calls[0][0].cards.map((card) => card.key);
    expect(keys[0]).toBe('p00');
    expect(keys[11]).toBe('p11');
  });

  it('judges against the query when the call sets no objective', async () => {
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    await spillWebSearchResult(context, source(results(12)), inlineCall);
    const input = spy.mock.calls[0][0];
    expect(input.objective).toBeUndefined();
    expect(input.query).toBe('query text');
  });

  it('makes no decision call when five results fit inline', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      source(results(5)),
      inlineCall,
    );

    expect(spy).not.toHaveBeenCalled();
    expect(titles(result)).toEqual(results(5).map((item) => item.title));
    expect(record(result)).toBeUndefined();
  });

  it('ranks ten results when the size bound cuts the text at seven', async () => {
    const list = Array.from({ length: 10 }, (_unused, index) =>
      wideResult(index),
    );

    const unranked = normalizeOutput(source(list), 10, 256);
    expect(unranked.kind === 'results' && unranked.results).toHaveLength(7);

    const { spy, context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      source(list),
      inlineCall,
    );

    expect(spy.mock.calls[0][0].cards).toHaveLength(10);
    expect(titles(result)).toEqual(
      Array.from(
        { length: 7 },
        (_unused, i) => `Title ${String(9 - i).padStart(2, '0')}`,
      ),
    );
  });

  it('ranks a small set over the limit', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(context, source(results(2)), {
      limit: 1,
      fetchSize: 20,
    });

    expect(spy.mock.calls[0][0].cards).toHaveLength(2);
    expect(titles(result)).toEqual(['Title 01']);
  });

  it('does not rank without a configured model', async () => {
    const { spy, context } = lane(
      byKeyNumber((n) => n),
      { rerank: false },
    );

    await spillWebSearchResult(context, source(results(20)), inlineCall);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not rank an answer output', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n));
    await spillWebSearchResult(
      context,
      {
        kind: 'answer',
        engine: 'hosted',
        query: 'q',
        answer: 'text',
        citations: [{ url: 'https://example.test/a' }],
      },
      inlineCall,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('ranks the results of a parallel engine like any other', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n / 100));

    const result = await spillWebSearchResult(
      context,
      source(results(12), { engine: 'parallel' }),
      inlineCall,
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(titles(result)).toEqual(
      results(12)
        .slice(2)
        .reverse()
        .map((item) => item.title),
    );
  });
});

describe('ordering', () => {
  it('keeps engine order on a tie and puts unjudged results last in engine order', async () => {
    const { context } = lane((input) =>
      Promise.resolve(
        judgement({
          [input.cards[0].key]: 0.5,
          [input.cards[1].key]: 0.9,
          [input.cards[2].key]: 0.5,
        }),
      ),
    );

    const result = await spillWebSearchResult(context, source(results(5)), {
      limit: 4,
      fetchSize: 20,
    });

    expect(titles(result)).toEqual([
      'Title 01',
      'Title 00',
      'Title 02',
      'Title 03',
    ]);
    expect(record(result)).toMatchObject({
      order: ['p1', 'p0', 'p2', 'p3', 'p4'],
      scores: { p0: 0.5, p1: 0.9, p2: 0.5 },
      model: 'jev-1.14',
      latencyMs: 180,
      costUsd: 0.0000042,
    });
  });

  it('keeps the rank order and adds no note after a partial answer', async () => {
    const { context } = lane((input) =>
      Promise.resolve(judgement({ [input.cards[2].key]: 0.7 })),
    );

    const result = await spillWebSearchResult(context, source(results(6)), {
      limit: 3,
      fetchSize: 20,
    });

    expect(titles(result)).toEqual(['Title 02', 'Title 00', 'Title 01']);
    expect(outputOf(result).notes).toBeUndefined();
    expect(record(result)).toMatchObject({
      order: ['p2', 'p0', 'p1', 'p3', 'p4', 'p5'],
    });
  });

  it('reports the ranked inline cut in the left out count', async () => {
    const list = [
      ...Array.from({ length: 11 }, (_unused, index) =>
        resultAt(index, { snippet: 's'.repeat(300) }),
      ),
      ...Array.from({ length: 7 }, (_unused, index) =>
        wideResult(11 + index, 'Wide'),
      ),
    ];

    const { context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      { ...context, artifactReadable: false },
      source(list),
      { limit: 18, fetchSize: 20 },
    );

    expect(titles(result)).toHaveLength(7);
    expect(result).toMatchObject({
      truncationNotice: 'left out: 11 results; full result not stored',
    });
  });

  it('keeps removal first and counts left out after ranking', async () => {
    const { context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      { ...context, artifactReadable: false },
      source(results(20), { removed: 2 }),
      inlineCall,
    );

    expect(outputOf(result).notes?.[0]).toBe('removed 2 entries');
    expect(result).toMatchObject({
      truncationNotice: 'left out: 10 results; full result not stored',
    });
  });
});

describe('a failed rank call', () => {
  const failing = () => lane(() => Promise.resolve(judgement(undefined)));

  it('keeps engine order, adds one note, and stores no record', async () => {
    const { context } = failing();

    const result = await spillWebSearchResult(
      context,
      source(results(20)),
      inlineCall,
    );

    expect(titles(result)).toEqual(results(10).map((item) => item.title));
    expect(outputOf(result).notes).toEqual(['rerank: unavailable']);
    expect(record(result)).toBeUndefined();
    expect(renderWebSearchText(result)).toContain('[rerank: unavailable]');
  });

  it('treats a judge that throws as a failed call', async () => {
    const { context } = lane(() => Promise.reject(new Error('boom')));

    const result = await spillWebSearchResult(
      context,
      source(results(20)),
      inlineCall,
    );

    expect(outputOf(result).notes).toEqual(['rerank: unavailable']);
  });

  it('keeps removal first and the failure note last at the note cap', async () => {
    const { context } = failing();

    const notes = Array.from(
      { length: 11 },
      (_unused, i) => `engine-${i + 1}: empty`,
    );

    const result = await spillWebSearchResult(
      context,
      source(results(20), { notes, removed: 1 }),
      inlineCall,
    );

    expect(outputOf(result).notes).toEqual([
      'removed 1 entry',
      ...notes.slice(0, 7),
      '4 more engines',
      'rerank: unavailable',
    ]);
    const text = renderWebSearchText(result) ?? '';
    expect(text.indexOf('[removed 1 entry]')).toBeLessThan(
      text.indexOf('[engine-1: empty]'),
    );
    expect(text.indexOf('[4 more engines]')).toBeLessThan(
      text.indexOf('[rerank: unavailable]'),
    );
  });

  it('propagates an enclosing cancellation without a failure note', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');

    const { context } = lane(() => {
      controller.abort(reason);

      return Promise.reject(reason);
    });

    await expect(
      spillWebSearchResult(
        { ...context, abortSignal: controller.signal },
        source(results(20)),
        inlineCall,
      ),
    ).rejects.toBe(reason);
  });
});

describe('aggregate candidate retention', () => {
  it('ranks all 40 merged candidates and stores all 40', async () => {
    const { spy, context } = lane(
      byKeyNumber((n) => n),
      { engines: AGGREGATE_ENGINES },
    );

    const result = await spillWebSearchResult(
      context,
      source(results(40), { engine: 'agg' }),
      inlineCall,
    );

    expect(spy.mock.calls[0][0].cards).toHaveLength(40);
    expect(titles(result)[0]).toBe('Title 39');
    expect(titles(result)).toHaveLength(10);
    expect(writtenTitles()).toHaveLength(40);
  });

  it('keeps the full merged set in fusion order when the rank call fails', async () => {
    const { context } = lane(() => Promise.resolve(judgement(undefined)), {
      engines: AGGREGATE_ENGINES,
    });

    const result = await spillWebSearchResult(
      context,
      source(results(40), { engine: 'agg' }),
      inlineCall,
    );

    expect(titles(result)).toEqual(results(10).map((item) => item.title));
    expect(outputOf(result).notes).toEqual(['rerank: unavailable']);
    expect(writtenTitles()).toHaveLength(40);
    expect(writtenTitles()[0]).toBe('Title 00');
  });

  /** Two Brave engines of 20 results each, behind one aggregate. */
  function stubTwoBraves() {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const offset =
          new Headers(init?.headers).get('X-Subscription-Token') === 'a-key'
            ? 0
            : 20;

        return Promise.resolve(
          new Response(
            JSON.stringify({
              web: {
                results: Array.from({ length: 20 }, (_unused, index) => ({
                  title: `Title ${String(offset + index).padStart(2, '0')}`,
                  url: `https://example.test/r/${offset + index}`,
                })),
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );
  }

  const twoBraveEngines: WebSearchConfig['engines'] = [
    { id: 'a', type: 'brave', key: 'a-key', timeoutSeconds: 60 },
    { id: 'b', type: 'brave', key: 'b-key', timeoutSeconds: 60 },
    { id: 'agg', type: 'aggregate', engines: ['a', 'b'] },
  ];

  it('retains both 20-result children through the tool: 40 cards, 40 artifact results', async () => {
    stubTwoBraves();

    try {
      const spy = vi.fn<JudgeFn>(byKeyNumber((n) => n));

      const context = testContext({
        decisions: { judgeCandidates: spy, protectText: (_m, t) => t },
        webSearch: {
          engines: twoBraveEngines,
          chain: ['agg'],
          fetchLimit: 20,
          rerank: { model: 'jev' },
        },
      });

      const result = await webSearchTool.execute(context, {
        query: 'query text',
        limit: 10,
        objective: 'find the thing',
      });

      expect(spy.mock.calls[0][0].cards).toHaveLength(40);
      expect(spy.mock.calls[0][0].objective).toBe('find the thing');
      expect(titles(result)).toHaveLength(10);
      expect(writtenTitles()).toHaveLength(40);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the fetch-size cut through the tool when no model is configured', async () => {
    stubTwoBraves();

    try {
      const context = testContext({
        webSearch: {
          engines: twoBraveEngines,
          chain: ['agg'],
          fetchLimit: 20,
        },
      });

      const result = await webSearchTool.execute(context, {
        query: 'query text',
        limit: 10,
      });

      expect(titles(result)).toHaveLength(10);
      expect(writtenTitles()).toHaveLength(20);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('judges the first 256 of 300 cards in 32-card requests and stores all 300', async () => {
    let inFlight = 0;
    let peak = 0;

    const decide = vi.fn(
      async (request: DecisionRequest): Promise<DecisionOutcome> => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;

        return {
          status: 'answered',
          model: 'jev-1.14',
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { type: 'noul' as const, noul: 0.5 },
            ]),
          ),
          usage: { inputTokens: 1, outputTokens: 0, costUsd: 0.001 },
          latencyMs: 5,
        };
      },
    );

    const client: DecisionClient = { decide };
    const spy = vi.fn<JudgeFn>((input) => judgeCandidatesWith(client, input));

    const context = testContext({
      decisions: { judgeCandidates: spy, protectText: (_m, t) => t },
      webSearch: {
        engines: AGGREGATE_ENGINES,
        chain: [],
        rerank: { model: 'jev' },
      },
    });

    const result = await spillWebSearchResult(
      context,
      source(results(300), { engine: 'agg' }),
      { limit: 10, fetchSize: 100 },
    );

    expect(decide).toHaveBeenCalledTimes(8);
    expect(peak).toBe(8);
    expect(
      decide.mock.calls.every(
        ([request]) => Object.keys(request.questions).length <= 32,
      ),
    ).toBe(true);
    const stored = record(result);
    expect(stored?.costUsd).toBeCloseTo(0.008, 10);
    expect(Object.keys(stored?.scores ?? {})).toHaveLength(256);
    expect(stored?.order).toHaveLength(300);
    expect(writtenTitles()).toHaveLength(300);
  });
});

describe('the stored rank record', () => {
  it('leaves rank metadata out of live and replayed text and keeps source text', async () => {
    const { context } = lane(byKeyNumber((n) => n));
    const list = results(12);
    list[11] = resultAt(11, { snippet: 'jev-1.14 rerank score 0.97 scores' });

    const result = await spillWebSearchResult(
      context,
      source(list),
      inlineCall,
    );

    expect(record(result)).toMatchObject({ model: 'jev-1.14' });
    const text = renderWebSearchText(result);
    // The closed output shape is what a replayed part renders from.
    expect(text).toBe(renderWebSearchText(outputOf(result)));
    expect(text).toContain('jev-1.14 rerank score 0.97 scores');
    expect(text).not.toContain('latencyMs');
    expect(text).not.toContain('"order"');
  });
});

describe('decision-key replacement', () => {
  const keyed = () =>
    results(12).map((item, index) =>
      index === 11
        ? {
            ...item,
            title: `Leak ${KEY} here`,
            snippet: `before ${KEY} after`,
            url: `https://example.test/leak?token=${KEY}`,
          }
        : item,
    );

  it('replaces the key on the wire, inline, in the artifact, and in rendered text', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      source(keyed()),
      inlineCall,
    );

    const wire = JSON.stringify(spy.mock.calls[0][0].cards);
    const rendered = renderWebSearchText(result) ?? '';

    for (const surface of [
      wire,
      JSON.stringify(result),
      rendered,
      writtenText(),
    ]) {
      expect(surface).not.toContain(KEY);
    }

    expect(spy.mock.calls[0][0].cards[11].text).toContain(
      '[p11] Leak [REDACTED] here',
    );
    expect(rendered).toContain('Leak [REDACTED] here');
    expect(rendered).toContain('before [REDACTED] after');
    expect(rendered).toContain('Title 10');
    expect(writtenText()).toContain('Leak [REDACTED] here');
  });

  it('replaces the key when the guard skips ranking', async () => {
    const { spy, context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      source(keyed().slice(10)),
      inlineCall,
    );

    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(renderWebSearchText(result)).toContain('Leak [REDACTED] here');
  });

  it('changes nothing without a configured model', async () => {
    const { context } = lane(
      byKeyNumber((n) => n),
      { rerank: false },
    );

    const result = await spillWebSearchResult(
      context,
      source(keyed().slice(10)),
      inlineCall,
    );

    expect(renderWebSearchText(result)).toContain(KEY);
  });
});

describe('what the lane receives', () => {
  it('sends the run id, the call objective and the enclosing signal', async () => {
    const controller = new AbortController();
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    await spillWebSearchResult(
      { ...context, abortSignal: controller.signal },
      source(results(12)),
      { ...inlineCall, objective: 'find the thing' },
    );
    const input = spy.mock.calls[0][0];
    expect(input.runId).toBe('run');
    expect(input.objective).toBe('find the thing');
    expect(input.abortSignal).toBe(controller.signal);
  });

  it('leaves out an absent objective and signal and sends an empty run id', async () => {
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    await spillWebSearchResult(
      { ...context, runId: undefined },
      source(results(12)),
      inlineCall,
    );
    const input = spy.mock.calls[0][0];
    expect(input.runId).toBe('');
    expect(Object.keys(input)).not.toContain('objective');
    expect(Object.keys(input)).not.toContain('abortSignal');
  });

  it('pads a ten-result set to one digit', async () => {
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    await spillWebSearchResult(context, source(results(10)), {
      limit: 5,
      fetchSize: 20,
    });
    const keys = spy.mock.calls[0][0].cards.map((card) => card.key);
    expect(keys).toEqual(Array.from({ length: 10 }, (_unused, i) => `p${i}`));
  });

  it('falls back to the URL for a blank title and drops an empty snippet', async () => {
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    const list = results(12);
    list[0] = resultAt(0, { title: '   ', snippet: '' });
    list[1] = resultAt(1, { snippet: undefined });
    await spillWebSearchResult(context, source(list), inlineCall);
    const cards = spy.mock.calls[0][0].cards;
    expect(cards[0].text).toBe('[p00] https://example.test/r/0 — example.test');
    expect(cards[1].text).toBe('[p01] Title 01 — example.test');
  });

  it('keeps a title that has text and joins its lines', async () => {
    const { spy, context } = lane(byKeyNumber(() => 0.5));
    const list = results(12);
    list[0] = resultAt(0, { title: '  A\nB ', snippet: 'x\ny' });
    await spillWebSearchResult(context, source(list), inlineCall);
    expect(spy.mock.calls[0][0].cards[0].text).toBe(
      '[p00] A B — example.test — x y',
    );
  });
});

describe('answers and citations of a results call', () => {
  it('replaces the key in the merged answers and their citations', async () => {
    const { context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      source(results(12), {
        answers: [
          {
            engine: 'hosted',
            answer: `answer ${KEY} end`,
            citations: [
              {
                url: `https://example.test/c?k=${KEY}`,
                title: `cited ${KEY} title`,
              },
              { url: 'https://example.test/untitled' },
            ],
          },
        ],
      }),
      inlineCall,
    );

    const rendered = renderWebSearchText(result) ?? '';
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(rendered).not.toContain(KEY);
    expect(rendered).toContain('answer [REDACTED] end');
    expect(JSON.stringify(result)).toContain('cited [REDACTED] title');
    expect(rendered).toContain('https://example.test/untitled');
  });

  it('replaces the key in the title of an answer citation', async () => {
    const { context } = lane(byKeyNumber((n) => n));

    const result = await spillWebSearchResult(
      context,
      {
        kind: 'answer',
        engine: 'hosted',
        query: 'q',
        answer: 'text',
        citations: [
          { url: 'https://example.test/a', title: `cited ${KEY} title` },
          { url: 'https://example.test/b' },
        ],
      },
      inlineCall,
    );

    const rendered = renderWebSearchText(result) ?? '';
    expect(rendered).not.toContain(KEY);
    expect(JSON.stringify(result)).toContain('cited [REDACTED] title');
  });
});

describe('which sources keep the whole merged set', () => {
  const braveEntry: WebSearchConfig['engines'][number] = {
    id: 'brave',
    type: 'brave',
    key: 'k',
    timeoutSeconds: 60,
  };

  const call = { limit: 10, fetchSize: 20 };

  it('stores only the fetch size for a single engine next to an aggregate', async () => {
    const { context } = lane(
      byKeyNumber((n) => n),
      {
        engines: [...AGGREGATE_ENGINES, braveEntry],
      },
    );

    await spillWebSearchResult(context, source(results(40)), call);
    expect(writtenTitles()).toHaveLength(20);
  });

  it('stores only the fetch size for an aggregate when no model is configured', async () => {
    const { context } = lane(
      byKeyNumber((n) => n),
      {
        engines: AGGREGATE_ENGINES,
        rerank: false,
      },
    );

    await spillWebSearchResult(
      context,
      source(results(40), { engine: 'agg' }),
      call,
    );
    expect(writtenTitles()).toHaveLength(20);
  });

  it('stores only the fetch size when the winning engine is not configured as an aggregate', async () => {
    const { context } = lane(
      byKeyNumber((n) => n),
      {
        engines: [{ ...braveEntry, id: 'agg' }, braveEntry],
      },
    );

    await spillWebSearchResult(
      context,
      source(results(40), { engine: 'agg' }),
      call,
    );
    expect(writtenTitles()).toHaveLength(20);
  });
});

describe('ranking with a rerank model', () => {
  const RERANK_KEY = 'rerank-key-fixture';

  function rerankContext(overrides: Partial<ToolContext> = {}): ToolContext {
    const decisions = new DecisionsService({
      config: {
        ...BUILT_IN_DEFAULTS,
        providers: [
          {
            id: 'rerank',
            type: 'cohere-rerank',
            key: RERANK_KEY,
            baseUrl: 'https://openrouter.ai/api/v1',
            headers: {},
          },
        ],
        rerankModels: [
          { id: 'rr-fast', provider: 'rerank', model: 'cohere/rerank-5-fast' },
        ],
      },
    });

    const webSearch: WebSearchConfig = {
      engines: [],
      chain: [],
      rerank: { model: 'rr-fast' },
    };

    return testContext({ decisions, webSearch, ...overrides });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts twenty results by score before the inline cut and stores the served model', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        Response.json({
          model: 'cohere/rerank-v5.0-fast',
          results: Array.from({ length: 20 }, (_unused, index) => ({
            index,
            relevance_score: index / 100,
          })),
          usage: { total_tokens: 2139, cost: 0.00004278 },
        }),
      ),
    );

    const result = await spillWebSearchResult(
      rerankContext(),
      source(results(20)),
      { ...inlineCall, objective: 'find the thing' },
    );

    expect(titles(result)).toEqual(
      Array.from({ length: 10 }, (_unused, i) => `Title ${19 - i}`),
    );
    const stored = record(result);
    expect(stored?.model).toBe('cohere/rerank-v5.0-fast');
    expect(Object.keys(stored?.scores ?? {})).toHaveLength(20);
    expect(stored?.costUsd).toBe(0.00004278);
    expect(writtenTitles()).toHaveLength(20);
  });

  it('keeps engine order and adds one note after a failed rerank request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response('', { status: 422 })),
      );

    const result = await spillWebSearchResult(
      rerankContext(),
      source(results(20)),
      inlineCall,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(titles(result)).toEqual(results(10).map((item) => item.title));
    expect(outputOf(result).notes).toEqual(['rerank: unavailable']);
    expect(record(result)).toBeUndefined();
  });

  it('settles with the runner timeout when the deadline passes during the request', async () => {
    const controller = new AbortController();
    const timeout = new DOMException('tool timeout', 'TimeoutError');
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
      controller.abort(timeout);

      return promise;
    });

    await expect(
      spillWebSearchResult(
        rerankContext({ abortSignal: controller.signal }),
        source(results(20)),
        inlineCall,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
