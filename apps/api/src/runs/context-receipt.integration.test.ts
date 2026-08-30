import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { modelContextSnapshots } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { isRecord } from '../unknown-record';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { seedModelContextSnapshot } from './model-context-snapshot.test-fixture';
import { RunsRepository } from './runs-repository';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

d('GET /api/v1/runs/:id/context-receipt', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
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

  async function seedRun(userId: string, snapshotId: string) {
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
        modelContextSnapshotId: snapshotId,
      });
    });
  }

  beforeAll(async () => {
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

  it('returns owner-safe v1 availability and hides the receipt cross-tenant', async () => {
    const snapshot = await tenantDb.runAs(ownerId, (tx) =>
      seedModelContextSnapshot(tx, ownerId, 'receipt-v1', [
        'search_conversations',
      ]),
    );
    const run = await seedRun(ownerId, snapshot.id);

    const ownerResponse = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', ownerCookie);

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body).toMatchObject({
      availabilityHash: snapshot.availabilityHash,
      toolAvailability: {
        version: 1,
        entries: [
          {
            id: 'search_conversations',
            state: 'available',
            label: 'available',
          },
        ],
      },
    });
    expect(JSON.stringify(ownerResponse.body)).not.toMatch(
      /ownerUserId|promptHash|toolHash|sourceDiagnostics|session|header|url/i,
    );

    const otherResponse = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', otherCookie);
    expect(otherResponse.status).toBe(404);
  });

  it('reports historical v0 as unobserved rather than an empty catalog', async () => {
    const snapshot = await tenantDb.runAs(ownerId, async (tx) => {
      const [created] = await tx
        .insert(modelContextSnapshots)
        .values({
          ownerUserId: ownerId,
          availabilityHash:
            '8c150f84f99edb30ec7fb866968b27db1bfc2d26e1be8a7e94ee61e565adf11e',
          contentHash: `legacy-content-${crypto.randomUUID()}`,
          promptHash: `legacy-prompt-${crypto.randomUUID()}`,
          toolHash: `legacy-tools-${crypto.randomUUID()}`,
          source: 'project_default',
          systemPrompt: 'Historical prompt',
          toolAvailabilityManifest: { version: 0, state: 'unobserved' },
          toolDeclarations: [],
        })
        .returning();
      if (!created) {
        throw new Error('Failed to seed historical snapshot');
      }
      return created;
    });
    const run = await seedRun(ownerId, snapshot.id);

    const response = await request(http)
      .get(`/api/v1/runs/${run.id}/context-receipt`)
      .set('Cookie', ownerCookie);

    expect(response.status).toBe(200);
    const body: unknown = response.body;
    if (!isRecord(body)) {
      throw new Error('Expected object response body');
    }
    expect(body.toolAvailability).toEqual({
      version: 0,
      state: 'unobserved',
    });
    expect(body.toolAvailability).not.toHaveProperty('entries');
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
