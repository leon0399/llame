/**
 * Fallback holds over HTTP and Postgres (openspec `model-roles` D4) — real
 * HTTP, real Postgres, a REAL `ModelsService` over a role-holding config, and a
 * fake model client so Runs complete without a provider. Holds are WRITTEN by
 * the test through `ChatsRepository.setModelSelection`, because the switch
 * layer that writes them is not part of this branch.
 *
 * Requires POSTGRES_URL to point at a migrated database; without it the suite
 * is skipped so offline `pnpm test` remains usable (the test:integration
 * globalSetup provides the real database gate).
 */

import { Server, type IncomingMessage, type ServerResponse } from 'node:http';

import { isRecord } from '@workspace/runtime-safety';
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
import type { ChatModelSelection } from '../models/model-selection';
import { ModelsService } from '../models/models.service';
import { TenantDbService } from '../db/tenant-db.service';
import { settleBashJob } from '../jobs/bash-job-store';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { RunDispatchService } from '../runs/run-dispatch.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { JobNoticeRunService } from '../runs/job-notice-run.service';
import { type TerminalRunStatus } from '../runs/run-status';
import { RunsRepository } from '../runs/runs-repository';
import {
  FakeStreamingModelClient,
  cookieOf,
  expectRegisteredUserId,
  waitFor,
} from '../testing/support';
import { newChatJob } from '../testing/chat-job-rows';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import type { CreateMessageDto } from './dto/chats.dto';

const hasDb = !!process.env['POSTGRES_URL'];
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

/** The role's primary candidate: declares `xhigh`, `high`, `low`. */
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

/** The held fallback: declares `medium`, which the primary does not. */
const SONNET: SystemModelCatalogEntry = {
  id: 'system:anthropic:claude-sonnet',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'claude-sonnet',
  systemPromptTemplate: 'Model selection prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  reasoning: {
    effortLevels: [{ value: 'medium' }, { value: 'low' }],
    defaultEffort: 'low',
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
  baseUrl: 'https://model-hold.example.test/v1',
  headers: {},
};

const CONFIG: LlameConfig = {
  ...BUILT_IN_DEFAULTS,
  defaults: { selector: '@coding', titleGenerationSelector: null },
  providers: [PROVIDER],
  models: [CODEX, SONNET, FAST],
  modelRoles: [
    {
      name: 'coding',
      candidates: [
        { modelId: CODEX.id, effort: 'high' },
        { modelId: SONNET.id, effort: 'low' },
      ],
    },
    { name: 'fast', candidates: [{ modelId: FAST.id }] },
  ],
};

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

type StreamText = ModelClient['streamText'];

/**
 * The seam over the fake client's stream: `holdNextTurn` fills it to keep one
 * turn's completion pending, so a Run stays live while the test acts.
 */
type StreamHold = {
  current:
    | ((input: ModelStreamInput, next: StreamText) => ModelStreamResult)
    | undefined;
};

const holdSchema = z.object({
  selector: z.string(),
  modelId: z.string(),
  effort: z.string().nullable(),
  revertAt: z.string(),
});

const selectionSchema = z.object({
  selector: z.string(),
  effort: z.string().nullable(),
  hold: holdSchema.optional(),
});

const chatSchema = z.object({
  id: z.string(),
  modelSelection: selectionSchema.nullable(),
});

/** An instant `ms` from now, as a stored hold's `revertAt`. */
const about = (ms: number) => new Date(Date.now() + ms).toISOString();

d('a Chat with a fallback hold', () => {
  let app: INestApplication;
  let http: HttpServer;
  let tenantDb: TenantDbService;
  let executor: RunExecutionService;
  let noticeRuns: JobNoticeRunService;
  let client: FakeStreamingModelClient;
  let streamHold: StreamHold;
  let cookieA = '';
  let userAId = '';
  let cookieB = '';
  let releaseTurn: (() => void) | undefined;

  async function register(label: string) {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `model-hold-${label}-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: `Hold ${label}`,
      });

    expect(res.status).toBe(201);
    const body: unknown = res.body;
    expectRegisteredUserId(body);

    return { cookie: cookieOf(res), userId: body.user.id };
  }

  beforeAll(async () => {
    client = new FakeStreamingModelClient();
    streamHold = { current: undefined };
    const nextStreamText: StreamText = (input) => client.streamText(input);

    const models = new ModelsService(
      { config: CONFIG, productUserAgent: 'llame/model-hold-test' },
      (input) => ({
        model: input.model.id,
        provider: 'openai',
        contextWindowTokens: input.model.contextWindowTokens,
        streamText: (streamInput) =>
          streamHold.current === undefined
            ? nextStreamText(streamInput)
            : streamHold.current(streamInput, nextStreamText),
      }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(InstanceConfigService)
      .useValue({ config: CONFIG, productUserAgent: 'llame/model-hold-test' })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);

    const server: unknown = app.getHttpServer();

    if (!isHttpServer(server)) throw new Error('Expected a Node HTTP server');

    http = server;
    tenantDb = app.get(TenantDbService);
    executor = app.get(RunExecutionService, { strict: false });
    noticeRuns = app.get(JobNoticeRunService, { strict: false });

    const owner = await register('owner');
    cookieA = owner.cookie;
    userAId = owner.userId;
    cookieB = (await register('stranger')).cookie;
  });

  afterEach(() => {
    releaseTurn?.();
    releaseTurn = undefined;
    streamHold.current = undefined;
    client.responses = ['fake assistant'];
  });

  afterAll(async () => {
    await app.close();
  });

  /** A Chat the test seeded, with the selection it stores. */
  async function createChat(selection?: ChatModelSelection): Promise<string> {
    const chat = await tenantDb.runAs(userAId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: userAId, title: 'Hold' }),
    );

    if (selection !== undefined) await storeSelection(chat.id, selection);

    return chat.id;
  }

  const storeSelection = (chatId: string, selection: ChatModelSelection) =>
    tenantDb.runAs(userAId, (tx) =>
      new ChatsRepository(tx).setModelSelection(chatId, userAId, selection),
    );

  /** The hold a switched `@coding` Chat stores: `sonnet` until `revertAt`. */
  const heldFor = (revertAt: string, effort: string | null = 'low') => ({
    revision: 1,
    selector: '@coding',
    effort: 'high',
    hold: { selector: '@coding', modelId: SONNET.id, effort, revertAt },
  });

  /** A Chat with one Run that a send judges live (fresh, no queue job). */
  async function chatWithLiveRun(): Promise<{ chatId: string; runId: string }> {
    const chatId = await createChat();

    const runId = await tenantDb.runAs(userAId, async (tx) => {
      const message = await new MessagesRepository(
        tx,
      ).createUserMessageIfAbsent({
        id: crypto.randomUUID(),
        chatId,
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'seed' }],
      });

      if (!message) throw new Error('seed message not stored');

      const runs = new RunsRepository(tx);

      const run = await runs.create({
        chatId,
        messageId: message.id,
        userId: userAId,
        modelId: CODEX.id,
      });

      await runs.markStarted(run.id, userAId);

      return run.id;
    });

    return { chatId, runId };
  }

  function postMessage(chatId: string, body: CreateMessageDto) {
    return request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookieA)
      .send(body);
  }

  function send(
    chatId: string,
    options: {
      selector?: string;
      effort?: string;
      text?: string;
      id?: string;
      delivery?: 'queue' | 'steer' | 'interrupt';
    } = {},
  ) {
    return postMessage(chatId, {
      ...(options.selector !== undefined && { selector: options.selector }),
      ...(options.effort !== undefined && { effort: options.effort }),
      ...(options.delivery !== undefined && { delivery: options.delivery }),
      message: {
        id: options.id ?? crypto.randomUUID(),
        parts: [{ type: 'text', text: options.text ?? 'hello' }],
      },
    });
  }

  const queue = (chatId: string, options: Parameters<typeof send>[1] = {}) =>
    send(chatId, { delivery: 'queue', ...options });

  async function getChat(chatId: string, cookie = cookieA) {
    const res = await request(http)
      .get(`/api/v1/chats/${chatId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    return chatSchema.parse(res.body);
  }

  const runsOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userAId),
    );

  const messagesOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userAId),
    );

  /** The newest Run of the Chat; every scenario asserts on its row. */
  async function latestRun(chatId: string) {
    const runs = await runsOf(chatId);
    const latest = runs.at(-1);

    if (!latest) throw new Error('The Chat has no Run.');

    return latest;
  }

  const until = (what: string, condition: () => Promise<boolean>) =>
    waitFor(async () => ((await condition()) ? true : undefined), 20_000, what);

  const settle = (runId: string, status: TerminalRunStatus) =>
    executor.settleTerminalRun({ userId: userAId, runId, status });

  /** Keep the next turn's completion pending, so its Run stays live. */
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

  it('A held Chat resolves to the held model', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    const res = await send(chatId);

    expect(res.status).toBe(200);
    expect(await latestRun(chatId)).toMatchObject({
      selector: '@coding',
      modelId: SONNET.id,
      effort: 'low',
    });

    // Nothing changed, so the admission wrote nothing: the hold is still there.
    expect((await getChat(chatId)).modelSelection).toMatchObject({
      selector: '@coding',
      effort: 'high',
      hold: { modelId: SONNET.id },
    });
  });

  it('The held model left the role', async () => {
    const chatId = await createChat({
      revision: 1,
      selector: '@coding',
      effort: 'high',
      hold: {
        selector: '@coding',
        modelId: FAST.id,
        effort: null,
        revertAt: about(3_600_000),
      },
    });

    expect((await send(chatId)).status).toBe(200);
    expect((await latestRun(chatId)).modelId).toBe(CODEX.id);
    expect((await getChat(chatId)).modelSelection).not.toHaveProperty('hold');
  });

  it('An effort that only the held model declares', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    expect((await send(chatId, { effort: 'medium' })).status).toBe(200);
    expect(await latestRun(chatId)).toMatchObject({
      modelId: SONNET.id,
      effort: 'medium',
    });

    // The named effort rides on the hold; the owner's selector and effort stay.
    expect((await getChat(chatId)).modelSelection).toMatchObject({
      selector: '@coding',
      effort: 'high',
      hold: { effort: 'medium' },
    });

    // Without the hold the same level is refused: the primary never declares it.
    const returned = await createChat(heldFor(about(-1)));
    const refused = await send(returned, { effort: 'medium' });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'effort_not_available' });
  });

  it('The owner picks the role again', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    expect((await send(chatId, { selector: '@coding' })).status).toBe(200);
    expect((await latestRun(chatId)).modelId).toBe(CODEX.id);

    const stored = (await getChat(chatId)).modelSelection;

    expect(stored).toMatchObject({ selector: '@coding', effort: 'high' });
    expect(stored).not.toHaveProperty('hold');
  });

  it('The owner changes only the effort', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    expect((await send(chatId, { effort: 'low' })).status).toBe(200);
    expect(await latestRun(chatId)).toMatchObject({
      modelId: SONNET.id,
      effort: 'low',
    });

    expect((await getChat(chatId)).modelSelection).toMatchObject({
      selector: '@coding',
      effort: 'high',
      hold: { modelId: SONNET.id, effort: 'low' },
    });
  });

  it('A send after the reset', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    // A reply on the held model first: the switch item compares with it.
    expect((await send(chatId, { text: 'before' })).status).toBe(200);
    expect((await latestRun(chatId)).modelId).toBe(SONNET.id);

    await storeSelection(chatId, heldFor(about(-1)));

    const id = crypto.randomUUID();
    expect((await send(chatId, { text: 'after', id })).status).toBe(200);
    expect(await latestRun(chatId)).toMatchObject({
      modelId: CODEX.id,
      effort: 'high',
    });
    expect((await getChat(chatId)).modelSelection).not.toHaveProperty('hold');

    // The first request of the Run carries the model-switch item, staged on the
    // stored user message.
    const message = (await messagesOf(chatId)).find(
      (candidate) => candidate.id === id,
    );

    if (!message) throw new Error('The send stored no user message.');

    const changed = message.parts.find(
      (part) =>
        isRecord(part) &&
        isRecord(part['data']) &&
        isRecord(part['data']['payload']) &&
        part['data']['payload']['cause'] === 'model',
    );

    expect(changed).toMatchObject({
      type: 'data-context',
      data: {
        producer: 'effective-context-change',
        payload: { fromModelId: SONNET.id, toModelId: CODEX.id },
      },
    });
  });

  it('A long Run passes revertAt', async () => {
    const chatId = await createChat(heldFor(about(2000)));
    const live = holdNextTurn();
    const pending = send(chatId, { text: 'long turn' }).then((res) => res);

    await live;

    // The Run is already on the held model, and the Chat still stores the hold:
    // a live Run never re-reads it.
    expect((await latestRun(chatId)).modelId).toBe(SONNET.id);

    const after = Date.now() + 3000;

    await until('the hold to pass', () => Promise.resolve(Date.now() > after));

    expect((await latestRun(chatId)).modelId).toBe(SONNET.id);
    expect((await getChat(chatId)).modelSelection).toHaveProperty('hold');

    releaseTurn?.();
    releaseTurn = undefined;
    expect((await pending).status).toBe(200);
  });

  it('A queue item after revertAt', async () => {
    const { chatId, runId } = await chatWithLiveRun();

    await storeSelection(chatId, heldFor(about(-1)));

    expect((await queue(chatId)).status).toBe(202);
    await settle(runId, 'completed');
    await until(
      'the promoted Run',
      async () => (await runsOf(chatId)).length >= 2,
    );

    expect(await latestRun(chatId)).toMatchObject({
      selector: '@coding',
      modelId: CODEX.id,
    });
    expect((await getChat(chatId)).modelSelection).not.toHaveProperty('hold');
  });

  it('A queue item after a switch', async () => {
    const { chatId, runId } = await chatWithLiveRun();

    // The hold arrives while the Run is live.
    await storeSelection(chatId, heldFor(about(3_600_000)));

    expect((await queue(chatId)).status).toBe(202);
    await settle(runId, 'completed');
    await until(
      'the promoted Run',
      async () => (await runsOf(chatId)).length >= 2,
    );

    expect(await latestRun(chatId)).toMatchObject({
      selector: '@coding',
      modelId: SONNET.id,
      effort: 'low',
    });
    // A derived creator never removes a hold that still applies.
    expect((await getChat(chatId)).modelSelection).toHaveProperty('hold');
  });

  it('A queue item with its own selector', async () => {
    const { chatId, runId } = await chatWithLiveRun();

    await storeSelection(chatId, heldFor(about(3_600_000)));

    expect((await queue(chatId, { selector: '@fast' })).status).toBe(202);
    await settle(runId, 'completed');
    await until(
      'the promoted Run',
      async () => (await runsOf(chatId)).length >= 2,
    );

    expect(await latestRun(chatId)).toMatchObject({
      selector: '@fast',
      modelId: FAST.id,
    });
    // The owner send that queued it replaced the selection, hold included.
    expect((await getChat(chatId)).modelSelection).not.toHaveProperty('hold');
  });

  it('A promotion never rewrites a selection the owner stored after queueing', async () => {
    const { chatId, runId } = await chatWithLiveRun();

    expect((await queue(chatId, { selector: '@fast' })).status).toBe(202);

    // The owner's selection changes while the item waits; the item still names
    // `@fast`, so promotion serves it without touching what the Chat stores.
    const held = heldFor(about(3_600_000));
    await storeSelection(chatId, held);

    await settle(runId, 'completed');
    await until(
      'the promoted Run',
      async () => (await runsOf(chatId)).length >= 2,
    );

    expect(await latestRun(chatId)).toMatchObject({
      selector: '@fast',
      modelId: FAST.id,
    });
    expect((await getChat(chatId)).modelSelection).toEqual({
      selector: held.selector,
      effort: held.effort,
      hold: held.hold,
    });
  });

  /** A Chat whose latest Run completed, so a settlement starts its notice. */
  async function chatWithCompletedRun(): Promise<string> {
    const chatId = await createChat();

    await tenantDb.runAs(userAId, async (tx) => {
      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'seed' }],
        attachments: [],
      });

      const runs = new RunsRepository(tx);

      const run = await runs.create({
        chatId,
        messageId: message.id,
        userId: userAId,
        modelId: CODEX.id,
      });

      await runs.markStarted(run.id, userAId);
      await runs.markFinished(run.id, userAId, 'completed');
    });

    return chatId;
  }

  async function settleJob(
    chatId: string,
    seq: number,
    effort?: string,
  ): Promise<void> {
    const job = await tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).insert(
        newChatJob({
          chatId,
          ownerUserId: userAId,
          seq,
          workerInstanceId: crypto.randomUUID(),
          artifactReadable: false,
          settings: {
            selector: '@coding',
            ...(effort !== undefined && { effort }),
            permissionMode: 'default',
          },
        }),
      ),
    );

    await settleBashJob(
      tenantDb,
      job,
      {
        output: {
          stdout: 'settled output',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'succeeded', result: { exitCode: 0 } },
        offsets: { stdout: 0, stderr: 0 },
      },
      { maxBytes: 65_536, hostFiles: false, noticeRuns },
    );
  }

  it('A notice uses the hold of the Chat', async () => {
    const chatId = await chatWithCompletedRun();

    await storeSelection(chatId, heldFor(about(3_600_000)));

    // The job records the effort of the Run that started it; the hold's effort
    // serves the notice instead.
    await settleJob(chatId, 7, 'xhigh');
    await until(
      'the notice Run',
      async () => (await runsOf(chatId)).length >= 2,
    );

    expect(await latestRun(chatId)).toMatchObject({
      selector: '@coding',
      modelId: SONNET.id,
      effort: 'low',
    });
  });

  it('A fork of a held Chat', async () => {
    const selection = heldFor(about(3_600_000));
    const chatId = await createChat(selection);

    await tenantDb.runAs(userAId, async (tx) => {
      await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'fork me' }],
        attachments: [],
      });
    });

    const res = await request(http)
      .post(`/api/v1/chats/${chatId}/forks`)
      .set('Cookie', cookieA)
      .send({});

    expect(res.status).toBe(201);
    expect(chatSchema.parse(res.body).modelSelection).toEqual({
      selector: selection.selector,
      effort: selection.effort,
      hold: selection.hold,
    });
  });

  it('A shared fork gets no hold', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    const published = await request(http)
      .patch(`/api/v1/chats/${chatId}`)
      .set('Cookie', cookieA)
      .send({ visibility: 'public' });

    expect(published.status).toBe(200);

    const res = await request(http)
      .post(`/api/v1/shared/chats/${chatId}/forks`)
      .set('Cookie', cookieB)
      .send({});

    expect(res.status).toBe(201);
    expect(chatSchema.parse(res.body).modelSelection).toBeNull();
  });

  it('A compact on a held Chat', async () => {
    const chatId = await createChat(heldFor(about(3_600_000)));

    await tenantDb.runAs(userAId, async (tx) => {
      const messages = new MessagesRepository(tx);

      await messages.create({
        chatId,
        role: 'user',
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'Keep the plan.' }],
        attachments: [],
      });
      await messages.create({
        chatId,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'Kept.' }],
        attachments: [],
      });
    });

    // The compaction Run's admission is what this asserts; execution is not.
    vi.spyOn(app.get(RunDispatchService), 'dispatch').mockResolvedValue();

    const res = await send(chatId, { text: '/compact' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: 'compact' });
    expect(await latestRun(chatId)).toMatchObject({
      kind: 'compaction',
      selector: '@coding',
      modelId: SONNET.id,
      effort: 'low',
    });
  });
});
