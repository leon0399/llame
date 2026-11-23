/**
 * Chat model selection over HTTP (openspec `model-roles`, D3/D14) — real HTTP,
 * real Postgres, a REAL `ModelsService` over a role-holding config, and a fake
 * model client so runs complete without a provider. Only the model transport
 * is doubled: admission, the tenant transaction, the Chat row, and the Run row
 * are the production ones, which is what the stored selection and its revision
 * have to be proved against.
 *
 * Requires POSTGRES_URL to point at a migrated database; without it the suite
 * is skipped so offline `pnpm test` remains usable (the test:integration
 * globalSetup provides the real database gate).
 */

import { Server, type IncomingMessage, type ServerResponse } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import type {
  ModelClient,
  ModelStreamInput,
  ModelStreamResult,
} from '../models/model-client';
import { ModelsService } from '../models/models.service';
import {
  FakeStreamingModelClient,
  cookieOf,
  expectRegisteredUserId,
} from '../testing/support';
import type { CreateMessageDto } from './dto/chats.dto';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 30_000 });

/** A reasoning model: the role's primary candidate declares `high`. */
const CODEX: SystemModelCatalogEntry = {
  id: 'system:openai:gpt-5.5',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'gpt-5.5',
  systemPromptTemplate: 'Model selection prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  reasoning: {
    effortLevels: [{ value: 'xhigh' }, { value: 'high' }, { value: 'low' }],
    defaultEffort: 'high',
    cacheInvalidatedByEffortChange: false,
  },
};

/** A model that declares no reasoning vocabulary at all. */
const FAST: SystemModelCatalogEntry = {
  id: 'system:openai:gpt-5.4-mini',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'gpt-5.4-mini',
  systemPromptTemplate: 'Model selection prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
};

const PROVIDER = {
  id: 'openai',
  type: 'openai-completions' as const,
  key: null,
  baseUrl: 'https://model-selection.example.test/v1',
  headers: {},
};

function configFor(selector: string | null): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    defaults: { selector, titleGenerationSelector: null },
    providers: [PROVIDER],
    models: [CODEX, FAST],
    modelRoles: [
      {
        name: 'coding',
        candidates: [
          { modelId: CODEX.id, effort: 'xhigh' },
          { modelId: FAST.id },
        ],
      },
      { name: 'fast', candidates: [{ modelId: FAST.id }] },
    ],
  };
}

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

type Harness = {
  readonly app: INestApplication;
  readonly http: HttpServer;
  readonly client: FakeStreamingModelClient;
};

type StreamText = ModelClient['streamText'];

/**
 * The seam a test installs over the fake client's stream: `holdNextTurn` fills
 * it to keep one turn's completion pending, and boot's client factory routes
 * every stream through it until the hold clears itself.
 */
type StreamHold = {
  current:
    | ((input: ModelStreamInput, next: StreamText) => ModelStreamResult)
    | undefined;
};

async function boot(
  config: LlameConfig,
  hold: StreamHold = { current: undefined },
): Promise<Harness> {
  const client = new FakeStreamingModelClient();

  const nextStreamText: StreamText = (input) => client.streamText(input);

  const models = new ModelsService(
    { config, productUserAgent: 'llame/model-selection-test' },
    (input) => ({
      model: input.model.id,
      provider: 'openai',
      contextWindowTokens: input.model.contextWindowTokens,
      streamText: (streamInput) =>
        hold.current === undefined
          ? nextStreamText(streamInput)
          : hold.current(streamInput, nextStreamText),
    }),
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(InstanceConfigService)
    .useValue({ config, productUserAgent: 'llame/model-selection-test' })
    .overrideProvider(ModelsService)
    .useValue(models)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);

  const server: unknown = app.getHttpServer();

  if (!isHttpServer(server)) {
    throw new Error('Expected Nest to expose a Node HTTP server');
  }

  return { app, http: server, client };
}

/** A Chat's stored selection as the Chat read returns it. */
const modelSelectionSchema = z
  .object({
    selector: z.string(),
    effort: z.string().nullable(),
  })
  .strict();

const chatResponseSchema = z.object({
  id: z.string(),
  modelSelection: modelSelectionSchema.nullable(),
});

const latestRunSchema = z
  .object({
    selector: z.string(),
    modelId: z.string(),
  })
  .passthrough();

const messagesResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string(), role: z.string() })),
  latestRun: latestRunSchema.nullable(),
});

d('a Chat stores its model selection', () => {
  let harness: Harness;
  let streamHold: StreamHold;
  let cookieA = '';
  let cookieB = '';
  let releaseTurn: (() => void) | undefined;

  async function register(
    label: string,
  ): Promise<{ cookie: string; userId: string }> {
    const res = await request(harness.http)
      .post('/auth/v1/register')
      .send({
        email: `model-selection-${label}-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: `Model selection ${label}`,
      });

    expect(res.status).toBe(201);
    const body: unknown = res.body;
    expectRegisteredUserId(body);

    return { cookie: cookieOf(res), userId: body.user.id };
  }

  // A body that still names the removed request field, to prove the API refuses it.
  type LegacySendBody = Omit<CreateMessageDto, 'selector'> & {
    modelId: string;
  };

  function postMessage(
    chatId: string,
    cookie: string,
    body: CreateMessageDto | LegacySendBody,
  ) {
    return request(harness.http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send(body);
  }

  function send(
    chatId: string,
    cookie: string,
    selector: string,
    text = 'hello',
  ) {
    return postMessage(chatId, cookie, {
      selector,
      message: { id: crypto.randomUUID(), parts: [{ type: 'text', text }] },
    });
  }

  async function getChat(chatId: string, cookie: string) {
    return request(harness.http)
      .get(`/api/v1/chats/${chatId}`)
      .set('Cookie', cookie);
  }

  async function getMessages(chatId: string, cookie: string) {
    const res = await request(harness.http)
      .get(`/api/v1/chats/${chatId}/messages?limit=100`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    return messagesResponseSchema.parse(res.body);
  }

  /** Hold the next turn's completion so its Run stays live. */
  function holdNextTurn(): Promise<void> {
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    releaseTurn = () => held.resolve();

    streamHold.current = (input, next) => {
      const onFinish = input.onFinish;

      if (!onFinish) return next(input);

      streamHold.current = undefined;

      return next({
        ...input,
        onFinish: async (output) => {
          started.resolve();
          await held.promise;
          await onFinish(output);
        },
      });
    };

    return started.promise;
  }

  beforeAll(async () => {
    streamHold = { current: undefined };
    harness = await boot(configFor('@coding'), streamHold);

    const owner = await register('owner');
    cookieA = owner.cookie;
    const stranger = await register('stranger');
    cookieB = stranger.cookie;
  });

  afterEach(() => {
    releaseTurn?.();
    releaseTurn = undefined;
    streamHold.current = undefined;
    harness.client.responses = ['fake assistant'];
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('Another device shows the same selection', async () => {
    const chatId = crypto.randomUUID();

    const sent = await send(chatId, cookieA, '@coding', 'from one device');
    expect(sent.status).toBe(200);

    // The second reader only has the Chat read: the selection is Chat state,
    // not a per-device composer value.
    const read = await getChat(chatId, cookieA);
    expect(read.status).toBe(200);
    const chat = chatResponseSchema.parse(read.body);

    expect(chat.modelSelection).toEqual({
      selector: '@coding',
      effort: 'xhigh',
    });

    const messages = await getMessages(chatId, cookieA);
    expect(messages.latestRun).toMatchObject({
      selector: '@coding',
      modelId: CODEX.id,
    });
  });

  it('A refused send stores no selection', async () => {
    const chatId = crypto.randomUUID();

    const accepted = await send(chatId, cookieA, '@coding');
    expect(accepted.status).toBe(200);

    const before = chatResponseSchema.parse(
      (await getChat(chatId, cookieA)).body,
    ).modelSelection;

    const refused = await postMessage(chatId, cookieA, {
      selector: '@coding',
      effort: 'ultra',
      message: {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'refused' }],
      },
    });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'effort_not_available' });

    const after = chatResponseSchema.parse(
      (await getChat(chatId, cookieA)).body,
    ).modelSelection;

    expect(after).toEqual(before);
  });

  it('A pick resets the stored effort', async () => {
    const chatId = crypto.randomUUID();

    expect((await send(chatId, cookieA, '@coding')).status).toBe(200);
    expect(
      chatResponseSchema.parse((await getChat(chatId, cookieA)).body)
        .modelSelection,
    ).toEqual({ selector: '@coding', effort: 'xhigh' });

    // `@fast`'s first candidate declares no reasoning, so the pick stores no
    // effort and drops the one `@coding` held.
    expect((await send(chatId, cookieA, '@fast', 'pick fast')).status).toBe(
      200,
    );
    expect(
      chatResponseSchema.parse((await getChat(chatId, cookieA)).body)
        .modelSelection,
    ).toEqual({ selector: '@fast', effort: null });

    // A later send with neither field is accepted on the stored pick.
    const stored = await postMessage(chatId, cookieA, {
      message: {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'no selector here' }],
      },
    });

    expect(stored.status).toBe(200);
    expect((await getMessages(chatId, cookieA)).latestRun).toMatchObject({
      selector: '@fast',
      modelId: FAST.id,
    });
  });

  it('A pick sent as a steer', async () => {
    const chatId = crypto.randomUUID();
    const live = holdNextTurn();

    // Attaching the handler dispatches the request: supertest only starts it
    // when the test is awaited, and this Run must be in flight first.
    const pending = send(chatId, cookieA, '@coding', 'live turn').then(
      (response) => response,
    );

    await live;

    const steer = await postMessage(chatId, cookieA, {
      selector: '@fast',
      delivery: 'steer',
      message: {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'steer to fast' }],
      },
    });

    expect(steer.status).toBe(202);
    expect(steer.body).toMatchObject({ selector: '@fast', mode: 'steer' });

    // The accepted steer writes the Chat's selection at once...
    expect(
      chatResponseSchema.parse((await getChat(chatId, cookieA)).body)
        .modelSelection,
    ).toEqual({ selector: '@fast', effort: null });

    // ...while the live Run keeps the model it started on.
    expect((await getMessages(chatId, cookieA)).latestRun?.modelId).toBe(
      CODEX.id,
    );

    releaseTurn?.();
    releaseTurn = undefined;
    expect((await pending).status).toBe(200);
  });

  it('Another owner reads a Chat', async () => {
    const chatId = crypto.randomUUID();

    expect((await send(chatId, cookieA, '@coding')).status).toBe(200);

    const foreignRead = await getChat(chatId, cookieB);
    expect(foreignRead.status).toBe(404);
    expect(foreignRead.body).not.toHaveProperty('modelSelection');

    const foreignSend = await send(chatId, cookieB, '@fast');
    expect(foreignSend.status).toBe(404);

    expect(
      chatResponseSchema.parse((await getChat(chatId, cookieA)).body)
        .modelSelection,
    ).toEqual({ selector: '@coding', effort: 'xhigh' });
  });

  it('A send with the old field', async () => {
    const chatId = crypto.randomUUID();

    expect((await send(chatId, cookieA, '@coding')).status).toBe(200);
    const before = await getMessages(chatId, cookieA);

    const legacy = await postMessage(chatId, cookieA, {
      modelId: FAST.id,
      message: {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'old field' }],
      },
    });

    expect(legacy.status).toBe(400);

    const after = await getMessages(chatId, cookieA);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(
      chatResponseSchema.parse((await getChat(chatId, cookieA)).body)
        .modelSelection,
    ).toEqual({ selector: '@coding', effort: 'xhigh' });
  });
});

d('a send with no selector and no default', () => {
  let app: INestApplication;
  let http: Server;

  beforeAll(async () => {
    const booted = await boot(configFor(null));
    app = booted.app;
    http = booted.http;
  });

  afterAll(async () => {
    await app.close();
  });

  it('No selector and no default', async () => {
    const registered = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `model-selection-no-default-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: 'No default',
      });

    expect(registered.status).toBe(201);
    const body: unknown = registered.body;
    expectRegisteredUserId(body);

    const chatId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookieOf(registered))
      .send({
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'nothing to resolve' }],
        },
      });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'model_configuration_invalid' });

    // The refusal rolls the admission transaction back: the first send's Chat
    // row and its message are not stored, so both reads answer 404.

    const chatRead = await request(http)
      .get(`/api/v1/chats/${chatId}`)
      .set('Cookie', cookieOf(registered));

    expect(chatRead.status).toBe(404);

    const messagesRead = await request(http)
      .get(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookieOf(registered));

    expect(messagesRead.status).toBe(404);
  });
});
