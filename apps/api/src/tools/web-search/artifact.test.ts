/**
 * `web_search` result spill (tool-result-artifacts D9): a call fetches the
 * operator's size, shows at most `limit` results inline, and stores the whole
 * normalized output as a Markdown artifact with one finding per result or
 * answer. A Run that cannot read artifacts, a failed write, and a result that
 * fits inline create no artifact.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { type MockInstance, vi } from 'vitest';

import { applySelectorSuffix } from '@workspace/native-file-tools';
import { isRecord } from '@workspace/runtime-safety';

import { type Db } from '../../db/tenant-db.service';
import { type WebSearchConfig } from '../../instance-config/web-search-config';
import { ArtifactsRepository } from '../artifacts/artifacts-repository';
import { artifactLineCount, artifactText } from '../artifacts/lines';
import { withholdFindings, type FindingPart } from '../artifacts/findings';
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
import {
  normalizeFullOutput,
  normalizeOutput,
  type WebSearchSuccess,
} from './output';
import {
  renderWebSearchOutput,
  renderWebSearchText,
  webSearchOutputSchema,
} from './text';
import { webSearchTool } from './tool';
import { createWorkspaceRootCell } from '../workspace-path';

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
  const db: Db = drizzle.mock();

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
    configuredCredentials: overrides.configuredCredentials ?? [],
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

function writtenPart(): FindingPart & { content: Buffer } {
  const part = writes.insertParts.mock.calls[0]?.[1]?.[0];

  if (part === undefined)
    throw new Error('Expected one written artifact part.');

  return {
    findings: part.findings,
    contentType: part.contentType,
    content: part.content,
  };
}

/** The stored text with the finding re-check applied, as `read` serves it. */
function withheldText(
  context: ToolContext,
  part: FindingPart & { content: Buffer },
): string {
  const text = part.content.toString('utf8');
  const locator = 'artifact://web_search-5';

  return withholdFindings(context, part, artifactText(text), {
    ...applySelectorSuffix(locator, undefined),
    lineCount: artifactLineCount(text),
  });
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
  expect(writtenPart().contentType).toBe('text/markdown');
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

it('numbers a long answer by its artifact pieces and withholds every line', async () => {
  const citations = Array.from({ length: 20 }, (_unused, index) =>
    longUrl(index + 1),
  );

  const source = answerSource('a'.repeat(8000), citations);

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  expect(result).toHaveProperty('artifact');
  const text = writtenText();
  expect(writtenFindings()).toEqual([
    {
      locators: citations.map((citation) => citation.url),
      rule: 'reject_only',
      start: 2,
      end: artifactLineCount(text),
    },
  ]);

  const rejecting = testContext({
    permissionPolicy: compileToolPermissionMap(
      {
        read: {
          reject: [{ field: 'path', regex: 'example\\.test/19/' }],
        },
      },
      'web-search-artifact-test',
    ),
  });

  const withheld = withheldText(rejecting, writtenPart()).split('\n');
  expect(withheld[0]).toContain('engine: hosted');
  expect(withheld.slice(1)).toEqual(
    Array.from({ length: withheld.length - 1 }, () => '[withheld]'),
  );
  expect(withheld.join('\n')).not.toContain('https://example.test/19/last');
});

it('continues after the last inline result when an answer follows', async () => {
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    [
      {
        engine: 'hosted',
        answer: 'short',
        citations: [{ url: 'https://example.test/cited' }],
      },
    ],
  );

  const blocks =
    renderWebSearchOutput(normalizeFullOutput(source, 20))?.blocks ?? [];

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  // A blank line separates result 11 from result 10, so the continuation is
  // the blank line, not the heading that follows it.
  expect(blocks[10]?.start).toBe((blocks[9]?.end ?? 0) + 2);
  expect(spilled(result).truncationNotice).toMatch(
    new RegExp(`:${(blocks[9]?.end ?? 0) + 1}-$`, 'u'),
  );
});

it('does not advertise a locator the read group denies after allocation', async () => {
  const policy = compileToolPermissionMap(
    {
      read: {
        allow: [{ field: 'path', literal: 'artifact://web_search-1' }],
        reject: [{ field: 'path', literal: 'artifact://web_search-5' }],
      },
    },
    'web-search-artifact-test',
  );

  const result = await spillWebSearchResult(
    testContext({ permissionPolicy: policy }),
    resultsSource(
      Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
    ),
    { limit: 10, fetchSize: 20 },
  );

  expect(result).not.toHaveProperty('artifact');
  expect(spilled(result).truncationNotice).toContain('left out: 10 results');
  expect(writes.insertParts).toHaveBeenCalled();
});

it('stores nothing without a Run id and keeps the tool name as the call id', async () => {
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
  );

  const withoutRun = await spillWebSearchResult(
    testContext({ runId: undefined }),
    source,
    { limit: 10, fetchSize: 20 },
  );

  expect(withoutRun).not.toHaveProperty('artifact');
  expect(writes.insertParts).not.toHaveBeenCalled();

  const withoutCall = await spillWebSearchResult(
    testContext({ toolCallId: undefined }),
    source,
    { limit: 10, fetchSize: 20 },
  );

  expect(withoutCall).toHaveProperty('artifact', 'artifact://web_search-5');
  expect(writes.insertArtifact.mock.calls[0]?.[0]).toMatchObject({
    toolCallId: 'web_search',
  });
});

it('stores a part exactly at the byte bound and not one byte over', async () => {
  const source = resultsSource(
    Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
  );

  const text = renderWebSearchOutput(normalizeFullOutput(source, 20))?.text;

  if (text === undefined) throw new Error('expected the full text');
  const bound = Buffer.byteLength(text);

  const atBound = await spillWebSearchResult(
    testContext({ artifactMaxBytes: bound }),
    source,
    { limit: 10, fetchSize: 20 },
  );

  expect(atBound).toHaveProperty('artifact', 'artifact://web_search-5');

  const overBound = await spillWebSearchResult(
    testContext({ artifactMaxBytes: bound - 1 }),
    source,
    { limit: 10, fetchSize: 20 },
  );

  expect(overBound).not.toHaveProperty('artifact');
});

it('names the host-file directory when the files are written', async () => {
  const root = mkdtempSync(join(tmpdir(), 'web-search-host-'));
  vi.stubEnv('TMPDIR', root);

  try {
    const result = await spillWebSearchResult(
      testContext({ artifactHostFiles: true }),
      resultsSource(
        Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
      ),
      { limit: 10, fetchSize: 20 },
    );

    expect(spilled(result).truncationNotice).toContain(
      `; host files in ${join(root, 'llame', 'chats', 'chat', 'artifacts')}`,
    );
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it('says the host files are on the llame host only in a Machine Workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'web-search-machine-'));
  vi.stubEnv('TMPDIR', root);

  try {
    const result = await spillWebSearchResult(
      testContext({
        artifactHostFiles: true,
        workspaceRoot: createWorkspaceRootCell('machine://box/home/u/project'),
        // Only this tool's locators are readable, so a wrong tool name in the
        // host-file fact loses the artifact's only route in a Machine.
        permissionPolicy: compileToolPermissionMap(
          {
            read: {
              allow: [{ field: 'path', regex: '^artifact://web_search-' }],
            },
          },
          'web-search-artifact-test',
        ),
      }),
      resultsSource(
        Array.from({ length: 20 }, (_unused, index) => resultAt(index + 1)),
      ),
      { limit: 10, fetchSize: 20 },
    );

    expect(spilled(result).truncationNotice).toContain(
      '; host files on the llame host only',
    );
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it('counts every citation an answer output leaves out', async () => {
  const citations = Array.from({ length: 20 }, (_unused, index) =>
    longUrl(index + 1),
  );

  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    answerSource('a'.repeat(8000), citations),
    { limit: 10, fetchSize: 20 },
  );

  const inline = spilled(result);

  if (inline.kind !== 'answer') throw new Error('expected an answer');
  const dropped = citations.length - inline.citations.length;
  expect(inline.truncationNotice).toBe(
    `left out: ${dropped} results; full result not stored`,
  );
});

it('uses the singular noun for one left-out result', async () => {
  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    resultsSource(
      Array.from({ length: 11 }, (_unused, index) => resultAt(index + 1)),
    ),
    { limit: 10, fetchSize: 20 },
  );

  expect(spilled(result).truncationNotice).toBe(
    'left out: 1 result; full result not stored',
  );
});

it('counts a dropped answer once, not once for each of its citations', async () => {
  const answers = Array.from({ length: 4 }, (_unused, index) => ({
    engine: `hosted-${index}`,
    answer: 'a'.repeat(8000),
    citations: [{ url: `https://example.test/cited-${index}` }],
  }));

  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    resultsSource([], answers),
    { limit: 10, fetchSize: 20 },
  );

  const inline = spilled(result);

  if (inline.kind !== 'results') throw new Error('expected results');
  const dropped = answers.length - (inline.answers?.length ?? 0);
  expect(dropped).toBeGreaterThan(1);
  expect(inline.truncationNotice).toBe(
    `left out: ${dropped} results; full result not stored`,
  );
});

it('records an answer output finding with every citation', async () => {
  const citations = Array.from({ length: 20 }, (_unused, index) =>
    longUrl(index + 1),
  );

  const source = answerSource('a'.repeat(8000), citations);

  await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  const blocks =
    renderWebSearchOutput(normalizeFullOutput(source, 20))?.blocks ?? [];

  expect(writtenFindings()).toEqual([
    {
      locators: citations.map((citation) => citation.url),
      rule: 'reject_only',
      start: blocks[0]?.start,
      end: blocks[0]?.end,
    },
  ]);
});

it('continues from the first block when an answer output is trimmed', async () => {
  const citations = Array.from({ length: 20 }, (_unused, index) =>
    longUrl(index + 1),
  );

  const result = await spillWebSearchResult(
    testContext(),
    answerSource('a'.repeat(8000), citations),
    { limit: 10, fetchSize: 20 },
  );

  expect(spilled(result).truncationNotice).toMatch(/:2-$/u);
});

it('counts dropped answers once and kept answers’ lost citations', async () => {
  const citations = Array.from({ length: 20 }, (_unused, index) =>
    longUrl(index + 1),
  );

  const answers = Array.from({ length: 5 }, (_unused, index) => ({
    engine: `hosted-${index}`,
    answer: 'a'.repeat(8000),
    citations,
  }));

  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    resultsSource([], answers),
    { limit: 10, fetchSize: 20 },
  );

  const inline = spilled(result);

  if (inline.kind !== 'results') throw new Error('expected results');
  expect(inline.answers).toHaveLength(1);
  expect(inline.answers?.[0]?.citations).toHaveLength(1);
  // Four whole answers and the nineteen citations the kept one lost.
  expect(inline.truncationNotice).toBe(
    'left out: 23 results; full result not stored',
  );
});

it('reserves the notice room when the inline body alone fits', async () => {
  const base = Array.from({ length: 20 }, (_unused, index) =>
    resultAt(index + 1, { title: 200, snippet: 300, url: 1 }),
  );

  const bodyLength = renderWebSearchOutput(
    normalizeOutput(resultsSource(base), 10),
  )?.text.length;

  if (bodyLength === undefined) throw new Error('expected the inline body');
  const target = 14_980;
  const extra = target - bodyLength;
  const per = Math.floor(extra / 10);
  const remainder = extra % 10;

  const source = resultsSource(
    base.map((result, index) =>
      index < 10
        ? {
            ...result,
            url: `${result.url}${'u'.repeat(per + (index < remainder ? 1 : 0))}`,
          }
        : result,
    ),
  );

  // The body alone fits the 15,000-unit bound, but the notice would not fit
  // beside it (the reported 15,004-unit overflow).
  const bodyOnly = renderWebSearchOutput(normalizeOutput(source, 10));
  expect(bodyOnly?.text.length).toBe(target);
  expect(target).toBeGreaterThan(14_744);
  expect(target).toBeLessThan(15_000);

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  const text = renderWebSearchText(result) ?? '';
  expect(text.length).toBeLessThanOrEqual(15_000);
  const notice = spilled(result).truncationNotice;
  expect(notice).toBeDefined();
  expect(text.split('\n').at(-1)).toBe(`[${String(notice)}]`);
});

it('re-reads a partially reproduced answer instead of skipping its tail', async () => {
  // Each answer is one artifact line (under 8,000 units), so a cut inside it
  // leaves the block's line span unchanged.
  const answers = ['a', 'b'].map((text, index) => ({
    engine: `hosted-${index}`,
    answer: text.repeat(6000),
    citations: [longUrl(index + 1)],
  }));

  const source = resultsSource([], answers);

  const fullBlocks =
    renderWebSearchOutput(normalizeFullOutput(source, 20))?.blocks ?? [];

  const result = await spillWebSearchResult(testContext(), source, {
    limit: 10,
    fetchSize: 20,
  });

  const inline = spilled(result);

  if (inline.kind !== 'results') throw new Error('expected results');
  expect(inline.answers).toHaveLength(2);
  const inlineBlocks = renderWebSearchOutput(inline)?.blocks ?? [];
  // The cut stays inside one answer line, so the block keeps its line span
  // while its content changed; it must not count as reproduced.
  expect(inlineBlocks[1]?.end).toBe(fullBlocks[1]?.end);
  expect(inlineBlocks[1]?.text).not.toBe(fullBlocks[1]?.text);
  expect(inline.truncationNotice).toMatch(
    new RegExp(`:${(fullBlocks[0]?.end ?? 0) + 1}-$`, 'u'),
  );
});

it('never reports zero results when only an answer text was cut', async () => {
  const answers = ['a', 'b'].map((text, index) => ({
    engine: `hosted-${index}`,
    answer: text.repeat(8000),
    citations: [longUrl(index + 1)],
  }));

  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    resultsSource([], answers),
    { limit: 10, fetchSize: 20 },
  );

  const inline = spilled(result);

  if (inline.kind !== 'results') throw new Error('expected results');
  expect(inline.answers).toHaveLength(2);
  expect(inline.answers?.[1]?.answer).not.toBe(answers[1]?.answer);
  expect(inline.truncationNotice).toBe(
    'left out: 1 result; full result not stored',
  );
});

it('counts a cut answer output as one left-out result', async () => {
  const source = {
    kind: 'answer' as const,
    engine: 'hosted',
    query: 'q'.repeat(1000),
    answer: 'a\n'.repeat(4000),
    citations: [longUrl(1)],
    notes: Array.from({ length: 10 }, () => 'n'.repeat(200)),
  };

  const result = await spillWebSearchResult(
    testContext({ artifactReadable: false }),
    source,
    { limit: 10, fetchSize: 20 },
  );

  const inline = spilled(result);

  if (inline.kind !== 'answer') throw new Error('expected an answer');
  expect(inline.answer.length).toBeLessThan(8000);
  expect(inline.citations).toHaveLength(1);
  expect(inline.truncationNotice).toBe(
    'left out: 1 result; full result not stored',
  );
});
