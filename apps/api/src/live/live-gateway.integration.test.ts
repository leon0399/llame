/**
 * Live gateway over a real WebSocket against a live DB:
 * - an upgrade without a session, with an invalid one, or from a foreign
 *   Origin is refused before `101`;
 * - an owner's socket receives the renamed chat record, the new Run record,
 *   and the Run's progress for the owner's own changes;
 * - another owner's socket receives nothing for those changes (isolation).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Server } from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { TenantDbService } from '../db/tenant-db.service';
import { MachinesStatusRepository } from '../machines/machines-status.repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { LIVE_PATH } from './live-gateway.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type Client = { socket: WebSocket; messages: Array<UnknownRecord> };

describeIfDb('LiveGatewayService', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  let machineStatus: MachinesStatusRepository;
  let url: string;
  const users: Record<'a' | 'b', { id: string; cookie: string }> = {
    a: { id: '', cookie: '' },
    b: { id: '', cookie: '' },
  };
  const clients: Array<Client> = [];

  const register = async (name: string) => {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `live-${name}-${crypto.randomUUID()}@test.com`,
        password: 'correct horse battery staple',
        name,
      });
    expect(res.status).toBe(201);
    expectRegisteredUserId(res.body);
    return { id: res.body.user.id, cookie: cookieOf(res) };
  };

  /** Resolves with the HTTP status of a refused upgrade, or 101 when accepted. */
  const upgradeStatus = (headers: Record<string, string>): Promise<number> =>
    new Promise((resolve) => {
      const socket = new WebSocket(url, { headers });
      socket.on('open', () => {
        socket.close();
        resolve(101);
      });
      socket.on('unexpected-response', (_req, res) =>
        resolve(res.statusCode ?? 0),
      );
      socket.on('error', () => undefined);
    });

  const connect = (cookie: string): Promise<Client> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { cookie, origin: 'http://localhost:3000' },
      });
      const client: Client = { socket, messages: [] };
      socket.on('message', (data) => {
        if (!Buffer.isBuffer(data)) return;
        const parsed: unknown = JSON.parse(data.toString('utf8'));
        if (isRecord(parsed)) client.messages.push(parsed);
      });
      socket.on('open', () => {
        clients.push(client);
        resolve(client);
      });
      socket.on('error', reject);
    });

  const waitForMessage = async (
    client: Client,
    predicate: (m: UnknownRecord) => boolean,
  ): Promise<UnknownRecord> => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const hit = client.messages.find(predicate);
      if (hit) return hit;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('live message not received');
  };

  const newChat = async (owner: string): Promise<string> => {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).createIfAbsent({
        id,
        ownerUserId: owner,
        title: 'Live',
      }),
    );
    return id;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
    machineStatus = app.get(MachinesStatusRepository);
    const address = http.address();
    if (!address || isString(address)) {
      throw new Error('expected a TCP listen address');
    }
    url = `ws://127.0.0.1:${address.port}${LIVE_PATH}`;
    users.a = await register('a');
    users.b = await register('b');
  });

  afterAll(async () => {
    for (const client of clients) client.socket.terminate();
    await app?.close();
  });

  it('refuses an upgrade without a session, with an invalid one, or from a foreign Origin', async () => {
    expect(await upgradeStatus({})).toBe(401);
    expect(await upgradeStatus({ cookie: 'llame_session=not-a-session' })).toBe(
      401,
    );
    expect(
      await upgradeStatus({
        cookie: users.a.cookie,
        origin: 'https://evil.example',
      }),
    ).toBe(403);
    expect(
      await upgradeStatus({
        cookie: users.a.cookie,
        origin: 'http://localhost:3000',
      }),
    ).toBe(101);
  });

  it("delivers an owner's own changes and nothing to another owner", async () => {
    const a = await connect(users.a.cookie);
    const b = await connect(users.b.cookie);

    const chatId = await newChat(users.a.id);
    const rename = await request(http)
      .patch(`/api/v1/chats/${chatId}`)
      .set('Cookie', users.a.cookie)
      .send({ title: 'Renamed live' });
    expect(rename.status).toBe(200);

    await waitForMessage(
      a,
      (m) =>
        m['type'] === 'chat.upserted' &&
        isRecord(m['chat']) &&
        m['chat']['id'] === chatId &&
        m['chat']['title'] === 'Renamed live',
    );

    const runId = await tenantDb.runAs(users.a.id, async (tx) => {
      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: users.a.id,
        parts: [{ type: 'text', text: 'go' }],
      });
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: message.id,
        userId: users.a.id,
        modelId: 'system:openai:gpt-5.4-mini',
      });
      return run.id;
    });
    await tenantDb.runAs(users.a.id, (tx) =>
      new RunEventsRepository(tx).append(runId, 'tool.requested', {}),
    );
    await waitForMessage(
      a,
      (m) =>
        m['type'] === 'run.updated' &&
        isRecord(m['run']) &&
        m['run']['id'] === runId &&
        m['run']['status'] === 'queued',
    );
    await waitForMessage(
      a,
      (m) =>
        m['type'] === 'run.progress' &&
        m['runId'] === runId &&
        m['phase'] === 'tool',
    );

    // B's own change is a marker: once it arrives, any leak of A's earlier
    // changes would already have arrived too (one ordered NOTIFY stream).
    const marker = await newChat(users.b.id);
    await waitForMessage(
      b,
      (m) => isRecord(m['chat']) && m['chat']['id'] === marker,
    );
    const seenByB = JSON.stringify(b.messages);
    expect(seenByB).not.toContain(chatId);
    expect(seenByB).not.toContain(runId);
    expect(seenByB).not.toContain('Renamed live');
    expect(JSON.stringify(a.messages)).not.toContain(marker);
  });

  it('delivers an instance-wide Machine status change to every user', async () => {
    const a = await connect(users.a.cookie);
    const b = await connect(users.b.cookie);
    const name = `live-${crypto.randomUUID()}`;

    // The real writer path: one successful contact, as the probe records it.
    await machineStatus.recordContact({
      name,
      at: new Date(),
      hubProtocolVersion: 1,
      daemonProtocolVersion: 1,
      daemonVersion: '0.4.0',
      roots: ['/srv/projects'],
    });

    const isMachine = (m: UnknownRecord) =>
      m['type'] === 'machine.upserted' &&
      isRecord(m['machine']) &&
      m['machine']['name'] === name;
    const seenByA = await waitForMessage(a, isMachine);
    const seenByB = await waitForMessage(b, isMachine);

    // The record is instance-wide: both users receive the same frame, and it
    // is the shape `GET /api/v1/machines` serves.
    expect(seenByA).toEqual(seenByB);
    const machine = seenByA['machine'];
    if (!isRecord(machine)) throw new Error('expected a machine record');
    expect(machine).toMatchObject({
      name,
      status: 'online',
      failureReason: null,
      hubProtocolVersion: 1,
      daemonProtocolVersion: 1,
      daemonVersion: '0.4.0',
      roots: ['/srv/projects'],
    });
    expect(isString(machine['lastSeenAt'])).toBe(true);

    // Removing the Machine from the configuration prunes its row on the next
    // probe; both users must learn that the Machine is gone.
    const db = app.get<PostgresJsDatabase>('DB_DEV', { strict: false });
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.machines_system', '1', true)`,
      );
      await tx.execute(sql`delete from machines_status where name = ${name}`);
    });
    const isRemoval = (m: UnknownRecord) =>
      m['type'] === 'machine.deleted' && m['name'] === name;
    expect(await waitForMessage(a, isRemoval)).toEqual({
      type: 'machine.deleted',
      name,
    });
    expect(await waitForMessage(b, isRemoval)).toEqual({
      type: 'machine.deleted',
      name,
    });
  });
});
