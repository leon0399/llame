/* eslint-disable @typescript-eslint/no-unsafe-return */

import { drizzle } from 'drizzle-orm/postgres-js';
import { ZodError } from 'zod';

import { ChatsRepository } from '../chats/chats-repository';
import * as schema from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type CanonicalHydrationRow } from '../search/chat/canonical-search-hydrator';
import {
  buildCanonicalSearchExcerpt,
  type CanonicalSearchPreviewPassage,
} from '../search/chat/canonical-search-excerpt';
import {
  matchCanonicalSearchPreview,
  scanCanonicalLogicalLines,
} from '../search/chat/canonical-search-matcher';
import {
  searchConversationsTool,
  type SearchConversationsContentResult,
} from './search-conversations';
import { parseConversationSourceCoordinates } from './conversation-source-coordinates';
import { isZodSchema } from './schema-utils';
import { type ToolContext, type ToolResult } from './types';
import { isRecord, isString } from '../unknown-record';

/**
 * `ToolResult`'s success variant is `{ status: 'success' } & UnknownRecord`
 * (shared across every tool), so `result.results` is `unknown` even after
 * narrowing on `status`. These two helpers narrow it back to this tool's own
 * result shape at the boundary instead of asserting it away.
 */
function successResults(result: ToolResult): ReadonlyArray<unknown> {
  if (result.status !== 'success' || !Array.isArray(result.results)) {
    throw new Error('Expected a successful result with an array `results`.');
  }
  return result.results;
}

function isContentResult(
  value: unknown,
): value is SearchConversationsContentResult {
  return isRecord(value) && value['kind'] === 'content';
}

/**
 * Unit tests with a FAKE ToolContext (no real DB; the repository read is
 * spied). Drizzle's mock DB runs the real `runAs` callback, so these prove the
 * tool boundary without a database: the
 * scope (userId) comes from context; the model's args are only query/limit;
 * rows map to the tool's result shape.
 * Cross-tenant isolation itself is proven on a live Postgres by
 * chats-search.integration.test.ts, which this tool now shares an
 * implementation with (ChatsRepository.searchByOwner) — see D7.
 */

type Row = {
  id: string;
  title: string | null;
  snippet: string | null;
  updatedAt: Date;
  bestDocumentId: string | null;
};

type CallerIdSpy = { userId?: string };

function fakeContext(
  rows: Array<Row>,
  spy?: CallerIdSpy,
  executeRows: ReadonlyArray<
    ReadonlyArray<CanonicalHydrationRow | { line_id: number }>
  > = [],
): ToolContext {
  const db: Db = drizzle.mock({ schema });
  vi.spyOn(ChatsRepository.prototype, 'searchByOwner').mockResolvedValue(rows);
  if (executeRows.length > 0) {
    const pending = [...executeRows];
    const executeSpy = vi.spyOn(db, 'execute');
    for (const rowSet of pending) {
      executeSpy.mockResolvedValueOnce(
        Object.assign([...rowSet], {
          columns: [],
          count: rowSet.length,
          command: 'SELECT',
          statement: { name: '', string: '', types: [], columns: [] },
          state: { status: 'I', pid: 0, secret: 0 },
        }),
      );
    }
  }
  const tenantDb: TenantRunner = {
    runAs: <T>(userId: string, fn: (tx: Db) => Promise<T>) => {
      if (spy) spy.userId = userId;
      return fn(db);
    },
  };
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb,
  };
}

const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000002';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000003';

function hydrationRow(
  text: string,
  chatId = CHAT_ID,
  offsets?: { start: number; endExclusive: number },
): CanonicalHydrationRow {
  return {
    message_id: MESSAGE_ID,
    message_chat_id: chatId,
    message_seq: '7',
    message_role: 'user',
    message_parts: [{ type: 'text', text }],
    message_usage: null,
    message_created_at: new Date('2026-08-27T10:00:00.000Z'),
    first_message_id: MESSAGE_ID,
    last_message_id: MESSAGE_ID,
    first_seq: '7',
    last_seq: '7',
    first_message_text_offset: offsets?.start ?? 0,
    last_message_text_offset_exclusive: offsets?.endExclusive ?? text.length,
  };
}

function passage(
  text: string,
  anchor: CanonicalSearchPreviewPassage['anchor'],
): CanonicalSearchPreviewPassage {
  return {
    message: {
      messageSeq: 7,
      role: 'user',
      timestamp: new Date('2026-08-27T10:00:00.000Z'),
    },
    offset: 0,
    limit: 1,
    lines: [
      {
        line: 0,
        text,
        delimiter: '',
        startOffset: 0,
        endOffsetExclusive: text.length,
      },
    ],
    anchor,
  };
}

describe('search_conversations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is read-only and takes mode + optional fields from the model', () => {
    expect(searchConversationsTool.classification).toBe('read_only');
    expect(searchConversationsTool.description).toContain('conversation_read');
    expect(searchConversationsTool.description).toContain('untrusted');
    expect(searchConversationsTool.description).not.toMatch(
      /bestDocumentId|hash|partId|projection|version/u,
    );
    const schema = searchConversationsTool.inputSchema;
    if (!isZodSchema(schema)) {
      throw new Error('Expected a Zod input schema');
    }
    expect(schema.parse({ mode: 'content', query: 'hi' })).toEqual({
      mode: 'content',
      query: 'hi',
    });
    expect(() =>
      schema.parse({ mode: 'content', query: 'hi', userId: 'x' }),
    ).toThrow(ZodError);
  });

  it('scopes canonical metadata results to the context userId without an activation flag', async () => {
    const spy: CallerIdSpy = {};
    const context = fakeContext(
      [
        {
          id: 'chat-9',
          title: 'TypeScript project',
          snippet: null,
          updatedAt: new Date('2026-07-01T12:00:00Z'),
          bestDocumentId: null,
        },
      ],
      spy,
    );

    const result = await searchConversationsTool.execute(context, {
      mode: 'content',
      query: 'typescript',
      limit: 5,
    });

    expect(spy.userId).toBe('user-A'); // scope came from context
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(isString(result.notice)).toBe(true);
    if (!isString(result.notice)) return;
    expect(result.notice).toMatch(/untrusted|stale/iu);
    expect(result.results).toEqual([
      {
        kind: 'metadata',
        chatId: 'chat-9',
        title: 'TypeScript project',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    ]);
  });

  it('returns success with an empty list when nothing matches', async () => {
    const result = await searchConversationsTool.execute(fakeContext([]), {
      mode: 'content',
      query: 'nothing',
      limit: 5,
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(isString(result.notice)).toBe(true);
    if (!isString(result.notice)) return;
    expect(result.notice).toMatch(/untrusted|stale/iu);
    expect(result.results).toEqual([]);
  });

  it('caps canonical excerpts around an exact raw anchor without splitting Unicode', () => {
    const raw = `${'x'.repeat(280)}😀NEEDLE${'y'.repeat(400)}`;
    const result = buildCanonicalSearchExcerpt(
      passage(raw, {
        line: 0,
        startOffset: 282,
        endOffsetExclusive: 288,
        kind: 'exact',
      }),
    );

    expect(Array.from(result).length).toBeLessThanOrEqual(500);
    expect(result).toContain('😀NEEDLE');
    expect(result).toContain('…');
    expect(result).not.toContain('\uFFFD');
  });

  it('uses the matcher fixed fallback anchor at the first raw code point of the qualifying line', async () => {
    const raw = `${'before\r\n'.repeat(20)}😀fallback${'z'.repeat(600)}`;
    const sourceLines = scanCanonicalLogicalLines(raw);
    const qualifyingLine = sourceLines.find((line) =>
      line.text.startsWith('😀fallback'),
    );
    if (qualifyingLine === undefined) {
      throw new Error('Expected a qualifying fallback line.');
    }

    const selected = await matchCanonicalSearchPreview(
      {
        chatId: CHAT_ID,
        messages: [
          {
            messageSeq: 7,
            role: 'user',
            timestamp: new Date('2026-08-27T10:00:00.000Z'),
            visibleText: raw,
            sourceStart: 0,
            sourceEndExclusive: raw.length,
          },
        ],
      },
      'unrelated fuzzy query',
      (_normalizedQuery, candidates) => {
        const candidate = candidates.find(({ normalizedText }) =>
          normalizedText.startsWith('😀fallback'),
        );
        return Promise.resolve(
          new Set(candidate === undefined ? [] : [candidate.id]),
        );
      },
    );
    if (selected === null) {
      throw new Error('Expected the fuzzy line to be selected.');
    }

    expect(selected.anchor).toEqual({
      line: qualifyingLine.line,
      startOffset: qualifyingLine.startOffset,
      endOffsetExclusive: qualifyingLine.startOffset + 2,
      kind: 'fallback',
    });
    expect(selected.offset).toBe(qualifyingLine.line - 1);
    expect(selected.limit).toBe(2);
    expect(selected.lines[0]?.delimiter).toBe('\r\n');

    const result = buildCanonicalSearchExcerpt(selected);

    expect(Array.from(result).length).toBeLessThanOrEqual(500);
    expect(result.startsWith('😀fallback')).toBe(true);
    expect(result).toContain('…');
    expect(result).not.toContain('\uFFFD');
  });

  it('returns strict metadata/content results when canonical shaping is trusted', async () => {
    const text = 'We decided something: https://example.test/item';
    const result = await searchConversationsTool.execute(
      fakeContext(
        [
          {
            id: CHAT_ID,
            title: 'Decision log',
            snippet: 'projection bytes must not leak',
            updatedAt: new Date('2026-08-27T11:00:00.000Z'),
            bestDocumentId: DOCUMENT_ID,
          },
          {
            id: '00000000-0000-4000-8000-000000000004',
            title: 'Decision title',
            snippet: null,
            updatedAt: new Date('2026-08-27T12:00:00.000Z'),
            bestDocumentId: null,
          },
        ],
        undefined,
        [[hydrationRow(text)], [{ line_id: 0 }]],
      ),
      { mode: 'content', query: 'decided', limit: 5 },
    );

    expect(result).toMatchObject({
      status: 'success',
      results: [
        {
          kind: 'content',
          chatId: CHAT_ID,
          title: 'Decision log',
          updatedAt: '2026-08-27T11:00:00.000Z',
          role: 'user',
          timestamp: '2026-08-27T10:00:00.000Z',
          messageSeq: 7,
          offset: 0,
          limit: 1,
          excerpt: text,
        },
        {
          kind: 'metadata',
          chatId: '00000000-0000-4000-8000-000000000004',
          title: 'Decision title',
          updatedAt: '2026-08-27T12:00:00.000Z',
        },
      ],
    });
    if (result.status !== 'success') return;
    if (!isString(result.notice)) return;
    expect(result.notice).toMatch(/untrusted|stale/iu);
    if (!Array.isArray(result.results)) return;
    const content: unknown = result.results[0];
    const metadata: unknown = result.results[1];
    if (!isRecord(content) || !isRecord(metadata)) return;
    const coordinates = {
      chatId: content['chatId'],
      messageSeq: content['messageSeq'],
      offset: content['offset'],
      limit: content['limit'],
    };
    expect(parseConversationSourceCoordinates(coordinates)).toEqual(
      coordinates,
    );
    expect(content).not.toHaveProperty('snippet');
    expect(content).not.toHaveProperty('bestDocumentId');
    expect(metadata).not.toHaveProperty('role');
    expect(metadata).not.toHaveProperty('messageSeq');
    expect(metadata).not.toHaveProperty('offset');
    expect(metadata).not.toHaveProperty('limit');
    expect(metadata).not.toHaveProperty('excerpt');
  });

  it('omits canonical candidates that cannot hydrate or match instead of falling back to projection text', async () => {
    const text = 'current canonical source';
    const omittedByHydration: Row = {
      id: '00000000-0000-4000-8000-000000000005',
      title: 'Deleted source',
      snippet: 'must never be returned',
      updatedAt: new Date('2026-08-27T13:00:00.000Z'),
      bestDocumentId: '00000000-0000-4000-8000-000000000006',
    };
    const omittedByMatcher: Row = {
      id: '00000000-0000-4000-8000-000000000007',
      title: 'Cross-line only source',
      snippet: 'must never be returned',
      updatedAt: new Date('2026-08-27T14:00:00.000Z'),
      bestDocumentId: '00000000-0000-4000-8000-000000000008',
    };

    const result = await searchConversationsTool.execute(
      fakeContext(
        [
          {
            id: CHAT_ID,
            title: 'Kept',
            snippet: 'projection text',
            updatedAt: new Date('2026-08-27T11:00:00.000Z'),
            bestDocumentId: DOCUMENT_ID,
          },
          omittedByHydration,
          omittedByMatcher,
        ],
        undefined,
        [
          [hydrationRow(text)],
          [{ line_id: 0 }],
          [],
          [hydrationRow(text, omittedByMatcher.id)],
          [],
        ],
      ),
      { mode: 'content', query: 'canonical', limit: 5 },
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    // Hydration-failed candidate omitted; matcher-failed candidate now
    // returned as a vector-only first-message-anchored result (#197 D5).
    expect(result.results).toHaveLength(2);
    expect(successResults(result)[0]).toMatchObject({
      kind: 'content',
      chatId: CHAT_ID,
    });
    expect(JSON.stringify(result)).not.toContain('must never be returned');
    expect(JSON.stringify(result)).not.toContain('projection text');
  });

  it('anchors a vector-only result to the matched chunk, not the start of the full message (#197 D5)', async () => {
    // A message long enough to have been chunked across multiple
    // `search_chat_documents` rows (conversation-chunker.ts splits messages
    // over CHUNK_MAX_CHARS): the winning document here covers only the
    // SECOND chunk (`first_message_text_offset` starts mid-message).
    const text =
      'line0 first chunk content\n' +
      'line1 more first chunk\n' +
      'line2 second chunk starts here\n' +
      'line3 second chunk continues';
    const chunkStart = text.indexOf('line2');
    const allLines = scanCanonicalLogicalLines(text);
    const expectedOffset = allLines.findIndex(
      (line) => line.startOffset === chunkStart,
    );
    if (expectedOffset === -1) {
      throw new Error('Fixture text must place the chunk on a line boundary.');
    }
    const expectedLimit = allLines.length - expectedOffset;

    const row: Row = {
      id: CHAT_ID,
      title: 'Chunked message',
      snippet: null,
      updatedAt: new Date('2026-08-27T15:00:00.000Z'),
      bestDocumentId: DOCUMENT_ID,
    };

    const result = await searchConversationsTool.execute(
      fakeContext([row], undefined, [
        [
          hydrationRow(text, CHAT_ID, {
            start: chunkStart,
            endExclusive: text.length,
          }),
        ],
        [], // no lexical line match -> vector-only fallback
      ]),
      { mode: 'content', query: 'unmatched lexically', limit: 5 },
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.results).toHaveLength(1);
    const [content] = successResults(result);
    if (!isContentResult(content)) {
      throw new Error('Expected a content result.');
    }
    expect(content.offset).toBe(expectedOffset);
    expect(content.limit).toBe(expectedLimit);
    expect(content.excerpt.startsWith('line2')).toBe(true);
    expect(content.excerpt).not.toContain('line0');
  });

  it('keeps search_conversations input and declaration surface strict and vector-free', () => {
    const schema = searchConversationsTool.inputSchema;
    if (!isZodSchema(schema)) {
      throw new Error('Expected a Zod input schema');
    }

    for (const field of [
      'chatId',
      'source',
      'sourceId',
      'vectorScore',
      'score',
      'messageSeq',
      'offset',
      'partId',
      'cursor',
    ]) {
      expect(() =>
        schema.parse({ mode: 'content', query: 'x', [field]: 'future' }),
      ).toThrow(ZodError);
    }
    expect(schema.parse({ mode: 'content', query: 'x', limit: 3 })).toEqual({
      mode: 'content',
      query: 'x',
      limit: 3,
    });
  });
});
