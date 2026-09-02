import { Test, type TestingModule } from '@nestjs/testing';

import { chats, messages, searchChatDocuments } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  CHUNKER_VERSION,
  chunkConversation,
  type ConversationChunk,
} from './chat/conversation-chunker';
import { SearchIndexService } from './search-index.service';

type FakeTable = typeof chats | typeof messages | typeof searchChatDocuments;

type FakeChat = { id: string };

type FakeMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<unknown>;
  createdAt: Date;
  usage?: unknown;
};

type ExistingChunk = {
  ordinal: number;
  version: number;
  ownerUserId: string;
  hash: string;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageTextOffset: number | null;
  lastMessageTextOffsetExclusive: number | null;
};

type FakeInsertRow = {
  ownerUserId: string;
  chatId: string;
  chunkOrdinal: number;
  chunkerVersion: number;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageAt: Date;
  lastMessageAt: Date;
  firstMessageTextOffset: number;
  lastMessageTextOffsetExclusive: number;
  content: string;
  normalizedContent: string;
  contentHash: string;
};

type FakeSelectQuery = {
  from: (table: FakeTable) => FakeSelectQuery;
  innerJoin: () => FakeSelectQuery;
  where: () => FakeSelectQuery | Promise<ReadonlyArray<ExistingChunk>>;
  orderBy: () => Promise<ReadonlyArray<{ messages: FakeMessage }>>;
  limit: () => Promise<ReadonlyArray<FakeChat>>;
};

type FakeTransaction = {
  select: () => FakeSelectQuery;
  insert: () => {
    values: (rows: ReadonlyArray<FakeInsertRow>) => {
      onConflictDoUpdate: () => Promise<void>;
    };
  };
  delete: () => { where: () => Promise<void> };
  execute: () => Promise<{ count: number }>;
};

const CHAT_ID = 'chat-1';
const OWNER_ID = 'owner-1';

function message(
  id: string,
  text: string,
  role: 'user' | 'assistant' = 'user',
): FakeMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
    createdAt: new Date(`2026-01-01T00:00:0${id.slice(-1)}.000Z`),
  };
}

function baselineChunk(): ConversationChunk {
  return chunkConversation([message('m-1', 'hello world')])[0];
}

function existingChunk(overrides: Partial<ExistingChunk> = {}): ExistingChunk {
  const chunk = baselineChunk();
  return {
    ordinal: chunk.chunkOrdinal,
    version: CHUNKER_VERSION,
    ownerUserId: OWNER_ID,
    hash: chunk.contentHash,
    firstMessageId: chunk.firstMessageId,
    lastMessageId: chunk.lastMessageId,
    firstMessageTextOffset: chunk.firstMessageTextOffset,
    lastMessageTextOffsetExclusive: chunk.lastMessageTextOffsetExclusive,
    ...overrides,
  };
}

function transactionHarness(
  options: {
    chat?: FakeChat;
    messages?: ReadonlyArray<FakeMessage>;
    existing?: ReadonlyArray<ExistingChunk>;
  } = {},
) {
  const chatRows = options.chat ? [options.chat] : [];
  const messageRows = (options.messages ?? []).map((row) => ({
    messages: row,
  }));
  const existingRows = options.existing ?? [];
  const insertValues = vi.fn();
  const execute = vi.fn(() => Promise.resolve({ count: 0 }));
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn((rows: ReadonlyArray<FakeInsertRow>) => {
    insertValues(rows);
    return { onConflictDoUpdate };
  });
  const whereDelete = vi.fn().mockResolvedValue(undefined);
  const deleteQuery = { where: whereDelete };
  const insertQuery = { values };
  let selectedTable: FakeTable | undefined;
  const whereResult = {
    orderBy: vi.fn(() => Promise.resolve(messageRows)),
    limit: vi.fn(() => Promise.resolve(chatRows)),
  };
  const selectQuery: FakeSelectQuery = {
    from: vi.fn((table: FakeTable) => {
      selectedTable = table;
      return selectQuery;
    }),
    innerJoin: vi.fn(() => selectQuery),
    where: vi.fn(() =>
      selectedTable === searchChatDocuments
        ? Promise.resolve(existingRows)
        : selectQuery,
    ),
    orderBy: whereResult.orderBy,
    limit: whereResult.limit,
  };
  const tx: FakeTransaction = {
    select: vi.fn(() => selectQuery),
    insert: vi.fn(() => insertQuery),
    delete: vi.fn(() => deleteQuery),
    execute,
  };
  const runAs = vi.fn(
    (
      _ownerUserId: string,
      callback: (transaction: FakeTransaction) => Promise<void>,
    ) => callback(tx),
  );
  const tenantDb = { runAs };
  return {
    execute,
    insertValues,
    onConflictDoUpdate,
    runAs,
    tenantDb,
    tx,
    whereDelete,
  };
}

async function buildService(harness: ReturnType<typeof transactionHarness>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SearchIndexService,
      { provide: TenantDbService, useValue: harness.tenantDb },
    ],
  }).compile();
  return { moduleRef, service: moduleRef.get(SearchIndexService) };
}

describe('SearchIndexService.reindexChat', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('does nothing beyond the owner-scoped read when the chat is absent', async () => {
    const harness = transactionHarness();
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await built.service.reindexChat(CHAT_ID, OWNER_ID);

    expect(harness.runAs).toHaveBeenCalledWith(OWNER_ID, expect.any(Function), {
      isolationLevel: 'repeatable read',
    });
    expect(harness.insertValues).not.toHaveBeenCalled();
    expect(harness.whereDelete).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('inserts changed chunks, prunes obsolete rows, and updates the watermark', async () => {
    const harness = transactionHarness({
      chat: { id: CHAT_ID },
      messages: [message('m-1', 'hello world')],
    });
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await built.service.reindexChat(CHAT_ID, OWNER_ID);

    expect(harness.insertValues).toHaveBeenCalledTimes(1);
    expect(harness.insertValues.mock.calls[0]?.[0]).toHaveLength(1);
    expect(harness.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(harness.whereDelete).toHaveBeenCalledTimes(1);
    expect(harness.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['owner', { ownerUserId: 'owner-2' }],
    ['hash', { hash: 'different-hash' }],
    ['first message', { firstMessageId: 'm-2' }],
    ['last message', { lastMessageId: 'm-2' }],
    ['first offset', { firstMessageTextOffset: 1 }],
    ['last offset', { lastMessageTextOffsetExclusive: 99 }],
  ])('rewrites a chunk when its %s locator differs', async (_field, change) => {
    const harness = transactionHarness({
      chat: { id: CHAT_ID },
      messages: [message('m-1', 'hello world')],
      existing: [existingChunk(change)],
    });
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await built.service.reindexChat(CHAT_ID, OWNER_ID);

    expect(harness.insertValues).toHaveBeenCalledTimes(1);
  });

  it('leaves a current-version chunk untouched when every field matches', async () => {
    const harness = transactionHarness({
      chat: { id: CHAT_ID },
      messages: [message('m-1', 'hello world')],
      existing: [existingChunk()],
    });
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await built.service.reindexChat(CHAT_ID, OWNER_ID);

    expect(harness.insertValues).not.toHaveBeenCalled();
    expect(harness.whereDelete).toHaveBeenCalledTimes(1);
    expect(harness.execute).toHaveBeenCalledTimes(1);
  });

  it('rewrites a stale-version row instead of treating it as the current chunk', async () => {
    const harness = transactionHarness({
      chat: { id: CHAT_ID },
      messages: [message('m-1', 'hello world')],
      existing: [existingChunk({ version: CHUNKER_VERSION - 1 })],
    });
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await built.service.reindexChat(CHAT_ID, OWNER_ID);

    expect(harness.insertValues).toHaveBeenCalledTimes(1);
  });

  it('retries a serialization failure in a fresh repeatable-read transaction', async () => {
    const harness = transactionHarness({
      chat: { id: CHAT_ID },
      messages: [message('m-1', 'hello world')],
    });
    harness.runAs
      .mockRejectedValueOnce({ code: '40001' })
      .mockImplementation(
        (
          _ownerUserId: string,
          callback: (transaction: FakeTransaction) => Promise<void>,
        ) => callback(harness.tx),
      );
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await built.service.reindexChat(CHAT_ID, OWNER_ID);

    expect(harness.runAs).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-serialization failure', async () => {
    const harness = transactionHarness();
    const failure = new Error('database unavailable');
    harness.runAs.mockRejectedValue(failure);
    const built = await buildService(harness);
    moduleRef = built.moduleRef;

    await expect(built.service.reindexChat(CHAT_ID, OWNER_ID)).rejects.toBe(
      failure,
    );
    expect(harness.runAs).toHaveBeenCalledTimes(1);
  });
});
