import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import type { Chat, Message } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { MessagesRepository } from './messages-repository';

type QueryValue = ReadonlyArray<unknown>;

function queryResult<T>(rows: ReadonlyArray<T>) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    groupBy: chain,
    innerJoin: chain,
    values: chain,
    set: chain,
    onConflictDoNothing: chain,
    returning: () => terminal,
  });
}

function asQuery(value: ReturnType<typeof queryResult<unknown>>): never {
  // SAFETY: the repository tests replace Drizzle's fluent terminal with a
  // Promise carrying exactly the chain methods exercised by these methods.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

function makeDb(options: {
  select?: Array<QueryValue>;
  distinct?: Array<QueryValue>;
  insert?: Array<QueryValue>;
  update?: Array<QueryValue>;
  execute?: Array<QueryValue>;
}) {
  const db: Db = drizzle.mock({ schema });
  const select = [...(options.select ?? [])];
  const distinct = [...(options.distinct ?? [])];
  const insert = [...(options.insert ?? [])];
  const update = [...(options.update ?? [])];
  const execute = [...(options.execute ?? [])];

  vi.spyOn(db, 'select').mockImplementation(() =>
    asQuery(queryResult(select.shift() ?? [])),
  );
  vi.spyOn(db, 'selectDistinctOn').mockImplementation(() =>
    asQuery(queryResult(distinct.shift() ?? [])),
  );
  vi.spyOn(db, 'insert').mockImplementation(() =>
    asQuery(queryResult(insert.shift() ?? [])),
  );
  vi.spyOn(db, 'update').mockImplementation(() =>
    asQuery(queryResult(update.shift() ?? [])),
  );
  vi.spyOn(db, 'execute').mockImplementation(() =>
    asQuery(queryResult(execute.shift() ?? [])),
  );
  return db;
}

const chat: Chat = {
  id: 'chat-1',
  ownerUserId: 'owner-1',
  title: 'Chat',
  visibility: 'private',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
};

const message = (seq: number, role: Message['role'] = 'user'): Message => ({
  id: `message-${seq}`,
  chatId: chat.id,
  seq,
  role,
  senderUserId: role === 'user' ? chat.ownerUserId : null,
  parts: [{ type: 'text', text: `message ${seq}` }],
  attachments: [],
  usage: null,
  inReplyTo: null,
  createdAt: new Date(seq * 1000),
});

describe('MessagesRepository query windows and conversation reads', () => {
  it('maps unlimited and limited chat windows, latest rows, and public rows', async () => {
    const db = makeDb({
      select: [
        [{ messages: message(1) }, { messages: message(2) }],
        [{ messages: message(3) }],
        [{ messages: message(5) }],
      ],
      distinct: [[{ messages: message(4) }], [{ messages: message(5) }]],
    });
    const repository = new MessagesRepository(db);

    await expect(
      repository.findByChatId(chat.id, chat.ownerUserId),
    ).resolves.toEqual([message(1), message(2)]);
    await expect(
      repository.findByChatId(chat.id, chat.ownerUserId, { limit: 1 }),
    ).resolves.toEqual([message(3)]);
    await expect(
      repository.findLatestPerOwnedChat(chat.ownerUserId),
    ).resolves.toEqual([message(4)]);
    await expect(
      repository.listPublicByChatId(chat.id, { limit: 1 }),
    ).resolves.toEqual([message(5)]);
  });

  it('short-circuits empty bounded sets and maps grouped counts', async () => {
    const db = makeDb({
      select: [[{ chatId: chat.id, value: 3 }]],
      distinct: [[]],
    });
    const repository = new MessagesRepository(db);

    await expect(
      repository.findEarliestUserMessagePerChat([], 'owner-1'),
    ).resolves.toEqual([]);
    await expect(repository.countPerChat([], 'owner-1')).resolves.toEqual(
      new Map(),
    );
    await expect(
      repository.findEarliestUserMessagePerChat([chat.id], 'owner-1'),
    ).resolves.toEqual([]);
    await expect(
      repository.countPerChat([chat.id], 'owner-1'),
    ).resolves.toEqual(new Map([[chat.id, 3]]));
  });

  it('rejects invalid conversation locators and parses eligible neighbors', async () => {
    const target = message(7);
    const db = makeDb({
      execute: [
        [
          {
            message_chat_id: chat.id,
            message_seq: '7',
            message_role: 'user',
            message_parts: target.parts,
            message_usage: null,
            message_created_at: target.createdAt,
            previous_message_seq: '5',
            next_message_seq: '9',
          },
        ],
      ],
    });
    const repository = new MessagesRepository(db);

    await expect(
      repository.findConversationMessage(chat.id, '   ', 7),
    ).rejects.toThrow('requires a non-empty userId');
    await expect(
      repository.findConversationMessage(chat.id, 'owner-1', 0),
    ).resolves.toBeUndefined();
    await expect(
      repository.findConversationMessage(chat.id, 'owner-1', 7),
    ).resolves.toEqual({
      chatId: chat.id,
      seq: 7,
      role: 'user',
      parts: target.parts,
      usage: null,
      createdAt: target.createdAt,
      previousMessageSeq: 5,
      nextMessageSeq: 9,
    });
  });

  it('fails closed for malformed conversation rows and sequence values', async () => {
    const db = makeDb({
      execute: [
        [
          {
            message_chat_id: chat.id,
            message_seq: '0',
            message_role: 'user',
            message_parts: [],
            message_usage: null,
            message_created_at: '1970-01-01T00:00:00.000Z',
            previous_message_seq: null,
            next_message_seq: null,
          },
        ],
        [
          {
            message_chat_id: chat.id,
            message_seq: '7',
            message_role: 'tool',
            message_parts: [],
            message_usage: null,
            message_created_at: '1970-01-01T00:00:00.000Z',
            previous_message_seq: null,
            next_message_seq: null,
          },
        ],
      ],
    });
    const repository = new MessagesRepository(db);

    await expect(
      repository.findConversationMessage(chat.id, 'owner-1', 7),
    ).resolves.toBeUndefined();
    await expect(
      repository.findConversationMessage(chat.id, 'owner-1', 8),
    ).resolves.toBeUndefined();
  });
});

describe('MessagesRepository writes', () => {
  it('chunks createMany input and creates user and assistant rows with a sequence', async () => {
    const createdUser = message(1);
    const createdAssistant = message(2, 'assistant');
    const db = makeDb({
      insert: [[createdUser], [createdAssistant]],
    });
    const transaction = vi
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => {
        // SAFETY: this transaction double exposes exactly the select/insert
        // methods used by insertWithChatSequence.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        return callback({
          select: () => asQuery(queryResult([{ value: 0 }])),
          insert: () => asQuery(queryResult([])),
        } as never);
      });
    const repository = new MessagesRepository(db);

    await repository.createMany([
      {
        id: 'copy-1',
        chatId: chat.id,
        seq: 1,
        role: 'user',
        senderUserId: chat.ownerUserId,
        parts: [],
        attachments: [],
        inReplyTo: null,
      },
    ]);
    await expect(
      repository.createUserMessageIfAbsent({
        id: 'user-message',
        chatId: chat.id,
        senderUserId: chat.ownerUserId,
        parts: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.createAssistantReplyIfAbsent({
        chatId: chat.id,
        inReplyTo: 'user-message',
        parts: [],
      }),
    ).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('returns existing turn state and updates only a retryable assistant', async () => {
    const user = message(1);
    const assistant = { ...message(2, 'assistant'), inReplyTo: user.id };
    const updated = {
      ...assistant,
      parts: [{ type: 'text', text: 'updated' }],
    };
    const db = makeDb({
      select: [[{ messages: user }], [{ messages: assistant }]],
      update: [[updated]],
    });
    const repository = new MessagesRepository(db);

    await expect(
      repository.findTurnState(chat.id, chat.ownerUserId, user.id),
    ).resolves.toEqual({
      userMessage: user,
      assistantMessage: assistant,
    });
    await expect(
      repository.updateAssistantReply({
        id: assistant.id,
        chatId: chat.id,
        inReplyTo: user.id,
        parts: updated.parts,
      }),
    ).resolves.toEqual(updated);
  });
});
