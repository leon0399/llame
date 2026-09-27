import type { Server } from 'node:http';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { systemPromptReceipts } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { isString } from '@workspace/runtime-safety';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { RunsRepository } from './runs-repository';

describe('GET /api/v1/runs/:id/context-receipt', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  let ownerId = '';
  let otherId = '';
  let ownerCookie = '';
  let otherCookie = '';
  const password = 'password123';
  const tag = `${Date.now()}-${crypto.randomUUID()}`;

  async function register(email: string, name: string) {
    const response = await request(http)
      .post('/auth/v1/register')
      .send({ email, password, name });
    expect(response.status).toBe(201);
    const body: unknown = response.body;
    expectRegisteredUserId(body);
    return { id: body.user.id, cookie: cookieOf(response) };
  }

  async function seedRun(userId: string) {
    return tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'Context receipt',
      });
      const message = await new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'Inspect context' }],
      });
      return new RunsRepository(tx).create({
        chatId: chat.id,
        messageId: message.id,
        userId,
        modelId: 'system:test',
      });
    });
  }

  beforeAll(async () => {
    if (!process.env.POSTGRES_URL)
      throw new Error('Integration database was not provisioned.');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const owner = await register(
      `receipt-owner-${tag}@example.com`,
      'Receipt Owner',
    );
    ownerId = owner.id;
    ownerCookie = owner.cookie;
    const other = await register(
      `receipt-other-${tag}@example.com`,
      'Receipt Other',
    );
    otherId = other.id;
    otherCookie = other.cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns ordered system-only receipts and hides the receipt cross-tenant', async () => {
    const run = await seedRun(ownerId);
    const firstAttempt = await tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).markStarted(run.id, ownerId),
    );
    const secondAttempt = await tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).markStarted(run.id, ownerId),
    );
    const firstAttemptId = firstAttempt?.activeAttemptId;
    const secondAttemptId = secondAttempt?.activeAttemptId;
    if (!isString(firstAttemptId) || !isString(secondAttemptId)) {
      throw new Error('Expected worker attempts to be assigned');
    }

    await tenantDb.runAs(ownerId, (tx) =>
      tx.insert(systemPromptReceipts).values([
        {
          ownerUserId: ownerId,
          runId: run.id,
          attemptId: firstAttemptId,
          source: 'project_default',
          systemPrompt: 'First effective prompt',
          promptHash: 'first-prompt-hash',
          createdAt: new Date('2026-09-01T10:00:00.000Z'),
        },
        {
          ownerUserId: ownerId,
          runId: run.id,
          attemptId: secondAttemptId,
          source: 'model_override',
          systemPrompt: 'Second effective prompt',
          promptHash: 'second-prompt-hash',
          createdAt: new Date('2026-09-01T10:00:01.000Z'),
        },
      ]),
    );
    await tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).markFinished(run.id, ownerId, 'completed', {
        attemptId: secondAttemptId,
      }),
    );

    const ownerResponse = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', ownerCookie);

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body).toMatchObject({
      modelId: 'system:test',
      activeAttemptId: secondAttemptId,
      completedAttemptId: secondAttemptId,
      state: 'prepared',
      receipts: [
        {
          attemptId: firstAttemptId,
          promptSource: 'project_default',
          systemPrompt: 'First effective prompt',
          promptHash: 'first-prompt-hash',
        },
        {
          attemptId: secondAttemptId,
          promptSource: 'model_override',
          systemPrompt: 'Second effective prompt',
          promptHash: 'second-prompt-hash',
        },
      ],
    });
    for (const field of [
      'tools',
      'toolAvailability',
      'availabilityHash',
      'contentHash',
    ]) {
      expect(ownerResponse.body).not.toHaveProperty(field);
    }
    expect(JSON.stringify(ownerResponse.body)).not.toMatch(
      /ownerUserId|runId|providerModelId|credential|executor|path|\/home\//i,
    );

    const otherResponse = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', otherCookie);
    expect(otherResponse.status).toBe(404);
  });

  it('reports pending before any worker attempt prepares context', async () => {
    const run = await seedRun(ownerId);
    const response = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', ownerCookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      modelId: 'system:test',
      state: 'pending',
      receipts: [],
    });
  });

  it('reports not_produced for a terminal run without an attempt receipt', async () => {
    const run = await seedRun(ownerId);
    await tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).markFinished(run.id, ownerId, 'failed', {
        error: { message: 'worker failed before prompt preparation' },
      }),
    );

    const response = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', ownerCookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      modelId: 'system:test',
      state: 'not_produced',
      receipts: [],
    });
  });

  it('requires authentication', async () => {
    const response = await request(http).get(
      `/api/v1/runs/${crypto.randomUUID()}/context-receipt`,
    );
    expect(response.status).toBe(401);
  });

  it('keeps the second owner fixture meaningful for FORCE RLS', () => {
    expect(otherId).not.toBe(ownerId);
  });
});
