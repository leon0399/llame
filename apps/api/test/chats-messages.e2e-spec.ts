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
import { type ModelMessage, type streamText } from 'ai';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { TenantDbService } from './../src/db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from './../src/chats/chats-repository';
import { MissingModelCredentialError } from './../src/models/model-client';
import { ModelsService } from './../src/models/models.service';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

const cookieOf = (res: request.Response): string => {
  const set = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  for (const c of set) {
    const m = /llame_session=([^;]+)/.exec(c);
    if (m) return `llame_session=${m[1]}`;
  }
  return '';
};

/**
 * Parses SSE data events into JSON values.
 *
 * @param body - The SSE payload to parse
 * @returns The parsed JSON values from each `data: ` event, excluding `[DONE]`
 */
function parseSseEvents(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((event) => event.trim())
    .filter((event) => event.startsWith('data: '))
    .map((event) => event.slice('data: '.length))
    .filter((data) => data !== '[DONE]')
    .map((data): unknown => JSON.parse(data) as unknown);
}

/**
 * Extracts streamed text content from an SSE payload.
 *
 * @returns The concatenated `delta` values from `text-delta` events.
 */
function streamedText(body: string): string {
  return parseSseEvents(body)
    .filter(
      (event): event is { type: 'text-delta'; delta: string } =>
        typeof event === 'object' &&
        event !== null &&
        (event as { type?: unknown }).type === 'text-delta',
    )
    .map((event) => event.delta)
    .join('');
}

/**
 * Waits until a condition becomes true.
 *
 * @param condition - The condition to poll
 * @param timeoutMs - The maximum time to wait in milliseconds
 * @returns A promise that resolves when the condition becomes true
 * @throws Error when the condition does not become true before the timeout expires
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type FakeTurn = {
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
  aborted: boolean;
};

class FakeStreamingModelClient {
  readonly turns: FakeTurn[] = [];
  responses: string[] = ['fake assistant'];
  shouldFinish = true;
  delayMs = 0;

  streamText(input: {
    messages: ModelMessage[];
    abortSignal?: AbortSignal;
    onFinish?: (event: {
      text: string;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      finishReason: string;
    }) => void | Promise<void>;
  }): ReturnType<typeof streamText> {
    const response =
      this.responses[this.turns.length] ?? this.responses[0] ?? '';
    const turn: FakeTurn = {
      messages: input.messages,
      abortSignal: input.abortSignal,
      aborted: false,
    };
    this.turns.push(turn);

    input.abortSignal?.addEventListener('abort', () => {
      turn.aborted = true;
    });

    const stream = new ReadableStream({
      start: async (controller) => {
        controller.enqueue({
          type: 'start',
          messageId: `fake-${this.turns.length}`,
        });
        controller.enqueue({ type: 'text-start', id: 'text-1' });

        if (this.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }

        if (input.abortSignal?.aborted) {
          turn.aborted = true;
          controller.error(new Error('aborted'));
          return;
        }

        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: response,
        });
        controller.enqueue({ type: 'text-end', id: 'text-1' });

        if (input.abortSignal?.aborted) {
          turn.aborted = true;
          controller.error(new Error('aborted'));
          return;
        }

        if (this.shouldFinish) {
          await input.onFinish?.({
            text: response,
            usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
            finishReason: 'stop',
          });
          controller.enqueue({ type: 'finish' });
        }

        controller.close();
      },
    });

    const toResponse = () => {
      const sse = stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
          },
          flush(controller) {
            controller.enqueue('data: [DONE]\n\n');
          },
        }),
      );
      return new Response(sse.pipeThrough(new TextEncoderStream()), {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      });
    };

    return {
      text: Promise.resolve(response),
      textStream: new ReadableStream({
        start(controller) {
          controller.enqueue(response);
          controller.close();
        },
      }) as never,
      fullStream: new ReadableStream() as never,
      consumeStream: async () => {},
      toUIMessageStreamResponse: toResponse,
    } as unknown as ReturnType<typeof streamText>;
  }
}

class FakeModelsService {
  credential: string | null = 'sk-test';
  readonly client = new FakeStreamingModelClient();

  resolveModelCredential(userId: string): string {
    if (!this.credential) {
      throw new MissingModelCredentialError(userId);
    }

    return this.credential;
  }

  createOpenAIClient() {
    return this.client;
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
  async function listMessages(chatId: string): Promise<unknown[]> {
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
    models.credential = 'sk-test';
    models.client.turns.length = 0;
    models.client.responses = ['fake assistant'];
    models.client.shouldFinish = true;
    models.client.delayMs = 0;
  });

  it('streams a UI-message SSE reply and persists user + assistant with usage', async () => {
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
            outputTokens: 5,
            totalTokens: 8,
            finishReason: 'stop',
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

  it('aborts the model call and does not persist an assistant message', async () => {
    models.client.delayMs = 200;
    const userMessageId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Abort me' }],
        },
      });
    const pendingResponse = pending.then((res) => res);

    await waitFor(() => models.client.turns.length === 1);
    pending.abort();

    await expect(pendingResponse).rejects.toThrow();
    await waitFor(() => models.client.turns[0]?.aborted === true);

    expect(models.client.turns).toHaveLength(1);
    expect(models.client.turns[0].aborted).toBe(true);
    const messages = await listMessages(chatA);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: userMessageId, role: 'user' }),
      ]),
    );
    expect(
      messages.some(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { inReplyTo?: unknown }).inReplyTo === userMessageId,
      ),
    ).toBe(false);
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

  it('retries an aborted turn by reusing the user row', async () => {
    models.client.shouldFinish = false;
    const userMessageId = crypto.randomUUID();

    const failed = await request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Try again' }],
        },
      });
    expect(failed.status).toBe(200);

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
    expect(models.client.turns).toHaveLength(2);

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

  it('isolates overlapping turns to history capped at each user message seq', async () => {
    models.client.delayMs = 50;
    models.client.responses = ['answer one', 'answer two'];
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();

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

    const secondResponse = request(http)
      .post(`/api/v1/chats/${chatA}/messages`)
      .set('Cookie', cookieA)
      .send({
        message: {
          id: secondId,
          parts: [{ type: 'text', text: 'Prompt two' }],
        },
      });

    const [first, second] = await Promise.all([firstResponse, secondResponse]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(models.client.turns).toHaveLength(2);

    const contextTexts = models.client.turns.map((turn) =>
      JSON.stringify(turn.messages),
    );
    const firstContextText = contextTexts.find((text) =>
      text.includes('Prompt one'),
    );
    const secondContextText = contextTexts.find((text) =>
      text.includes('Prompt two'),
    );
    expect(firstContextText).toBeDefined();
    expect(firstContextText).not.toContain('Prompt two');
    expect(secondContextText).toBeDefined();

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

    // The chat now exists, owned by the sender (never the client), with the default title.
    const chat = await request(http)
      .get(`/api/v1/chats/${newChatId}`)
      .set('Cookie', cookieA);
    expect(chat.status).toBe(200);
    expect(chat.body).toMatchObject({
      id: newChatId,
      ownerUserId: userAId,
      title: 'New chat',
    });

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
