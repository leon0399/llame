import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { readChatResource } from './chat-read';
import {
  ChatReadRepository,
  type ChatIndexRow,
} from '../chats/chat-read-repository';
import { type ToolContext } from './types';
import { measureToolResultForModel, renderToolResultText } from './model-text';

afterEach(() => vi.restoreAllMocks());

function context(userId = 'owner') {
  const db = drizzle.mock();
  const runAsMock = vi.fn<(owner: string) => void>();

  const runAs: TenantRunner['runAs'] = <T>(
    owner: string,
    callback: (tx: Db) => Promise<T>,
  ) => {
    runAsMock(owner);

    return callback(db);
  };

  return {
    value: {
      userId,
      chatId: 'chat',
      tenantDb: { runAs },
      configuredCredentials: [],
    } satisfies ToolContext,
    runAs: runAsMock,
  };
}

describe('readChatResource', () => {
  it.each(['edit', 'write'] as const)(
    'refuses %s before parsing or datastore access',
    async (operation) => {
      const fixture = context();
      await expect(
        readChatResource(fixture.value, operation, 'not a locator'),
      ).resolves.toMatchObject({
        status: 'error',
        type: 'unsupported_operation',
      });
      expect(fixture.runAs).not.toHaveBeenCalled();
    },
  );

  it.each([
    'chat://bad',
    'chat://00000000-0000-0000-0000-000000000000/0',
    'chat://00000000-0000-0000-0000-000000000000/9007199254740992',
    'chat://00000000-0000-0000-0000-000000000000/1/extra',
    'chat://00000000-0000-0000-0000-000000000000?x=1',
  ])(
    'rejects malformed addresses before owner queries: %s',
    async (locator) => {
      const fixture = context();
      await expect(
        readChatResource(fixture.value, 'read', locator),
      ).resolves.toMatchObject({ status: 'error', type: 'invalid_path' });
      expect(fixture.runAs).not.toHaveBeenCalled();
    },
  );

  it('fails closed for an empty trusted owner without opening a tenant transaction', async () => {
    const fixture = context('  ');
    await expect(
      readChatResource(fixture.value, 'read', 'chat://'),
    ).resolves.toMatchObject({ status: 'error', type: 'not_found' });
    expect(fixture.runAs).not.toHaveBeenCalled();
  });
});

const CHAT_ID = '00000000-0000-0000-0000-000000000001';

function mockMessage(parts: Array<unknown>) {
  vi.spyOn(ChatReadRepository.prototype, 'readMessage').mockResolvedValue({
    chatId: CHAT_ID,
    seq: 1,
    role: 'user',
    senderUserId: 'user-1',
    parts,
    usage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  vi.spyOn(ChatReadRepository.prototype, 'currentRunStatus').mockResolvedValue(
    'idle',
  );
}

function mockIndexRepository(rows: Array<ChatIndexRow>, latest: number) {
  vi.spyOn(
    ChatReadRepository.prototype,
    'maxCommittedSequence',
  ).mockResolvedValue(latest);
  vi.spyOn(
    ChatReadRepository.prototype,
    'listEligibleIndex',
  ).mockImplementation((_chatId, _owner, window) => {
    const beforeSeq = window.beforeSeq;

    const matches = rows
      .filter(
        ({ seq }) =>
          seq >= (window.start ?? 0) &&
          seq <= (window.end ?? Number.MAX_SAFE_INTEGER) &&
          (beforeSeq === undefined || seq < beforeSeq),
      )
      .sort((left, right) => left.seq - right.seq);

    return Promise.resolve(
      beforeSeq === undefined
        ? matches.slice(0, window.limit)
        : matches.slice(-window.limit),
    );
  });
  vi.spyOn(
    ChatReadRepository.prototype,
    'previousEligibleSequences',
  ).mockImplementation((_chatId, _owner, beforeSeq, limit) =>
    Promise.resolve(
      rows
        .filter(({ seq }) => seq < beforeSeq)
        .sort((left, right) => left.seq - right.seq)
        .slice(-limit)
        .map(({ seq }) => ({ seq })),
    ),
  );
  vi.spyOn(ChatReadRepository.prototype, 'currentRunStatus').mockResolvedValue(
    'idle',
  );
  vi.spyOn(ChatReadRepository.prototype, 'ownsChat').mockResolvedValue(true);
}

describe('Chat message windows', () => {
  it('reports full source line count and native requested ranges for exact multi-range raw reads', async () => {
    mockMessage([{ type: 'text', text: 'one\ntwo\nthree\nfour' }]);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}/1:L1-1,3-3:raw`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      representation: 'raw',
      lineCount: 4,
      requestedRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 3 },
      ],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 3 },
      ],
      content: 'one\nthree\n',
    });
  });

  it('keeps an empty attachment-only message framed with a null source range', async () => {
    mockMessage([
      {
        type: 'file',
        url: 'media://00000000-0000-0000-0000-000000000002',
        mediaType: 'image/png',
        filename: 'photo.png',
      },
    ]);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}/1`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      lineCount: 0,
      shownRange: null,
      content:
        '[image media://00000000-0000-0000-0000-000000000002 photo.png]\n',
    });
    expect(renderToolResultText('read', result)).toContain(
      `chat://${CHAT_ID}/1: empty`,
    );
  });

  it('matches native empty-source line-one selection semantics', async () => {
    mockMessage([{ type: 'text', text: '' }]);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}/1:L1`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      lineCount: 0,
      requestedRange: { startLine: 1, endLine: 1 },
      shownRange: null,
      content: '',
    });
  });
  it('fits the neutralized read rendering rather than escaped JSON content', async () => {
    mockMessage([{ type: 'text', text: '"'.repeat(9000) }]);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}/1`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      lineCount: 1,
    });
    expect(measureToolResultForModel('read')(result)).toBeLessThanOrEqual(
      16_000,
    );
    expect(result).toHaveProperty('content', `1: ${'"'.repeat(9000)}`);
  });
  it('keeps the full native fit when its truncated prefix is over budget', async () => {
    const text = `${'a'.repeat(15_630)}\nx`;
    mockMessage([{ type: 'text', text }]);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}/1`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      lineCount: 2,
      truncated: false,
      content: `1: ${'a'.repeat(15_630)}\n2: x`,
    });
    expect(measureToolResultForModel('read')(result)).toBeLessThanOrEqual(
      16_000,
    );
  });
});

describe('Chat indexes and collection', () => {
  it('shows the earliest page of the selected tail interval and continues forward', async () => {
    const rows = Array.from({ length: 160 }, (_, index) => ({
      seq: index + 1,
      role: 'user' as const,
      parts: [
        { type: 'text', text: `tail-${String(index + 1).padStart(3, '0')}` },
      ],
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    }));

    mockIndexRepository(rows, 160);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}:-M120`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: 41, endSeq: 90 },
      continuationLocator: `chat://${CHAT_ID}:M91-160`,
      earlierLocator: undefined,
      truncated: true,
    });

    if (result.status !== 'success')
      throw new Error('Expected a successful Chat index.');
    expect(result.content).toContain('tail-041');
    expect(result.content).toContain('tail-090');
    expect(result.content).not.toContain('tail-091');
  });

  it('keeps the newest eligible suffix and reports sparse earlier progress without a duplicate header', async () => {
    const allRows = Array.from({ length: 55 }, (_, index) => ({
      chatId: CHAT_ID,
      seq: (index + 1) * 3,
      role: 'user' as const,
      parts: [
        { type: 'text', text: `row-${String(index + 1).padStart(3, '0')}` },
      ],
      usage: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    }));

    vi.spyOn(
      ChatReadRepository.prototype,
      'maxCommittedSequence',
    ).mockResolvedValue(165);
    vi.spyOn(
      ChatReadRepository.prototype,
      'listEligibleIndex',
    ).mockImplementation((_chatId, _owner, window) => {
      const beforeSeq = window.beforeSeq;

      const rows = allRows.filter(
        (row) =>
          row.seq >= (window.start ?? 0) &&
          row.seq <= (window.end ?? Number.MAX_SAFE_INTEGER) &&
          (beforeSeq === undefined || row.seq < beforeSeq),
      );

      return Promise.resolve(
        beforeSeq === undefined
          ? rows.slice(0, window.limit)
          : rows.slice(-window.limit),
      );
    });
    vi.spyOn(
      ChatReadRepository.prototype,
      'previousEligibleSequences',
    ).mockImplementation((_chatId, _owner, beforeSeq, limit) =>
      Promise.resolve(
        allRows
          .filter((row) => row.seq < beforeSeq)
          .slice(-limit)
          .toReversed()
          .map(({ seq }) => ({ seq })),
      ),
    );
    vi.spyOn(
      ChatReadRepository.prototype,
      'currentRunStatus',
    ).mockResolvedValue('idle');
    vi.spyOn(ChatReadRepository.prototype, 'ownsChat').mockResolvedValue(true);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: 18, endSeq: 165 },
      earlierLocator: `chat://${CHAT_ID}:M3-17`,
      truncated: true,
    });

    if (result.status !== 'success')
      throw new Error('Expected a successful Chat index.');
    expect(result.content).toContain('row-006');
    expect(result.content).toContain('row-055');
    expect(result.content).not.toContain('row-005');
    expect(renderToolResultText('read', result)).not.toMatch(/^M\d+-\d+/mu);
  });

  it('returns an explicit forward locator after the earliest eligible index page', async () => {
    const allRows = Array.from({ length: 100 }, (_, index) => ({
      chatId: CHAT_ID,
      seq: (index + 1) * 2,
      role: 'user' as const,
      parts: [{ type: 'text', text: `message-${index + 1}` }],
      usage: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    }));

    vi.spyOn(
      ChatReadRepository.prototype,
      'maxCommittedSequence',
    ).mockResolvedValue(200);
    vi.spyOn(
      ChatReadRepository.prototype,
      'listEligibleIndex',
    ).mockImplementation((_chatId, _owner, window) => {
      const rows = allRows.filter(
        (row) =>
          row.seq >= (window.start ?? 0) &&
          row.seq <= (window.end ?? Number.MAX_SAFE_INTEGER),
      );

      return Promise.resolve(rows.slice(0, window.limit));
    });
    vi.spyOn(
      ChatReadRepository.prototype,
      'currentRunStatus',
    ).mockResolvedValue('idle');
    vi.spyOn(ChatReadRepository.prototype, 'ownsChat').mockResolvedValue(true);

    const result = await readChatResource(
      context().value,
      'read',
      `chat://${CHAT_ID}:M1-200`,
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: 2, endSeq: 100 },
      continuationLocator: `chat://${CHAT_ID}:M101-200`,
    });
  });
  it.each([`chat://${CHAT_ID}:5-10`, `chat://${CHAT_ID}:L5-10`])(
    'directs misplaced listing selectors to the M message unit: %s',
    async (locator) => {
      const result = await readChatResource(context().value, 'read', locator);

      expect(result).toMatchObject({
        status: 'error',
        type: 'invalid_selector',
      });
      expect(result.message).toMatch(/start with M/u);
    },
  );

  it('rejects a count whose endpoint exceeds the safe sequence range', async () => {
    await expect(
      readChatResource(
        context().value,
        'read',
        `chat://${CHAT_ID}:M9007199254740991+2`,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
  });

  it('rejects unsupported collection selectors before querying owned chat counts', async () => {
    const count = vi.spyOn(ChatReadRepository.prototype, 'countOwnedChats');
    await expect(
      readChatResource(context().value, 'read', 'chat://:raw'),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('renders collection status inside the measured template row and uses native line ranges', async () => {
    vi.spyOn(ChatReadRepository.prototype, 'readChatRows').mockResolvedValue({
      rows: [
        {
          chatId: CHAT_ID,
          locator: `chat://${CHAT_ID}`,
          title: 'A chat',
          activityAt: '2026-01-01T00:00:00.000Z',
          messageCount: 2,
          workspace: 'machine://host/root',
          openingExcerpt: 'Opening',
          latestExcerpt: 'Latest',
          runStatus: 'running_model',
        },
      ],
      total: 1,
    });
    const result = await readChatResource(context().value, 'read', 'chat://');
    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      shownRange: { startLine: 1, endLine: 1 },
    });
    expect(result).toHaveProperty(
      'content',
      expect.stringContaining('Run status: running_model'),
    );
  });
});
