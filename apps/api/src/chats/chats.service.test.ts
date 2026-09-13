import { BadRequestException, NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import type { Chat, Compaction, Message, Run } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { RunsRepository } from '../runs/runs-repository';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { MessageTurnContextsRepository } from './message-turn-contexts-repository';
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
      noopQueryEmbedder(),
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
    inheritedContextOriginAt: null,
    contextRevision: 0,
    initialContinuationState: {
      contextRevision: 0,
      sourceMaxSeq: 0,
      digestBaseline: null,
      digestTold: null,
    },
    initialActiveCompactionId: null,
    initialDigestRebakedFrom: null,
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
      inheritedTurnComplete: false,
      usageOriginKind: null,
      usageOriginId: null,
      usageProvenanceCol: null,
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
      noopQueryEmbedder(),
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
      usageOriginKind: null,
      usageOriginId: null,
      usageProvenanceCol: null,
      contextRevision: null,
      sourceMaxSeq: null,
      companionActiveCompactionId: null,
      companionDigestRebakedFrom: null,
      companionState: null,
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

describe('ChatsService message windows, updates and forks', () => {
  const ownerUserId = 'owner-1';
  const chat: Chat = {
    id: 'chat-1',
    ownerUserId,
    title: 'Source',
    visibility: 'private',
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    archivedAt: null,
    projectId: null,
    recencyDigestBaseline: null,
    recencyDigestTold: null,
    recencyDigestRebakedFrom: null,
    inheritedContextOriginAt: null,
    contextRevision: 0,
    initialContinuationState: {
      contextRevision: 0,
      sourceMaxSeq: 0,
      digestBaseline: null,
      digestTold: null,
    },
    initialActiveCompactionId: null,
    initialDigestRebakedFrom: null,
  };

  function message(seq: number, overrides: Partial<Message> = {}): Message {
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
      inheritedTurnComplete: false,
      usageOriginKind: null,
      usageOriginId: null,
      usageProvenanceCol: null,
      ...overrides,
    };
  }

  function makeService() {
    const db: Db = drizzle.mock({ schema });
    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });
    vi.spyOn(tenantDb, 'runAs').mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
    vi.spyOn(tenantDb, 'runAsPublic').mockImplementation(
      async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    );
    const aborts = new RunAbortRegistry();
    return {
      service: new ChatsService(
        tenantDb,
        aborts,
        noopReindexDispatch(),
        noopEmbedDispatch(),
        noopQueryEmbedder(),
      ),
      aborts,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getChatMessages', () => {
    it('reports an absent chat as not found rather than an empty window', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
        undefined,
      );
      const findByChatId = vi
        .spyOn(MessagesRepository.prototype, 'findByChatId')
        .mockResolvedValue([]);
      vi.spyOn(
        CompactionsRepository.prototype,
        'findLatestByChatId',
      ).mockResolvedValue(undefined);

      await expect(
        makeService().service.getChatMessages(chat.id, ownerUserId, {
          limit: 5,
        }),
      ).resolves.toBeUndefined();
      expect(findByChatId).not.toHaveBeenCalled();
    });

    it('translates the exclusive beforeSeq cursor into an inclusive maxSeq one below it', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      const findByChatId = vi
        .spyOn(MessagesRepository.prototype, 'findByChatId')
        .mockResolvedValue([message(7), message(8)]);
      const findLatest = vi
        .spyOn(CompactionsRepository.prototype, 'findLatestByChatId')
        .mockResolvedValue(undefined);

      await expect(
        makeService().service.getChatMessages(chat.id, ownerUserId, {
          limit: 2,
          beforeSeq: 9,
        }),
      ).resolves.toMatchObject({
        messages: [message(7), message(8)],
        compaction: undefined,
        absorbedMessageCount: null,
      });

      expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId, {
        limit: 2,
        maxSeq: 8,
      });
      expect(findLatest).toHaveBeenCalledWith(chat.id, ownerUserId);
    });

    it('leaves the window unbounded when no cursor is supplied', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      const findByChatId = vi
        .spyOn(MessagesRepository.prototype, 'findByChatId')
        .mockResolvedValue([message(1)]);
      vi.spyOn(
        CompactionsRepository.prototype,
        'findLatestByChatId',
      ).mockResolvedValue(undefined);

      await makeService().service.getChatMessages(chat.id, ownerUserId, {
        limit: 3,
      });

      expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId, {
        limit: 3,
        maxSeq: undefined,
      });
    });

    it('accepts a target window whose LAST row is the target, not merely one containing it', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
        message(10),
        message(20),
        message(30),
      ]);
      vi.spyOn(
        CompactionsRepository.prototype,
        'findLatestByChatId',
      ).mockResolvedValue(undefined);

      await expect(
        makeService().service.getChatMessages(chat.id, ownerUserId, {
          limit: 3,
          targetSeq: 30,
        }),
      ).resolves.toMatchObject({
        messages: [message(10), message(20), message(30)],
      });
    });
  });

  describe('updateChat', () => {
    function pgError(code: string): Error {
      return Object.assign(new Error('update failed'), { code });
    }

    it('reports an FK violation on the patched project as a project 404', async () => {
      vi.spyOn(ChatsRepository.prototype, 'update').mockRejectedValue(
        pgError('23503'),
      );

      const rejected = makeService().service.updateChat(chat.id, ownerUserId, {
        projectId: 'missing-project',
      });
      await expect(rejected).rejects.toBeInstanceOf(NotFoundException);
      await expect(rejected).rejects.toThrow('Project not found');
    });

    it('reports an RLS denial on the patched project as the SAME project 404', async () => {
      vi.spyOn(ChatsRepository.prototype, 'update').mockRejectedValue(
        pgError('42501'),
      );

      const rejected = makeService().service.updateChat(chat.id, ownerUserId, {
        projectId: 'someone-elses-project',
      });
      await expect(rejected).rejects.toBeInstanceOf(NotFoundException);
      await expect(rejected).rejects.toThrow('Project not found');
    });

    it('lets a domain HttpException through untouched, even when it carries a mapped SQLSTATE', async () => {
      const guard = Object.assign(new BadRequestException('Chat is archived'), {
        code: '23503',
      });
      vi.spyOn(ChatsRepository.prototype, 'update').mockRejectedValue(guard);

      await expect(
        makeService().service.updateChat(chat.id, ownerUserId, {
          title: 'renamed',
        }),
      ).rejects.toBe(guard);
    });

    it('rethrows an unrelated Postgres failure rather than mislabelling it', async () => {
      const unrelated = pgError('23505');
      vi.spyOn(ChatsRepository.prototype, 'update').mockRejectedValue(
        unrelated,
      );

      await expect(
        makeService().service.updateChat(chat.id, ownerUserId, {
          title: 'renamed',
        }),
      ).rejects.toBe(unrelated);
    });

    it('returns the updated row when the patch succeeds', async () => {
      const updated: Chat = { ...chat, title: 'renamed' };
      vi.spyOn(ChatsRepository.prototype, 'update').mockResolvedValue(updated);

      await expect(
        makeService().service.updateChat(chat.id, ownerUserId, {
          title: 'renamed',
        }),
      ).resolves.toBe(updated);
    });
  });

  describe('getSharedChat', () => {
    it('applies the same exclusive-cursor translation as the owner read', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findPublicById').mockResolvedValue(
        chat,
      );
      const listPublic = vi
        .spyOn(MessagesRepository.prototype, 'listPublicByChatId')
        .mockResolvedValue([message(4)]);

      await expect(
        makeService().service.getSharedChat(chat.id, {
          limit: 2,
          beforeSeq: 5,
        }),
      ).resolves.toEqual({ chat, messages: [message(4)] });

      expect(listPublic).toHaveBeenCalledWith(chat.id, {
        limit: 2,
        maxSeq: 4,
      });
    });

    it('reads the whole conversation when no options are given', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findPublicById').mockResolvedValue(
        chat,
      );
      const listPublic = vi
        .spyOn(MessagesRepository.prototype, 'listPublicByChatId')
        .mockResolvedValue([]);

      await makeService().service.getSharedChat(chat.id);

      expect(listPublic).toHaveBeenCalledWith(chat.id, {
        limit: undefined,
        maxSeq: undefined,
      });
    });

    it('returns not-found for a private or absent chat without reading messages', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findPublicById').mockResolvedValue(
        undefined,
      );
      const listPublic = vi.spyOn(
        MessagesRepository.prototype,
        'listPublicByChatId',
      );

      await expect(
        makeService().service.getSharedChat(chat.id),
      ).resolves.toBeUndefined();
      expect(listPublic).not.toHaveBeenCalled();
    });
  });

  describe('forkChat', () => {
    beforeEach(() => {
      vi.spyOn(
        RunsRepository.prototype,
        'findActiveByChatId',
      ).mockResolvedValue(undefined);
      vi.spyOn(
        CompactionsRepository.prototype,
        'findByCoverage',
      ).mockResolvedValue([]);
      vi.spyOn(
        MessageTurnContextsRepository.prototype,
        'findByCoverage',
      ).mockResolvedValue([]);
      vi.spyOn(
        MessageTurnContextsRepository.prototype,
        'create',
      ).mockResolvedValue(undefined);
      vi.spyOn(
        MessageTurnContextsRepository.prototype,
        'findLatestByChatId',
      ).mockResolvedValue(undefined);
      vi.spyOn(
        ChatsRepository.prototype,
        'setForkContinuationState',
      ).mockResolvedValue(undefined);
    });
    it('copies the whole chat, renumbering seq from 1 and remapping in-reply-to edges', async () => {
      const first = message(5);
      const second = message(6, {
        role: 'assistant',
        senderUserId: null,
        inReplyTo: first.id,
      });
      const created: Chat = {
        ...chat,
        id: 'chat-fork',
        title: 'Source (fork)',
      };
      const create = vi
        .spyOn(ChatsRepository.prototype, 'create')
        .mockResolvedValue(created);
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      const findByChatId = vi
        .spyOn(MessagesRepository.prototype, 'findByChatId')
        .mockResolvedValue([first, second]);
      const createMany = vi
        .spyOn(MessagesRepository.prototype, 'createMany')
        .mockResolvedValue(undefined);

      await expect(
        makeService().service.forkChat(chat.id, ownerUserId),
      ).resolves.toBe(created);

      expect(create).toHaveBeenCalledWith({
        ownerUserId,
        title: 'Source (fork)',
        inheritedContextOriginAt: chat.createdAt,
      });
      // Boundary resolution reads all messages, then copy reads the prefix.
      expect(findByChatId).toHaveBeenCalledTimes(2);
      expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId);
      expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId, {
        maxSeq: second.seq,
      });

      const copied = createMany.mock.calls[0][0];
      expect(copied.map((m) => m.seq)).toEqual([1, 2]);
      expect(copied.map((m) => m.chatId)).toEqual(['chat-fork', 'chat-fork']);
      expect(copied.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(copied.map((m) => m.id)).not.toEqual([first.id, second.id]);
      expect(copied[1].inReplyTo).toBe(copied[0].id);
      expect(copied[0].inReplyTo).toBeNull();
    });

    it('leaves an untitled source untitled instead of forking an empty title', async () => {
      const untitled: Chat = { ...chat, title: null };
      const create = vi
        .spyOn(ChatsRepository.prototype, 'create')
        .mockResolvedValue({ ...untitled, id: 'chat-fork' });
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
        untitled,
      );
      vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue(
        [],
      );
      vi.spyOn(MessagesRepository.prototype, 'createMany').mockResolvedValue(
        undefined,
      );

      await makeService().service.forkChat(chat.id, ownerUserId);

      expect(create).toHaveBeenCalledWith({ ownerUserId });
    });

    it('bounds the copied prefix to the anchor message seq', async () => {
      const anchor = message(7, {
        role: 'assistant',
        senderUserId: null,
        usage: { status: 'completed', totalTokens: 100 },
      });
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      vi.spyOn(ChatsRepository.prototype, 'create').mockResolvedValue({
        ...chat,
        id: 'chat-fork',
      });
      const findById = vi
        .spyOn(MessagesRepository.prototype, 'findById')
        .mockResolvedValue(anchor);
      const findByChatId = vi
        .spyOn(MessagesRepository.prototype, 'findByChatId')
        .mockResolvedValue([anchor]);
      vi.spyOn(MessagesRepository.prototype, 'createMany').mockResolvedValue(
        undefined,
      );

      await makeService().service.forkChat(chat.id, ownerUserId, anchor.id);

      expect(findById).toHaveBeenCalledWith(chat.id, ownerUserId, anchor.id);
      expect(findByChatId).toHaveBeenCalledWith(chat.id, ownerUserId, {
        maxSeq: 7,
      });
    });

    it('404s an unknown source chat before creating anything', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
        undefined,
      );
      const create = vi.spyOn(ChatsRepository.prototype, 'create');

      const rejected = makeService().service.forkChat(chat.id, ownerUserId);
      await expect(rejected).rejects.toBeInstanceOf(NotFoundException);
      await expect(rejected).rejects.toThrow('Chat not found');
      expect(create).not.toHaveBeenCalled();
    });

    it('404s a fork-point message that is not in this chat', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      vi.spyOn(MessagesRepository.prototype, 'findById').mockResolvedValue(
        undefined,
      );
      const create = vi.spyOn(ChatsRepository.prototype, 'create');

      const rejected = makeService().service.forkChat(
        chat.id,
        ownerUserId,
        'foreign-message',
      );
      await expect(rejected).rejects.toBeInstanceOf(NotFoundException);
      await expect(rejected).rejects.toThrow(
        'Fork-point message not found in this chat',
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('copies compaction lineage with inherited provenance and remapped parent', async () => {
      const first = message(1);
      const second = message(2, {
        role: 'assistant',
        senderUserId: null,
        usage: { status: 'completed' },
        inReplyTo: first.id,
      });
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      vi.spyOn(ChatsRepository.prototype, 'create').mockResolvedValue({
        ...chat,
        id: 'chat-fork',
      });
      vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
        first,
        second,
      ]);
      vi.spyOn(MessagesRepository.prototype, 'createMany').mockResolvedValue(
        undefined,
      );
      const parent: Compaction = {
        id: 'comp-parent',
        chatId: chat.id,
        uptoSeq: 1,
        parentId: null,
        summary: 'parent summary',
        replacementHistory: [{ role: 'user', parts: [] }],
        usage: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        usageOriginKind: null,
        usageOriginId: null,
        usageProvenanceCol: null,
        contextRevision: null,
        sourceMaxSeq: null,
        companionActiveCompactionId: null,
        companionDigestRebakedFrom: null,
        companionState: null,
      };
      const child: Compaction = {
        ...parent,
        id: 'comp-child',
        uptoSeq: 2,
        parentId: 'comp-parent',
        usage: { costUsd: 0.25, model: 'gpt-x' },
        contextRevision: 3,
        sourceMaxSeq: 2,
        companionState: {
          contextRevision: 3,
          sourceMaxSeq: 2,
          digestBaseline: null,
          digestTold: null,
        },
      };
      vi.spyOn(
        CompactionsRepository.prototype,
        'findByCoverage',
      ).mockResolvedValue([parent, child]);
      const createCompaction = vi
        .spyOn(CompactionsRepository.prototype, 'create')
        .mockResolvedValue(child);

      await makeService().service.forkChat(chat.id, ownerUserId);

      expect(createCompaction).toHaveBeenCalledTimes(2);
      const childInput = createCompaction.mock.calls[1][0];
      // Inherited usage provenance with the original compaction id.
      expect(childInput).toMatchObject({
        chatId: 'chat-fork',
        uptoSeq: 2,
        usageOriginKind: 'compaction',
        usageOriginId: 'comp-child',
        usageProvenanceCol: 'inherited',
        createdAt: child.createdAt,
      });
      // Parent lineage remapped to the copied parent's new id.
      const parentInput = createCompaction.mock.calls[0][0];
      expect(childInput.parentId).toBe(parentInput.id);
      expect(childInput.parentId).not.toBe('comp-parent');
    });

    it('omits companion state from a checkpoint authored after the boundary', async () => {
      const first = message(1);
      const second = message(2, {
        role: 'assistant',
        senderUserId: null,
        usage: { status: 'completed' },
        inReplyTo: first.id,
      });
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      vi.spyOn(ChatsRepository.prototype, 'create').mockResolvedValue({
        ...chat,
        id: 'chat-fork',
      });
      vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
        first,
        second,
      ]);
      vi.spyOn(MessagesRepository.prototype, 'createMany').mockResolvedValue(
        undefined,
      );
      // Coverage fits the prefix (uptoSeq 1 <= 2) but the state observed a
      // later message (sourceMaxSeq 18 > 2) — ineligible companion.
      const stale: Compaction = {
        id: 'comp-stale',
        chatId: chat.id,
        uptoSeq: 1,
        parentId: null,
        summary: 'stale summary',
        replacementHistory: [{ role: 'user', parts: [] }],
        usage: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        usageOriginKind: null,
        usageOriginId: null,
        usageProvenanceCol: null,
        contextRevision: 9,
        sourceMaxSeq: 18,
        companionActiveCompactionId: null,
        companionDigestRebakedFrom: null,
        companionState: {
          contextRevision: 9,
          sourceMaxSeq: 18,
          digestBaseline: null,
          digestTold: null,
        },
      };
      vi.spyOn(
        CompactionsRepository.prototype,
        'findByCoverage',
      ).mockResolvedValue([stale]);
      const createCompaction = vi
        .spyOn(CompactionsRepository.prototype, 'create')
        .mockResolvedValue(stale);

      await makeService().service.forkChat(chat.id, ownerUserId);

      expect(createCompaction).toHaveBeenCalledTimes(1);
      expect(createCompaction.mock.calls[0][0]).not.toHaveProperty('companion');
    });

    it('copies turn evidence with remapped message ids and sets fork state', async () => {
      const first = message(1);
      const second = message(2, {
        role: 'assistant',
        senderUserId: null,
        usage: { status: 'completed' },
        inReplyTo: first.id,
      });
      vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
      vi.spyOn(ChatsRepository.prototype, 'create').mockResolvedValue({
        ...chat,
        id: 'chat-fork',
      });
      vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
        first,
        second,
      ]);
      const createMany = vi
        .spyOn(MessagesRepository.prototype, 'createMany')
        .mockResolvedValue(undefined);
      const evidence = {
        chatId: chat.id,
        originRunId: 'run-1',
        messageId: first.id,
        ownerUserId,
        modelId: 'model-1',
        effort: null,
        acceptedAt: new Date('2026-08-01T00:00:00.000Z'),
        snapshotId: null,
        contextRevision: 2,
        sourceMaxSeq: 1,
        activeCompactionId: null,
        digestRebakedFrom: null,
        digestBaseline: null,
        digestTold: null,
        contextItems: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      };
      vi.spyOn(
        MessageTurnContextsRepository.prototype,
        'findByCoverage',
      ).mockResolvedValue([evidence]);
      const createEvidence = vi
        .spyOn(MessageTurnContextsRepository.prototype, 'create')
        .mockResolvedValue(undefined);
      vi.spyOn(
        MessageTurnContextsRepository.prototype,
        'findLatestByChatId',
      ).mockResolvedValue(evidence);
      const setState = vi
        .spyOn(ChatsRepository.prototype, 'setForkContinuationState')
        .mockResolvedValue(undefined);

      await makeService().service.forkChat(chat.id, ownerUserId);

      // Evidence copied with the DESTINATION message id, not the source id.
      const copiedUser = createMany.mock.calls[0][0][0];
      expect(createEvidence).toHaveBeenCalledTimes(1);
      expect(createEvidence.mock.calls[0][0]).toMatchObject({
        chatId: 'chat-fork',
        originRunId: 'run-1',
        messageId: copiedUser.id,
        contextRevision: 2,
      });
      expect(createEvidence.mock.calls[0][0].messageId).not.toBe(first.id);
      expect(setState).toHaveBeenCalledWith(
        'chat-fork',
        ownerUserId,
        expect.objectContaining({ contextRevision: 2 }),
      );
    });
  });

  describe('forkSharedChat', () => {
    it('attributes copied user turns to the caller, assistant turns to nobody, and copies no attachments', async () => {
      const userTurn = message(1, {
        attachments: [{ type: 'file', url: 'https://example.test/a.png' }],
      });
      const assistantTurn = message(2, {
        role: 'assistant',
        senderUserId: null,
        inReplyTo: userTurn.id,
      });
      vi.spyOn(ChatsRepository.prototype, 'findPublicById').mockResolvedValue(
        chat,
      );
      vi.spyOn(
        MessagesRepository.prototype,
        'listPublicByChatId',
      ).mockResolvedValue([userTurn, assistantTurn]);
      vi.spyOn(ChatsRepository.prototype, 'create').mockResolvedValue({
        ...chat,
        id: 'chat-fork',
      });
      const createMany = vi
        .spyOn(MessagesRepository.prototype, 'createMany')
        .mockResolvedValue(undefined);

      await makeService().service.forkSharedChat(chat.id, 'visitor-9');

      const copied = createMany.mock.calls[0][0];
      expect(copied.map((m) => m.senderUserId)).toEqual(['visitor-9', null]);
      expect(copied.map((m) => m.attachments)).toEqual([[], []]);
      expect(copied[1].inReplyTo).toBe(copied[0].id);
    });

    it('returns not-found for a chat that is not publicly shared', async () => {
      vi.spyOn(ChatsRepository.prototype, 'findPublicById').mockResolvedValue(
        undefined,
      );
      const create = vi.spyOn(ChatsRepository.prototype, 'create');

      await expect(
        makeService().service.forkSharedChat(chat.id, 'visitor-9'),
      ).resolves.toBeUndefined();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('deleteChat', () => {
    const activeRun: Run = {
      id: 'run-1',
      chatId: chat.id,
      messageId: null,
      userId: ownerUserId,
      modelId: 'system:openai:public-model',
      modelContextSnapshotId: null,
      effort: null,
      status: 'running_model',
      workerId: null,
      cancelRequestedAt: null,
      error: null,
      contextItems: null,
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
      startedAt: new Date('2026-08-28T00:00:00.000Z'),
      finishedAt: null,
    };

    it('cancels and aborts the in-flight run before deleting the chat', async () => {
      vi.spyOn(
        RunsRepository.prototype,
        'findActiveByChatId',
      ).mockResolvedValue(activeRun);
      const requestCancel = vi
        .spyOn(RunsRepository.prototype, 'requestCancel')
        .mockResolvedValue(activeRun);
      vi.spyOn(ChatsRepository.prototype, 'deleteById').mockResolvedValue(true);
      const { service, aborts } = makeService();
      const abort = vi.spyOn(aborts, 'abort');

      await expect(service.deleteChat(ownerUserId, chat.id)).resolves.toBe(
        true,
      );

      expect(requestCancel).toHaveBeenCalledWith(activeRun.id, ownerUserId);
      expect(abort).toHaveBeenCalledWith(activeRun.id);
    });

    it('deletes a chat with no in-flight run without touching the cancel path', async () => {
      vi.spyOn(
        RunsRepository.prototype,
        'findActiveByChatId',
      ).mockResolvedValue(undefined);
      const requestCancel = vi.spyOn(RunsRepository.prototype, 'requestCancel');
      vi.spyOn(ChatsRepository.prototype, 'deleteById').mockResolvedValue(
        false,
      );
      const { service, aborts } = makeService();
      const abort = vi.spyOn(aborts, 'abort');

      await expect(service.deleteChat(ownerUserId, chat.id)).resolves.toBe(
        false,
      );

      expect(requestCancel).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
    });
  });
});
