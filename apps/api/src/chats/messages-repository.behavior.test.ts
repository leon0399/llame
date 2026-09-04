import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import type { Chat, Message } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { type UnknownRecord } from '../unknown-record';
import { MessagesRepository } from './messages-repository';

type QueryValue = ReadonlyArray<unknown>;
type MessageInsert = typeof schema.messages.$inferInsert;

function queryResult<T>(
  rows: ReadonlyArray<T>,
  onValues?: (value: MessageInsert | Array<MessageInsert>) => void,
) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;
  const values = (value: MessageInsert | Array<MessageInsert>) => {
    onValues?.(value);
    return terminal;
  };
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    groupBy: chain,
    innerJoin: chain,
    values,
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
    const db = makeDb({});
    const batches: Array<unknown> = [];
    vi.spyOn(db, 'insert').mockImplementation(() =>
      asQuery(queryResult([], (rows) => batches.push(rows))),
    );
    const insertedRows: Array<unknown> = [];
    const createdRows = [createdUser, createdAssistant];
    let insertCall = 0;
    const transaction = vi
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => {
        // SAFETY: this transaction double exposes exactly the select/insert
        // methods used by insertWithChatSequence.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        return callback({
          select: () => asQuery(queryResult([{ value: insertCall }])),
          insert: () => {
            const created = createdRows[insertCall++];
            if (created === undefined) throw new Error('unexpected insert');
            return asQuery(
              queryResult([created], (row) => insertedRows.push(row)),
            );
          },
        } as never);
      });
    const repository = new MessagesRepository(db);

    await repository.createMany(
      Array.from({ length: 501 }, (_, index) => ({
        id: `copy-${index + 1}`,
        chatId: chat.id,
        seq: index + 1,
        role: 'user',
        senderUserId: chat.ownerUserId,
        parts: [],
        attachments: [],
        inReplyTo: null,
      })),
    );
    expect(batches).toHaveLength(2);
    expect(
      batches.map((batch) => (Array.isArray(batch) ? batch.length : 0)),
    ).toEqual([500, 1]);
    await expect(
      repository.createUserMessageIfAbsent({
        id: 'user-message',
        chatId: chat.id,
        senderUserId: chat.ownerUserId,
        parts: [],
      }),
    ).resolves.toBe(createdUser);
    await expect(
      repository.createAssistantReplyIfAbsent({
        chatId: chat.id,
        inReplyTo: 'user-message',
        parts: [],
      }),
    ).resolves.toBe(createdAssistant);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(insertedRows).toEqual([
      expect.objectContaining({ role: 'user', seq: 1 }),
      expect.objectContaining({ role: 'assistant', seq: 2 }),
    ]);
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

type ChainCall = { method: string; argument: unknown };

/** The driver error a scripted insert attempt rejects with. */
type AttemptFailure = Error;

/** `queryResult`, plus a record of every fluent call and its first argument. */
function recordingQuery<T>(
  rows: ReadonlyArray<T>,
  calls: Array<ChainCall>,
  rejectWith?: AttemptFailure,
) {
  const terminal =
    rejectWith === undefined
      ? Promise.resolve(rows)
      : Promise.reject(rejectWith);
  const chain =
    (method: string) =>
    (...args: Array<unknown>) => {
      calls.push({ method, argument: args[0] });
      return terminal;
    };
  return Object.assign(terminal, {
    from: chain('from'),
    where: chain('where'),
    orderBy: chain('orderBy'),
    limit: chain('limit'),
    groupBy: chain('groupBy'),
    innerJoin: chain('innerJoin'),
    values: chain('values'),
    set: chain('set'),
    onConflictDoNothing: chain('onConflictDoNothing'),
    returning: chain('returning'),
  });
}

/**
 * A db whose `transaction` replays one scripted attempt of
 * `insertWithChatSequence`: the chat's current max seq, and either the row the
 * insert returns or the failure it raises.
 */
function sequencingDb(
  attempts: ReadonlyArray<{
    maxRows?: Array<{ value: number | null }>;
    created?: Message;
    fails?: AttemptFailure;
  }>,
) {
  const db: Db = drizzle.mock({ schema });
  const calls: Array<ChainCall> = [];
  let attempt = 0;
  const transaction = vi
    .spyOn(db, 'transaction')
    .mockImplementation(async (callback) => {
      const step = attempts[Math.min(attempt, attempts.length - 1)];
      attempt += 1;
      // SAFETY: insertWithChatSequence uses only select/insert on its tx.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      return callback({
        select: () =>
          asQuery(recordingQuery(step.maxRows ?? [{ value: 0 }], calls)),
        insert: () =>
          asQuery(
            recordingQuery(
              step.created === undefined ? [] : [step.created],
              calls,
              step.fails,
            ),
          ),
      } as never);
    });
  const insertedRow = () =>
    calls.find((call) => call.method === 'values')?.argument;
  return { db, calls, transaction, insertedRow };
}

const sequenceViolation = (fields: UnknownRecord) =>
  Object.assign(new Error('duplicate key value'), fields);

describe('MessagesRepository chat sequence assignment', () => {
  it('takes the next sequence after the chat max and returns the inserted row', async () => {
    const created = message(5);
    const { db, insertedRow } = sequencingDb([
      { maxRows: [{ value: 4 }], created },
    ]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: chat.ownerUserId,
        parts: [],
      }),
    ).resolves.toBe(created);
    expect(insertedRow()).toMatchObject({ seq: 5 });
  });

  it('starts an empty chat at sequence 1 whether the max query returns no row or a null max', async () => {
    const noRow = sequencingDb([{ maxRows: [], created: message(1) }]);
    await new MessagesRepository(noRow.db).create({
      chatId: chat.id,
      role: 'user',
      parts: [],
    });
    expect(noRow.insertedRow()).toMatchObject({ seq: 1 });

    const nullMax = sequencingDb([
      { maxRows: [{ value: null }], created: message(1) },
    ]);
    await new MessagesRepository(nullMax.db).create({
      chatId: chat.id,
      role: 'user',
      parts: [],
    });
    expect(nullMax.insertedRow()).toMatchObject({ seq: 1 });
  });

  it('refuses to write past the safe integer sequence range instead of inserting a lossy seq', async () => {
    const { db, calls } = sequencingDb([
      { maxRows: [{ value: Number.MAX_SAFE_INTEGER }], created: message(1) },
    ]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toThrow(`Chat ${chat.id} exhausted safe message sequence values`);
    expect(calls.some((call) => call.method === 'values')).toBe(false);
  });

  it('refuses a non-positive sequence', async () => {
    const { db, calls } = sequencingDb([
      { maxRows: [{ value: -1 }], created: message(1) },
    ]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toThrow('exhausted safe message sequence values');
    expect(calls.some((call) => call.method === 'values')).toBe(false);
  });

  it('fails loudly when the insert returns no row', async () => {
    const { db } = sequencingDb([{ maxRows: [{ value: 0 }] }]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toThrow('Message insert returned no row');
  });

  it('retries the whole transaction when the chat-sequence index conflicts', async () => {
    const created = message(6);
    const { db, transaction } = sequencingDb([
      {
        maxRows: [{ value: 4 }],
        fails: sequenceViolation({
          code: '23505',
          constraint_name: 'messages_chat_seq_unique_idx',
        }),
      },
      { maxRows: [{ value: 5 }], created },
    ]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).resolves.toBe(created);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('recognises the conflict from the error message alone', async () => {
    const created = message(2);
    const { db, transaction } = sequencingDb([
      {
        fails: Object.assign(
          new Error(
            'duplicate key value violates unique constraint "messages_chat_seq_unique_idx"',
          ),
          { code: '23505' },
        ),
      },
      { maxRows: [{ value: 1 }], created },
    ]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).resolves.toBe(created);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('recognises the conflict when the driver error is nested under cause', async () => {
    const created = message(2);
    const { db, transaction } = sequencingDb([
      {
        fails: Object.assign(new Error('insert failed'), {
          cause: {
            code: '23505',
            constraint_name: 'messages_chat_seq_unique_idx',
          },
        }),
      },
      { maxRows: [{ value: 1 }], created },
    ]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).resolves.toBe(created);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('rethrows a unique violation on a DIFFERENT index without retrying', async () => {
    const other = sequenceViolation({
      code: '23505',
      constraint_name: 'messages_pkey',
      message: 'duplicate key value violates unique constraint "messages_pkey"',
    });
    const { db, transaction } = sequencingDb([{ fails: other }]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toBe(other);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rethrows a sequence-index name carried by a NON-conflict SQLSTATE', async () => {
    const other = sequenceViolation({
      code: '40001',
      constraint_name: 'messages_chat_seq_unique_idx',
    });
    const { db, transaction } = sequencingDb([{ fails: other }]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toBe(other);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rethrows failures that carry no cause chain to walk', async () => {
    const nullCause = Object.assign(new Error('connection reset'), {
      cause: null,
    });
    const { db, transaction } = sequencingDb([{ fails: nullCause }]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toBe(nullCause);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('gives up after the fixed attempt budget and surfaces the last conflict', async () => {
    const conflict = sequenceViolation({
      code: '23505',
      constraint_name: 'messages_chat_seq_unique_idx',
    });
    const { db, transaction } = sequencingDb([{ fails: conflict }]);

    await expect(
      new MessagesRepository(db).create({
        chatId: chat.id,
        role: 'user',
        parts: [],
      }),
    ).rejects.toBe(conflict);
    expect(transaction).toHaveBeenCalledTimes(8);
  });
});

describe('MessagesRepository insert payloads', () => {
  it('persists explicit sender, attachments and reply linkage, and omits an unset id', async () => {
    const { db, insertedRow } = sequencingDb([
      { maxRows: [{ value: 0 }], created: message(1) },
    ]);

    await new MessagesRepository(db).create({
      chatId: chat.id,
      role: 'assistant',
      senderUserId: 'sender-9',
      parts: [{ type: 'text', text: 'hi' }],
      attachments: [{ kind: 'file' }],
      inReplyTo: 'message-1',
    });

    expect(insertedRow()).toMatchObject({
      senderUserId: 'sender-9',
      attachments: [{ kind: 'file' }],
      inReplyTo: 'message-1',
    });
    expect(insertedRow()).not.toHaveProperty('id');
  });

  it('defaults sender, attachments and reply linkage, and forwards a caller-assigned id', async () => {
    const { db, insertedRow } = sequencingDb([
      { maxRows: [{ value: 0 }], created: message(1) },
    ]);

    await new MessagesRepository(db).create({
      id: 'caller-assigned',
      chatId: chat.id,
      role: 'user',
      parts: [],
    });

    expect(insertedRow()).toMatchObject({
      id: 'caller-assigned',
      senderUserId: null,
      attachments: [],
      inReplyTo: null,
    });
  });

  it('keys the idempotent user insert on the message id and carries its attachments', async () => {
    const { db, calls, insertedRow } = sequencingDb([
      { maxRows: [{ value: 0 }], created: message(1) },
    ]);

    await new MessagesRepository(db).createUserMessageIfAbsent({
      id: 'user-message',
      chatId: chat.id,
      senderUserId: chat.ownerUserId,
      parts: [],
      attachments: [{ kind: 'file' }],
    });

    expect(insertedRow()).toMatchObject({
      role: 'user',
      attachments: [{ kind: 'file' }],
    });
    expect(
      calls.find((call) => call.method === 'onConflictDoNothing')?.argument,
    ).toEqual({ target: schema.messages.id });
  });

  it('keys the idempotent assistant insert on in-reply-to and carries no attachments', async () => {
    const { db, calls, insertedRow } = sequencingDb([
      { maxRows: [{ value: 0 }], created: message(2, 'assistant') },
    ]);

    await new MessagesRepository(db).createAssistantReplyIfAbsent({
      chatId: chat.id,
      inReplyTo: 'user-message',
      parts: [],
    });

    expect(insertedRow()).toMatchObject({
      role: 'assistant',
      senderUserId: null,
      attachments: [],
      inReplyTo: 'user-message',
    });
    expect(
      calls.find((call) => call.method === 'onConflictDoNothing')?.argument,
    ).toEqual({ target: schema.messages.inReplyTo });
  });

  it('writes only parts and usage when updating an assistant reply', async () => {
    const db: Db = drizzle.mock({ schema });
    const calls: Array<ChainCall> = [];
    const updated = message(2, 'assistant');
    vi.spyOn(db, 'update').mockImplementation(() =>
      asQuery(recordingQuery([updated], calls)),
    );

    await expect(
      new MessagesRepository(db).updateAssistantReply({
        id: updated.id,
        chatId: chat.id,
        inReplyTo: 'message-1',
        parts: [{ type: 'text', text: 'final' }],
        usage: { status: 'completed' },
      }),
    ).resolves.toBe(updated);

    expect(calls.find((call) => call.method === 'set')?.argument).toEqual({
      parts: [{ type: 'text', text: 'final' }],
      usage: { status: 'completed' },
    });
  });
});

describe('MessagesRepository read shapes', () => {
  it('returns a limited window oldest-first even though it is queried newest-first', async () => {
    const db = makeDb({
      select: [[{ messages: message(9) }, { messages: message(8) }]],
    });

    await expect(
      new MessagesRepository(db).findByChatId(chat.id, chat.ownerUserId, {
        limit: 2,
      }),
    ).resolves.toEqual([message(8), message(9)]);
  });

  it('reports a missing message as undefined rather than throwing', async () => {
    const db = makeDb({ select: [[]] });

    await expect(
      new MessagesRepository(db).findById(chat.id, chat.ownerUserId, 'absent'),
    ).resolves.toBeUndefined();
  });

  it('skips the query entirely for an empty chat-id set', async () => {
    const db: Db = drizzle.mock({ schema });
    const calls: Array<ChainCall> = [];
    const distinct = vi
      .spyOn(db, 'selectDistinctOn')
      .mockImplementation(() => asQuery(recordingQuery([], calls)));
    const select = vi
      .spyOn(db, 'select')
      .mockImplementation(() => asQuery(recordingQuery([], calls)));

    await expect(
      new MessagesRepository(db).findEarliestUserMessagePerChat(
        [],
        chat.ownerUserId,
      ),
    ).resolves.toEqual([]);
    await expect(
      new MessagesRepository(db).countPerChat([], chat.ownerUserId),
    ).resolves.toEqual(new Map());
    expect(distinct).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('partitions the preview and earliest-user reads on chat id', async () => {
    const db: Db = drizzle.mock({ schema });
    const calls: Array<ChainCall> = [];
    const distinct = vi
      .spyOn(db, 'selectDistinctOn')
      .mockImplementation(() => asQuery(recordingQuery([], calls)));
    const repository = new MessagesRepository(db);

    await repository.findLatestPerOwnedChat(chat.ownerUserId);
    await repository.findEarliestUserMessagePerChat(
      [chat.id],
      chat.ownerUserId,
    );

    expect(distinct).toHaveBeenNthCalledWith(1, [schema.messages.chatId]);
    expect(distinct).toHaveBeenNthCalledWith(2, [schema.messages.chatId]);
  });

  it('writes nothing for an empty bulk copy', async () => {
    const db: Db = drizzle.mock({ schema });
    const calls: Array<ChainCall> = [];
    const insert = vi
      .spyOn(db, 'insert')
      .mockImplementation(() => asQuery(recordingQuery([], calls)));

    await new MessagesRepository(db).createMany([]);

    expect(insert).not.toHaveBeenCalled();
  });

  it('orders the assistant lookup by seq so the earliest reply wins, and does not order the user lookup', async () => {
    const db: Db = drizzle.mock({ schema });
    const calls: Array<ChainCall> = [];
    vi.spyOn(db, 'select').mockImplementation(() =>
      asQuery(recordingQuery([], calls)),
    );

    await new MessagesRepository(db).findTurnState(
      chat.id,
      chat.ownerUserId,
      'user-message',
    );

    expect(calls.filter((call) => call.method === 'orderBy')).toHaveLength(1);
  });
});

describe('MessagesRepository conversation lookup shape', () => {
  const conversationRow = (overrides: UnknownRecord) => ({
    message_chat_id: chat.id,
    message_seq: '7',
    message_role: 'user',
    message_parts: [{ type: 'text', text: 'hi' }],
    message_usage: null,
    message_created_at: new Date(7000),
    previous_message_seq: null,
    next_message_seq: null,
    ...overrides,
  });

  it('reports an absent row as undefined rather than dereferencing it', async () => {
    const db = makeDb({ execute: [[]] });

    await expect(
      new MessagesRepository(db).findConversationMessage(
        chat.id,
        chat.ownerUserId,
        7,
      ),
    ).resolves.toBeUndefined();
  });

  it('admits an assistant turn and omits neighbour keys that do not exist', async () => {
    const db = makeDb({
      execute: [[conversationRow({ message_role: 'assistant' })]],
    });

    await expect(
      new MessagesRepository(db).findConversationMessage(
        chat.id,
        chat.ownerUserId,
        7,
      ),
    ).resolves.toStrictEqual({
      chatId: chat.id,
      seq: 7,
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      usage: null,
      createdAt: new Date(7000),
    });
  });

  it('omits a neighbour whose sequence is not a usable positive integer', async () => {
    const db = makeDb({
      execute: [
        [
          conversationRow({
            previous_message_seq: '0',
            next_message_seq: '9',
          }),
        ],
      ],
    });

    await expect(
      new MessagesRepository(db).findConversationMessage(
        chat.id,
        chat.ownerUserId,
        7,
      ),
    ).resolves.toStrictEqual({
      chatId: chat.id,
      seq: 7,
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
      usage: null,
      createdAt: new Date(7000),
      nextMessageSeq: 9,
    });
  });
});
