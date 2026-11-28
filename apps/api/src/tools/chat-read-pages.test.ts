import { isNumber, isRecord } from '@workspace/runtime-safety';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import {
  ChatReadRepository,
  type ChatIndexRow,
  type ChatReadRow,
} from '../chats/chat-read-repository';
import { readChatResource } from './chat-read';
import { type ToolContext } from './types';

afterEach(() => vi.restoreAllMocks());

const CHAT_ID = '00000000-0000-0000-0000-000000000001';

function context() {
  const db = drizzle.mock();

  const runAs: TenantRunner['runAs'] = <T>(
    _owner: string,
    callback: (tx: Db) => Promise<T>,
  ) => callback(db);

  return {
    userId: 'owner',
    chatId: 'chat',
    tenantDb: { runAs },
    configuredCredentials: [],
  } satisfies ToolContext;
}

function chatRows(count: number): Array<ChatReadRow> {
  return Array.from({ length: count }, (_, index) => ({
    chatId: CHAT_ID,
    locator: `chat://${CHAT_ID}`,
    title: `Chat ${index + 1}`,
    activityAt: '2026-01-01T00:00:00.000Z',
    messageCount: index + 1,
    workspace: 'machine://host/root',
    openingExcerpt: 'Opening',
    latestExcerpt: 'Latest',
    runStatus: 'idle',
  }));
}

function installCollectionRows(rows: Array<ChatReadRow>, total = rows.length) {
  vi.spyOn(ChatReadRepository.prototype, 'countOwnedChats').mockResolvedValue(
    total,
  );
  vi.spyOn(ChatReadRepository.prototype, 'readChatRows').mockImplementation(
    (_owner, offset, limit) =>
      Promise.resolve({ rows: rows.slice(offset, offset + limit), total }),
  );
}

function indexRows(count: number, text = 'index row'): Array<ChatIndexRow> {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    role: 'user',
    parts: [{ type: 'text', text: `${text} ${index + 1}` }],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index % 60)),
  }));
}

function installIndexRows(
  rows: Array<ChatIndexRow>,
  latest = rows.at(-1)?.seq ?? 0,
) {
  vi.spyOn(
    ChatReadRepository.prototype,
    'maxCommittedSequence',
  ).mockResolvedValue(latest);
  vi.spyOn(
    ChatReadRepository.prototype,
    'listEligibleIndex',
  ).mockImplementation((_chatId, _owner, window) => {
    const matches = rows.filter(
      ({ seq }) =>
        seq >= (window.start ?? 0) &&
        seq <= (window.end ?? Number.MAX_SAFE_INTEGER) &&
        (window.beforeSeq === undefined || seq < window.beforeSeq),
    );

    const selected =
      window.start === undefined
        ? matches.slice(-window.limit)
        : matches.slice(0, window.limit);

    return Promise.resolve(selected);
  });
  vi.spyOn(
    ChatReadRepository.prototype,
    'previousEligibleSequences',
  ).mockImplementation((_chatId, _owner, beforeSeq, limit) =>
    Promise.resolve(
      rows
        .filter(({ seq }) => seq < beforeSeq)
        .slice(-limit)
        .toReversed()
        .map(({ seq }) => ({ seq })),
    ),
  );
  vi.spyOn(ChatReadRepository.prototype, 'currentRunStatus').mockResolvedValue(
    'idle',
  );
  vi.spyOn(ChatReadRepository.prototype, 'ownsChat').mockResolvedValue(true);
}

describe('Chat collection pages', () => {
  it.each([
    'chat://:raw',
    'chat://:outline',
    'chat://:L1-2,4-5',
    'chat://:L1,3',
    'chat://:L5-,L9',
  ])(
    'rejects unsupported or malformed collection selector %s before reading rows',
    async (locator) => {
      const count = vi.spyOn(ChatReadRepository.prototype, 'countOwnedChats');
      const rows = vi.spyOn(ChatReadRepository.prototype, 'readChatRows');

      await expect(
        readChatResource(context(), 'read', locator),
      ).resolves.toMatchObject({ status: 'error', type: 'invalid_selector' });
      expect(count).not.toHaveBeenCalled();
      expect(rows).not.toHaveBeenCalled();
    },
  );

  it('places a finite collection window at its one-based offset and caps it at the requested end', async () => {
    installCollectionRows(chatRows(80));

    const result = await readChatResource(context(), 'read', 'chat://:L21-23');

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: 'chat://',
      shownRange: { startLine: 21, endLine: 23 },
      requestedRange: { startLine: 21, endLine: 23 },
      nextOffset: undefined,
      truncated: false,
    });

    if (result.status !== 'success') throw new Error('Expected a collection.');
    expect(result.content).toContain('Chat 21');
    expect(result.content).toContain('Chat 23');
    expect(result.content).toContain('\n');
    expect(result.content).not.toContain('Chat 24');
  });

  it('keeps the default collection newest-page continuation bounded by the actual total', async () => {
    installCollectionRows(chatRows(35));

    const result = await readChatResource(context(), 'read', 'chat://');

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      entryCount: 35,
      shownRange: { startLine: 1, endLine: 20 },
      requestedRange: undefined,
      nextOffset: 20,
      truncated: true,
    });
  });

  it('caps an open-ended collection page at twenty rows and advances from the exact next offset', async () => {
    installCollectionRows(chatRows(35));

    const result = await readChatResource(context(), 'read', 'chat://:L6-');

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      shownRange: { startLine: 6, endLine: 25 },
      requestedRange: { startLine: 6, endLine: 35 },
      nextOffset: 25,
      truncated: true,
    });

    if (result.status !== 'success') throw new Error('Expected a collection.');
    expect(result.content).toContain('Chat 6');
    expect(result.content).toContain('Chat 25');
    expect(result.content).not.toContain('Chat 26');
  });

  it('distinguishes a selected empty collection from an invalid selector and reports its empty range', async () => {
    installCollectionRows([], 0);

    const result = await readChatResource(context(), 'read', 'chat://:L1-');

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      entryCount: 0,
      shownRange: null,
      requestedRange: { startLine: 1, endLine: 0 },
      truncated: false,
    });
  });

  it('shrinks an oversized collection from its tail while keeping result bounds and continuation metadata', async () => {
    const rows = chatRows(4).map((row, index) => ({
      ...row,
      title: `Oversized ${index + 1} ${'x'.repeat(12_000)}`,
    }));

    installCollectionRows(rows);

    const result = await readChatResource(context(), 'read', 'chat://:L1-');

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      entryCount: 4,
      shownRange: { startLine: 1, endLine: 1 },
      requestedRange: { startLine: 1, endLine: 4 },
      nextOffset: 1,
      truncated: true,
    });
  });

  it('returns a bounded row-size error instead of retrying forever for an oversized collection row', async () => {
    installCollectionRows(
      chatRows(1).map((row) => ({ ...row, title: 'x'.repeat(20_000) })),
    );

    await expect(
      readChatResource(context(), 'read', 'chat://'),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'representation_too_large',
    });
  });
});

describe('Chat index pages', () => {
  it('reports a missing foreign Chat when no rows are visible, but preserves an owned empty Chat', async () => {
    installIndexRows([], 0);
    const owns = vi.spyOn(ChatReadRepository.prototype, 'ownsChat');
    owns.mockResolvedValueOnce(false);

    await expect(
      readChatResource(context(), 'read', `chat://${CHAT_ID}`),
    ).resolves.toMatchObject({ status: 'error', type: 'not_found' });
    await expect(
      readChatResource(context(), 'read', `chat://${CHAT_ID}`),
    ).resolves.toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: null,
      content: '',
      truncated: false,
    });
  });

  it('uses the default newest 50-row suffix and exposes sparse backward navigation without self-inclusion', async () => {
    const rows = indexRows(55).map((row) => ({ ...row, seq: row.seq * 3 }));
    installIndexRows(rows, 165);
    vi.spyOn(
      ChatReadRepository.prototype,
      'previousEligibleSequences',
    ).mockResolvedValue([15, 12, 9, 6, 3].map((seq) => ({ seq })));

    const result = await readChatResource(
      context(),
      'read',
      `chat://${CHAT_ID}`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: 18, endSeq: 165 },
      earlierLocator: `chat://${CHAT_ID}:M3-17`,
      continuationLocator: undefined,
      truncated: true,
    });

    if (result.status !== 'success') throw new Error('Expected an index.');
    expect(result.content).toContain('index row 55');
    expect(result.content).not.toMatch(/index row 5(?!\d)/u);
  });

  it('omits earlier navigation when the newest page has no earlier eligible messages', async () => {
    installIndexRows(indexRows(55));
    vi.spyOn(
      ChatReadRepository.prototype,
      'previousEligibleSequences',
    ).mockResolvedValue([]);

    const result = await readChatResource(
      context(),
      'read',
      `chat://${CHAT_ID}`,
    );

    expect(result).toMatchObject({
      status: 'success',
      shownSeqRange: { startSeq: 6, endSeq: 55 },
      earlierLocator: undefined,
      truncated: true,
    });
  });

  it('uses explicit windows forward, with a 51st-row lookahead to signal continuation', async () => {
    const rows = indexRows(51);
    installIndexRows(rows, 80);

    const result = await readChatResource(
      context(),
      'read',
      `chat://${CHAT_ID}:M1-80`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: 1, endSeq: 50 },
      earlierLocator: undefined,
      continuationLocator: `chat://${CHAT_ID}:M51-80`,
      truncated: true,
    });

    if (result.status !== 'success') throw new Error('Expected an index.');
    expect(result.content).toContain('index row 1');
    expect(result.content).toContain('index row 50');
    expect(result.content).toContain('\n');
    expect(result.content).not.toContain('index row 51');
  });

  it('does not claim another page at the exact end of an explicit window', async () => {
    installIndexRows(indexRows(50), 50);

    const result = await readChatResource(
      context(),
      'read',
      `chat://${CHAT_ID}:M1-50`,
    );

    expect(result).toMatchObject({
      status: 'success',
      shownSeqRange: { startSeq: 1, endSeq: 50 },
      continuationLocator: undefined,
      truncated: false,
    });
  });

  it('renders an empty preview for messages without visible text', async () => {
    const row: ChatIndexRow = {
      seq: 1,
      role: 'user',
      parts: [
        { type: 'file', url: 'media://00000000-0000-0000-0000-000000000002' },
      ],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    installIndexRows([row]);

    const result = await readChatResource(
      context(),
      'read',
      `chat://${CHAT_ID}:M1`,
    );

    expect(result).toMatchObject({ status: 'success', kind: 'chat-index' });

    if (result.status !== 'success') throw new Error('Expected an index.');
    expect(result.content).toContain(`chat://${CHAT_ID}/1`);
    expect(result.content).not.toContain('media://');
  });

  it('shrinks a maximum-width explicit index page while preserving the requested continuation end', async () => {
    const start = Number.MAX_SAFE_INTEGER - 50;

    const rows = Array.from({ length: 51 }, (_, index): ChatIndexRow => ({
      seq: start + index,
      role: 'assistant',
      parts: [{ type: 'text', text: 'z'.repeat(200) }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }));

    installIndexRows(rows, Number.MAX_SAFE_INTEGER);

    const result = await readChatResource(
      context(),
      'read',
      `chat://${CHAT_ID}:M${start}-${Number.MAX_SAFE_INTEGER}`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: start },
      truncated: true,
    });

    if (result.status !== 'success') throw new Error('Expected an index.');
    const shown = result.shownSeqRange;

    if (!isRecord(shown) || !isNumber(shown['endSeq']))
      throw new Error('Expected a shown message range.');

    const lastSeq = shown['endSeq'];
    expect(result.continuationLocator).toBe(
      `chat://${CHAT_ID}:M${lastSeq + 1}-${Number.MAX_SAFE_INTEGER}`,
    );
  });
});
