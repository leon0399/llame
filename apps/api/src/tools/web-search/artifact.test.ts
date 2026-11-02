/**
 * `web_search` result spill (tool-result-artifacts D9): a call fetches the
 * operator's size, shows at most `limit` results inline, and stores the whole
 * normalized output as a Markdown artifact with one finding per result or
 * answer. A Run that cannot read artifacts, a failed write, and a result that
 * fits inline create no artifact.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type MockInstance, vi } from 'vitest';

import { isRecord } from '@workspace/runtime-safety';

import * as schema from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';
import { type WebSearchConfig } from '../../instance-config/web-search-config';
import { ArtifactsRepository } from '../artifacts/artifacts-repository';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type ToolContext, type ToolResult } from '../types';
import { type VendorFetch } from './http';
import { spillWebSearchResult } from './artifact';
import {
  type RawAnswer,
  type RawCitation,
  type RawResult,
  type SearchChainSuccess,
} from './chain';
import { normalizeFullOutput, type WebSearchSuccess } from './output';
import {
  renderWebSearchOutput,
  renderWebSearchText,
  webSearchOutputSchema,
} from './text';
import { webSearchTool } from './tool';

/** The Chat counter every write in this suite takes: seq 5. */
const SEQ = 5;
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');

type ArtifactWrites = {
  readonly nextSeq: MockInstance<ArtifactsRepository['nextSeq']>;
  readonly insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
};
let writes: ArtifactWrites;

function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId: 'call-1',
    permissionPolicy: compileToolPermissionMap(
      { read: { allow: true } },
      'web-search-artifact-test',
    ),
    artifactReadable: true,
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    ...overrides,
  };
}

function resultAt(
  index: number,
  options: {
    readonly title?: number;
    readonly snippet?: number;
    readonly url?: number;
  } = {},
): RawResult {
  return {
    title: `Title ${String(index).padStart(2, '0')}${'t'.repeat(options.title ?? 0)}`,
    url: `https://example.test/r/${index}/${'p'.repeat(options.url ?? 6)}`,
    snippet: 's'.repeat(options.snippet ?? 20),
    published: '2026-10-08',
  };
}

function resultsSource(
  results: ReadonlyArray<RawResult>,
  answers?: ReadonlyArray<RawAnswer>,
): Extract<SearchChainSuccess, { kind: 'results' }> {
  const source = {
    kind: 'results' as const,
    engine: 'brave',
    query: 'query',
    results,
  };
  return answers === undefined ? source : { ...source, answers };
}

function answerSource(
  answer: string,
  citations: ReadonlyArray<RawCitation>,
): Extract<SearchChainSuccess, { kind: 'answer' }> {
  return {
    kind: 'answer',
    engine: 'hosted',
    query: 'question',
    answer,
    citations,
  };
}

function longUrl(index: number, padding = 2000): RawCitation {
  return { url: `https://example.test/${index}/${'u'.repeat(padding)}` };
}

/** The returned object as its closed output shape. */
function spilled(
  result: ToolResult,
): WebSearchSuccess & { truncationNotice?: string } {
  if (result.status !== 'success') throw new Error('expected a success');
  return webSearchOutputSchema.parse(result);
}

function textOf(result: ToolResult): string {
  return renderWebSearchText(result) ?? '';
}

function writtenText(): string {
  const part = writes.insertParts.mock.calls[0]?.[1]?.[0];
  if (part === undefined)
    throw new Error('Expected one written artifact part.');
  return part.content.toString('utf8');
}

function writtenFindings(): ReadonlyArray<unknown> {
  const part = writes.insertParts.mock.calls[0]?.[1]?.[0];
  const document: unknown = part?.findings;
  if (!isRecord(document) || !Array.isArray(document['findings'])) {
    throw new Error('Expected a written finding document.');
  }
  return document['findings'];
}

beforeEach(() => {
  vi.restoreAllMocks();
  writes = {
    nextSeq: vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(SEQ),
    insertArtifact: vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue({ id: 'artifact-5', createdAt: CREATED_AT }),
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
});

it('shows ten of twenty results inline and stores all twenty in rank order', async () => {
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
  );

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  expect(result).toMatchObject({
    status: 'success',
    kind: 'results',
    artifact: 'artifact://web_search-5',
  });
  const output = spilled(result);
  if (output.kind !== 'results') throw new Error('expected results');
  expect(output.results).toHaveLength(10);
  expect(output.results.map((item) => item.url)).toEqual(
    source.results.slice(0, 10).map((item) => item.url),
  );

  const text = writtenText();
  const headings = text.match(/^## \d+\./gmu) ?? [];
  expect(headings).toHaveLength(20);
  const positions = Array.from({ length: 20 }, (_unused, index) =>
    text.indexOf(`## ${index + 1}.`),
  );
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  expect(text).toBe(renderWebSearchText(normalizeFullOutput(source, 20)));
});

it('keeps the artifact text whole, so reading it needs no engine request', async () => {
  const fetch = vi.fn(() => Promise.reject(new Error('no request expected')));
  vi.stubGlobal('fetch', fetch);
  try {
    const source = resultsSource(
      Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    );
    const result = await spillWebSearchResult(testContext(), source, {
      limit: 10,
      fetchSize: 20,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(textOf(result)).toContain('artifact://web_search-5:');
    // Every result the model does not read inline is in the stored text, so a
    // `read` of the locator serves it from the store alone.
    expect(writtenText()).toContain('https://example.test/r/20/pppppp');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('ends the notice with the artifact line after the last inline result', async () => {
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
  );
  const blocks =
    renderWebSearchOutput(normalizeFullOutput(source, 20))?.blocks ?? [];

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  const notice = spilled(result).truncationNotice;
  expect(notice).toMatch(
    /^full result: artifact:\/\/web_search-5 \(\d+ lines\)/u,
  );
  // The artifact line after the last inline result: the blank separator
  // before the first result the inline text leaves out.
  expect(notice).toMatch(
    new RegExp(
      `; continue with artifact://web_search-5:${(blocks[9]?.end ?? 0) + 1}-$`,
      'u',
    ),
  );
  expect(textOf(result).split('\n').at(-1)).toBe(`[${String(notice)}]`);
});

it('drops trailing results that do not fit and never cuts a URL', async () => {
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) =>
      resultAt(index + 1, { title: 200, snippet: 300, url: 400 }),
    ),
  );

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 20,
    fetchSize: 20,
  });

  const output = spilled(result);
  if (output.kind !== 'results') throw new Error('expected results');
  expect(output.results.length).toBeLessThan(20);
  expect(output.results.map((item) => item.url)).toEqual(
    source.results.slice(0, output.results.length).map((item) => item.url),
  );
  expect(output.notes).toContain(
    `${20 - output.results.length} results dropped to fit the output limit`,
  );
  const text = textOf(result);
  expect(text.length).toBeLessThanOrEqual(15_000);
  for (const item of output.results) expect(text).toContain(item.url);
  expect(writtenText().match(/^## \d+\./gmu)).toHaveLength(20);
});

it('keeps the first citation of a maximal answer inline', async () => {
  const citations = Array.from({ length: 20 }, (_unused, index) =>
    longUrl(index + 1),
  );

  const result = await spillWebSearchResult(
    testContext(),
    answerSource('a'.repeat(8000), citations),
    { limit: 10, fetchSize: 20 },
  );

  expect(result).toMatchObject({
    kind: 'answer',
    artifact: 'artifact://web_search-5',
  });
  const output = spilled(result);
  if (output.kind !== 'answer') throw new Error('expected an answer');
  expect(output.citations.length).toBeGreaterThanOrEqual(1);
  expect(output.citations.length).toBeLessThan(20);
  expect(output.citations[0]?.url).toBe(citations[0]?.url);
  const text = textOf(result);
  expect(text).toContain(`[1] ${citations[0]?.url}`);
  expect(text.length).toBeLessThanOrEqual(15_000);
  expect(writtenText().match(/^\[\d+\] https:/gmu)).toHaveLength(20);
});

it('drops results before the text of an attached answer', async () => {
  const answer: RawAnswer = {
    engine: 'hosted',
    answer: 'a'.repeat(8000),
    citations: [{ url: 'https://example.test/cited' }],
  };
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) =>
      resultAt(index + 1, { title: 200, snippet: 300 }),
    ),
    [answer],
  );

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 20,
    fetchSize: 20,
  });

  const output = spilled(result);
  if (output.kind !== 'results') throw new Error('expected results');
  expect(output.answers?.[0]?.answer).toBe(answer.answer);
  expect(output.results.length).toBeLessThan(20);
  expect(output.notes).toEqual(
    expect.arrayContaining([
      `${20 - output.results.length} results dropped to fit the output limit`,
    ]),
  );
});

it('drops whole attached answers from the end last, with one note', async () => {
  const answers = Array.from({ length: 8 }, (_unused, index) => ({
    engine: `hosted-${index}`,
    answer: 'a',
    citations: [longUrl(index + 1, 2000)],
  }));

  const result = await spillWebSearchResult(
    testContext(),
    resultsSource([], answers),
    { limit: 10, fetchSize: 20 },
  );

  const output = spilled(result);
  if (output.kind !== 'results') throw new Error('expected results');
  const inline = output.answers ?? [];
  const dropped = 8 - inline.length;
  expect(dropped).toBeGreaterThan(0);
  expect(output.notes).toEqual(
    expect.arrayContaining([
      `${dropped} ${dropped === 1 ? 'answer' : 'answers'} dropped to fit the output limit`,
    ]),
  );
  expect(writtenText().match(/^## Answer /gmu)).toHaveLength(8);
});

it('keeps one citation in each attached answer', async () => {
  const answers: Array<RawAnswer> = Array.from(
    { length: 2 },
    (_unused, index) => ({
      engine: `hosted-${index}`,
      answer: 'a'.repeat(8000),
      citations: Array.from({ length: 20 }, (_inner, citation) =>
        longUrl(index * 20 + citation + 1),
      ),
    }),
  );

  const result = await spillWebSearchResult(
    testContext(),
    resultsSource([], answers),
    { limit: 10, fetchSize: 20 },
  );

  const output = spilled(result);
  if (output.kind !== 'results') throw new Error('expected results');
  const inline = output.answers ?? [];
  expect(inline).toHaveLength(2);
  for (const [index, answer] of inline.entries()) {
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]?.url).toBe(answers[index]?.citations[0]?.url);
  }
  expect(textOf(result).length).toBeLessThanOrEqual(15_000);
});

it('creates no artifact when a removal leaves an output that fits', async () => {
  const source = {
    ...resultsSource([resultAt(1), resultAt(2)]),
    removed: 1,
  };

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  expect(result).not.toHaveProperty('artifact');
  expect(spilled(result).notes).toContain('removed 1 entry');
  expect(writes.insertParts).not.toHaveBeenCalled();
});

it('creates no artifact when the whole output fits inline', async () => {
  const result = await spillWebSearchResult(
    testContext(),
    resultsSource(
      Array.from({ length: 5 }, (_unused, index) => resultAt(index + 1)),
    ),
    { limit: 10, fetchSize: 20 },
  );

  expect(result).not.toHaveProperty('artifact');
  expect(result).not.toHaveProperty('truncationNotice');
  expect(writes.insertParts).not.toHaveBeenCalled();
});

it('returns the inline output and a count when the Run cannot read artifacts', async () => {
  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    resultsSource(
      Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    ),
    { limit: 10, fetchSize: 20 },
  );

  expect(result).toMatchObject({
    truncationNotice: 'left out: 10 results; full result not stored',
  });
  expect(result).not.toHaveProperty('artifact');
  expect(writes.insertParts).not.toHaveBeenCalled();
  expect(textOf(result).split('\n').at(-1)).toBe(
    '[left out: 10 results; full result not stored]',
  );
});

it('keeps the inline result when the artifact write fails', async () => {
  writes.insertParts.mockRejectedValueOnce(new Error('insert failed'));

  const result = await spillWebSearchResult(
    testContext(),
    resultsSource(
      Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    ),
    { limit: 10, fetchSize: 20 },
  );

  expect(result).toMatchObject({
    truncationNotice: 'left out: 10 results; full result not stored',
  });
  expect(result).not.toHaveProperty('artifact');
});

it('does not store a result above the byte bound', async () => {
  const result = await spillWebSearchResult(
    testContext({ artifactMaxBytes: 500 }),
    resultsSource(
      Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    ),
    { limit: 10, fetchSize: 20 },
  );

  expect(result).toMatchObject({
    truncationNotice: 'left out: 10 results; full result not stored',
  });
  expect(writes.insertParts).not.toHaveBeenCalled();
});

it('records one reject-only finding for every result and answer block', async () => {
  const answers: Array<RawAnswer> = [
    {
      engine: 'hosted',
      answer: 'grounded',
      citations: [{ url: 'https://example.test/answer' }],
    },
  ];
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    answers,
  );
  const blocks =
    renderWebSearchOutput(normalizeFullOutput(source, 20))?.blocks ?? [];

  await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  const findings = writtenFindings();
  expect(findings).toHaveLength(21);
  expect(findings[0]).toEqual({
    locators: [source.results[0]?.url],
    rule: 'reject_only',
    start: blocks[0]?.start,
    end: blocks[0]?.end,
  });
  expect(findings[20]).toEqual({
    locators: ['https://example.test/answer'],
    rule: 'reject_only',
    start: blocks[20]?.start,
    end: blocks[20]?.end,
  });
});

it('fetches the default size and shows ten of fifteen results inline', async () => {
  const entries = Array.from({ length: 15 }, (_unused, index) => ({
    title: `Result ${index + 1}`,
    url: `https://example.test/n/${index + 1}`,
    description: `Description ${index + 1}`,
  }));
  const fetch = vi.fn<VendorFetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ web: { results: entries } }), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    const config: WebSearchConfig = {
      engines: [
        { id: 'brave', type: 'brave', key: 'test-key', timeoutSeconds: 60 },
      ],
      chain: ['brave'],
    };

    const result = await webSearchTool.execute(
      { ...testContext(), webSearch: config },
      { query: 'llame', limit: 10 },
    );

    const [url] = fetch.mock.calls[0] ?? [];
    if (url === undefined) throw new Error('Expected one engine request.');
    const requested =
      url instanceof Request ? url.url : url instanceof URL ? url.href : url;
    const request = new URL(requested);
    expect(request.searchParams.get('count')).toBe('20');
    expect(result).toMatchObject({
      kind: 'results',
      artifact: 'artifact://web_search-5',
    });
    const output = spilled(result);
    if (output.kind !== 'results') throw new Error('expected results');
    expect(output.results).toHaveLength(10);
    expect(writtenText().match(/^## \d+\./gmu)).toHaveLength(15);
  } finally {
    vi.unstubAllGlobals();
  }
});
