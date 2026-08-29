import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import type { Chat, Compaction, Message } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { ChatsService } from './chats.service';

describe('ChatsService.searchChats', () => {
  it('maps internal ranked candidates to the public web result shape', async () => {
    const db: Db = drizzle.mock({ schema });
    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });
    vi.spyOn(tenantDb, 'runAs').mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
    const internalRows = [
      {
        id: 'chat-1',
        title: 'A chat',
        snippet: 'A matching excerpt',
        updatedAt: new Date('2026-08-27T00:00:00Z'),
        bestDocumentId: 'document-1',
      },
    ];
    vi.spyOn(ChatsRepository.prototype, 'searchByOwner').mockResolvedValue(
      internalRows,
    );
    const service = new ChatsService(
      tenantDb,
      new RunAbortRegistry(),
      noopReindexDispatch(),
      noopEmbedDispatch(),
    );

    await expect(service.searchChats('user-1', 'matching', 5)).resolves.toEqual(
      [
        {
          id: 'chat-1',
          title: 'A chat',
          snippet: 'A matching excerpt',
          updatedAt: new Date('2026-08-27T00:00:00Z'),
        },
      ],
    );
  });
});

describe('ChatsService.getChatMessages targetSeq', () => {
  const ownerUserId = 'owner-1';
  const chat: Chat = {
    id: 'chat-1',
    ownerUserId,
    title: 'Target chat',
    visibility: 'private',
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    archivedAt: null,
    projectId: null,
    recencyDigestBaseline: null,
    recencyDigestTold: null,
    recencyDigestRebakedFrom: null,
  };

  function message(seq: number): Message {
    return {
      id: `message-${seq}`,
      chatId: chat.id,
      seq,
      role: 'user',
      senderUserId: ownerUserId,
      parts: [{ type: 'text', text: `message ${seq}` }],
      attachments: [],
      usage: null,
      inReplyTo: null,
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
    };
  }

  function makeService(db: Db): ChatsService {
    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });
    vi.spyOn(tenantDb, 'runAs').mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
    return new ChatsService(
      tenantDb,
      new RunAbortRegistry(),
      noopReindexDispatch(),
      noopEmbedDispatch(),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses one target-bounded history query and returns a chronological window ending at the target', async () => {
    const db: Db = drizzle.mock({ schema });
    const findById = vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValue(chat);
    const findByChatId = vi
      .spyOn(MessagesRepository.prototype, 'findByChatId')
      .mockResolvedValue([message(20), message(30)]);
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(undefined);

    await expect(
      makeService(db).getChatMessages(chat.id, ownerUserId, {
        limit: 2,
        targetSeq: 30,
      }),
    ).resolves.toMatchObject({
      messages: [message(20), message(30)],
      compaction: undefined,
      absorbedMessageCount: null,
    });

    expect(findById).toHaveBeenCalledWith(chat.id, ownerUserId);
    expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId, {
      limit: 2,
      maxSeq: 30,
    });
  });

  it('returns the closed missing-chat result when the bounded window does not end at the target', async () => {
    const db: Db = drizzle.mock({ schema });
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
    const findByChatId = vi
      .spyOn(MessagesRepository.prototype, 'findByChatId')
      .mockResolvedValue([message(20)]);
    const findLatestCompaction = vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    );

    await expect(
      makeService(db).getChatMessages(chat.id, ownerUserId, {
        limit: 2,
        targetSeq: 30,
      }),
    ).resolves.toBeUndefined();

    expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId, {
      limit: 2,
      maxSeq: 30,
    });
    expect(findLatestCompaction).not.toHaveBeenCalled();
  });

  it('bounds target compaction selection and derives the delta from that selected chain', async () => {
    const db: Db = drizzle.mock({ schema });
    const first: Compaction = {
      id: 'compaction-1',
      chatId: chat.id,
      uptoSeq: 20,
      parentId: null,
      summary: 'first summary',
      replacementHistory: [
        { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      ],
      usage: null,
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
    };
    const second: Compaction = {
      ...first,
      id: 'compaction-2',
      uptoSeq: 25,
      parentId: first.id,
      summary: 'second summary',
    };
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(20),
      message(30),
    ]);
    const findLatestCompaction = vi
      .spyOn(CompactionsRepository.prototype, 'findLatestByChatId')
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(first);

    await expect(
      makeService(db).getChatMessages(chat.id, ownerUserId, {
        limit: 2,
        targetSeq: 30,
      }),
    ).resolves.toMatchObject({
      compaction: second,
      absorbedMessageCount: 5,
    });

    expect(findLatestCompaction).toHaveBeenNthCalledWith(
      1,
      chat.id,
      ownerUserId,
      { maxSeq: 30 },
    );
    expect(findLatestCompaction).toHaveBeenNthCalledWith(
      2,
      chat.id,
      ownerUserId,
      { beforeSeq: 25 },
    );
  });
});
