import { randomUUID } from 'node:crypto';
import { type Server } from 'node:http';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { searchChatDocuments } from '../db/schema/search';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { loadProductUserAgent } from '../instance-config/product-identity';
import { ModelsService } from '../models/models.service';
import { RunDispatchService } from '../runs/run-dispatch.service';
import { RunsRepository } from '../runs/runs-repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { settleBashJob } from '../jobs/bash-job-store';
import { JobNoticeRunService } from '../runs/job-notice-run.service';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { bootWorkerHarness, type WorkerHarness } from '../runs/worker-harness';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { SearchIndexService } from '../search/search-index.service';
import {
  cookieOf,
  expectRegisteredUserId,
  FakeModelsService,
  waitFor,
} from '../testing/support';
import { toMessageParts, toRunUserMessage } from './chat-message-parts';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatsService } from './chats.service';

const databaseUrl = process.env['TEST_DATABASE_URL'];

if (!databaseUrl)
  throw new Error(
    'host-history.integration.test.ts requires TEST_DATABASE_URL; run pnpm --filter api test:integration',
  );

vi.setConfig({ testTimeout: 60_000 });

const noticeParts = [
  {
    type: 'data-context',
    data: {
      v: 1,
      producer: 'job',
      form: 'notice',
      runId: randomUUID(),
      payload: { job: 'job://bash-7', state: 'failed' },
      text: '<system-reminder>PRIVATE_JOB_OUTPUT_TOKEN</system-reminder>',
    },
  },
];

describe('seeded host history boundaries', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  let chats: ChatsService;
  let dispatch: RunDispatchService;
  let owner: string;
  let visitor: string;
  let ownerCookie: string;
  let visitorCookie: string;
  const models = new FakeModelsService();
  let worker: WorkerHarness;

  beforeAll(async () => {
    process.env['POSTGRES_URL'] = databaseUrl;
    process.env['PGBOSS_SCHEMA'] =
      `${process.env['LLAME_TEST_SCHEMA_PREFIX'] ?? 'llame_t'}_host_${randomUUID().slice(0, 8)}`;

    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .overrideProvider(InstanceConfigService)
      .useValue({
        config: structuredClone(BUILT_IN_DEFAULTS),
        productUserAgent: loadProductUserAgent(),
      })
      .compile();

    app = testingModule.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
    chats = app.get(ChatsService);
    dispatch = app.get(RunDispatchService);

    async function register(name: string) {
      const response = await request(http)
        .post('/auth/v1/register')
        .send({
          email: `host-history-${name}-${randomUUID()}@example.com`,
          password: 'password123',
          name,
        });

      expect(response.status).toBe(201);
      const body: unknown = response.body;
      expectRegisteredUserId(body);

      return { id: body.user.id, cookie: cookieOf(response) };
    }

    const first = await register('owner');
    owner = first.id;
    ownerCookie = first.cookie;
    const second = await register('visitor');
    visitor = second.id;
    visitorCookie = second.cookie;
    worker = await bootWorkerHarness({ runsConcurrency: null });
  });

  afterAll(async () => {
    await app?.close();
    await worker?.close();
  });
  beforeEach(() => {
    models.client.turns.length = 0;
    models.createClientCalls.length = 0;
    models.client.responses = ['Host answer'];
    models.client.delayMs = 0;
  });

  const rows = (chatId: string, userId = owner) =>
    tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );

  async function seedHistory() {
    const seed = await tenantDb.runAs(owner, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: owner,
        title: 'Host history',
        visibility: 'public',
      });

      const messages = new MessagesRepository(tx);

      const question = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'OWNER_SEARCH_TOKEN' }],
      });

      const answer = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Earlier answer' }],
        inReplyTo: question.id,
      });

      const priorRun = await new RunsRepository(tx).create({
        chatId: chat.id,
        messageId: question.id,
        userId: owner,
        modelId: 'system:openai:gpt-5.5',
      });

      await new RunsRepository(tx).markFinished(
        priorRun.id,
        owner,
        'completed',
      );

      return { chat, question, answer, priorRun };
    });

    const job = await worker.tenantDb.runAs(owner, (tx) =>
      new ChatJobsRepository(tx).insert({
        chatId: seed.chat.id,
        ownerUserId: owner,
        executor: 'bash',
        seq: 1,
        runId: seed.priorRun.id,
        toolCallId: randomUUID(),
        workerInstanceId: randomUUID(),
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: {
          modelId: 'system:openai:gpt-5.5',
          permissionMode: 'default',
        },
      }),
    );

    await settleBashJob(
      worker.tenantDb,
      job,
      {
        output: {
          stdout: 'PRIVATE_JOB_OUTPUT_TOKEN',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'failed', result: { exitCode: 1 } },
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: worker.moduleRef.get(JobNoticeRunService),
      },
    );

    const host = await tenantDb.runAs(owner, async (tx) => {
      const messages = new MessagesRepository(tx);
      const chatMessages = await messages.findByChatId(seed.chat.id, owner);

      const trigger = chatMessages.find(
        (message) => message.role === 'user' && message.senderUserId === null,
      );

      if (!trigger)
        throw new Error('Job settlement did not create a host trigger.');

      const run = (
        await new RunsRepository(tx).findByChatId(seed.chat.id, owner)
      ).find((candidate) => candidate.messageId === trigger.id);

      if (!run) throw new Error('Job settlement did not create its host Run.');

      return { trigger, run };
    });

    await dispatch.dispatch({
      chatId: seed.chat.id,
      runId: host.run.id,
      userId: owner,
      modelId: host.run.modelId,
      userMessage: toRunUserMessage(host.trigger),
    });
    await waitFor(
      async () =>
        (await dispatch.jobState(host.run.id)) === 'completed'
          ? true
          : undefined,
      20_000,
      'settlement-created host Run completion',
    );

    const produced = await tenantDb.runAs(owner, async (tx) => {
      const messages = await new MessagesRepository(tx).findByChatId(
        seed.chat.id,
        owner,
      );

      const trigger = messages.find(
        (message) => message.id === host.trigger.id,
      );

      const reply = messages.find(
        (message) =>
          message.role === 'assistant' && message.inReplyTo === host.trigger.id,
      );

      if (!trigger || !reply)
        throw new Error(
          'The host Run did not persist its owner-history reply.',
        );

      return { trigger, reply };
    });

    return {
      chat: seed.chat,
      question: seed.question,
      answer: seed.answer,
      host: produced.trigger,
      reply: produced.reply,
    };
  }

  it('marks owner history, preserves assistant identity, and denies foreign owner history', async () => {
    const { chat, question, host, answer } = await seedHistory();
    const url = `/api/v1/chats/${chat.id}/messages`;
    const response = await request(http).get(url).set('Cookie', ownerCookie);
    expect(response.status).toBe(200);
    const body: unknown = response.body;

    for (const row of [
      { id: question.id, host: false },
      { id: host.id, host: true },
      { id: answer.id, host: false },
    ]) {
      expect(body).toHaveProperty(
        'messages',
        expect.arrayContaining([expect.objectContaining(row)]),
      );
    }

    expect(JSON.stringify(body)).toContain('PRIVATE_JOB_OUTPUT_TOKEN');

    const delivered = await worker.tenantDb.runAs(owner, (tx) =>
      new ChatDeliveriesRepository(tx).listDeliveredJobNotices(
        chat.id,
        owner,
        host.id,
      ),
    );

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.parts).toEqual([]);

    const foreign = await request(http).get(url).set('Cookie', visitorCookie);
    expect(foreign.status).toBe(404);
    expect(await rows(chat.id, visitor)).toEqual([]);
  });

  it('filters host rows before public pagination and shared forks, but owner forks remain literal', async () => {
    const { chat, question, answer, host, reply } = await seedHistory();
    const page = await chats.getSharedChat(chat.id, { limit: 2 });
    expect(page?.messages.map((row) => row.id)).toEqual([answer.id, reply.id]);

    const publicResponse = await request(http).get(
      `/api/v1/shared/chats/${chat.id}?limit=2`,
    );

    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body).toMatchObject({
      messages: [{ id: answer.id }, { id: reply.id }],
    });
    expect(JSON.stringify(publicResponse.body)).not.toContain(
      'PRIVATE_JOB_OUTPUT_TOKEN',
    );

    const earlier = await chats.getSharedChat(chat.id, {
      limit: 2,
      beforeSeq: answer.seq,
    });

    expect(earlier?.messages.map((row) => row.id)).toEqual([question.id]);
    const shared = await chats.forkSharedChat(chat.id, visitor);

    if (!shared) throw new Error('Public fork was not created');
    const sharedRows = await rows(shared.id, visitor);

    const visibleText = (parts: Array<unknown>) =>
      toMessageParts(parts)
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('');

    expect(sharedRows.map((row) => row.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ]);
    expect(sharedRows.map((row) => visibleText(row.parts))).toEqual(
      [question, answer, reply].map((row) => visibleText(row.parts)),
    );
    expect(sharedRows[1]?.inReplyTo).toBe(sharedRows[0]?.id);
    expect(sharedRows[2]?.inReplyTo).toBeNull();
    expect(
      sharedRows
        .filter((row) => row.role === 'user')
        .map((row) => row.senderUserId),
    ).toEqual([visitor]);
    expect(JSON.stringify(sharedRows)).not.toContain(
      'PRIVATE_JOB_OUTPUT_TOKEN',
    );

    const fork = await chats.forkChat(chat.id, owner);
    const copied = await rows(fork.id);
    const source = await rows(chat.id);
    expect(
      copied.map((row) => ({
        role: row.role,
        sender: row.senderUserId,
        parts: row.parts,
      })),
    ).toEqual(
      source.map((row) => ({
        role: row.role,
        sender: row.senderUserId,
        parts: row.parts,
      })),
    );
    const copiedHost = copied.find((row) => row.seq === host.seq);
    expect(copied.find((row) => row.seq === reply.seq)?.inReplyTo).toBe(
      copiedHost?.id,
    );
    expect(
      await tenantDb.runAsPublic((tx) =>
        new MessagesRepository(tx).findByChatId(fork.id, owner),
      ),
    ).toEqual([]);
  });

  it('uses owner text for recency and previews and never indexes host context as evidence', async () => {
    const { chat, question, reply } = await seedHistory();

    const first = await tenantDb.runAs(owner, async (tx) => {
      const earlierHost = await new ChatsRepository(tx).create({
        ownerUserId: owner,
      });

      const messages = new MessagesRepository(tx);
      await messages.create({
        chatId: earlierHost.id,
        role: 'user',
        parts: noticeParts,
      });

      const ownerRow = await messages.create({
        chatId: earlierHost.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'Owner opening' }],
      });

      const hostOnly = await new ChatsRepository(tx).create({
        ownerUserId: owner,
      });

      await messages.create({
        chatId: hostOnly.id,
        role: 'user',
        parts: noticeParts,
      });

      const selected = await messages.findEarliestUserMessagePerChat(
        [hostOnly.id, earlierHost.id, chat.id],
        owner,
      );

      return { selected, ownerRow };
    });

    expect(first.selected.map((row) => row.id).sort()).toEqual(
      [question.id, first.ownerRow.id].sort(),
    );
    const previews = await chats.listChatsWithLastMessage(owner);
    expect(
      previews.find((row) => row.chat.id === chat.id)?.lastMessage?.id,
    ).toBe(reply.id);
    await new SearchIndexService(tenantDb).reindexChat(chat.id, owner);

    const evidence = await tenantDb.runAs(owner, (tx) =>
      tx
        .select()
        .from(searchChatDocuments)
        .where(eq(searchChatDocuments.chatId, chat.id)),
    );

    expect(evidence.map((row) => row.content).join('\n')).toContain(
      'OWNER_SEARCH_TOKEN',
    );
    expect(evidence.map((row) => row.content).join('\n')).not.toContain(
      'PRIVATE_JOB_OUTPUT_TOKEN',
    );
  });

  it('still generates a title for a normal owner turn', async () => {
    const chat = await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: owner }),
    );

    const response = await request(http)
      .post(`/api/v1/chats/${chat.id}/messages`)
      .set('Cookie', ownerCookie)
      .send({
        modelId: 'system:openai:gpt-5.5',
        message: {
          id: randomUUID(),
          parts: [{ type: 'text', text: 'Owner title source' }],
        },
      });

    expect(response.status).toBe(200);

    const titled = await waitFor(
      async () => {
        const current = await chats.getChatById(chat.id, owner);

        return current?.title ?? undefined;
      },
      20_000,
      'owner title generation',
    );

    expect(titled).toBe('Generated Title');
    expect(models.createClientCalls).toContainEqual({
      modelId: 'system:openai:gpt-5.4-nano',
    });
  });

  it('does not generate a title for a real settlement-created host trigger', async () => {
    const seed = await tenantDb.runAs(owner, async (tx) => {
      const chat = await new ChatsRepository(tx).create({ ownerUserId: owner });

      const question = await new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'Earlier owner turn' }],
      });

      const priorRun = await new RunsRepository(tx).create({
        chatId: chat.id,
        messageId: question.id,
        userId: owner,
        modelId: 'system:openai:gpt-5.5',
      });

      await new RunsRepository(tx).markFinished(
        priorRun.id,
        owner,
        'completed',
      );

      return { chat, priorRun };
    });

    const job = await worker.tenantDb.runAs(owner, (tx) =>
      new ChatJobsRepository(tx).insert({
        chatId: seed.chat.id,
        ownerUserId: owner,
        executor: 'bash',
        seq: 1,
        runId: seed.priorRun.id,
        toolCallId: randomUUID(),
        workerInstanceId: randomUUID(),
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: {
          modelId: 'system:openai:gpt-5.5',
          permissionMode: 'default',
        },
      }),
    );

    await settleBashJob(
      worker.tenantDb,
      job,
      {
        output: {
          stdout: 'PRIVATE_JOB_OUTPUT_TOKEN',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'succeeded', result: { exitCode: 0 } },
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: worker.moduleRef.get(JobNoticeRunService),
      },
    );

    const host = await tenantDb.runAs(owner, async (tx) => {
      const message = (
        await new MessagesRepository(tx).findByChatId(seed.chat.id, owner)
      ).find((row) => row.role === 'user' && row.senderUserId === null);

      if (!message)
        throw new Error('Settlement did not create a host trigger.');

      const run = (
        await new RunsRepository(tx).findByChatId(seed.chat.id, owner)
      ).find((candidate) => candidate.messageId === message.id);

      if (!run) throw new Error('Settlement did not create its host Run.');

      return { message, run };
    });

    await dispatch.dispatch({
      chatId: seed.chat.id,
      runId: host.run.id,
      userId: owner,
      modelId: host.run.modelId,
      userMessage: toRunUserMessage(host.message),
    });
    await waitFor(
      async () =>
        (await dispatch.jobState(host.run.id)) === 'completed'
          ? true
          : undefined,
      20_000,
      'real host Run completion',
    );

    expect((await chats.getChatById(seed.chat.id, owner))?.title).toBeNull();
    expect(models.createClientCalls).not.toContainEqual({
      modelId: 'system:openai:gpt-5.4-nano',
    });
  });

  it.each([
    { label: 'empty', parts: [] },
    { label: 'persisted job context', parts: noticeParts },
  ])(
    'preserves the prior reply and skips titles for a $label host trigger',
    async ({ parts }) => {
      const seed = await tenantDb.runAs(owner, async (tx) => {
        const chat = await new ChatsRepository(tx).create({
          ownerUserId: owner,
        });

        const messages = new MessagesRepository(tx);

        const question = await messages.create({
          chatId: chat.id,
          role: 'user',
          senderUserId: owner,
          parts: [{ type: 'text', text: 'Earlier question' }],
        });

        await messages.create({
          chatId: chat.id,
          role: 'assistant',
          parts: [{ type: 'text', text: 'PRESERVE_EARLIER_REPLY' }],
          inReplyTo: question.id,
        });

        const host = await messages.create({
          chatId: chat.id,
          role: 'user',
          parts,
        });

        const run = await new RunsRepository(tx).create({
          chatId: chat.id,
          messageId: host.id,
          userId: owner,
          modelId: 'system:openai:gpt-5.5',
        });

        return { chat, host, run };
      });

      await dispatch.dispatch({
        chatId: seed.chat.id,
        runId: seed.run.id,
        userId: owner,
        modelId: seed.run.modelId,
        userMessage: toRunUserMessage(seed.host),
      });
      await waitFor(
        async () =>
          (await dispatch.jobState(seed.run.id)) === 'completed'
            ? true
            : undefined,
        20_000,
        'host fixture Run completion',
      );
      const prompt = models.client.turns[0]?.messages;
      expect(prompt?.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
      expect(JSON.stringify(prompt?.[1])).toContain('PRESERVE_EARLIER_REPLY');

      if (parts.length > 0)
        expect(JSON.stringify(prompt?.[2])).toContain(
          'PRIVATE_JOB_OUTPUT_TOKEN',
        );
      const chat = await chats.getChatById(seed.chat.id, owner);
      expect(chat?.title).toBeNull();
      expect(models.createClientCalls).not.toContainEqual({
        modelId: 'system:openai:gpt-5.4-nano',
      });
    },
  );
});
