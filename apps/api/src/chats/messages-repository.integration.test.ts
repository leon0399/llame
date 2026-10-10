/**
 * Running-reply semantics on a live DB: the dispatch-time upsert's conflict
 * guard, the attempt-fenced write-through (RunningReplyRepository), the
 * model-switch baseline read, and the owner reads that hide a `running` reply
 * (MessagesRepository). The SQL shapes are pinned by the behavior test; this
 * proves Postgres honors them.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';
import { MessagesRepository } from './messages-repository';
import { RunningReplyRepository } from './running-reply-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const RUN_ID = '88888888-8888-4888-8888-888888888888';

const runningUsage = (attemptId: string, modelId = 'model-a') => ({
  status: 'running',
  complete: false,
  runId: RUN_ID,
  attemptId,
  modelId,
});

describeIfDb('MessagesRepository running replies', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let owner: string;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 5 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'R', ${`r-${owner}@t.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${owner}`;
      await sql.end();
    }
  });

  /** A Chat holding one accepted user turn and nothing else. */
  const seedTurn = () =>
    tenantDb.runAs(owner, async (tx) => {
      const chat = await new ChatsRepository(tx).create({ ownerUserId: owner });
      const user = await new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'question' }],
      });
      return { chatId: chat.id, userId: user.id };
    });

  const withMessages = <Result>(
    work: (messages: MessagesRepository) => Promise<Result>,
  ) => tenantDb.runAs(owner, (tx) => work(new MessagesRepository(tx)));

  const withReplies = <Result>(
    work: (replies: RunningReplyRepository) => Promise<Result>,
  ) => tenantDb.runAs(owner, (tx) => work(new RunningReplyRepository(tx)));

  const replyTo = (chatId: string, userId: string) =>
    withMessages(
      async (messages) =>
        (await messages.findTurnState(chatId, owner, userId)).assistantMessage,
    );

  it('inserts an empty running reply after the user turn', async () => {
    const turn = await seedTurn();

    const reply = await withReplies((replies) =>
      replies.upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        usage: runningUsage('attempt-a'),
      }),
    );

    expect(reply).toMatchObject({
      role: 'assistant',
      seq: 2,
      inReplyTo: turn.userId,
      parts: [],
      usage: runningUsage('attempt-a'),
    });
  });

  it('resets a reply that is not completed, in place', async () => {
    const turn = await seedTurn();
    const first = await withReplies(async (replies) => {
      const created = await replies.upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        usage: runningUsage('attempt-a'),
      });
      await replies.updateRunningReplyParts({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        attemptId: 'attempt-a',
        parts: [{ type: 'text', text: 'attempt A output' }],
      });
      return created;
    });
    if (first === undefined) expect.unreachable('expected a running reply');

    const reset = await withReplies((replies) =>
      replies.upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        usage: runningUsage('attempt-b'),
      }),
    );

    expect(reset).toMatchObject({
      id: first.id,
      seq: first.seq,
      parts: [],
      usage: runningUsage('attempt-b'),
    });

    // A failed reply is replaceable too.
    await withMessages((messages) =>
      messages.updateAssistantReply({
        id: first.id,
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        parts: [{ type: 'text', text: 'failed output' }],
        usage: { status: 'failed', modelId: 'model-a' },
      }),
    );
    await expect(
      withReplies((replies) =>
        replies.upsertRunningReply({
          chatId: turn.chatId,
          inReplyTo: turn.userId,
          usage: runningUsage('attempt-c'),
        }),
      ),
    ).resolves.toMatchObject({ id: first.id, parts: [] });
  });

  it('refuses to touch a completed reply', async () => {
    const turn = await seedTurn();
    const completed = await withMessages((messages) =>
      messages.createAssistantReplyIfAbsent({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        parts: [{ type: 'text', text: 'final answer' }],
        usage: { status: 'completed', modelId: 'model-a' },
      }),
    );

    await expect(
      withReplies((replies) =>
        replies.upsertRunningReply({
          chatId: turn.chatId,
          inReplyTo: turn.userId,
          usage: runningUsage('attempt-b'),
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(replyTo(turn.chatId, turn.userId)).resolves.toEqual(completed);
  });

  it('reports no reply when the user turn is missing', async () => {
    const turn = await seedTurn();

    await expect(
      withReplies((replies) =>
        replies.upsertRunningReply({
          chatId: turn.chatId,
          inReplyTo: crypto.randomUUID(),
          usage: runningUsage('attempt-a'),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('writes parts through only to the running reply of the same attempt', async () => {
    const turn = await seedTurn();
    await withReplies((replies) =>
      replies.upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        usage: runningUsage('attempt-b'),
      }),
    );
    const write = (attemptId: string, text: string) =>
      withReplies((replies) =>
        replies.updateRunningReplyParts({
          chatId: turn.chatId,
          inReplyTo: turn.userId,
          attemptId,
          parts: [{ type: 'text', text }],
        }),
      );

    // A stale attempt cannot write into the reply the next attempt reset.
    await expect(write('attempt-a', 'stale')).resolves.toBe(false);
    await expect(write('attempt-b', 'current')).resolves.toBe(true);
    await expect(replyTo(turn.chatId, turn.userId)).resolves.toMatchObject({
      parts: [{ type: 'text', text: 'current' }],
    });

    // Once finalized, not even the producing attempt can write through.
    const reply = await replyTo(turn.chatId, turn.userId);
    if (reply === undefined) expect.unreachable('expected the reply');
    await withMessages((messages) =>
      messages.updateAssistantReply({
        id: reply.id,
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        parts: [{ type: 'text', text: 'failed' }],
        usage: { status: 'failed', attemptId: 'attempt-b' },
      }),
    );
    await expect(write('attempt-b', 'late')).resolves.toBe(false);
  });

  it('reads the newest earlier reply that records a model, whatever its status', async () => {
    const chatId = await tenantDb.runAs(owner, async (tx) => {
      const chat = await new ChatsRepository(tx).create({ ownerUserId: owner });
      const messages = new MessagesRepository(tx);
      const turns: Array<[string, unknown]> = [
        ['completed', { status: 'completed', modelId: 'model-old' }],
        ['failed', { status: 'failed', modelId: 'model-failed' }],
        ['bare', { status: 'completed' }],
        ['newest', runningUsage('attempt-x', 'model-running')],
      ];
      for (const [text, usage] of turns) {
        const user = await messages.create({
          chatId: chat.id,
          role: 'user',
          senderUserId: owner,
          parts: [{ type: 'text', text }],
        });
        await messages.create({
          chatId: chat.id,
          role: 'assistant',
          parts: [{ type: 'text', text }],
          usage,
          inReplyTo: user.id,
        });
      }
      return chat.id;
    });
    // seq: 1 U, 2 completed/model-old, 3 U, 4 failed/model-failed,
    //      5 U, 6 bare (no modelId), 7 U, 8 running/model-running.
    const before = (seq: number) =>
      withMessages((messages) =>
        messages.findLatestReplyModelIdBefore(chatId, owner, seq),
      );

    await expect(before(9)).resolves.toBe('model-running');
    await expect(before(7)).resolves.toBe('model-failed');
    await expect(before(4)).resolves.toBe('model-old');
    await expect(before(2)).resolves.toBeUndefined();
  });

  it('hides a running reply from history, fork source, previews and id lookup', async () => {
    const turn = await seedTurn();
    const reply = await withReplies((replies) =>
      replies.upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.userId,
        usage: runningUsage('attempt-a'),
      }),
    );
    if (reply === undefined) expect.unreachable('expected a running reply');

    const reads = await withMessages(async (messages) => ({
      history: await messages.findByChatId(turn.chatId, owner),
      forkSource: await messages.findForkSource(turn.chatId, owner, undefined),
      preview: (await messages.findLatestPerOwnedChat(owner)).find(
        ({ chatId }) => chatId === turn.chatId,
      ),
      byId: await messages.findById(turn.chatId, owner, reply.id),
    }));

    expect(reads.history.map(({ id }) => id)).toEqual([turn.userId]);
    expect(reads.forkSource.map(({ id }) => id)).toEqual([turn.userId]);
    expect(reads.preview?.id).toBe(turn.userId);
    expect(reads.byId).toBeUndefined();
  });
});
