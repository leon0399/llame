/**
 * Chat message streaming e2e (#55) — real HTTP + Postgres, fake model client.
 *
 * Requires POSTGRES_URL to point at a migrated database. Without it the suite is
 * skipped so offline `pnpm test` remains usable; the test:integration globalSetup provides the
 * real database gate.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { sql as dsql } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { ModelsService } from '../models/models.service';
import { turnTelemetryLogger } from '../chats/turn-telemetry';
import { isRecord } from '@workspace/runtime-safety';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
  parseSseEvents,
  streamedText,
  expectTemporalRow,
} from '../testing/support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 30_000 });

/**
 * Waits until a condition becomes true.
 *
 * @param condition - The condition to poll
 * @param timeoutMs - The maximum time to wait in milliseconds
 * @returns A promise that resolves when the condition becomes true
 * @throws Error when the condition does not become true before the timeout expires
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Asserts a listed message carries an ordering `createdAt`/`seq` pair. */
function assertOrderedMessage(
  value: unknown,
): asserts value is { createdAt: string; seq: number } {
  if (
    !isRecord(value) ||
    typeof value.createdAt !== 'string' ||
    typeof value.seq !== 'number'
  ) {
    throw new Error('Expected a message with createdAt/seq');
  }
}

/** Asserts a message's `usage` carries the two numeric token fields checked below. */
function assertUsageTokens(
  value: unknown,
): asserts value is { cachedInputTokens: number; inputTokens: number } {
  if (
    !isRecord(value) ||
    typeof value.cachedInputTokens !== 'number' ||
    typeof value.inputTokens !== 'number'
  ) {
    throw new Error('Expected assistant usage with numeric token fields');
  }
}

d('POST /api/v1/chats/:id/messages — streaming loop', () => {
  let app: INestApplication;
  let http: import('http').Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;

  const tag = Date.now();
  const password = 'password123';
  let cookieA = '';
  let userAId = '';
  let cookieB = '';
  let userBId = '';
  let chatA = '';

  /**
   * Registers a user and returns the session cookie and user ID.
   *
   * @param email - The email address to register
   * @param name - The display name to register
   * @returns The session cookie and created user ID
   */
  async function register(
    email: string,
    name: string,
  ): Promise<{ cookie: string; userId: string }> {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email, password, name });
    expect(res.status).toBe(201);
    const body: unknown = res.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(res), userId: body.user.id };
  }

  /**
   * Seeds an empty chat owned by the user, directly via the RLS-scoped repository.
   *
   * There is no HTTP empty-chat endpoint (#86 — chats are created by their first message),
   * so tests that need a pre-existing empty chat seed it through the repository instead.
   *
   * @param userId - The owner user id
   * @param title - Chat title to set
   * @returns The created chat ID
   */
  async function createChat(userId: string, title: string): Promise<string> {
    const chat = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: userId, title }),
    );
    return chat.id;
  }

  /**
   * Loads the messages visible to the test user for a chat.
   *
   * @param chatId - The chat identifier
   * @returns The messages returned for that chat in the current test tenant context
   */
  async function listMessages(chatId: string): Promise<Array<Message>> {
    return tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userAId),
    );
  }

  beforeAll(async () => {
    models = new FakeModelsService();
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const userA = await register(`stream-a-${tag}@example.com`, 'Stream A');
    cookieA = userA.cookie;
    userAId = userA.userId;
    const userB = await register(`stream-b-${tag}@example.com`, 'Stream B');
    cookieB = userB.cookie;
    userBId = userB.userId;
    chatA = await createChat(userAId, 'Streaming Chat');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    models.credential = 'sk-test';
    models.createClientCalls.length = 0;
    models.client.turns.length = 0;
    models.client.titleTurns.length = 0;
    models.client.titleResponse = 'Generated Title';
    models.client.responses = ['fake assistant'];
    models.client.usage = {
      inputTokens: 3,
      inputTokenDetails: {
        noCacheTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
      },
      cachedInputTokens: 2,
      outputTokens: 5,
      outputTokenDetails: { textTokens: 4, reasoningTokens: 1 },
      totalTokens: 8,
      reasoningTokens: 1,
    };
    models.client.delayMs = 0;
  });

  afterEach(async () => {
    // Single-flight hygiene: a test that leaves a non-terminal run poisons
    // every later test on the same chat (409 at the unique index). Finish
    // any leftovers so state never leaks across tests.
    await tenantDb.runAs(userAId, async (tx) => {
      const repo = new RunsRepository(tx);
      const runs = await repo.findByChatId(chatA, userAId);
      for (const leftover of runs) {
        if (
          !['completed', 'failed', 'cancelled', 'expired'].includes(
            leftover.status,
          )
        ) {
          await repo.markFinished(leftover.id, userAId, 'cancelled', {
            message: 'test cleanup',
          });
        }
      }
    });
  });

  it('reads persisted message history over guarded HTTP and hides it cross-tenant', async () => {
    const historyChatId = await createChat(userAId, 'History API Chat');
    const userMessageId = crypto.randomUUID();
    let assistantMessageId = '';

    await tenantDb.runAs(userAId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      await messagesRepo.create({
        id: userMessageId,
        chatId: historyChatId,
        role: 'user',
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'History prompt' }],
        attachments: [{ type: 'file', name: 'context.txt' }],
      });
      const assistantMessage = await messagesRepo.create({
        chatId: historyChatId,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'History answer' }],
        attachments: [],
        usage: { status: 'completed', cachedInputTokens: 1 },
        inReplyTo: userMessageId,
      });
      assistantMessageId = assistantMessage.id;
    });

    const ownerRead = await request(http)
      .get(`/api/v1/chats/${historyChatId}/messages`)
      .set('Cookie', cookieA);
    const ownerReadBody: unknown = ownerRead.body;
    if (!isRecord(ownerReadBody) || !Array.isArray(ownerReadBody.messages)) {
      throw new Error('Expected a messages array');
    }
    const [firstMessage, secondMessage]: Array<unknown> =
      ownerReadBody.messages;
    assertOrderedMessage(firstMessage);
    assertOrderedMessage(secondMessage);

    expect(ownerRead.status).toBe(200);
    expect(ownerReadBody).toEqual({
      messages: [
        expect.objectContaining({
          id: userMessageId,
          chatId: historyChatId,
          seq: expect.any(Number),
          role: 'user',
          senderUserId: userAId,
          parts: [{ type: 'text', text: 'History prompt' }],
          attachments: [{ type: 'file', name: 'context.txt' }],
          usage: null,
          inReplyTo: null,
          createdAt: expect.any(String),
        }),
        expect.objectContaining({
          id: assistantMessageId,
          chatId: historyChatId,
          seq: expect.any(Number),
          role: 'assistant',
          senderUserId: null,
          parts: [{ type: 'text', text: 'History answer' }],
          attachments: [],
          usage: { status: 'completed', cachedInputTokens: 1 },
          inReplyTo: userMessageId,
          createdAt: expect.any(String),
        }),
      ],
      // No compaction on this chat — #136's embedded field is null.
      compaction: null,
    });
    expect(Date.parse(firstMessage.createdAt)).not.toBeNaN();
    expect(Date.parse(secondMessage.createdAt)).not.toBeNaN();
    expect(firstMessage.seq).toBeLessThan(secondMessage.seq);

    const olderPage = await request(http)
      .get(`/api/v1/chats/${historyChatId}/messages`)
      .query({ limit: 1, beforeSeq: secondMessage.seq })
      .set('Cookie', cookieA);
    expect(olderPage.status).toBe(200);
    expect(olderPage.body).toEqual({
      messages: [
        expect.objectContaining({
          id: userMessageId,
          seq: firstMessage.seq,
        }),
      ],
      compaction: null,
    });

    const tooLarge = await request(http)
      .get(`/api/v1/chats/${historyChatId}/messages`)
      .query({ limit: 201 })
      .set('Cookie', cookieA);
    expect(tooLarge.status).toBe(400);

    const crossTenantRead = await request(http)
      .get(`/api/v1/chats/${historyChatId}/messages`)
      .set('Cookie', cookieB);
    expect(crossTenantRead.status).toBe(404);

    const anonymousRead = await request(http).get(
      `/api/v1/chats/${historyChatId}/messages`,
    );
    expect(anonymousRead.status).toBe(401);
  });

  it('loads target-ended windows, rejects missing targets, and hides foreign targets', async () => {
    const targetChatId = await createChat(userAId, 'Target API Chat');
    const targetMessages: Array<Message> = [];

    await tenantDb.runAs(userAId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      for (const text of ['first', 'middle', 'latest']) {
        targetMessages.push(
          await messagesRepo.create({
            chatId: targetChatId,
            role: 'user',
            senderUserId: userAId,
            parts: [{ type: 'text', text }],
            attachments: [],
          }),
        );
      }
    });

    for (const [index, target] of targetMessages.entries()) {
      const response = await request(http)
        .get(`/api/v1/chats/${targetChatId}/messages`)
        .query({ limit: 2, targetSeq: target.seq })
        .set('Cookie', cookieA);
      const body = z
        .object({ messages: z.array(z.object({ seq: z.number() })) })
        .parse(response.body);

      expect(response.status).toBe(200);
      expect(body.messages.map((message) => message.seq)).toEqual(
        targetMessages
          .slice(Math.max(0, index - 1), index + 1)
          .map((message) => message.seq),
      );
      expect(body.messages.at(-1)?.seq).toBe(target.seq);
    }

    const missingTarget = await request(http)
      .get(`/api/v1/chats/${targetChatId}/messages`)
      .query({ targetSeq: targetMessages.at(-1)!.seq + 1 })
      .set('Cookie', cookieA);
    expect(missingTarget.status).toBe(404);

    const deletedTarget = targetMessages[1];
    await tenantDb.runAs(userAId, (tx) =>
      tx.execute(dsql`delete from messages where id = ${deletedTarget.id}`),
    );
    const deletedResponse = await request(http)
      .get(`/api/v1/chats/${targetChatId}/messages`)
      .query({ targetSeq: deletedTarget.seq })
      .set('Cookie', cookieA);
    expect(deletedResponse.status).toBe(404);

    const otherChatId = await createChat(userBId, 'Foreign Target API Chat');
    const [otherMessage] = await tenantDb.runAs(userBId, async (tx) => {
      const created = await new MessagesRepository(tx).create({
        chatId: otherChatId,
        role: 'user',
        senderUserId: userBId,
        parts: [{ type: 'text', text: 'foreign' }],
        attachments: [],
      });
      return [created];
    });
    await tenantDb.runAs(userBId, (tx) =>
      new ChatsRepository(tx).update(otherChatId, userBId, {
        visibility: 'public',
      }),
    );

    const ownerToForeign = await request(http)
      .get(`/api/v1/chats/${otherChatId}/messages`)
      .query({ targetSeq: otherMessage.seq })
      .set('Cookie', cookieA);
    expect(ownerToForeign.status).toBe(404);

    const foreignToOwner = await request(http)
      .get(`/api/v1/chats/${targetChatId}/messages`)
      .query({ targetSeq: targetMessages[0].seq })
      .set('Cookie', cookieB);
    expect(foreignToOwner.status).toBe(404);
  });

  it('rejects invalid target history queries before repository access', async () => {
    const invalidQueryChatId = await createChat(
      userAId,
      'Invalid Target API Chat',
    );
    const findChat = vi.spyOn(ChatsRepository.prototype, 'findById');
    const findMessages = vi.spyOn(MessagesRepository.prototype, 'findByChatId');

    for (const query of [
      { targetSeq: '0' },
      { targetSeq: '-1' },
      { targetSeq: '1.5' },
      { targetSeq: '9007199254740992' },
      { beforeSeq: '1.5' },
      { targetSeq: '7', beforeSeq: '6' },
      { targetSeq: '7', unknown: 'value' },
    ]) {
      const response = await request(http)
        .get(`/api/v1/chats/${invalidQueryChatId}/messages`)
        .query(query)
        .set('Cookie', cookieA);
      expect(response.status).toBe(400);
    }

    expect(findChat).not.toHaveBeenCalled();
    expect(findMessages).not.toHaveBeenCalled();
  });

  it('caps default HTTP message history reads at the latest 100 messages', async () => {
    const cappedChatId = await createChat(userAId, 'Capped History API Chat');
    const seededMessageIds: Array<string> = [];

    await tenantDb.runAs(userAId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      for (let index = 0; index < 101; index += 1) {
        const id = crypto.randomUUID();
        seededMessageIds.push(id);
        await messagesRepo.create({
          id,
          chatId: cappedChatId,
          role: 'user',
          senderUserId: userAId,
          parts: [{ type: 'text', text: `History prompt ${index}` }],
        });
      }
    });

    const ownerRead = await request(http)
      .get(`/api/v1/chats/${cappedChatId}/messages`)
      .set('Cookie', cookieA);
    const ownerReadBody = z
      .object({
        messages: z.array(z.object({ id: z.string(), seq: z.number() })),
      })
      .parse(ownerRead.body);

    expect(ownerRead.status).toBe(200);
    expect(ownerReadBody.messages).toHaveLength(100);
    expect(ownerReadBody.messages.map((message) => message.id)).toEqual(
      seededMessageIds.slice(1),
    );
    expect(
      ownerReadBody.messages.every((message, index, messages) =>
        index === 0 ? true : messages[index - 1].seq < message.seq,
      ),
    ).toBe(true);
  });

  it('streams a UI-message SSE reply and persists user + assistant with usage', async () => {
    const telemetryLog = vi
      .spyOn(turnTelemetryLogger, 'info')
      .mockImplementation(() => {});
    models.client.responses = ['hello from model'];
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Hello' }],
        },
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    expect(streamedText(res.text)).toBe('hello from model');
    expect(models.client.turns).toHaveLength(1);

    const messages = await listMessages(chatA);
    const assistantMessage = messages.find(
      (message) =>
        message.role === 'assistant' && message.inReplyTo === userMessageId,
    );
    expectTemporalRow(
      messages.find((message) => message.id === userMessageId)?.parts ?? [],
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: userMessageId,
          role: 'user',
          parts: [expect.anything(), { type: 'text', text: 'Hello' }],
        }),
        expect.objectContaining({
          role: 'assistant',
          parts: [{ type: 'text', text: 'hello from model' }],
          usage: expect.objectContaining({
            inputTokens: 3,
            cachedInputTokens: 2,
            outputTokens: 5,
            totalTokens: 8,
            reasoningTokens: 1,
            modelId: 'system:openai:gpt-5.4-mini',
            latencyMs: expect.any(Number),
            finishReason: 'stop',
            status: 'completed',
            costUsd: 0.0000234,
          }),
          inReplyTo: userMessageId,
        }),
      ]),
    );
    expect(assistantMessage?.usage).toEqual(
      expect.objectContaining({
        cachedInputTokens: 2,
      }),
    );
    const assistantUsage = assistantMessage?.usage;
    assertUsageTokens(assistantUsage);
    expect(
      assistantUsage.cachedInputTokens / assistantUsage.inputTokens,
    ).toBeCloseTo(2 / 3);
    // The terminal event can close the SSE response before post-commit search
    // indexing and telemetry finish. Assert the documented eventual boundary.
    await waitFor(() => telemetryLog.mock.calls.length >= 1, 5000);
    expect(telemetryLog).toHaveBeenCalledTimes(1);
    expect(telemetryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'assistant_turn_completed',
        chatId: chatA,
        messageId: assistantMessage?.id,
        inReplyTo: userMessageId,
        inputTokens: 3,
        cachedInputTokens: 2,
        outputTokens: 5,
        totalTokens: 8,
        reasoningTokens: 1,
        modelId: 'system:openai:gpt-5.4-mini',
        finishReason: 'stop',
        status: 'completed',
        costUsd: 0.0000234,
      }),
    );
    expect(JSON.stringify(telemetryLog.mock.calls[0]?.[0])).not.toContain(
      'Hello',
    );
    expect(JSON.stringify(telemetryLog.mock.calls[0]?.[0])).not.toContain(
      'hello from model',
    );
  });

  it('does not fail the turn when the telemetry log sink throws', async () => {
    vi.spyOn(turnTelemetryLogger, 'info').mockImplementation(() => {
      throw new Error('pino sink failed');
    });
    models.client.responses = ['still persisted'];
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Hello' }],
        },
      });

    expect(res.status).toBe(200);
    expect(streamedText(res.text)).toBe('still persisted');
    const messages = await listMessages(chatA);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          parts: [{ type: 'text', text: 'still persisted' }],
          usage: expect.objectContaining({
            status: 'completed',
            cachedInputTokens: 2,
          }),
          inReplyTo: userMessageId,
        }),
      ]),
    );
  });

  it('returns 404 and writes nothing for a cross-tenant chat', async () => {
    const before = await listMessages(chatA);

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieB)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'steal' }],
        },
      });

    expect(res.status).toBe(404);
    expect(models.client.turns).toHaveLength(0);
    await expect(listMessages(chatA)).resolves.toEqual(before);
  });

  it('does not require a provider credential before enqueueing a turn', async () => {
    models.credential = null;
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'No key' }],
        },
      });

    expect(res.status).toBe(200);
    expect(models.client.turns).toHaveLength(1);
    const messages = await listMessages(chatA);
    expect(messages.some((message) => message.id === userMessageId)).toBe(true);
  });

  it('returns 409 when the client message id collides with a non-user row', async () => {
    const collisionId = crypto.randomUUID();
    await tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).create({
        id: collisionId,
        chatId: chatA,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'Existing assistant' }],
      }),
    );
    const before = await listMessages(chatA);

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: collisionId,
          parts: [{ type: 'text', text: 'Colliding prompt' }],
        },
      });

    expect(res.status).toBe(409);
    expect(models.client.turns).toHaveLength(0);
    await expect(listMessages(chatA)).resolves.toEqual(before);
  });

  it('rejects a completed turn retry on the existing message id', async () => {
    models.client.responses = ['first answer'];
    const userMessageId = crypto.randomUUID();

    const first = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Once' }],
        },
      });
    expect(first.status).toBe(200);

    const second = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Once' }],
        },
      });

    expect(second.status).toBe(409);
    expect(models.client.turns).toHaveLength(1);

    const messages = await listMessages(chatA);
    expect(messages.filter((m) => m.id === userMessageId)).toHaveLength(1);
    expect(messages.filter((m) => m.inReplyTo === userMessageId)).toHaveLength(
      1,
    );
  });

  /** Find chatA's run for a message and cancel it via the HTTP surface. */
  async function cancelRunForMessage(messageId: string) {
    const runs = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(chatA, userAId),
    );
    const run = runs.find((r) => r.messageId === messageId);
    expect(run).toBeDefined();
    const cancelRes = await request(http)
      .patch(`/api/v1/runs/${run!.id}`)
      .set('Cookie', cookieA)
      .send({ status: 'cancelled' });
    expect(cancelRes.status).toBe(200);
    return run!;
  }

  // #73 — event-driven abort fidelity: with an effectively infinite model
  // delay, ONLY the abort event can end the turn (no polling branch). The
  // no-partial-write guarantee under durable-run semantics: cancellation goes
  // through PATCH /runs/:id (transport abort deliberately never kills a run),
  // onFinish never fires, the persisted assistant row is the empty aborted
  // placeholder, and the run terminates cancelled (freeing single-flight).
  it('an event-driven mid-stream cancel fires onError, never onFinish, no partial text', async () => {
    models.client.delayMs = 60_000;
    const finishCallsBefore = models.client.onFinishCalls;
    const turnsBefore = models.client.turns.length;
    const userMessageId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Abort me mid-stream' }],
        },
      });
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );

    await waitFor(() => models.client.turns.length === turnsBefore + 1, 5000);
    const run = await cancelRunForMessage(userMessageId);
    await settled;
    models.client.delayMs = 0;

    // The cancelled turn persisted only the empty placeholder, never text.
    await waitFor(async () => {
      const messages = await listMessages(chatA);
      return messages.some(
        (m) =>
          m.inReplyTo === userMessageId &&
          Array.isArray(m.parts) &&
          m.parts.length === 0 &&
          isRecord(m.usage) &&
          m.usage.status === 'aborted',
      );
    }, 5000);
    expect(models.client.onFinishCalls).toBe(finishCallsBefore);

    // And the run reached a terminal cancelled state, freeing single-flight.
    const finalRun = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findById(run.id, userAId),
    );
    expect(finalRun?.status).toBe('cancelled');
  });

  it('rejects a cancelled turn retry on the existing message id', async () => {
    // Worker semantics: a turn is interrupted by CANCELLING its run (PATCH),
    // not by aborting the transport — disconnects deliberately don't kill
    // runs. Cancel mid-flight, then retry the same message id.
    models.client.delayMs = 400;
    const userMessageId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Try again' }],
        },
      });
    const settled = pending.then(
      (res) => res,
      () => undefined,
    );

    await waitFor(() => models.client.turns.length === 1, 5000);
    // The run for THIS message (findByChatId is oldest-first and chatA
    // accumulates runs across the suite).
    const run = await cancelRunForMessage(userMessageId);

    await settled;
    await waitFor(async () => {
      const current = await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).findById(run.id, userAId),
      );
      if (current == null) {
        return false;
      }
      return ['cancelled', 'failed', 'completed', 'expired'].includes(
        current.status,
      );
    }, 10_000);
    models.client.delayMs = 0;

    const turnsAfterCancel = models.client.turns.length;
    models.client.responses = ['retry answer'];
    const retried = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Try again' }],
        },
      });

    expect(retried.status).toBe(409);
    expect(models.client.turns).toHaveLength(turnsAfterCancel);

    const messages = await listMessages(chatA);
    expect(messages.filter((m) => m.id === userMessageId)).toHaveLength(1);
    expect(messages.filter((m) => m.inReplyTo === userMessageId)).toHaveLength(
      1,
    );
  });

  // Rewritten for #48 single-flight: v0.1 allowed overlapping turns with
  // seq-isolated contexts; runs are now serialized per chat — an overlapping
  // send is rejected outright, and a subsequent send sees the prior turn.
  it('serializes turns per chat: overlap rejected, next turn sees prior history', async () => {
    models.client.delayMs = 50;
    models.client.responses = ['answer one', 'answer two'];
    const firstId = crypto.randomUUID();

    const firstRequest = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: firstId,
          parts: [{ type: 'text', text: 'Prompt one' }],
        },
      });
    const firstResponse = firstRequest.then((res) => res);
    await waitFor(() => models.client.turns.length === 1);

    const overlapping = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Prompt two' }],
        },
      });
    expect(overlapping.status).toBe(409);

    const first = await firstResponse;
    expect(first.status).toBe(200);
    models.client.delayMs = 0;

    // The first turn's context never saw the rejected send.
    expect(JSON.stringify(models.client.turns[0].messages)).not.toContain(
      'Prompt two',
    );

    // After the in-flight run finished, the chat accepts the next turn — and
    // its context includes the completed first exchange.
    const secondId = crypto.randomUUID();
    const second = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: secondId,
          parts: [{ type: 'text', text: 'Prompt two' }],
        },
      });
    expect(second.status).toBe(200);
    expect(models.client.turns).toHaveLength(2);
    const secondContext = JSON.stringify(models.client.turns[1].messages);
    expect(secondContext).toContain('Prompt one');
    expect(secondContext).toContain('answer one');

    const messages = await listMessages(chatA);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', inReplyTo: firstId }),
        expect.objectContaining({ role: 'assistant', inReplyTo: secondId }),
      ]),
    );
  });

  it('rejects malformed bodies before any write', async () => {
    const before = await listMessages(chatA);

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: '' }],
        },
      });

    expect(res.status).toBe(400);
    expect(models.client.turns).toHaveLength(0);
    await expect(listMessages(chatA)).resolves.toEqual(before);
  });

  // #86 — first message creates the chat (upsert on a client-supplied id).
  it('creates the chat on the first message to a not-yet-existing id', async () => {
    models.client.responses = ['created via first message'];
    const newChatId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${newChatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'First' }],
        },
      });

    expect(res.status).toBe(200);
    expect(streamedText(res.text)).toBe('created via first message');

    // The chat now exists, owned by the sender (never the client).
    const chat = await request(http)
      .get(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA);
    expect(chat.status).toBe(200);
    expect(chat.body).toMatchObject({
      id: newChatId,
      ownerUserId: userAId,
    });

    // #78 — the completed first turn titles the still-untitled chat. Polled,
    // not asserted outright: titling runs AFTER the terminal run event that
    // ends the stream (a title is a second model call — holding the stream open
    // for it would be the wrong trade), so the response above can legitimately
    // land before the title commits. Only the assistant message is atomic with
    // the terminal write (#261).
    const readChat = () =>
      request(http).get(`/api/v1/chats/${newChatId}`).set('Cookie', cookieA);
    await waitFor(async () => {
      const body: unknown = (await readChat()).body;
      return isRecord(body) && body.title === 'Generated Title';
    }, 10_000);
    expect((await readChat()).body).toMatchObject({ title: 'Generated Title' });
    expect(models.client.titleTurns.length).toBeGreaterThanOrEqual(1);
    expect(models.createClientCalls).toContainEqual(
      expect.objectContaining({ modelId: 'system:openai:gpt-5.4-mini' }),
    );
    expect(models.createClientCalls).toContainEqual(
      expect.objectContaining({ modelId: 'system:openai:gpt-5.4-nano' }),
    );

    // #48 — the turn left a durable run with an ordered lifecycle event log:
    // run row completed, events strictly sequence-ascending, source of truth
    // for replay (#49).
    const runs = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(newChatId, userAId),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      messageId: userMessageId,
      userId: userAId,
      modelId: 'system:openai:gpt-5.4-mini',
      status: 'completed',
    });
    expect(runs[0].startedAt).not.toBeNull();
    expect(runs[0].finishedAt).not.toBeNull();

    const events = await tenantDb.runAs(userAId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runs[0].id, userAId),
    );
    expect(events.map((e) => e.eventType)).toEqual([
      'run.created',
      'run.started',
      'model.requested',
      'model.delta',
      'model.completed',
      'run.completed',
    ]);
    expect(
      events.find((event) => event.eventType === 'model.requested')?.payload,
    ).toEqual({ modelId: 'system:openai:gpt-5.4-mini' });
    const completedPayload = events.find(
      (event) => event.eventType === 'model.completed',
    )?.payload;
    const completedTelemetry = isRecord(completedPayload)
      ? completedPayload.telemetry
      : undefined;
    expect(completedTelemetry).toEqual(
      expect.objectContaining({
        modelId: 'system:openai:gpt-5.4-mini',
        status: 'completed',
      }),
    );
    expect(completedTelemetry).not.toHaveProperty('model');
    expect(completedTelemetry).not.toHaveProperty('provider');
    const sequences = events.map((e) => e.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);

    // Both turn messages persisted under the new chat.
    const messages = await listMessages(newChatId);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: userMessageId, role: 'user' }),
        expect.objectContaining({
          role: 'assistant',
          inReplyTo: userMessageId,
        }),
      ]),
    );
  });

  it('does not overwrite a manually confirmed default title while title generation is in flight', async () => {
    let resolveTitle!: (value: string) => void;
    models.client.titleResponse = new Promise<string>((resolve) => {
      resolveTitle = resolve;
    });

    const newChatId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const responsePromise = request(http)
      .post(`/api/v1/chats/${newChatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'First' }],
        },
      })
      .then((res) => res);

    await waitFor(() => models.client.titleTurns.length > 0, 5000);

    const rename = await request(http)
      .patch(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA)
      .send({ title: 'New chat' });
    expect(rename.status).toBe(200);
    expect(rename.body).toMatchObject({ title: 'New chat' });

    resolveTitle('Generated Title');
    const res = await responsePromise;
    expect(res.status).toBe(200);

    const chat = await request(http)
      .get(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA);
    expect(chat.status).toBe(200);
    expect(chat.body).toMatchObject({ title: 'New chat' });
  });

  // #48 — per-chat single-flight: while one run is in flight, a DIFFERENT
  // message to the same chat is rejected atomically (the partial unique index,
  // not app logic), and its transaction rolls back leaving nothing behind.
  // Same-message retries are blocked for now: id reuse is rejected on id alone.
  it('rejects a second message while a run is in flight for the chat (409)', async () => {
    models.client.delayMs = 400;
    models.client.responses = ['slow answer'];
    const before = models.client.turns.length;
    const firstId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: { id: firstId, parts: [{ type: 'text', text: 'First' }] },
      });
    const settled = pending.then(
      (res) => res,
      () => undefined,
    );

    await waitFor(() => models.client.turns.length === before + 1);

    const secondId = crypto.randomUUID();
    const second = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: { id: secondId, parts: [{ type: 'text', text: 'Second' }] },
      });
    expect(second.status).toBe(409);

    const first = await settled;
    expect(first?.status).toBe(200);
    models.client.delayMs = 0;

    // The rejected send persisted nothing — its transaction rolled back whole.
    const messages = await listMessages(chatA);
    expect(messages.some((m) => m.id === secondId)).toBe(false);
    expect(messages.some((m) => m.id === firstId)).toBe(true);
  });

  // #48/#49 — the run read surface: run row over HTTP, ordered SSE replay by
  // cursor, and cross-tenant denial (404, no existence leak).
  it('replays run events over SSE by cursor; cross-tenant reads 404', async () => {
    models.client.responses = ['replayed answer'];
    const newChatId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${newChatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Replay me' }],
        },
      });
    expect(res.status).toBe(200);

    const [run] = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(newChatId, userAId),
    );
    expect(run).toBeDefined();
    await waitFor(async () => {
      const current = await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).findById(run.id, userAId),
      );
      return current?.status === 'completed';
    }, 5000);

    // Run row over HTTP (egress-allowlisted response shape).
    const runRes = await request(http)
      .get(`/api/v1/runs/${run.id}`)
      .set('Cookie', cookieA);
    expect(runRes.status).toBe(200);
    expect(runRes.body).toMatchObject({
      id: run.id,
      chatId: newChatId,
      messageId: userMessageId,
      status: 'completed',
    });

    // Full SSE replay: ordered lifecycle incl. the coalesced model.delta text.
    const sse = await request(http)
      .get(`/api/v1/runs/${run.id}/events`)
      .set('Cookie', cookieA);
    expect(sse.status).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    const runEventFrameSchema = z.object({
      sequence: z.number(),
      eventType: z.string(),
      payload: z.object({ text: z.string().optional() }).nullable(),
    });
    const frames = z.array(runEventFrameSchema).parse(parseSseEvents(sse.text));
    expect(frames.map((f) => f.eventType)).toEqual([
      'run.created',
      'run.started',
      'model.requested',
      'model.delta',
      'model.completed',
      'run.completed',
    ]);
    expect(frames.find((f) => f.eventType === 'model.delta')?.payload).toEqual({
      text: 'replayed answer',
    });
    expect(sse.text).toContain('data: [DONE]');

    // Cursor: replay strictly after the last seen sequence → tail only ([DONE]).
    const lastFrame = frames.at(-1);
    if (lastFrame === undefined) expect.unreachable('expected replayed frames');
    const lastSequence = lastFrame.sequence;
    const resumed = await request(http)
      .get(`/api/v1/runs/${run.id}/events?after_sequence=${lastSequence}`)
      .set('Cookie', cookieA);
    expect(resumed.status).toBe(200);
    expect(parseSseEvents(resumed.text)).toHaveLength(0);

    // Cursor mid-stream: only events after it are replayed.
    const midSequence = frames[2].sequence; // after model.requested
    const partial = await request(http)
      .get(`/api/v1/runs/${run.id}/events?after_sequence=${midSequence}`)
      .set('Cookie', cookieA);
    const partialFrames = z
      .array(runEventFrameSchema)
      .parse(parseSseEvents(partial.text));
    expect(partialFrames.map((f) => f.eventType)).toEqual([
      'model.delta',
      'model.completed',
      'run.completed',
    ]);

    // Native EventSource reconnect: the browser re-requests the SAME URL (no
    // query cursor) and sends the last `id:` seen via Last-Event-ID (SSE
    // spec). The header must win, or every reconnect replays from zero.
    const reconnected = await request(http)
      .get(`/api/v1/runs/${run.id}/events`)
      .set('Cookie', cookieA)
      .set('Last-Event-ID', String(midSequence));
    const reconnectedFrames = z
      .array(runEventFrameSchema)
      .parse(parseSseEvents(reconnected.text));
    expect(reconnectedFrames.map((f) => f.eventType)).toEqual([
      'model.delta',
      'model.completed',
      'run.completed',
    ]);

    // Cross-tenant: another user's session sees 404 on both surfaces.
    const deniedRun = await request(http)
      .get(`/api/v1/runs/${run.id}`)
      .set('Cookie', cookieB);
    expect(deniedRun.status).toBe(404);
    const deniedEvents = await request(http)
      .get(`/api/v1/runs/${run.id}/events`)
      .set('Cookie', cookieB);
    expect(deniedEvents.status).toBe(404);
  });

  it('creates the first-message chat even when no provider credential is configured', async () => {
    models.credential = null;
    const newChatId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${newChatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'No key' }],
        },
      });

    expect(res.status).toBe(200);
    expect(models.client.turns).toHaveLength(1);

    const chat = await request(http)
      .get(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA);
    expect(chat.status).toBe(200);
  });

  // #86 — a client-supplied id is routing/idempotency only, never ownership. First writer wins;
  // a second tenant cannot create-or-hijack an id already claimed by another.
  it('does not let another tenant claim an already-owned chat id', async () => {
    models.client.responses = ['owned by B'];
    const sharedId = crypto.randomUUID();

    const bFirst = await request(http)
      .post(`/api/v1/chats/${sharedId}/messages`)
      .set('Cookie', cookieB)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'mine' }],
        },
      });
    expect(bFirst.status).toBe(200);

    const aSteal = await request(http)
      .post(`/api/v1/chats/${sharedId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'steal' }],
        },
      });
    expect(aSteal.status).toBe(404);

    // A cannot see it (no existence leak); B still owns it.
    const aGet = await request(http)
      .get(`/api/v1/chats/${sharedId}`)
      .set('Cookie', cookieA);
    expect(aGet.status).toBe(404);

    const bGet = await request(http)
      .get(`/api/v1/chats/${sharedId}`)
      .set('Cookie', cookieB);
    expect(bGet.status).toBe(200);
    expect(bGet.body).toMatchObject({ id: sharedId, ownerUserId: userBId });
  });
});
