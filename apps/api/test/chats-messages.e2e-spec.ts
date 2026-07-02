/**
 * Chat message streaming e2e (#55) — real HTTP + Postgres, fake model client.
 *
 * Requires POSTGRES_URL to point at a migrated database. Without it the suite is
 * skipped so offline `pnpm test` remains usable; scripts/rls-test.sh provides the
 * real database gate.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { ConfigsRepository } from './../src/config-resolver/configs-repository';
import { type Message } from './../src/db/schema';
import { TenantDbService } from './../src/db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from './../src/chats/chats-repository';
import {
  RunEventsRepository,
  RunsRepository,
} from './../src/runs/runs-repository';
import { ModelsService } from './../src/models/models.service';
import { turnTelemetryLogger } from './../src/chats/turn-telemetry';
import {
  FakeModelsService,
  cookieOf,
  parseSseEvents,
  streamedText,
} from './support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

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
    const body = res.body as { user?: { id?: unknown } };
    const userId = body.user?.id;
    expect(typeof userId).toBe('string');
    return { cookie: cookieOf(res), userId: userId as string };
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
  async function listMessages(chatId: string): Promise<Message[]> {
    return tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userAId),
    );
  }

  beforeAll(async () => {
    models = new FakeModelsService();
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    jest.restoreAllMocks();
    models.credential = 'sk-test';
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
    models.client.shouldFinish = true;
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
    const ownerReadBody = ownerRead.body as {
      messages: Array<{ createdAt: string; seq: number }>;
    };

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
    });
    expect(Date.parse(ownerReadBody.messages[0].createdAt)).not.toBeNaN();
    expect(Date.parse(ownerReadBody.messages[1].createdAt)).not.toBeNaN();
    expect(ownerReadBody.messages[0].seq).toBeLessThan(
      ownerReadBody.messages[1].seq,
    );

    const olderPage = await request(http)
      .get(`/api/v1/chats/${historyChatId}/messages`)
      .query({ limit: 1, beforeSeq: ownerReadBody.messages[1].seq })
      .set('Cookie', cookieA);
    expect(olderPage.status).toBe(200);
    expect(olderPage.body).toEqual({
      messages: [
        expect.objectContaining({
          id: userMessageId,
          seq: ownerReadBody.messages[0].seq,
        }),
      ],
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

  it('caps default HTTP message history reads at the latest 100 messages', async () => {
    const cappedChatId = await createChat(userAId, 'Capped History API Chat');
    const seededMessageIds: string[] = [];

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
    const ownerReadBody = ownerRead.body as {
      messages: Array<{ id: string; seq: number }>;
    };

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
    const telemetryLog = jest
      .spyOn(turnTelemetryLogger, 'info')
      .mockImplementation(() => {});
    models.client.responses = ['hello from model'];
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
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
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: userMessageId,
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
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
            model: 'gpt-4o-mini',
            provider: 'openai',
            latencyMs: expect.any(Number),
            finishReason: 'stop',
            status: 'completed',
            costUsd: 0.0000033,
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
    const assistantUsage = assistantMessage?.usage as {
      cachedInputTokens: number;
      inputTokens: number;
    };
    expect(
      assistantUsage.cachedInputTokens / assistantUsage.inputTokens,
    ).toBeCloseTo(2 / 3);
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
        model: 'gpt-4o-mini',
        provider: 'openai',
        finishReason: 'stop',
        status: 'completed',
        costUsd: 0.0000033,
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
    jest.spyOn(turnTelemetryLogger, 'info').mockImplementation(() => {
      throw new Error('pino sink failed');
    });
    models.client.responses = ['still persisted'];
    const userMessageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
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
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'steal' }],
        },
      });

    expect(res.status).toBe(404);
    expect(models.client.turns).toHaveLength(0);
    await expect(listMessages(chatA)).resolves.toEqual(before);
  });

  it('returns 402 before any write when the user has no model credential', async () => {
    models.credential = null;
    const before = await listMessages(chatA);

    const res = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'No key' }],
        },
      });

    expect(res.status).toBe(402);
    expect(res.body).not.toMatchObject({ stack: expect.anything() });
    expect(models.client.turns).toHaveLength(0);
    await expect(listMessages(chatA)).resolves.toEqual(before);
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
        message: {
          id: collisionId,
          parts: [{ type: 'text', text: 'Colliding prompt' }],
        },
      });

    expect(res.status).toBe(409);
    expect(models.client.turns).toHaveLength(0);
    await expect(listMessages(chatA)).resolves.toEqual(before);
  });

  it('retries a completed turn without a second model call or duplicate user row', async () => {
    models.client.responses = ['first answer'];
    const userMessageId = crypto.randomUUID();

    const first = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
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
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Once' }],
        },
      });

    expect(second.status).toBe(409);
    expect(models.client.turns).toHaveLength(1);

    const messages = await listMessages(chatA);
    expect(
      messages.filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { id?: unknown }).id === userMessageId,
      ),
    ).toHaveLength(1);
    expect(
      messages.filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { inReplyTo?: unknown }).inReplyTo === userMessageId,
      ),
    ).toHaveLength(1);
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
          (m.usage as { status?: string } | null)?.status === 'aborted',
      );
    }, 5000);
    expect(models.client.onFinishCalls).toBe(finishCallsBefore);

    // And the run reached a terminal cancelled state, freeing single-flight.
    const finalRun = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findById(run.id, userAId),
    );
    expect(finalRun?.status).toBe('cancelled');
  });

  it('retries a cancelled turn by reusing the user row', async () => {
    // Worker semantics: a turn is interrupted by CANCELLING its run (PATCH),
    // not by aborting the transport — disconnects deliberately don't kill
    // runs. Cancel mid-flight, then retry the same message id.
    models.client.delayMs = 400;
    const userMessageId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
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
    }, 10000);
    models.client.delayMs = 0;

    models.client.shouldFinish = true;
    models.client.responses = ['retry answer'];
    const retried = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Try again' }],
        },
      });

    expect(retried.status).toBe(200);
    expect(models.client.turns.length).toBeGreaterThanOrEqual(2);

    const messages = await listMessages(chatA);
    expect(
      messages.filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { id?: unknown }).id === userMessageId,
      ),
    ).toHaveLength(1);
    expect(
      messages.filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { inReplyTo?: unknown }).inReplyTo === userMessageId,
      ),
    ).toHaveLength(1);
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

    // #78 — the completed first turn titles the still-default chat before stream
    // completion, so the client's first post-stream chat-list refresh can see it.
    const titled = await request(http)
      .get(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA);
    expect(titled.body).toMatchObject({ title: 'Generated Title' });
    expect(models.client.titleTurns.length).toBeGreaterThanOrEqual(1);

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
  // Same-message retries are NOT blocked — they supersede (covered above).
  it('rejects a second message while a run is in flight for the chat (409)', async () => {
    models.client.delayMs = 400;
    models.client.responses = ['slow answer'];
    const before = models.client.turns.length;
    const firstId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
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
    const frames = parseSseEvents(sse.text) as Array<{
      sequence: number;
      eventType: string;
      payload: { text?: string } | null;
    }>;
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
    const lastSequence = frames[frames.length - 1].sequence;
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
    const partialFrames = parseSseEvents(partial.text) as Array<{
      eventType: string;
    }>;
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
    const reconnectedFrames = parseSseEvents(reconnected.text) as Array<{
      eventType: string;
    }>;
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

  // #91 — per-run budget: the cap is snapshotted onto the run row at creation,
  // forwarded to the provider, and a length-stop terminates the run as a
  // structured budget_exceeded failure — partial answer intact, breach event
  // in the trace, no post-turn model spend.
  it('stops a run cleanly as budget_exceeded when the output token cap is hit', async () => {
    process.env.RUN_MAX_OUTPUT_TOKENS = '100';
    models.client.responses = ['truncated answ'];
    models.client.finishReason = 'length';
    const titleCallsBefore = models.client.titleTurns.length;
    try {
      const newChatId = crypto.randomUUID();
      const userMessageId = crypto.randomUUID();

      const res = await request(http)
        .post(`/api/v1/chats/${newChatId}/messages`)
        .set('Cookie', cookieA)
        .send({
          message: {
            id: userMessageId,
            parts: [{ type: 'text', text: 'Write a novel' }],
          },
        });
      expect(res.status).toBe(200);

      const [run] = await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).findByChatId(newChatId, userAId),
      );
      // Config snapshot at creation (#46): the effective cap with instance
      // provenance (env layer), forwarded to the provider.
      const snapshot = run.configSnapshot as {
        effective: { run?: { maxOutputTokens?: number } };
        provenance: Record<string, { scopeType: string }>;
        layers: { scopeType: string }[];
        computedAt: string;
      };
      expect(snapshot.effective.run?.maxOutputTokens).toBe(100);
      expect(snapshot.provenance['run.maxOutputTokens']?.scopeType).toBe(
        'instance',
      );
      expect(snapshot.layers.map((l) => l.scopeType)).toEqual([
        'instance',
        'user',
        'chat',
      ]);
      expect(models.client.turns.at(-1)?.maxOutputTokens).toBe(100);

      await waitFor(async () => {
        const current = await tenantDb.runAs(userAId, (tx) =>
          new RunsRepository(tx).findById(run.id, userAId),
        );
        return current?.status === 'failed';
      }, 5000);
      const finished = await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).findById(run.id, userAId),
      );
      expect(finished?.error).toMatchObject({ code: 'budget_exceeded' });

      // The breach is observable in the trace, between the model outcome and
      // the terminal event.
      const events = await tenantDb.runAs(userAId, (tx) =>
        new RunEventsRepository(tx).listByRunId(run.id, userAId),
      );
      expect(events.map((e) => e.eventType)).toEqual([
        'run.created',
        'run.started',
        'model.requested',
        'model.delta',
        'model.completed',
        'run.budget_exceeded',
        'run.failed',
      ]);
      expect(
        events.find((e) => e.eventType === 'run.budget_exceeded')?.payload,
      ).toEqual({ maxOutputTokens: 100, outputTokens: 5 });

      // Clean stop, no corruption: the partial answer is persisted with its
      // length finish recorded in the turn telemetry.
      const messages = await listMessages(newChatId);
      const assistant = messages.find(
        (m) => m.role === 'assistant' && m.inReplyTo === userMessageId,
      );
      expect(assistant?.parts).toEqual([
        { type: 'text', text: 'truncated answ' },
      ]);
      expect(assistant?.usage).toMatchObject({
        status: 'completed',
        finishReason: 'length',
      });

      // A run that ran out of budget triggers no further model spend (#91):
      // the async post-turn title call is skipped.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(models.client.titleTurns.length).toBe(titleCallsBefore);
    } finally {
      delete process.env.RUN_MAX_OUTPUT_TOKENS;
      models.client.finishReason = 'stop';
    }
  });

  // #46 — config resolver: a user-scope config row overrides the instance
  // (env) layer, the run snapshot records per-leaf provenance, and the
  // explain endpoint mirrors the resolution (404 cross-tenant).
  it('resolves user-scope config over the instance layer, with provenance and explain', async () => {
    process.env.RUN_MAX_OUTPUT_TOKENS = '1000';
    models.client.responses = ['short'];
    models.client.finishReason = 'length';
    try {
      // Seed a user-scope override (written under RLS: own scope only).
      await tenantDb.runAs(userAId, (tx) =>
        new ConfigsRepository(tx).upsert({
          scopeType: 'user',
          scopeId: userAId,
          config: { run: { maxOutputTokens: 64 } },
        }),
      );

      const newChatId = crypto.randomUUID();
      const userMessageId = crypto.randomUUID();
      const res = await request(http)
        .post(`/api/v1/chats/${newChatId}/messages`)
        .set('Cookie', cookieA)
        .send({
          message: {
            id: userMessageId,
            parts: [{ type: 'text', text: 'Budgeted by my own config' }],
          },
        });
      expect(res.status).toBe(200);

      const [run] = await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).findByChatId(newChatId, userAId),
      );
      const snapshot = run.configSnapshot as {
        effective: { run?: { maxOutputTokens?: number } };
        provenance: Record<
          string,
          { scopeType: string; scopeId: string | null }
        >;
      };
      // User scope (64) beats the instance env layer (1000).
      expect(snapshot.effective.run?.maxOutputTokens).toBe(64);
      expect(snapshot.provenance['run.maxOutputTokens']).toMatchObject({
        scopeType: 'user',
        scopeId: userAId,
      });
      expect(models.client.turns.at(-1)?.maxOutputTokens).toBe(64);

      // Explain endpoint mirrors the resolution, with provenance entries.
      const explain = await request(http)
        .get(`/api/v1/chats/${newChatId}/effective-config`)
        .set('Cookie', cookieA);
      expect(explain.status).toBe(200);
      const explained = explain.body as {
        effective: { run?: { maxOutputTokens?: number } };
        provenance: { path: string; scopeType: string; scopeId: unknown }[];
        layers: { scopeType: string }[];
      };
      expect(explained.effective.run?.maxOutputTokens).toBe(64);
      expect(explained.provenance).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'run.maxOutputTokens',
            scopeType: 'user',
            scopeId: userAId,
          }),
        ]),
      );
      expect(explained.layers.map((l) => l.scopeType)).toEqual([
        'instance',
        'user',
        'chat',
      ]);

      // Cross-tenant explain: 404, no existence leak.
      const denied = await request(http)
        .get(`/api/v1/chats/${newChatId}/effective-config`)
        .set('Cookie', cookieB);
      expect(denied.status).toBe(404);
    } finally {
      delete process.env.RUN_MAX_OUTPUT_TOKENS;
      models.client.finishReason = 'stop';
      await tenantDb.runAs(userAId, (tx) =>
        new ConfigsRepository(tx).remove('user', userAId),
      );
    }
  });

  // #86 — the 402 (no credential) path must create nothing: the orphan was a *persisted* row,
  // so assert the chat is truly absent, not merely that the model was not called.
  it('creates no chat when the first message is rejected for a missing credential', async () => {
    models.credential = null;
    const newChatId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${newChatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'No key' }],
        },
      });

    expect(res.status).toBe(402);
    expect(models.client.turns).toHaveLength(0);

    const chat = await request(http)
      .get(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA);
    expect(chat.status).toBe(404);
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
